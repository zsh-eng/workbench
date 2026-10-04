import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import xxhash from "xxhash-wasm";
import type { AppEnv } from "./env";

let hasher: ReturnType<typeof xxhash> | undefined;
export function createFileRoutes() {
  const app = new Hono<AppEnv>();
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
        maxSize:
          c.get("namespace") === "spaced" ? 2 * 1024 * 1024 : 100 * 1024 * 1024,
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
      const prior = await c.env.DATABASE.prepare(
        "SELECT * FROM file_storage WHERE user_id=? AND namespace=? AND id=?",
      )
        .bind(user, namespace, id)
        .first<FileRow>();
      const key = `users/${encodeURIComponent(user)}/apps/${namespace}/${id}`;
      const mediaType =
        c.req.header("Content-Type") || "application/octet-stream";
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
