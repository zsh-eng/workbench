import { expect, test } from "bun:test";
import {
  downloadFiles,
  encodeFrameHeader,
  FILE_BATCH_TYPE,
} from "../src/index";

const id = (n: number) => `xxh64:${n.toString(16).padStart(16, "0")}`;
const bytesOf = (n: number) => new TextEncoder().encode(`file ${n}`);

/** The server's frames for these ids; `dropAfter` cuts the connection. */
function answer(ids: string[], dropAfter = Infinity) {
  const chunks: Uint8Array[] = [];
  ids.forEach((fileId, index) => {
    if (index >= dropAfter) return;
    const bytes = bytesOf(Number.parseInt(fileId.slice(6), 16));
    chunks.push(
      encodeFrameHeader({
        id: fileId,
        status: 200,
        size: bytes.length,
        type: "text/plain",
      }),
      // Split a file across chunks, as a network does.
      bytes.subarray(0, 3),
      bytes.subarray(3),
    );
  });
  const dropped = dropAfter < ids.length;
  if (!dropped) chunks.push(encodeFrameHeader({ end: true }));
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks.shift();
      if (chunk) controller.enqueue(chunk);
      else if (dropped) controller.error(new TypeError("network error"));
      else controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": FILE_BATCH_TYPE } });
}

test("a dropped connection keeps the files that arrived and asks again for the rest", async () => {
  const requests: string[][] = [];
  const stored = new Map<string, string>();
  const ids = Array.from({ length: 10 }, (_, n) => id(n));
  const result = await downloadFiles({
    ids,
    parallel: 1,
    backoffMs: 0,
    fetchBatch: async (batch) => {
      requests.push(batch);
      return answer(batch, requests.length === 1 ? 4 : Infinity);
    },
    fetchOne: () => Promise.reject(new Error("not used")),
    store: async (fileId, bytes) => {
      expect(stored.has(fileId)).toBe(false);
      stored.set(fileId, new TextDecoder().decode(bytes));
    },
  });
  expect(result).toEqual({ stored: 10, failed: 0 });
  expect(requests).toEqual([ids, ids.slice(4)]);
  expect(stored.get(id(9))).toBe("file 9");
});

test("a slow link that cuts every answer after one file still downloads them all", async () => {
  const ids = Array.from({ length: 10 }, (_, n) => id(n));
  const stored: string[] = [];
  const result = await downloadFiles({
    ids,
    parallel: 1,
    backoffMs: 0,
    fetchBatch: async (batch) => answer(batch, 1),
    fetchOne: () => Promise.reject(new Error("not used")),
    store: async (fileId) => {
      stored.push(fileId);
    },
  });
  expect(result).toEqual({ stored: 10, failed: 0 });
  expect(stored.sort()).toEqual(ids);
});

test("a server that keeps failing ends the download after three tries, backing off", async () => {
  const times: number[] = [];
  const failed: string[] = [];
  const result = await downloadFiles({
    ids: [id(1)],
    backoffMs: 40,
    fetchBatch: async () => {
      times.push(performance.now());
      return new Response("busy", { status: 503 });
    },
    fetchOne: () => Promise.reject(new Error("not used")),
    store: async () => {},
    onFailed: (fileId) => failed.push(fileId),
  });
  expect(result).toEqual({ stored: 0, failed: 1 });
  expect(failed).toEqual([id(1)]);
  // 30–40 ms, then 60–80 ms: the retry waits, whichever request takes it.
  expect(times).toHaveLength(3);
  expect(times[1]! - times[0]!).toBeGreaterThanOrEqual(29);
  expect(times[2]! - times[1]!).toBeGreaterThanOrEqual(59);
});
