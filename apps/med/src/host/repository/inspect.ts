import type { BrowseSource } from "../../shared/browse";
import {
  browseBlameRequestSchema,
  browseSearchRequestSchema,
  type BrowseBlame,
  type BrowseBlameRequest,
  type BrowseSearch,
} from "../../shared/inspect";
import { HostError } from "../runtime/errors";
import { git, ProcessFailure } from "../runtime/process";
import { listBrowse, readBrowse } from "./browse";

export const MAX_SEARCH_MATCHES = 200;
export const MAX_SEARCH_BYTES = 64 * 1024 * 1024;
const SEARCH_TIME_MS = 12_000;
const MAX_SNIPPET = 1000;

/** Git finds candidate paths; the same confined reader used by file previews supplies all text. */
export async function searchBrowse(
  source: BrowseSource,
  query: string,
  signal?: AbortSignal,
): Promise<BrowseSearch> {
  browseSearchRequestSchema.parse({ source, query });
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(SEARCH_TIME_MS);
  const bounded = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const result: BrowseSearch = { source, query, matches: [], truncated: false };
  let bytes = 0;
  const needle = query.toLowerCase();
  const scan = async (path: string) => {
    bounded.throwIfAborted();
    let file;
    try {
      file = await readBrowse(source, path, bounded);
    } catch (error) {
      if (error instanceof HostError && error.status === 409) {
        result.truncated = true;
        result.reason =
          "Some files changed during search. Run the search again for current results.";
        return true;
      }
      throw error;
    }
    if (file.kind !== "text" || file.text === undefined) {
      if (file.kind === "too-large") {
        result.truncated = true;
        result.reason = "Some files exceed the text preview limit and were not searched.";
      }
      return true;
    }
    bytes += file.size;
    if (bytes > MAX_SEARCH_BYTES) {
      result.truncated = true;
      result.reason = "Search reached its 64 MiB text limit. Narrow the query.";
      return false;
    }
    const lines = file.text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const at = line.toLowerCase().indexOf(needle);
      if (at < 0) continue;
      if (result.matches.length === MAX_SEARCH_MATCHES) {
        result.truncated = true;
        result.reason = "Showing the first 200 matching lines. Narrow the query.";
        return false;
      }
      const start = Math.max(0, at - 160);
      const text = line.slice(start, start + MAX_SNIPPET).replace(/\r$/, "");
      result.matches.push({
        path,
        line: i + 1,
        text: `${start ? "…" : ""}${text}${start + MAX_SNIPPET < line.length ? "…" : ""}`,
      });
    }
    return true;
  };
  try {
    const manifest = await listBrowse(source, false, bounded);
    result.truncated = manifest.truncated;
    if (manifest.truncated)
      result.reason = "The workspace file list is limited. Some files were not searched.";
    const tracked = manifest.entries.filter(
      (entry) => entry.kind === "file" && entry.status !== "?",
    );
    // Explicit literal paths keep Git out of symlink and nested-repository entries excluded by browse.
    for (let offset = 0; offset < tracked.length;) {
      const paths: string[] = [];
      let argumentBytes = 0;
      while (offset < tracked.length && paths.length < 1024 && argumentBytes < 60 * 1024) {
        const path = tracked[offset++]!.path;
        paths.push(path);
        argumentBytes += Buffer.byteLength(path) + 1;
      }
      const output = await git(
        source.repo,
        [
          "--literal-pathspecs",
          "-c",
          "grep.threads=2",
          "grep",
          "--no-textconv",
          "--no-recurse-submodules",
          "-l",
          "-z",
          "-I",
          "-F",
          "-i",
          "-e",
          query,
          ...(source.kind === "commit" ? [source.oid] : []),
          "--",
          ...paths,
        ],
        { signal: bounded, maxBytes: 1024 * 1024, acceptedExitCodes: [0, 1] },
      );
      for (const record of output.toString("utf8").split("\0")) {
        if (!record) continue;
        const path = source.kind === "commit" ? record.slice(source.oid.length + 1) : record;
        // Do not trust a Git record or stale manifest to authorize content reads.
        if (paths.includes(path) && !(await scan(path))) return result;
      }
    }
    for (const entry of manifest.entries) {
      if (entry.kind === "file" && entry.status === "?" && !(await scan(entry.path))) return result;
    }
  } catch (error) {
    signal?.throwIfAborted();
    if (
      timeout.aborted ||
      (error instanceof ProcessFailure && ["output-too-large", "timeout"].includes(error.code))
    ) {
      result.truncated = true;
      result.reason = "Search reached its time or output limit. Narrow the query.";
    } else throw error;
  }
  return result;
}

function parseBlame(text: string): BrowseBlame["lines"] {
  const lines: BrowseBlame["lines"] = [];
  let entry: BrowseBlame["lines"][number] | undefined;
  for (const record of text.split("\n")) {
    const header = /^([0-9a-f]{40}(?:[0-9a-f]{24})?) \d+ (\d+)(?: \d+)?$/.exec(record);
    if (header)
      entry = { line: Number(header[2]), commit: header[1]!, author: "", date: "", summary: "" };
    else if (entry && record.startsWith("author ")) entry.author = record.slice(7);
    else if (entry && record.startsWith("author-time ")) {
      const time = Number(record.slice(12)) * 1000;
      entry.date =
        Number.isFinite(time) && Math.abs(time) <= 8.64e15 ? new Date(time).toISOString() : "";
    } else if (entry && record.startsWith("summary ")) entry.summary = record.slice(8);
    else if (entry && record.startsWith("\t")) {
      if (/^0+$/.test(entry.commit)) {
        entry.author = "Not committed";
        entry.date = "";
        entry.summary = "Uncommitted change";
      }
      lines.push(entry);
      entry = undefined;
    }
  }
  return lines;
}

// Git spends blame time walking history, which costs about the same for 200
// lines as for 1,000. Blame runs once for each 1,000-line chunk of a file
// version, and later pages of that chunk come from memory. The key names the
// exact content and commit, so a cached chunk never outlives its file version.
const CHUNK = 1000;
const MAX_CHUNKS = 32;
const chunks = new Map<string, BrowseBlame["lines"]>();
const pendingChunks = new Map<string, Promise<BrowseBlame["lines"]>>();

function remember(key: string, lines: BrowseBlame["lines"]) {
  chunks.delete(key);
  chunks.set(key, lines);
  while (chunks.size > MAX_CHUNKS) chunks.delete(chunks.keys().next().value!);
}

/** Waits for shared work, but lets one caller stop waiting without stopping it. */
function settle<T>(work: Promise<T>, signal?: AbortSignal) {
  if (!signal) return work;
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/** Blame is tied to the exact visible content, never a later version of the working file. */
export async function blameBrowse(
  input: BrowseBlameRequest,
  signal?: AbortSignal,
): Promise<BrowseBlame> {
  const { source, path, identity, startLine, endLine } = browseBlameRequestSchema.parse(input);
  const file = await readBrowse(source, path, signal);
  const result: BrowseBlame = { source, path, identity, lines: [], truncated: false };
  const changed = () =>
    new HostError("file-changed", "This file changed. Refresh it before reading blame.", 409);
  if (file.identity !== identity) throw changed();
  if (file.kind !== "text" || file.text === undefined)
    return { ...result, reason: "Blame is only available for text files." };
  const count =
    file.text.length === 0 ? 0 : file.text.split("\n").length - (file.text.endsWith("\n") ? 1 : 0);
  if (startLine > count) return { ...result, reason: "There is no file content at this line." };
  const end = Math.min(endLine, count);
  const head =
    source.kind === "commit"
      ? source.oid
      : (
          await git(source.repo, ["rev-parse", "--verify", "HEAD"], {
            signal,
            acceptedExitCodes: [0, 128],
            maxBytes: 4096,
          })
        )
          .toString("utf8")
          .trim();
  if (!head) return { ...result, reason: "This worktree has no committed history." };
  const prefix = [source.repo, head, path, identity].join("\0");
  const first = Math.floor((startLine - 1) / CHUNK);
  const last = Math.floor((end - 1) / CHUNK);
  if (!chunks.has(`${prefix}\0${first}`) || !chunks.has(`${prefix}\0${last}`)) {
    if (source.kind === "worktree") {
      // Even --contents - runs Git clean conversion. Never execute a repository filter.
      const attrs = (
        await git(
          source.repo,
          ["check-attr", "-z", "filter", "working-tree-encoding", "--", path],
          { signal, maxBytes: 32 * 1024 },
        )
      )
        .toString("utf8")
        .split("\0");
      for (let i = 2; i < attrs.length; i += 3) {
        if (attrs[i] !== "unspecified" && attrs[i] !== "unset")
          return {
            ...result,
            reason:
              "Blame is unavailable for files that require a Git content filter or encoding conversion.",
          };
      }
    }
    const exists = await git(
      source.repo,
      ["--literal-pathspecs", "ls-tree", "-z", head, "--", path],
      { signal, maxBytes: 8192 },
    );
    if (exists.length === 0)
      return { ...result, reason: "This file has no history at the selected commit." };
  }
  for (let chunk = first; chunk <= last; chunk++) {
    const key = `${prefix}\0${chunk}`;
    let lines = chunks.get(key);
    if (lines) remember(key, lines);
    else {
      let work = pendingChunks.get(key);
      if (!work) {
        const from = chunk * CHUNK + 1;
        const to = Math.min(count, from + CHUNK - 1);
        // The read finishes even if this request ends, so the next page finds it.
        work = blameChunk(source, path, identity, head, file.text, from, to)
          .then((value) => {
            remember(key, value);
            return value;
          })
          .finally(() => pendingChunks.delete(key));
        pendingChunks.set(key, work);
      }
      lines = await settle(work, signal);
    }
    result.lines.push(...lines.filter((entry) => entry.line >= startLine && entry.line <= end));
  }
  return result;
}

async function blameChunk(
  source: BrowseSource,
  path: string,
  identity: string,
  head: string,
  text: string,
  from: number,
  to: number,
) {
  const output = await git(
    source.repo,
    [
      "-c",
      "blame.ignoreRevsFile=",
      "blame",
      "--line-porcelain",
      "--no-textconv",
      "--encoding=UTF-8",
      "-L",
      `${from},${to}`,
      ...(source.kind === "commit" ? [source.oid] : ["--contents", "-"]),
      "--",
      path,
    ],
    {
      input: source.kind === "worktree" ? text : undefined,
      maxBytes: 16 * 1024 * 1024,
      timeoutMs: 20_000,
    },
  );
  if (source.kind === "worktree") {
    const [current, currentHead] = await Promise.all([
      readBrowse(source, path),
      git(source.repo, ["rev-parse", "--verify", "HEAD"], { maxBytes: 4096 }),
    ]);
    if (current.identity !== identity || currentHead.toString("utf8").trim() !== head)
      throw new HostError(
        "file-changed",
        "This file changed. Refresh it before reading blame.",
        409,
      );
  }
  return parseBlame(output.toString("utf8"));
}
