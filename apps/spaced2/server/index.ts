import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { bodyLimit } from "hono/body-limit";
import { createSyncHonoRoutes } from "@zsh-eng/local-sync/hono";
import { createAuth } from "./lib/auth";
import {
  fileIdSchema,
  putRemoteFile,
  getRemoteFile,
  listRemoteFiles,
  deleteRemoteFile,
} from "./lib/files";
import type { User, Session } from "better-auth/types";

type AppEnv = { Bindings: Env; Variables: { user: User; session: Session } };
const app = new Hono<AppEnv>();
// Cutover only: keep reads and auth available.
app.use("/api/*", async (c, next) => {
  const mode = c.env.SYNC_CUTOVER_MODE;
  const recordWrite =
    c.req.method === "POST" && c.req.path === "/api/sync/v2/push";
  const fileWrite =
    ["PUT", "DELETE"].includes(c.req.method) &&
    c.req.path.startsWith("/api/files/");
  if (mode && (recordWrite || fileWrite)) {
    c.header("Cache-Control", "no-store");
    if (mode === "freeze") c.header("Retry-After", "60");
    return c.json(
      {
        error: mode === "freeze" ? "SYNC_MAINTENANCE" : "SYNC_UPGRADE_REQUIRED",
        message:
          "Keep this device's local data. Reload the latest app to continue syncing.",
      },
      mode === "freeze" ? 503 : 410,
    );
  }
  await next();
});

app.on(["POST", "GET"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);
const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", session.user);
  c.set("session", session.session);
  c.header("Cache-Control", "no-store");
  await next();
});
app.get("/api/me", requireUser, (c) =>
  c.json({
    userId: c.get("user").id,
    user: c.get("user"),
    expiresAt: c.get("session").expiresAt,
  }),
);
app.route(
  "/api/sync/v2",
  createSyncHonoRoutes<AppEnv>({
    requireAuth: requireUser,
    getIdentity: (c) => ({
      userId: c.get("user").id,
      deviceId: c.req.header("X-Device-ID"),
    }),
    getDatabase: (c) => c.env.DATABASE,
  }),
);
app.use("/api/files/*", requireUser);
app.get("/api/files", requireUser, async (c) =>
  c.json({ files: await listRemoteFiles(c.env.DATABASE, c.get("user").id) }),
);
app.use("/api/files/:fileId", async (c, next) => {
  if (!fileIdSchema.safeParse(c.req.param("fileId")).success)
    return c.json({ error: "Invalid file ID" }, 400);
  await next();
});
app.put(
  "/api/files/:fileId",
  bodyLimit({
    maxSize: 2 * 1024 * 1024,
    onError: (c) => c.json({ error: "File exceeds 2 MiB" }, 413),
  }),
  async (c) => {
    const result = await putRemoteFile(
      c.env.DATABASE,
      c.env.FILES,
      c.get("user").id,
      fileIdSchema.parse(c.req.param("fileId")),
      await c.req.arrayBuffer(),
      c.req.header("Content-Type") ?? "application/octet-stream",
    );
    return result
      ? c.json(result)
      : c.json({ error: "File ID does not match content" }, 400);
  },
);
app.get("/api/files/:fileId", async (c) => {
  const file = await getRemoteFile(
    c.env.DATABASE,
    c.get("user").id,
    fileIdSchema.parse(c.req.param("fileId")),
  );
  if (!file) return c.json({ error: "File not found" }, 404);
  const object = await c.env.FILES.get(file.r2Key);
  if (!object) return c.json({ error: "File not found" }, 404);
  // Downloads may contain arbitrary user bytes. Do not execute active content on the app origin.
  const headers = new Headers({
    "Content-Type": file.mediaType,
    "Content-Length": String(object.size),
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox; default-src 'none'",
  });
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/avif",
    ].includes(file.mediaType)
  )
    headers.set("Content-Disposition", "attachment");
  if (object.httpEtag) headers.set("ETag", object.httpEtag);
  return new Response(object.body, { headers });
});
app.delete("/api/files/:fileId", async (c) => {
  const deleted = await deleteRemoteFile(
    c.env.DATABASE,
    c.env.FILES,
    c.get("user").id,
    fileIdSchema.parse(c.req.param("fileId")),
  );
  return deleted ? c.body(null, 204) : c.json({ error: "File not found" }, 404);
});
app.all("/api/*", (c) => c.json({ error: "Endpoint not found" }, 404));
export default app;
