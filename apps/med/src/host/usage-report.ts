import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { canonicalModel, PRICE_TABLE, requestCost } from "../shared/model-usage";
import type { UsageReport, UsageRow } from "../shared/usage-report";
import { newRead, readMore, type Read } from "./session-usage";
import { userHome } from "./service/discover";

// What every session on this Mac spent, for the Usage page
// (docs/usage/usage.md): Claude Code's transcripts and their subagents',
// Codex's rollouts, Pi's sessions, and Med's files of the other ACP sessions
// that it ran, such as Antigravity's. A file that changed before the range
// starts has nothing in it. Each file's requests stay as numbers; a file that grows is
// read from where it ended while it is recent, and again in full after.
//
// Claude Code copies requests into other files: a resumed or forked session
// starts with its original's, and a subagent's file can be in two sessions'
// folders. A request counts once, by its message ID. Pi copies a forked
// session's entries the same way, and its requests count once by entry.

type Kind = "claude" | "codex" | "acp" | "pi";

/** A file's requests, `FIELDS` numbers each. */
const FIELDS = 9;
const [KEY, AT, MODEL, INPUT, OUTPUT, CACHE_READ, CACHE_WRITE, COST, AGENT_PRICED] = [
  0, 1, 2, 3, 4, 5, 6, 7, 8,
];
/** A read file stays ready to read on from its end this long after it changed. */
const RECENT_MS = 30 * 60 * 1000;
/** Files read at once. */
const READERS = 6;

interface Kept {
  size: number;
  modified: number;
  /** The agent: Claude Code, Codex, Pi, or another ACP agent that Med ran. */
  agent: string;
  models: string[];
  requests: Float64Array;
  /** The read state of a recent file, to read on from its end. */
  read?: Read;
}

/** A 53-bit hash of a request's ID: two FNV-1a hashes. */
function hashOf(text: string) {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ code, 0x5bd1e995);
  }
  return (a >>> 0) * 0x200000 + ((b >>> 0) & 0x1fffff);
}

/** The requests of a read file, priced as each was on its day. */
function pack(kind: Kind, path: string, read: Read) {
  const models: string[] = [];
  const index = new Map<string, number>();
  const requests = new Float64Array(read.requests.size * FIELDS);
  let at = 0;
  for (const [id, request] of read.requests) {
    const model = canonicalModel(request.model);
    let slot = index.get(model);
    if (slot === undefined) index.set(model, (slot = models.push(model) - 1));
    const listed = requestCost(request.model, request.tokens, {
      ...(request.at ? { at: request.at } : {}),
      ...(request.whole ? { whole: true } : {}),
    });
    const cost = listed ?? request.agentCost?.cost;
    const { tokens } = request;
    requests.set(
      [
        // Codex's and Med's keys are their file's own; Claude Code's and Pi's
        // are the same in every file that copies the request.
        hashOf(kind === "claude" || kind === "pi" ? id : `${path}\n${id}`),
        request.at ?? Number.NaN,
        slot,
        tokens.input,
        tokens.output,
        tokens.cacheRead,
        tokens.cacheWrite5m + tokens.cacheWrite1h,
        cost ?? Number.NaN,
        listed === undefined && cost !== undefined ? 1 : 0,
      ],
      at,
    );
    at += FIELDS;
  }
  return { models, requests };
}

/** The local day of a time, as YYYY-MM-DD. */
export function localDay(at: number) {
  const date = new Date(at);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The start of a local day, YYYY-MM-DD. */
const dayStart = (day: string) => {
  const [year, month, date] = day.split("-").map(Number) as [number, number, number];
  return new Date(year, month - 1, date).getTime();
};

const jsonl = async (folder: string) =>
  (await readdir(folder).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".jsonl"))
    .map((name) => join(folder, name));

/** Claude Code's transcripts: each project's sessions and their subagents. */
async function claudeFiles(home: string) {
  const root = join(home, ".claude", "projects");
  const projects = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(
    projects
      .filter((entry) => entry.isDirectory())
      .map(async (project) => {
        const folder = join(root, project.name);
        const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
        const subagents = await Promise.all(
          entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => jsonl(join(folder, entry.name, "subagents"))),
        );
        return [
          ...entries
            .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
            .map((entry) => join(folder, entry.name)),
          ...subagents.flat(),
        ];
      }),
  );
  return found.flat();
}

/** Pi's sessions: a folder of each working directory's. */
async function piFiles(home: string) {
  const root = join(process.env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), "sessions");
  const folders = await readdir(root, { withFileTypes: true }).catch(() => []);
  const found = await Promise.all(
    folders.filter((entry) => entry.isDirectory()).map((entry) => jsonl(join(root, entry.name))),
  );
  return found.flat();
}

/** Codex's rollouts: ~/.codex/sessions/YYYY/MM/DD, and the archived ones. */
async function codexFiles(home: string) {
  const root = join(home, ".codex", "sessions");
  const level = async (folder: string) =>
    (await readdir(folder).catch(() => [] as string[]))
      .filter((name) => /^\d+$/.test(name))
      .map((name) => join(folder, name));
  const days = (
    await Promise.all((await Promise.all((await level(root)).map(level))).flat().map(level))
  ).flat();
  const files = await Promise.all(days.map(jsonl));
  return [...files.flat(), ...(await jsonl(join(home, ".codex", "archived_sessions")))];
}

export function createUsageReport(
  options: {
    home?: () => string;
    /** The folder of Med's files of the ACP sessions that it ran. */
    logs?: string;
    now?: () => number;
  } = {},
) {
  const home = options.home ?? userHome;
  const now = options.now ?? Date.now;
  const kept = new Map<string, Kept>();
  const reading = new Map<string, Promise<Kept | undefined>>();

  /** A file's requests, read again where it changed. */
  const readFile = (kind: Kind, path: string, size: number, modified: number) => {
    const known = kept.get(path);
    if (known && known.size === size && known.modified === modified) return Promise.resolve(known);
    let running = reading.get(path);
    if (running) return running;
    running = (async () => {
      // A file that got shorter, or that Med no longer reads on, is read again.
      const read = known?.read && size >= known.size ? known.read : newRead();
      await readMore(kind, path, read);
      const agent = kind === "acp" ? (read.acp?.agent ?? "acp") : kind;
      // Pi's own files have the requests of the Pi sessions that Med ran.
      const { models, requests } =
        kind === "acp" && agent === "pi"
          ? { models: [], requests: new Float64Array(0) }
          : pack(kind, path, read);
      const next: Kept = {
        size: read.offset,
        modified,
        agent,
        models,
        requests,
        ...(now() - modified < RECENT_MS ? { read } : {}),
      };
      kept.set(path, next);
      return next;
    })()
      .catch(() => undefined)
      .finally(() => reading.delete(path));
    reading.set(path, running);
    return running;
  };

  return {
    /** The spend of the days from `from` to `to`, both included. */
    async report(from: string, to: string): Promise<UsageReport> {
      const start = dayStart(from);
      const end = dayStart(to) + 24 * 60 * 60 * 1000;
      const root = home();
      const listed = [
        ...(await claudeFiles(root)).map((path) => ({ kind: "claude" as const, path })),
        ...(await codexFiles(root)).map((path) => ({ kind: "codex" as const, path })),
        ...(await piFiles(root)).map((path) => ({ kind: "pi" as const, path })),
        ...(options.logs ? await jsonl(options.logs) : []).map((path) => ({
          kind: "acp" as const,
          path,
        })),
      ];
      // A file that last changed before the range has none of its requests.
      const files = (
        await Promise.all(
          listed.map(async (file) => {
            const info = await stat(file.path).catch(() => undefined);
            return info && info.mtimeMs >= start
              ? { ...file, size: info.size, modified: info.mtimeMs }
              : undefined;
          }),
        )
      ).filter((file) => !!file);
      // Files that left the range, or the disk, leave Med's memory too.
      const wanted = new Set(files.map((file) => file.path));
      for (const path of kept.keys()) if (!wanted.has(path)) kept.delete(path);

      const read: Kept[] = [];
      for (let next = 0; next < files.length; next += READERS)
        read.push(
          ...(
            await Promise.all(
              files
                .slice(next, next + READERS)
                .map((file) => readFile(file.kind, file.path, file.size, file.modified)),
            )
          ).filter((file) => !!file),
        );
      for (const file of read)
        if (file.read && now() - file.modified >= RECENT_MS) delete file.read;

      const rows = new Map<string, UsageRow>();
      const counted = new Set<number>();
      for (const file of read) {
        const { requests } = file;
        for (let at = 0; at < requests.length; at += FIELDS) {
          const time = requests[at + AT]!;
          if (!(time >= start && time < end)) continue;
          const key = requests[at + KEY]!;
          if (counted.has(key)) continue;
          counted.add(key);
          const day = localDay(time);
          const model = file.models[requests[at + MODEL]!]!;
          const id = `${day}\n${file.agent}\n${model}`;
          let row = rows.get(id);
          if (!row)
            rows.set(
              id,
              (row = {
                day,
                agent: file.agent,
                model,
                requests: 0,
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                cost: 0,
                unpriced: 0,
                agentPriced: 0,
              }),
            );
          row.requests++;
          row.input += requests[at + INPUT]!;
          row.output += requests[at + OUTPUT]!;
          row.cacheRead += requests[at + CACHE_READ]!;
          row.cacheWrite += requests[at + CACHE_WRITE]!;
          const cost = requests[at + COST]!;
          if (Number.isNaN(cost)) row.unpriced++;
          else row.cost += cost;
          row.agentPriced += requests[at + AGENT_PRICED]!;
        }
      }
      return {
        from,
        to,
        rows: [...rows.values()].sort(
          (a, b) => a.day.localeCompare(b.day) || b.cost - a.cost || a.model.localeCompare(b.model),
        ),
        files: read.length,
        prices: PRICE_TABLE,
      };
    },
  };
}
