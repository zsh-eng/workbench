import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { createSyncHonoRoutes } from "@zsh-eng/local-sync/hono";
import { syncDeviceIdSchema } from "@zsh-eng/local-sync";
import { UAParser } from "ua-parser-js";
import { createAuth } from "./auth";
import { createFileRoutes } from "./files";
import { loginPage } from "./login";
import { trustedOrigins, type AppEnv } from "./env";

const app = new Hono<AppEnv>();
app.use("*", async (c, next) => {
  // This configuration is deliberately local-only. Production needs its own secrets and bindings.
  if (
    c.env.LOCAL_DEVELOPMENT === "true" &&
    !["localhost", "127.0.0.1"].includes(new URL(c.req.url).hostname)
  )
    return c.json({ error: "Local service only" }, 403);
  const origin = c.req.header("Origin");
  if (origin && !trustedOrigins(c.env).includes(origin))
    return c.json({ error: "Untrusted origin" }, 403);
  c.header("Cache-Control", "private, no-store");
  return cors({
    origin: trustedOrigins(c.env),
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "X-Device-ID", "X-Sync-Scope"],
    exposeHeaders: ["X-Sync-Scope", "Content-Length"],
  })(c, next);
});
app.on(["GET", "POST"], "/api/auth/*", (c) =>
  createAuth(c.env).handler(c.req.raw),
);
app.get("/login", (c) => {
  const returnTo =
    c.req.query("returnTo") ?? c.env.APP_ORIGINS.split(",")[0].trim();
  if (!trustedOrigins(c.env).includes(returnTo))
    return c.text("Invalid return origin", 400);
  return c.html(loginPage(returnTo));
});
const requireUser = createMiddleware<AppEnv>(async (c, next) => {
  const auth = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!auth) return c.json({ error: "Unauthorized" }, 401);
  c.set("user", auth.user);
  c.set("session", auth.session);
  await next();
});
app.get("/api/me", requireUser, (c) =>
  c.json({
    user: c.get("user"),
    userId: c.get("user").id,
    expiresAt: c.get("session").expiresAt,
  }),
);
app.use("/api/apps/:namespace/*", requireUser, async (c, next) => {
  const namespace = c.req.param("namespace");
  if (namespace !== "reader" && namespace !== "spaced")
    return c.json({ error: "Unknown app" }, 404);
  c.set("namespace", namespace);
  const userId = c.get("user").id;
  let stream = await c.env.DATABASE.prepare(
    "SELECT epoch FROM sync_streams WHERE user_id=? AND namespace=?",
  )
    .bind(userId, namespace)
    .first<{ epoch: string }>();
  if (!stream) {
    await c.env.DATABASE.prepare(
      "INSERT OR IGNORE INTO sync_streams(user_id,namespace,epoch) VALUES(?,?,?)",
    )
      .bind(userId, namespace, crypto.randomUUID())
      .run();
    stream = await c.env.DATABASE.prepare(
      "SELECT epoch FROM sync_streams WHERE user_id=? AND namespace=?",
    )
      .bind(userId, namespace)
      .first<{ epoch: string }>();
  }
  const scope = {
    origin: new URL(c.env.BASE_URL).origin,
    userId,
    namespace,
    epoch: stream!.epoch,
  };
  c.set("scope", scope);
  c.header("X-Sync-Scope", JSON.stringify(scope));
  const expected = c.req.header("X-Sync-Scope");
  const syncOperation = /\/sync\/v3\/(push|pull|pull-stream)$/.test(c.req.path);
  if ((syncOperation || expected) && expected !== JSON.stringify(scope))
    return c.json({ error: "SYNC_SCOPE_CHANGED", scope }, 409);
  const device = syncDeviceIdSchema.safeParse(c.req.header("X-Device-ID"));
  if (device.success) {
    const now = Date.now();
    await c.env.DATABASE.prepare(`INSERT INTO client_devices(user_id,namespace,client_id,user_agent,created_at,last_active_at) VALUES(?,?,?,?,?,?)
      ON CONFLICT(user_id,namespace,client_id) DO UPDATE SET last_active_at=excluded.last_active_at,user_agent=excluded.user_agent`)
      .bind(
        userId,
        namespace,
        device.data,
        c.req.header("User-Agent") ?? "",
        now,
        now,
      )
      .run();
  }
  await next();
});
app.get("/api/apps/:namespace/sync/v3/state", (c) => c.json(c.get("scope")));
app.route(
  "/api/apps/:namespace/sync/v3",
  createSyncHonoRoutes<AppEnv>({
    requireAuth: requireUser,
    getIdentity: (c) => ({
      userId: c.get("user").id,
      namespace: c.get("namespace"),
      deviceId: c.req.header("X-Device-ID"),
    }),
    getDatabase: (c) => c.env.DATABASE,
  }),
);
app.get("/api/apps/:namespace/me", (c) =>
  c.json({
    user: c.get("user"),
    userId: c.get("user").id,
    expiresAt: c.get("session").expiresAt,
  }),
);
app.get("/api/apps/:namespace/sessions", async (c) => {
  const sessions = await createAuth(c.env).api.listSessions({
    headers: c.req.raw.headers,
  });
  return c.json({
    sessions: sessions.map((s) => ({
      id: s.id,
      ...agentInfo(s.userAgent),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      isCurrent: s.id === c.get("session").id,
    })),
  });
});
app.get("/api/apps/:namespace/devices", async (c) => {
  const rows = await c.env.DATABASE.prepare(
    "SELECT * FROM client_devices WHERE user_id=? AND namespace=? ORDER BY last_active_at DESC",
  )
    .bind(c.get("user").id, c.get("namespace"))
    .all<{
      client_id: string;
      user_agent: string;
      created_at: number;
      last_active_at: number;
    }>();
  return c.json({
    devices: rows.results.map((row) => ({
      id: row.client_id,
      clientId: row.client_id,
      deviceName: null,
      browser: agentInfo(row.user_agent).browser.name,
      os: agentInfo(row.user_agent).os.name,
      deviceType: agentInfo(row.user_agent).deviceType,
      createdAt: new Date(row.created_at).toISOString(),
      lastActiveAt: new Date(row.last_active_at).toISOString(),
      isCurrent: row.client_id === c.req.header("X-Device-ID"),
    })),
  });
});
app.route("/api/apps/:namespace/files", createFileRoutes());
app.get("/health", (c) => c.json({ ok: true, apps: ["reader", "spaced"] }));
function agentInfo(ua?: string | null) {
  const parsed = new UAParser(ua ?? "").getResult();
  return {
    browser: {
      name: parsed.browser.name ?? "Unknown",
      version: parsed.browser.version ?? "",
    },
    os: { name: parsed.os.name ?? "Unknown", version: parsed.os.version ?? "" },
    deviceType: parsed.device.type ?? "desktop",
  };
}
export default app;
