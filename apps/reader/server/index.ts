import { createArcticNativeAuthRoutes } from "@server/lib/arctic-native-auth";
import { createArcticRoutes } from "@workbench/arctic-sync-server/routes";
import { createSyncHonoRoutes } from "@zsh-eng/local-sync/hono";
import { createAuth } from "@server/lib/auth";
import { getDevices } from "@server/lib/devices";
import {
  deleteRemoteFile,
  fileIdSchema,
  getRemoteFile,
  listRemoteFiles,
  putRemoteFile,
} from "@server/lib/files";
import { extractDevice } from "@server/lib/middleware/extract-device";
import { requireAuth, requireUser } from "@server/lib/middleware/require-auth";
import { getActiveSessions } from "@server/lib/sessions";
import type { Session, User } from "better-auth/types";
import { Hono } from "hono";
import { cors } from "hono/cors";

// Define your environment bindings type
type Bindings = Env & { SYNC_CUTOVER_MODE?: "freeze" | "retired" };

type AppEnv = {
  Bindings: Bindings;
  Variables: {
    user: User | undefined;
    session: Session | undefined;
    deviceId: string | undefined;
  };
};

const app = new Hono<AppEnv>();
// Cutover only: keep reads and auth available; Arctic routes are independent.
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

app.use(
  "*",
  async (c, next) => {
    const auth = createAuth(c.env);
    const session = await auth.api.getSession({
      headers: c.req.raw.headers,
    });

    if (session) {
      c.set("user", session.user);
      c.set("session", session.session);
    }

    await next();
  },
  extractDevice,
);

// https://www.better-auth.com/docs/integrations/hono#cors
app.use(
  "/api/auth/*", // or replace with "*" to enable cors for all routes
  async (c, next) => {
    const corsMiddlewareHandler = cors({
      origin: c.env.BASE_URL || "http://localhost:5173",
      allowHeaders: ["Content-Type", "Authorization"],
      allowMethods: ["POST", "GET", "OPTIONS"],
      exposeHeaders: ["Content-Length"],
      maxAge: 600,
      credentials: true,
    });
    return corsMiddlewareHandler(c, next);
  },
);

app.on(["POST", "GET"], "/api/auth/*", (c) => {
  const auth = createAuth(c.env);
  return auth.handler(c.req.raw);
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const route = app
  .basePath("/api")
  .get("/hello", (c) => {
    return c.json({ message: "Hello from backend!" });
  })
  .get("/me", requireUser, (c) => {
    const user = c.get("user")!;
    return c.json({ user });
  })
  .get("/sessions", requireUser, async (c) => {
    const user = c.get("user")!;
    const currentSession = c.get("session")!;
    const activeSessions = await getActiveSessions(c.env, currentSession, user);
    return c.json({ sessions: activeSessions });
  })
  .get("/devices", requireAuth, async (c) => {
    const user = c.get("user")!;
    const currentDeviceId = c.get("deviceId")!;
    const devices = await getDevices(c.env.DATABASE, user.id, currentDeviceId);
    return c.json({ devices });
  })
  .put("/files/:fileId", requireUser, async (c) => {
    const user = c.get("user")!;
    const fileIdResult = fileIdSchema.safeParse(c.req.param("fileId"));
    if (!fileIdResult.success) {
      return c.json({ error: "Invalid file ID" }, 400);
    }

    try {
      const content = await c.req.arrayBuffer();
      const result = await putRemoteFile(
        c.env.DATABASE,
        c.env.BOOK_STORAGE,
        user.id,
        fileIdResult.data,
        content,
        c.req.header("Content-Type") ?? "application/octet-stream",
      );

      if (!result) {
        return c.json({ error: "File ID does not match content" }, 400);
      }

      return c.json({
        id: result.id,
        fileSize: result.fileSize,
        mediaType: result.mediaType,
        createdAt: result.createdAt.getTime(),
        alreadyExists: result.alreadyExists,
      });
    } catch (error) {
      console.error("Error uploading file:", error);
      return c.json({ error: "Failed to upload file" }, 500);
    }
  })
  .get("/files", requireUser, async (c) => {
    const user = c.get("user")!;

    try {
      const files = await listRemoteFiles(c.env.DATABASE, user.id);
      return c.json({
        files: files.map((file) => ({
          id: file.id,
          fileSize: file.fileSize,
          mediaType: file.mediaType,
          createdAt: file.createdAt.getTime(),
        })),
      });
    } catch (error) {
      console.error("Error listing files:", error);
      return c.json({ error: "Failed to list files" }, 500);
    }
  })
  .get("/files/:fileId", requireUser, async (c) => {
    const user = c.get("user")!;
    const fileIdResult = fileIdSchema.safeParse(c.req.param("fileId"));
    if (!fileIdResult.success) {
      return c.json({ error: "Invalid file ID" }, 400);
    }

    try {
      const storedFile = await getRemoteFile(
        c.env.DATABASE,
        user.id,
        fileIdResult.data,
      );

      if (!storedFile) {
        return c.json({ error: "File not found" }, 404);
      }

      const object = await c.env.BOOK_STORAGE.get(storedFile.r2Key);

      if (!object) {
        console.error(`R2 key exists in DB but not in R2: ${storedFile.r2Key}`);
        return c.json({ error: "File not found in storage" }, 404);
      }

      const headers = new Headers({
        "Content-Type": storedFile.mediaType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": object.size.toString(),
      });

      if (object.httpEtag) {
        headers.set("ETag", object.httpEtag);
      }

      return new Response(object.body, {
        headers,
      });
    } catch (error) {
      console.error("Error fetching file from R2:", error);
      return c.json({ error: "Failed to retrieve file" }, 500);
    }
  })
  .delete("/files/:fileId", requireUser, async (c) => {
    const user = c.get("user")!;
    const fileIdResult = fileIdSchema.safeParse(c.req.param("fileId"));
    if (!fileIdResult.success) {
      return c.json({ error: "Invalid file ID" }, 400);
    }

    try {
      const deleted = await deleteRemoteFile(
        c.env.DATABASE,
        c.env.BOOK_STORAGE,
        user.id,
        fileIdResult.data,
      );

      if (!deleted) {
        return c.json({ error: "File not found" }, 404);
      }

      return c.body(null, 204);
    } catch (error) {
      console.error("Error deleting file:", error);
      return c.json({ error: "Failed to delete file" }, 500);
    }
  })
  .route("/arctic/auth", createArcticNativeAuthRoutes())
  .route(
    "/arctic",
    createArcticRoutes<AppEnv>({
      requireAuth,
      getIdentity: (c) => ({
        userId: c.get("user")!.id,
        deviceId: c.get("deviceId"),
      }),
      getDatabase: (c) => c.env.ARCTIC_DATABASE,
      getBucket: (c) => c.env.BOOK_STORAGE,
    }),
  )
  .route(
    "/sync/v2",
    createSyncHonoRoutes({
      requireAuth,
      getIdentity: (c) => ({
        userId: c.get("user")!.id,
        deviceId: c.get("deviceId"),
      }),
      getDatabase: (c) => c.env.DATABASE,
    }),
  );

export default app;

// Export type for client-side type inference
export type AppType = typeof route;
