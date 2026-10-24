import { SyncNetworkError } from "./errors.js";
import { syncPullResponseSchema, type SyncPullResponse } from "./protocol.js";

/** Wire frames are bounded separately from decoded records and transport buffers. */
export const MAX_SYNC_STREAM_FRAME_BYTES = 4 * 1024 * 1024;
export const SYNC_STREAM_PAGE_BYTES = 512 * 1024;
export const MAX_SYNC_STREAM_PAGES = 32;

/** Backpressure reaches the page iterator: at most one frame is queued here. */
export function createSyncPullStream(
  pages: AsyncIterable<SyncPullResponse>,
): ReadableStream<BufferSource> {
  const iterator = pages[Symbol.asyncIterator]();
  const encoder = new TextEncoder();
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await iterator.next();
        const bytes = encoder.encode(
          JSON.stringify(next.done ? { type: "end" } : next.value) + "\n",
        );
        if (bytes.length > MAX_SYNC_STREAM_FRAME_BYTES)
          throw new Error("Sync stream frame exceeds its byte limit");
        controller.enqueue(bytes);
        if (next.done) controller.close();
      } catch (error) {
        controller.error(error);
        await iterator.return?.();
      }
    },
    async cancel() {
      await iterator.return?.();
    },
  });
}

/** A clean end marker distinguishes a bounded response window from a dropped connection.
 * The host must cancel the signal when its account or sync lifetime ends.
 */
export async function* readSyncPullStream(
  response: Response,
  signal: AbortSignal,
  idleTimeoutMs = 30_000,
): AsyncGenerator<SyncPullResponse> {
  if (
    !response.ok ||
    !response.body ||
    !response.headers.get("content-type")?.startsWith("application/x-ndjson")
  ) {
    throw new Error(`Invalid sync stream response (${response.status})`);
  }
  const reader = response.body.getReader();
  const cancel = () => {
    void reader.cancel().catch(() => {});
  };
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "",
    bytes = 0,
    ended = false,
    sawPage = false;
  try {
    while (true) {
      signal.throwIfAborted();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const chunk = await Promise.race([
        reader.read().catch((error: unknown) => {
          signal.throwIfAborted();
          // Browsers fail a dropped body with a TypeError; keep other errors.
          if (!(error instanceof TypeError)) throw error;
          throw new SyncNetworkError("Sync stream connection failed", {
            cause: error,
          });
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new SyncNetworkError("Sync stream idle timeout")),
            idleTimeoutMs,
          );
        }),
      ]).finally(() => clearTimeout(timer));
      signal.throwIfAborted();
      if (chunk.done) break;
      let start = 0;
      while (start < chunk.value.length) {
        if (ended) throw new Error("Sync stream has data after its end marker");
        const newline = chunk.value.indexOf(10, start);
        const end = newline < 0 ? chunk.value.length : newline;
        const part = chunk.value.subarray(start, end);
        bytes += part.length;
        if (bytes > MAX_SYNC_STREAM_FRAME_BYTES)
          throw new Error("Sync stream frame exceeds its byte limit");
        pending += decoder.decode(part, { stream: true });
        if (newline < 0) break;
        pending += decoder.decode();
        const value: unknown = JSON.parse(pending);
        pending = "";
        bytes = 0;
        start = newline + 1;
        if (
          value &&
          typeof value === "object" &&
          "type" in value &&
          value.type === "end"
        ) {
          if (Object.keys(value).length !== 1 || !sawPage)
            throw new Error("Invalid sync stream end marker");
          ended = true;
        } else {
          sawPage = true;
          yield syncPullResponseSchema.parse(value);
        }
      }
    }
    // A dropped connection ends the body early; the next attempt resumes.
    if (!ended || bytes !== 0)
      throw new SyncNetworkError("Truncated sync stream");
  } finally {
    signal.removeEventListener("abort", cancel);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
