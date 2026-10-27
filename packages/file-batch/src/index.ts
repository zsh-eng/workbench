/**
 * Many small files in one response: the shared API's `POST …/files/batch`
 * and the browser side that reads it. See ../README.md for the format.
 */

export const FILE_BATCH_TYPE = "application/x-workbench-file-batch";
/** Ids in one request: under 50 subrequests and 100 D1 parameters. */
export const MAX_BATCH_IDS = 32;
/**
 * File bytes in one response. The server ends a batch early past this (it
 * always sends one file), so a response finishes well inside a client's
 * request timeout on a slow connection.
 */
export const MAX_BATCH_BYTES = 1024 * 1024;
const MAX_HEADER_BYTES = 1024;
const FILE_ID = /^xxh64:[a-f0-9]{16}$/;

export const isFileId = (id: string) => FILE_ID.test(id);

export type FrameHeader =
  | { id: string; status: 200; size: number; type: string }
  | { id: string; status: number }
  | { end: true };

const encoder = new TextEncoder();
/** One header line. A 200 header is followed by exactly `size` bytes. */
export const encodeFrameHeader = (header: FrameHeader) =>
  encoder.encode(`${JSON.stringify(header)}\n`);

/** The ids of a batch request, or null when the body is not one. */
export function parseBatchRequest(body: unknown): string[] | null {
  const ids =
    body && typeof body === "object" && "ids" in body ? body.ids : undefined;
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_BATCH_IDS)
    return null;
  if (!ids.every((id) => typeof id === "string" && isFileId(id))) return null;
  return [...new Set(ids as string[])];
}

export type FileBatchItem =
  | { id: string; status: 200; type: string; bytes: Uint8Array }
  | { id: string; status: number };

/** The connection failed or went quiet; the files read so far are good. */
export class FileBatchStreamError extends Error {
  override name = "FileBatchStreamError";
}

/**
 * Reads a batch body frame by frame. Ends at the end frame; throws
 * FileBatchStreamError when the body stops before it, or sends nothing for
 * `idleMs`.
 */
export async function* readFileBatch(
  body: ReadableStream<Uint8Array>,
  idleMs = 30_000,
): AsyncGenerator<FileBatchItem> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  let chunk: Uint8Array = new Uint8Array(0);
  let offset = 0;
  const next = async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new FileBatchStreamError("The download went quiet")),
            idleMs,
          );
        }),
      ]);
      if (result.done) return false;
      chunk = result.value;
      offset = 0;
      return true;
    } catch (error) {
      if (error instanceof FileBatchStreamError) throw error;
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      throw new FileBatchStreamError("The download stopped", { cause: error });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  };
  try {
    while (true) {
      // The header line.
      const parts: Uint8Array[] = [];
      let length = 0;
      while (true) {
        if (offset === chunk.length && !(await next()))
          throw new FileBatchStreamError("The download ended early");
        const newline = chunk.indexOf(10, offset);
        const end = newline < 0 ? chunk.length : newline;
        parts.push(chunk.subarray(offset, end));
        length += end - offset;
        if (length > MAX_HEADER_BYTES) throw new Error("Invalid file batch");
        offset = newline < 0 ? chunk.length : newline + 1;
        if (newline >= 0) break;
      }
      const line = new Uint8Array(length);
      let at = 0;
      for (const part of parts) {
        line.set(part, at);
        at += part.length;
      }
      const header = JSON.parse(decoder.decode(line)) as Record<
        string,
        unknown
      >;
      if (header.end === true) {
        if (offset < chunk.length || (await next()))
          throw new Error("Invalid file batch: data after its end");
        return;
      }
      const { id, status } = header;
      if (typeof id !== "string" || typeof status !== "number")
        throw new Error("Invalid file batch header");
      if (status !== 200) {
        yield { id, status };
        continue;
      }
      const { size, type } = header;
      if (
        typeof size !== "number" ||
        !Number.isSafeInteger(size) ||
        size < 0 ||
        typeof type !== "string"
      )
        throw new Error("Invalid file batch header");
      // The file's bytes, copied once into their own buffer.
      const bytes = new Uint8Array(size);
      let filled = 0;
      while (filled < size) {
        if (offset === chunk.length && !(await next()))
          throw new FileBatchStreamError("The download ended in a file");
        const take = Math.min(size - filled, chunk.length - offset);
        bytes.set(chunk.subarray(offset, offset + take), filled);
        filled += take;
        offset += take;
      }
      yield { id, status, type, bytes };
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** A status the server answered; 401, 403 and 409 stop the download. */
export class FileBatchHttpError extends Error {
  override name = "FileBatchHttpError";
  constructor(readonly status: number) {
    super(`File download failed (${status})`);
  }
}

export interface DownloadFilesOptions {
  ids: Iterable<string>;
  /** POSTs `{ids}` to the batch route. Resolves with any status. */
  fetchBatch(ids: string[], signal: AbortSignal): Promise<Response>;
  /** GETs one file: for a server without the batch route. Any status. */
  fetchOne(id: string, signal: AbortSignal): Promise<Response>;
  /** Keeps one file. Awaited before the file counts. */
  store(id: string, bytes: Uint8Array, type: string): Promise<void>;
  /** A file that did not download, after its attempts. */
  onFailed?(id: string, error: unknown): void;
  signal?: AbortSignal;
  /** Requests at once (6). */
  parallel?: number;
  /** Tries for each file (3). */
  attempts?: number;
  /** Before a retry, in ms: 500, 1000, 2000…, with jitter. Tests pass 0. */
  backoffMs?: number;
}

/**
 * Downloads files in batches, several at once, and stores each as it
 * arrives. A file that fails is retried in a later batch; a dropped
 * connection keeps what arrived. A server without the batch route gets one
 * request per file. Rejects only on abort, 401, 403, 409 or a full disk.
 */
export async function downloadFiles(options: DownloadFilesOptions) {
  const parallel = options.parallel ?? 6;
  const attempts = options.attempts ?? 3;
  const backoffMs = options.backoffMs ?? 500;
  // A fatal failure in one request stops the others.
  const halt = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, halt.signal])
    : halt.signal;
  const tries = new Map<string, number>();
  const queue: string[] = [];
  const workers = new Set<Promise<void>>();
  /** Files that wait out their backoff before they go back in the queue. */
  const waits = new Set<Promise<void>>();
  let failure: unknown;
  let stored = 0,
    failed = 0;
  // Once the server lacks the route, every request is a single file.
  let single = false;

  function fail(id: string, error: unknown) {
    failed++;
    options.onFailed?.(id, error);
  }
  /**
   * Back in the queue, or failed after its last attempt. A counted try
   * waits 500 ms, then 1 s, 2 s… (with jitter) before the file is asked for
   * again, whichever request takes it.
   */
  function retry(ids: string[], error: unknown, counts = true) {
    const again: string[] = [];
    let used = 0;
    for (const id of ids) {
      const tried = (tries.get(id) ?? 0) + (counts ? 1 : 0);
      tries.set(id, tried);
      if (tried >= attempts) fail(id, error);
      else again.push(id);
      used = Math.max(used, tried);
    }
    if (again.length === 0) return;
    const delay =
      counts && backoffMs > 0
        ? backoffMs * 2 ** (used - 1) * (0.75 + Math.random() / 4)
        : 0;
    if (delay === 0) {
      queue.push(...again);
      launch();
      return;
    }
    const wait: Promise<void> = sleep(delay, signal)
      .then(
        () => {
          queue.push(...again);
          launch();
        },
        () => {},
      )
      .finally(() => waits.delete(wait));
    waits.add(wait);
  }
  /** Abort, a session or account that changed, or a full disk. */
  const fatal = (error: unknown) =>
    signal.aborted ||
    (error instanceof FileBatchHttpError &&
      [401, 403, 409].includes(error.status)) ||
    (error instanceof Error && error.name === "QuotaExceededError");
  async function keep(id: string, bytes: Uint8Array, type: string) {
    try {
      await options.store(id, bytes, type);
      stored++;
    } catch (error) {
      if (fatal(error)) throw error;
      fail(id, error);
    }
  }

  async function batch(ids: string[]) {
    const open = new Set(ids);
    try {
      const response = await options.fetchBatch(ids, signal);
      if ([400, 404, 405, 501].includes(response.status)) {
        void response.body?.cancel().catch(() => {});
        single = true;
        retry(ids, undefined, false);
        return;
      }
      if (
        !response.ok ||
        !response.body ||
        !response.headers.get("Content-Type")?.startsWith(FILE_BATCH_TYPE)
      ) {
        void response.body?.cancel().catch(() => {});
        throw new FileBatchHttpError(response.status);
      }
      for await (const item of readFileBatch(response.body)) {
        if (!open.delete(item.id)) continue;
        if ("bytes" in item) await keep(item.id, item.bytes, item.type);
        else if (item.status === 404)
          fail(item.id, new FileBatchHttpError(404));
        else retry([item.id], new FileBatchHttpError(item.status));
      }
    } catch (error) {
      if (fatal(error)) throw error;
      // No connection, a server error, or an answer cut short. A cut answer
      // that brought files made progress (a slow link meets the request
      // timeout), so the rest go back without using a try.
      retry([...open], error, open.size === ids.length);
      return;
    }
    // A complete answer may leave ids for the next one (its byte limit).
    // One that answered none of its ids uses a try, so this ends.
    retry([...open], undefined, open.size === ids.length);
  }

  async function one(id: string) {
    try {
      const response = await options.fetchOne(id, signal);
      if (response.status === 404) {
        void response.body?.cancel().catch(() => {});
        fail(id, new FileBatchHttpError(404));
        return;
      }
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new FileBatchHttpError(response.status);
      }
      const type =
        response.headers.get("Content-Type") ?? "application/octet-stream";
      const bytes = new Uint8Array(await response.arrayBuffer());
      await keep(id, bytes, type);
    } catch (error) {
      if (fatal(error)) throw error;
      retry([id], error);
    }
  }

  let busy = 0;
  async function worker() {
    while (queue.length > 0) {
      signal.throwIfAborted();
      // Share what is left among the requests that can start now, so a
      // short list still goes out in parallel; but at least six, which the
      // server reads at once anyway.
      const take = single
        ? 1
        : Math.min(
            MAX_BATCH_IDS,
            Math.max(6, Math.ceil(queue.length / (parallel - busy))),
          );
      const ids = queue.splice(0, take);
      busy++;
      try {
        await (single ? one(ids[0]!) : batch(ids));
      } finally {
        busy--;
      }
    }
  }
  /** Workers leave when the queue is empty; a retry fills it again. */
  function launch() {
    while (workers.size < parallel && queue.length > 0 && !failure) {
      const run: Promise<void> = worker()
        .catch((error: unknown) => {
          failure ??= error;
          halt.abort(error);
        })
        .finally(() => workers.delete(run));
      workers.add(run);
    }
  }

  for (const id of new Set(options.ids))
    if (isFileId(id)) queue.push(id);
    else fail(id, new Error("Not a file ID"));
  launch();
  while (workers.size > 0 || waits.size > 0)
    await Promise.race([...workers, ...waits]);
  if (failure) throw failure;
  signal.throwIfAborted();
  return { stored, failed };
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal.removeEventListener("abort", done);
      clearTimeout(timer);
      if (signal.aborted) reject(signal.reason);
      else resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}
