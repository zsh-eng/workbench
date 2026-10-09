import type { BrowseRead } from "../../shared/browse";
import { browseBlameResponseSchema, type BrowseBlame } from "../../shared/inspect";
import type { CommitDetails } from "../../shared/protocol";
import { commitDetailsSchema, createApi } from "./api";
import { browseSourceKey } from "./browse";

export type BlameLoader = (
  file: BrowseRead,
  startLine: number,
  endLine: number,
  signal: AbortSignal,
) => Promise<BrowseBlame>;

export function createBlameLoader(fetcher: typeof fetch, token: string): BlameLoader {
  const api = createApi(fetcher, token);
  return async (file, startLine, endLine, signal) => {
    const result = await api.json("/api/browse/blame", browseBlameResponseSchema, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        source: file.source,
        path: file.path,
        identity: file.identity,
        startLine,
        endLine,
      }),
      signal,
    });
    if (
      browseSourceKey(result.source) !== browseSourceKey(file.source) ||
      result.path !== file.path ||
      result.identity !== file.identity
    )
      throw new Error("Line history belongs to a different file version. Refresh this file.");
    if (result.lines.some((entry) => entry.line < startLine || entry.line > endLine))
      throw new Error("Line history does not match the selected lines.");
    return result;
  };
}

/** A commit's body and size, read from the file's own repository. */
export type CommitLoader = (
  repo: string,
  id: string,
  signal: AbortSignal,
) => Promise<CommitDetails>;

export function createCommitLoader(fetcher: typeof fetch, token: string): CommitLoader {
  const api = createApi(fetcher, token);
  return (repo, id, signal) =>
    api.json(`/api/commit?${new URLSearchParams({ repo, id })}`, commitDetailsSchema, { signal });
}

export const BLAME_PAGE = 200;
export type BlameEntry = BrowseBlame["lines"][number];

// Line history for each file version, shared by the gutter and the line blame,
// so returning to a file or toggling blame needs no new read. Each loader has
// its own cache; the app uses one loader.
const MAX_FILES = 16;
interface BlameCache {
  files: Map<string, Map<number, BrowseBlame>>;
  inflight: Map<
    string,
    { promise: Promise<BrowseBlame>; controller: AbortController; users: number }
  >;
}
const caches = new WeakMap<BlameLoader, BlameCache>();
function cacheFor(load: BlameLoader) {
  let cache = caches.get(load);
  if (!cache) caches.set(load, (cache = { files: new Map(), inflight: new Map() }));
  return cache;
}

export function blameKey(file: BrowseRead) {
  return `${browseSourceKey(file.source)}\0${file.path}\0${file.identity}`;
}

export const blamePage = (line: number) => Math.floor((line - 1) / BLAME_PAGE);

export function cachedBlame(load: BlameLoader, file: BrowseRead, page: number) {
  return caches.get(load)?.files.get(blameKey(file))?.get(page);
}

export function cachedBlameLine(
  load: BlameLoader,
  file: BrowseRead,
  line: number,
): BlameEntry | undefined {
  return cachedBlame(load, file, blamePage(line))?.lines.find((entry) => entry.line === line);
}

/** Reads one page, or joins a read of it already running. The read stops when
 * every caller that waits for it has stopped. */
export function loadBlamePage(
  load: BlameLoader,
  file: BrowseRead,
  page: number,
  lineCount: number,
  signal: AbortSignal,
): Promise<BrowseBlame> {
  const { files, inflight } = cacheFor(load);
  const key = blameKey(file);
  const cached = files.get(key)?.get(page);
  if (cached) return Promise.resolve(cached);
  const id = `${key}\0${page}`;
  let entry = inflight.get(id);
  if (!entry) {
    const controller = new AbortController();
    const promise = load(
      file,
      page * BLAME_PAGE + 1,
      Math.min(lineCount, (page + 1) * BLAME_PAGE),
      controller.signal,
    ).then((result) => {
      const pages = files.get(key) ?? new Map<number, BrowseBlame>();
      files.delete(key);
      files.set(key, pages.set(page, result));
      while (files.size > MAX_FILES) files.delete(files.keys().next().value!);
      return result;
    });
    const current = { promise, controller, users: 0 };
    void promise.then(
      () => inflight.get(id) === current && inflight.delete(id),
      () => inflight.get(id) === current && inflight.delete(id),
    );
    inflight.set(id, current);
    entry = current;
  }
  const shared = entry;
  shared.users++;
  return new Promise<BrowseBlame>((resolve, reject) => {
    let done = false;
    const finish = () => {
      if (done) return false;
      done = true;
      shared.users--;
      signal.removeEventListener("abort", abort);
      return true;
    };
    const abort = () => {
      if (!finish()) return;
      if (shared.users === 0) {
        shared.controller.abort();
        if (inflight.get(id) === shared) inflight.delete(id);
      }
      reject(new DOMException("The blame read stopped.", "AbortError"));
    };
    if (signal.aborted) return abort();
    signal.addEventListener("abort", abort, { once: true });
    shared.promise.then(
      (value) => finish() && resolve(value),
      (error: unknown) => finish() && reject(error),
    );
  });
}
