import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import xxhash from "xxhash-wasm";
import {
  encodeFrameHeader,
  FILE_BATCH_TYPE,
  MAX_BATCH_BYTES,
  MAX_BATCH_IDS,
  parseBatchRequest,
} from "@workbench/file-batch";
import type { AppEnv, Namespace } from "./env";

let hasher: ReturnType<typeof xxhash> | undefined;
const MiB = 1024 * 1024;
const MAX_BYTES: Record<Namespace, number> = {
  reader: 100 * MiB,
  spaced: 2 * MiB,
  arctic: 0,
  "arctic-content": 2 * MiB,
  "arctic-annotations": 0,
  "arctic-reading": 0,
};
/** Arctic's article text: a reader copy that the client cleaned. The server
 * keeps that contract: HTML only, and no scripts. */
function refuseArcticContent(mediaType: string, bytes: ArrayBuffer) {
  if (!/^text\/html(;\s*charset=utf-8)?$/i.test(mediaType)) return "Article text must be HTML";
  if (/<script\b/i.test(new TextDecoder().decode(bytes))) return "Article text cannot contain scripts";
  return undefined;
}
/** Namespaces of small files, which `POST /batch` serves; Reader's books
 * stay one request each. */
const BATCHED: readonly Namespace[] = ["spaced", "arctic-content"];
/** R2 reads waiting for headers at once: the Workers limit per request. */
const R2_AT_ONCE = 6;
export function createFileRoutes() {
  const app = new Hono<AppEnv>();
  // Many files in one streamed body (packages/file-batch). Before
  // `/:fileId`, which refuses "batch" as an ID.
  app.post(
    "/batch",
    bodyLimit({
      maxSize: 16 * 1024,
      onError: (c) => c.json({ error: "Request too large" }, 413),
    }),
    async (c) => {
      const namespace = c.get("namespace");
      if (!BATCHED.includes(namespace))
        return c.json({ error: "Batch downloads are not available here" }, 404);
      if (!/^application\/json\b/i.test(c.req.header("Content-Type") ?? ""))
        return c.json({ error: "Expected JSON" }, 415);
      const ids = parseBatchRequest(await c.req.json().catch(() => null));
      if (!ids)
        return c.json({ error: `Expected 1 to ${MAX_BATCH_IDS} file IDs` }, 400);
      const { results } = await c.env.DATABASE.prepare(
        `SELECT * FROM file_storage WHERE user_id=? AND namespace=? AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
      )
        .bind(c.get("user").id, namespace, ...ids)
        .all<FileRow>();
      const rows = new Map(results.map((row) => [row.id, row]));
      // Files up to the byte limit, and always one; the client asks again
      // for the ids that this answer leaves out.
      const plan: { id: string; row?: FileRow }[] = [];
      let bytes = 0;
      for (const id of ids) {
        const row = rows.get(id);
        if (row && bytes > 0 && bytes + row.file_size > MAX_BATCH_BYTES)
          continue;
        bytes += row?.file_size ?? 0;
        plan.push({ id, row });
      }
      const { readable, writable } = new IdentityTransformStream();
      void writeBatch(c.env.FILES, plan, writable);
      // Text compresses well, as Cloudflare compresses single text files;
      // images do not.
      const gzip =
        namespace === "arctic-content" &&
        /\bgzip\b/i.test(c.req.header("Accept-Encoding") ?? "");
      const init: ResponseInit & { encodeBody: "manual" } = {
        encodeBody: "manual",
        headers: {
          "Content-Type": FILE_BATCH_TYPE,
          "Content-Disposition": "attachment",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "X-Content-Type-Options": "nosniff",
          Vary: "Accept-Encoding",
          ...(gzip ? { "Content-Encoding": "gzip" } : {}),
        },
      };
      // Workers must not compress these bytes a second time.
      return new Response(
        gzip ? readable.pipeThrough(new CompressionStream("gzip")) : readable,
        init,
      );
    },
  );
  app.get("/", async (c) => {
    const rows = await c.env.DATABASE.prepare(
      "SELECT * FROM file_storage WHERE user_id=? AND namespace=? AND deleted_at IS NULL ORDER BY created_at DESC",
    )
      .bind(c.get("user").id, c.get("namespace"))
      .all<FileRow>();
    return c.json({ files: rows.results.map(present) });
  });
  app.use("/:fileId", async (c, next) => {
    if (!/^xxh64:[a-f0-9]{16}$/.test(c.req.param("fileId")))
      return c.json({ error: "Invalid file ID" }, 400);
    await next();
  });
  app.put(
    "/:fileId",
    async (c, next) =>
      bodyLimit({
        maxSize: MAX_BYTES[c.get("namespace")],
        onError: (c) => c.json({ error: "File too large" }, 413),
      })(c, next),
    async (c) => {
      const bytes = await c.req.arrayBuffer();
      hasher ??= xxhash();
      const id = `xxh64:${(await hasher).h64Raw(new Uint8Array(bytes)).toString(16).padStart(16, "0")}`;
      if (id !== c.req.param("fileId"))
        return c.json({ error: "File ID does not match content" }, 400);
      const user = c.get("user").id,
        namespace = c.get("namespace");
      const mediaType =
        c.req.header("Content-Type") || "application/octet-stream";
      if (namespace === "arctic-content") {
        const refused = refuseArcticContent(mediaType, bytes);
        if (refused) return c.json({ error: refused }, 415);
      }
      const prior = await c.env.DATABASE.prepare(
        "SELECT * FROM file_storage WHERE user_id=? AND namespace=? AND id=?",
      )
        .bind(user, namespace, id)
        .first<FileRow>();
      const key = `users/${encodeURIComponent(user)}/apps/${namespace}/${id}`;
      await c.env.FILES.put(key, bytes, {
        httpMetadata: { contentType: mediaType },
      });
      await c.env.DATABASE.prepare(`INSERT INTO file_storage (user_id,namespace,id,r2_key,file_size,media_type,created_at) VALUES(?,?,?,?,?,?,?)
      ON CONFLICT(user_id,namespace,id) DO UPDATE SET file_size=excluded.file_size,media_type=excluded.media_type,deleted_at=NULL`)
        .bind(
          user,
          namespace,
          id,
          key,
          bytes.byteLength,
          mediaType,
          prior?.created_at ?? Date.now(),
        )
        .run();
      const row = await c.env.DATABASE.prepare(
        "SELECT * FROM file_storage WHERE user_id=? AND namespace=? AND id=?",
      )
        .bind(user, namespace, id)
        .first<FileRow>();
      return c.json({
        ...present(row!),
        alreadyExists: prior?.deleted_at === null,
      });
    },
  );
  app.get("/:fileId", async (c) => {
    const row = await c.env.DATABASE.prepare(
      "SELECT * FROM file_storage WHERE user_id=? AND namespace=? AND id=? AND deleted_at IS NULL",
    )
      .bind(c.get("user").id, c.get("namespace"), c.req.param("fileId"))
      .first<FileRow>();
    const object = row && (await c.env.FILES.get(row.r2_key));
    if (!row || !object) return c.json({ error: "File not found" }, 404);
    c.header("Content-Type", row.media_type);
    c.header("Content-Length", String(object.size));
    c.header("Content-Security-Policy", "sandbox; default-src 'none'");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("ETag", object.httpEtag);
    if (!/^image\/(png|jpeg|webp|gif|avif)$/.test(row.media_type))
      c.header("Content-Disposition", "attachment");
    return c.body(object.body);
  });
  app.delete("/:fileId", async (c) => {
    const row = await c.env.DATABASE.prepare(
      "UPDATE file_storage SET deleted_at=? WHERE user_id=? AND namespace=? AND id=? AND deleted_at IS NULL RETURNING r2_key",
    )
      .bind(
        Date.now(),
        c.get("user").id,
        c.get("namespace"),
        c.req.param("fileId"),
      )
      .first<{ r2_key: string }>();
    if (!row) return c.json({ error: "File not found" }, 404);
    // Retain bytes for restore and to avoid racing an idempotent re-upload.
    return c.body(null, 204);
  });
  return app;
}
/**
 * Writes each planned file as a frame, in order, reading at most six from R2
 * ahead of the one being written. A failed read is a 500 frame; a missing
 * file a 404. A body that fails part-way ends the response without its end
 * frame, so the client asks again for what did not arrive.
 */
async function writeBatch(
  files: R2Bucket,
  plan: { id: string; row?: FileRow }[],
  writable: WritableStream<Uint8Array>,
) {
  const reads: (Promise<R2ObjectBody | null> | undefined)[] = [];
  const read = (index: number) => {
    const row = plan[index]?.row;
    if (row) reads[index] = files.get(row.r2_key);
  };
  for (let index = 0; index < R2_AT_ONCE; index++) read(index);
  let writer = writable.getWriter();
  let index = 0;
  try {
    for (; index < plan.length; index++) {
      const { id, row } = plan[index]!;
      const object = row
        ? await reads[index]!.catch(() => undefined)
        : null;
      read(index + R2_AT_ONCE);
      if (object === undefined) {
        await writer.write(encodeFrameHeader({ id, status: 500 }));
        continue;
      }
      if (!object || !row) {
        await writer.write(encodeFrameHeader({ id, status: 404 }));
        continue;
      }
      await writer.write(
        encodeFrameHeader({
          id,
          status: 200,
          size: object.size,
          type: row.media_type,
        }),
      );
      writer.releaseLock();
      await object.body.pipeTo(writable, { preventClose: true });
      writer = writable.getWriter();
    }
    await writer.write(encodeFrameHeader({ end: true }));
    await writer.close();
  } catch (error) {
    // The client left, or a body failed: stop, and free the reads ahead.
    for (const pending of reads.slice(index))
      void pending?.then(
        (object) => object?.body.cancel().catch(() => {}),
        () => {},
      );
    await writer.abort(error).catch(() => {});
  }
}
interface FileRow {
  id: string;
  r2_key: string;
  file_size: number;
  media_type: string;
  created_at: number;
  deleted_at: number | null;
}
function present(row: FileRow) {
  return {
    id: row.id,
    r2Key: row.r2_key,
    fileSize: row.file_size,
    mediaType: row.media_type,
    createdAt: row.created_at,
  };
}
