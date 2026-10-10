import { open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import type { CodexFinding, CodexReviewRun } from "../shared/codex-review";
import { userHome } from "./service/discover";

// Codex writes each session to ~/.codex/sessions/YYYY/MM/DD/rollout-…jsonl. A
// review ends with an `ExitedReviewMode` item whose `review_output` holds its
// findings, each at an absolute path and line range of the reviewed checkout.

/** Day folders read at most, newest first. */
const MAX_DAYS = 120;
/** A session's first line, its metadata, is read up to this size. */
const MAX_META_BYTES = 1024 * 1024;
const CHUNK_BYTES = 1024 * 1024;
const MARKER = Buffer.from('ReviewMode"');

interface RawFinding extends Omit<CodexFinding, "id" | "path"> {
  file: string;
}
interface RawRun {
  createdAt: string;
  target: string;
  verdict: string;
  explanation: string;
  findings: RawFinding[];
}
interface Scan {
  size: number;
  mtimeMs: number;
  /** Where the next read starts; sessions only grow. */
  offset: number;
  meta: { threadId: string; cwd: string; commit: string | null; createdAt: string } | null;
  /** The target of the review that runs now. */
  target: string;
  runs: RawRun[];
}

const text = (value: unknown) => (typeof value === "string" ? value : "");
const inside = (folder: string, path: string) => {
  const rest = relative(folder, path);
  return !rest.startsWith("..") && !isAbsolute(rest);
};
const day = (time: number) => {
  const date = new Date(time);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
};

/** Reads the complete lines that contain MARKER, from `from` to `size`, and
 * returns where the next read starts. */
async function scanLines(path: string, from: number, size: number, visit: (line: string) => void) {
  const handle = await open(path, "r");
  try {
    const chunk = Buffer.alloc(CHUNK_BYTES);
    let position = from;
    let rest = Buffer.alloc(0);
    while (position < size) {
      const { bytesRead } = await handle.read(
        chunk,
        0,
        Math.min(CHUNK_BYTES, size - position),
        position,
      );
      if (!bytesRead) break;
      position += bytesRead;
      const data = Buffer.concat([rest, chunk.subarray(0, bytesRead)]);
      const complete = data.lastIndexOf(10) + 1;
      let cursor = 0;
      for (
        let found = data.indexOf(MARKER, cursor);
        found >= 0 && found < complete;
        found = data.indexOf(MARKER, cursor)
      ) {
        const end = data.indexOf(10, found);
        visit(data.toString("utf8", data.lastIndexOf(10, found) + 1, end));
        cursor = end + 1;
      }
      rest = Buffer.from(data.subarray(complete));
    }
    return position - rest.length;
  } finally {
    await handle.close();
  }
}

async function readMeta(path: string) {
  const handle = await open(path, "r");
  try {
    // The metadata line holds Codex's instructions, often 20 KB; read in steps.
    const buffer = Buffer.alloc(MAX_META_BYTES);
    let filled = 0;
    let end = -1;
    while (end < 0 && filled < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        filled,
        Math.min(64 * 1024, buffer.length - filled),
        filled,
      );
      if (!bytesRead) break;
      end = buffer.indexOf(10, filled);
      filled += bytesRead;
      if (end >= filled) end = -1;
    }
    if (end < 0) return null;
    const entry = JSON.parse(buffer.toString("utf8", 0, end)) as {
      type?: string;
      payload?: Record<string, unknown>;
    };
    const payload = entry.payload ?? {};
    const git = (payload.git ?? {}) as Record<string, unknown>;
    if (entry.type !== "session_meta" || !text(payload.id) || !text(payload.cwd)) return null;
    return {
      meta: {
        threadId: text(payload.id),
        cwd: await realpath(text(payload.cwd)).catch(() => text(payload.cwd)),
        commit: text(git.commit_hash) || null,
        createdAt: text(payload.timestamp),
      },
      offset: end + 1,
    };
  } catch {
    return null;
  } finally {
    await handle.close();
  }
}

/** A review item from one rollout line, with the line's time, or nothing. */
function reviewItem(line: string) {
  try {
    const entry = JSON.parse(line) as {
      timestamp?: string;
      type?: string;
      payload?: Record<string, unknown>;
    };
    const item = entry.payload?.item as Record<string, unknown> | undefined;
    if (entry.type !== "event_msg" || entry.payload?.type !== "item_completed" || !item)
      return undefined;
    return { item, at: text(entry.timestamp) };
  } catch {
    return undefined;
  }
}

function rawRun(output: Record<string, unknown>, target: string, createdAt: string): RawRun {
  const findings = Array.isArray(output.findings) ? output.findings : [];
  return {
    createdAt,
    target,
    verdict: text(output.overall_correctness),
    explanation: text(output.overall_explanation),
    findings: findings.flatMap((value: Record<string, unknown>) => {
      const location = (value?.code_location ?? {}) as Record<string, unknown>;
      const range = (location.line_range ?? {}) as Record<string, unknown>;
      const file = text(location.absolute_file_path);
      const start = Number(range.start);
      const end = Number(range.end);
      if (!file || !Number.isInteger(start) || start < 1) return [];
      const title = text(value.title);
      const priority =
        typeof value.priority === "number"
          ? value.priority
          : Number(/^\[P(\d)\]/.exec(title)?.[1] ?? Number.NaN);
      return [
        {
          title: title.replace(/^\[P\d\]\s*/, ""),
          body: text(value.body),
          priority: Number.isInteger(priority) && priority >= 0 && priority <= 3 ? priority : null,
          confidence: typeof value.confidence_score === "number" ? value.confidence_score : null,
          file,
          startLine: start,
          endLine: Number.isInteger(end) && end >= start ? end : start,
        },
      ];
    }),
  };
}

/** Finds Codex reviews in Codex's session files. Each file is read once, and
 * then only from where the last read stopped. */
export class CodexReviews {
  private scans = new Map<string, Scan>();
  constructor(private home: () => string = userHome) {}

  private async scan(path: string) {
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) return undefined;
    let scan = this.scans.get(path);
    if (scan && scan.size === info.size && scan.mtimeMs === info.mtimeMs) return scan;
    if (!scan || info.size < scan.size) {
      const read = await readMeta(path);
      scan = {
        size: 0,
        mtimeMs: 0,
        offset: read?.offset ?? 0,
        meta: read?.meta ?? null,
        target: "",
        runs: [],
      };
      this.scans.set(path, scan);
    }
    if (scan.meta) {
      const current = scan;
      current.offset = await scanLines(path, current.offset, info.size, (line) => {
        const { item, at } = reviewItem(line) ?? {};
        if (item?.type === "EnteredReviewMode") current.target = text(item.user_facing_hint);
        if (item?.type === "ExitedReviewMode" && item.review_output)
          current.runs.push(
            rawRun(
              item.review_output as Record<string, unknown>,
              current.target || "changes",
              at || current.meta!.createdAt,
            ),
          );
      });
    }
    scan.size = info.size;
    scan.mtimeMs = info.mtimeMs;
    return scan;
  }

  /** Reviews that Codex ran in one of `repos` or a folder below it, from
   * sessions that started on `since`'s day or later, newest first. */
  async find(repos: readonly string[], since: number): Promise<CodexReviewRun[]> {
    const root = join(this.home(), ".codex", "sessions");
    const first = day(since);
    const list = async (path: string) => (await readdir(path).catch(() => [])).sort().reverse();
    const files: string[] = [];
    let days = 0;
    search: for (const year of await list(root))
      for (const month of await list(join(root, year)))
        for (const date of await list(join(root, year, month))) {
          if (`${year}/${month}/${date}` < first || ++days > MAX_DAYS) break search;
          const folder = join(root, year, month, date);
          for (const name of await list(folder))
            if (name.startsWith("rollout-") && name.endsWith(".jsonl"))
              files.push(join(folder, name));
        }
    const runs: CodexReviewRun[] = [];
    for (const file of files) {
      const scan = await this.scan(file);
      if (!scan?.meta || !scan.runs.length) continue;
      const { meta } = scan;
      // The innermost checkout, when one is inside another.
      const repo = repos
        .filter((candidate) => inside(candidate, meta.cwd))
        .sort((a, b) => b.length - a.length)[0];
      if (!repo) continue;
      scan.runs.forEach((run, index) =>
        runs.push({
          id: `${meta.threadId}:${index}`,
          threadId: meta.threadId,
          repo,
          commit: meta.commit,
          createdAt: run.createdAt,
          target: run.target,
          verdict: run.verdict,
          explanation: run.explanation,
          findings: run.findings.flatMap(({ file, ...finding }, number) =>
            inside(repo, file) && file !== repo
              ? [
                  {
                    ...finding,
                    id: `${meta.threadId}:${index}:${number}`,
                    path: relative(repo, file),
                  },
                ]
              : [],
          ),
        }),
      );
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
