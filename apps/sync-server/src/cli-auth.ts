import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { html } from "hono/html";
import { createAuth } from "./auth";
import type { AppEnv } from "./env";

const lifetime = 90 * 24 * 60 * 60 * 1000;
export const digest = async (s: string) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)),
    ),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
const random = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
export const cliAuth = new Hono<AppEnv>();
cliAuth.use("*", bodyLimit({ maxSize: 2048 }));
cliAuth.use("*", async (c, next) => {
  c.header("Cache-Control", "no-store");
  // Per-source budgets bound allocation and online user-code guessing. No raw IPs stored.
  const key = await digest(
    `${c.req.path}:${c.req.header("CF-Connecting-IP") ?? "local"}:${Math.floor(Date.now() / 60000)}`,
  );
  const row = await c.env.DATABASE.prepare(
    "INSERT INTO cli_rate_limits(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, Date.now() + 120000)
    .first<{ count: number }>();
  if (row!.count > (c.req.path.endsWith("/token") ? 60 : 15)) {
    c.header("Retry-After", "60");
    return c.json({ error: "rate_limited" }, 429);
  }
  await c.env.DATABASE.prepare(
    "DELETE FROM cli_rate_limits WHERE expires_at < ?",
  )
    .bind(Date.now())
    .run();
  return next();
});
cliAuth.post("/device", async (c) => {
  const device = random();
  const alphabet = "BCDFGHJKLMNPQRSTVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  const code = Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
  await c.env.DATABASE.prepare(
    "DELETE FROM cli_device_grants WHERE expires_at <= ?",
  )
    .bind(Date.now())
    .run();
  await c.env.DATABASE.prepare(
    "INSERT INTO cli_device_grants(device_hash,user_code,expires_at) VALUES(?,?,?)",
  )
    .bind(await digest(device), code, Date.now() + 600000)
    .run();
  return c.json({
    device_code: device,
    user_code: `${code.slice(0, 4)}-${code.slice(4)}`,
    verification_uri: `${c.env.BASE_URL}/device`,
    expires_in: 600,
    interval: 5,
  });
});
cliAuth.post("/approve", async (c) => {
  if (c.req.header("Origin") !== new URL(c.env.BASE_URL).origin)
    return c.json({ error: "Untrusted origin" }, 403);
  const session = await createAuth(c.env).api.getSession({
    headers: c.req.raw.headers,
  });
  if (!session) return c.json({ error: "Sign in first" }, 401);
  const body = await c.req.json().catch(() => null);
  const code =
    typeof body?.user_code === "string"
      ? body.user_code.replaceAll("-", "").trim().toUpperCase()
      : "";
  if (!/^[A-Z2-9]{8}$/.test(code))
    return c.json({ error: "Invalid code" }, 400);
  const row = await c.env.DATABASE.prepare(
    "UPDATE cli_device_grants SET user_id=? WHERE user_code=? AND expires_at>? AND user_id IS NULL RETURNING device_hash",
  )
    .bind(session.user.id, code, Date.now())
    .first();
  return row
    ? c.json({ ok: true })
    : c.json({ error: "Code expired or already used" }, 400);
});
cliAuth.post("/token", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!/^[a-f0-9]{64}$/.test(body?.device_code ?? ""))
    return c.json({ error: "invalid_grant" }, 400);
  const hash = await digest(body.device_code);
  const grant = await c.env.DATABASE.prepare(
    "SELECT * FROM cli_device_grants WHERE device_hash=?",
  )
    .bind(hash)
    .first<{ user_id: string | null; expires_at: number; last_poll: number }>();
  if (!grant || grant.expires_at <= Date.now())
    return c.json({ error: "expired_token" }, 400);
  if (Date.now() - grant.last_poll < 5000)
    return c.json({ error: "slow_down" }, 400);
  await c.env.DATABASE.prepare(
    "UPDATE cli_device_grants SET last_poll=? WHERE device_hash=?",
  )
    .bind(Date.now(), hash)
    .run();
  if (!grant.user_id) return c.json({ error: "authorization_pending" }, 400);
  const token = `wb_${random()}`;
  const now = Date.now();
  // D1 batch is atomic: only one concurrent exchange can insert before consuming the grant.
  const results = await c.env.DATABASE.batch([
    c.env.DATABASE.prepare(
      "INSERT INTO cli_tokens(token_hash,user_id,created_at,expires_at) SELECT ?,user_id,?,? FROM cli_device_grants WHERE device_hash=? AND user_id IS NOT NULL AND expires_at>?",
    ).bind(await digest(token), now, now + lifetime, hash, now),
    c.env.DATABASE.prepare(
      "DELETE FROM cli_device_grants WHERE device_hash=?",
    ).bind(hash),
  ]);
  if (results[0].meta.changes !== 1)
    return c.json({ error: "invalid_grant" }, 400);
  return c.json({
    access_token: token,
    token_type: "Bearer",
    expires_in: lifetime / 1000,
    scope: "sync:read files:read",
  });
});
cliAuth.post("/revoke", async (c) => {
  const token = c.req.header("Authorization")?.replace(/^Bearer /, "") ?? "";
  await c.env.DATABASE.prepare("DELETE FROM cli_tokens WHERE token_hash=?")
    .bind(await digest(token))
    .run();
  return c.json({ ok: true });
});

/** This credential authorizes only explicitly listed read routes, never app writes. */
export async function cliIdentity(c: Context<AppEnv>) {
  const header = c.req.header("Authorization");
  if (!header?.startsWith("Bearer wb_")) return null;
  const row = await c.env.DATABASE.prepare(
    `SELECT u.*,t.expires_at FROM cli_tokens t JOIN user u ON u.id=t.user_id WHERE t.token_hash=? AND t.expires_at>?`,
  )
    .bind(await digest(header.slice(7)), Date.now())
    .first<{
      id: string;
      name: string;
      email: string;
      email_verified: number;
      image: string | null;
      created_at: number;
      updated_at: number;
      expires_at: number;
    }>();
  if (!row) return null;
  return {
    user: {
      id: row.id,
      name: row.name,
      email: row.email,
      emailVerified: !!row.email_verified,
      image: row.image,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    },
    expiresAt: new Date(row.expires_at),
  };
}
export const cliReadPath = (path: string) =>
  path === "/api/me" ||
  path === "/api/namespaces" ||
  /^\/api\/apps\/(reader|spaced)\/(sync\/v3\/(state|pull|pull-stream)|files(?:\/xxh64:[a-f0-9]{16})?\/?|me)$/.test(
    decodeURIComponent(path),
  );

export function devicePage(local: boolean) {
  return html`
    <!doctype html>
    <html lang="en">
      <meta charset="utf-8" /><meta
        name="viewport"
        content="width=device-width,initial-scale=1"
      /><title>Authorize Workbench CLI</title>
      <style>
        body {
          font: 16px system-ui;
          max-width: 28rem;
          margin: 10vh auto;
          padding: 1rem;
        }
        input,
        button {
          font: inherit;
          padding: 0.7rem;
          margin: 0.4rem 0;
        }
        label {
          display: block;
        }
        #message {
          white-space: pre-wrap;
        }
      </style>
      <h1>Authorize Workbench CLI</h1>
      <p>
        This allows a CLI to download your Reader and Spaced data and files for 90
        days. It cannot edit your data. Only enter a code from a login you started.
      </p>
      <p id="identity"></p>
      <button id="google">Sign in with Google</button>
      ${local ? html`<form id="local"><label>Email <input name="email" type="email" required></label><label>Password <input name="password" type="password" required></label><button>Sign in locally</button></form>` : ""}
      <form id="approve" hidden>
        <label
          >Device code
          <input
            name="code"
            placeholder="XXXX-XXXX"
            autocomplete="off"
            required
            maxlength="9" /></label
        ><button>Approve read-only access</button>
      </form>
      <p id="message" role="status"></p>
      <script>
        const message = document.querySelector("#message");
        async function check() {
          const r = await fetch("/api/me");
          if (r.ok) {
            const v = await r.json();
            document.querySelector("#identity").textContent =
              "Signed in as " + v.user.email;
            document.querySelector("#approve").hidden = false;
            document.querySelector("#google").hidden = true;
            document.querySelector("#local")?.setAttribute("hidden", "");
          }
        }
        document.querySelector("#google").onclick = async () => {
          try {
            const r = await fetch("/api/auth/sign-in/social", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                provider: "google",
                callbackURL: location.origin + "/device",
              }),
            });
            const v = await r.json();
            if (!r.ok || !v.url) throw Error(v.message || "Sign in failed");
            location.assign(v.url);
          } catch (e) {
            message.textContent = e.message;
          }
        };
        document.querySelector("#local")?.addEventListener("submit", async (e) => {
          e.preventDefault();
          const f = new FormData(e.target);
          const r = await fetch("/api/auth/sign-in/email", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(Object.fromEntries(f)),
          });
          if (r.ok) await check();
          else message.textContent = "Sign in failed";
        });
        document.querySelector("#approve").onsubmit = async (e) => {
          e.preventDefault();
          const r = await fetch("/api/cli/approve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_code: new FormData(e.target).get("code") }),
          });
          const v = await r.json();
          message.textContent = r.ok
            ? "Approved. Return to your terminal."
            : v.error;
          if (r.ok) e.target.hidden = true;
        };
        check().catch(() => {
          message.textContent = "Unable to check session";
        });
      </script>
    </html>
  `;
}
