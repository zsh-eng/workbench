import { Hono, type Context, type Env } from "hono";
import { bodyLimit } from "hono/body-limit";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";

const flowCookie = "__Secure-arctic.auth_flow";
const cookiePath = "/api/arctic/auth";
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const verifierPattern = /^[A-Za-z0-9._~-]{43,128}$/;
const callback = "articles://auth/callback";
const flowLifetime = 10 * 60 * 1000;
const codeLifetime = 60 * 1000;

type Flow = { challenge: string; state: string };
type User = { id: string; email: string };
type Identity = { user: User; cookie: string };
type CodeBinding = { codeHash: string; challenge: string; expiresAt: number };
function authenticatedCodeContext(binding: CodeBinding) {
  return new TextEncoder().encode(
    JSON.stringify([
      "arctic-native-code-v1",
      binding.codeHash,
      binding.challenge,
      binding.expiresAt,
    ]),
  );
}
/** Small storage contract so the host can supply D1 without leaking its generated types. */
interface NativeAuthStatement {
  bind(...values: unknown[]): NativeAuthStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<unknown>;
}
export interface NativeAuthDatabase {
  prepare(query: string): NativeAuthStatement;
  batch(statements: NativeAuthStatement[]): Promise<unknown>;
}
export interface NativeAuthOptions<E extends Env> {
  /** Host-specific Better Auth cookie; defaults to the legacy Reader host. */
  sessionCookieName?: string;
  database(c: Context<E>): NativeAuthDatabase;
  secret(c: Context<E>): string;
  origin(c: Context<E>): string;
  /** Existing Better Auth Google sign-in. Return its cookies and authorization URL. */
  startGoogle(
    c: Context<E>,
    success: string,
    failure: string,
  ): Promise<Response>;
  /** Must validate the signed cookie and check server session expiry/revocation. */
  authenticate(c: Context<E>, cookie: string): Promise<User | null>;
  now?: () => number;
}
function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}
export async function pkceChallenge(verifier: string): Promise<string> {
  return base64url(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
}
async function encryptionKey(secret: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`arctic-native-auth-v1\0${secret}`),
  );
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
async function seal(
  identity: Identity,
  secret: string,
  binding: CodeBinding,
): Promise<string> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: nonce,
      additionalData: authenticatedCodeContext(binding),
    },
    await encryptionKey(secret),
    new TextEncoder().encode(JSON.stringify(identity)),
  );
  return `${base64url(nonce)}.${base64url(new Uint8Array(ciphertext))}`;
}
async function open(
  payload: string,
  secret: string,
  binding: CodeBinding,
): Promise<Identity> {
  const decode = (value: string) =>
    Uint8Array.from(
      atob(value.replaceAll("-", "+").replaceAll("_", "/")),
      (character) => character.charCodeAt(0),
    );
  const [nonce, ciphertext] = payload.split(".");
  if (!nonce || !ciphertext)
    throw new Error("Invalid native authorization payload");
  const bytes = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(nonce),
      additionalData: authenticatedCodeContext(binding),
    },
    await encryptionKey(secret),
    decode(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(bytes)) as Identity;
}
function redirect(state: string, query: Record<string, string>): string {
  const url = new URL(callback);
  url.search = new URLSearchParams({ state, ...query }).toString();
  return url.toString();
}

/** Public endpoints carry no shared client secret. The verifier is known only to
 * the initiating app; the browser cookie binds OAuth completion to that flow.
 * Exchange consumes a matching code in one SQL statement, including under races. */
export function createNativeAuthRoutes<E extends Env>(
  options: NativeAuthOptions<E>,
) {
  const now = options.now ?? Date.now;
  const sessionCookieName =
    options.sessionCookieName ?? "__Secure-better-auth.session_token";
  async function consumeFlow(c: Context<E>): Promise<Flow | null> {
    const flow = c.req.query("flow");
    if (!flow || !tokenPattern.test(flow) || getCookie(c, flowCookie) !== flow)
      return null;
    const result = await options
      .database(c)
      .prepare(
        "DELETE FROM native_auth_flows WHERE id_hash = ? AND expires_at > ? RETURNING challenge, state",
      )
      .bind(await pkceChallenge(flow), now())
      .first<Flow>();
    deleteCookie(c, flowCookie, { path: cookiePath, secure: true });
    return result;
  }
  return new Hono<E>()
    .use("*", async (c, next) => {
      c.header("Cache-Control", "no-store");
      c.header("Referrer-Policy", "no-referrer");
      await next();
    })
    .get("/start", async (c: Context<E>) => {
      const challenge = c.req.query("challenge"),
        state = c.req.query("state");
      if (
        !challenge ||
        !state ||
        !tokenPattern.test(challenge) ||
        !tokenPattern.test(state)
      )
        return c.json({ error: "Invalid authorization request" }, 400);
      const flow = randomToken(),
        origin = new URL(options.origin(c)).origin;
      if (!origin.startsWith("https://"))
        return c.json({ error: "HTTPS is required" }, 400);
      const database = options.database(c);
      const response = await options.startGoogle(
        c,
        `${origin}${cookiePath}/finish?flow=${flow}`,
        `${origin}${cookiePath}/failure?flow=${flow}`,
      );
      if (!response.ok)
        return c.json(
          { error: "Unable to start Google sign-in" },
          response.status === 429 ? 429 : 502,
        );
      const body = (await response.json()) as { url?: string };
      if (!body.url || new URL(body.url).protocol !== "https:")
        return c.json({ error: "Invalid provider response" }, 502);
      await database.batch([
        database
          .prepare("DELETE FROM native_auth_flows WHERE expires_at <= ?")
          .bind(now()),
        database
          .prepare("DELETE FROM native_auth_codes WHERE expires_at <= ?")
          .bind(now()),
        database
          .prepare(
            "INSERT INTO native_auth_flows (id_hash, challenge, state, expires_at) VALUES (?, ?, ?, ?)",
          )
          .bind(
            await pkceChallenge(flow),
            challenge,
            state,
            now() + flowLifetime,
          ),
      ]);
      for (const cookie of response.headers.getSetCookie())
        c.header("Set-Cookie", cookie, { append: true });
      setCookie(c, flowCookie, flow, {
        secure: true,
        httpOnly: true,
        sameSite: "Lax",
        path: cookiePath,
        maxAge: flowLifetime / 1000,
      });
      return c.redirect(body.url, 302);
    })
    .get("/finish", async (c: Context<E>) => {
      const flow = await consumeFlow(c);
      if (!flow) return c.json({ error: "Authorization request expired" }, 400);
      const cookieValue = getCookie(c, sessionCookieName);
      if (!cookieValue)
        return c.redirect(
          redirect(flow.state, { error: "sign_in_failed" }),
          302,
        );
      // Hono decoded the cookie value. Re-encode exactly as Better Auth expects.
      const cookie = `${sessionCookieName}=${encodeURIComponent(cookieValue)}`;
      const user = await options.authenticate(c, cookie);
      if (!user)
        return c.redirect(
          redirect(flow.state, { error: "sign_in_failed" }),
          302,
        );
      const code = randomToken();
      const binding = {
        codeHash: await pkceChallenge(code),
        challenge: flow.challenge,
        expiresAt: now() + codeLifetime,
      };
      await options
        .database(c)
        .prepare(
          "INSERT INTO native_auth_codes (code_hash, challenge, payload, expires_at) VALUES (?, ?, ?, ?)",
        )
        .bind(
          binding.codeHash,
          binding.challenge,
          await seal({ user, cookie }, options.secret(c), binding),
          binding.expiresAt,
        )
        .run();
      return c.redirect(redirect(flow.state, { code }), 302);
    })
    .get("/failure", async (c: Context<E>) => {
      const flow = await consumeFlow(c);
      return flow
        ? c.redirect(redirect(flow.state, { error: "sign_in_failed" }), 302)
        : c.json({ error: "Authorization request expired" }, 400);
    })
    .post("/exchange", bodyLimit({ maxSize: 4096 }), async (c: Context<E>) => {
      // This response installs an authentication cookie. Reject browser form
      // submissions and foreign origins even when they carry an attacker's own
      // valid code/verifier. Native URLSession does not need an Origin header.
      const origin = c.req.header("Origin");
      if (
        origin !== undefined &&
        origin !== new URL(options.origin(c)).origin
      ) {
        return c.json({ error: "Origin is not allowed" }, 403);
      }
      const contentType = c.req
        .header("Content-Type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase();
      if (contentType !== "application/json") {
        return c.json({ error: "JSON is required" }, 415);
      }
      let parsed: unknown;
      try {
        parsed = await c.req.json();
      } catch {
        return c.json({ error: "Invalid authorization request" }, 400);
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return c.json({ error: "Invalid authorization request" }, 400);
      }
      const body = parsed as { code?: unknown; verifier?: unknown };
      if (
        typeof body.code !== "string" ||
        !tokenPattern.test(body.code) ||
        typeof body.verifier !== "string" ||
        !verifierPattern.test(body.verifier)
      )
        return c.json({ error: "Invalid authorization request" }, 400);
      const codeHash = await pkceChallenge(body.code);
      const challenge = await pkceChallenge(body.verifier);
      const row = await options
        .database(c)
        .prepare(
          "DELETE FROM native_auth_codes WHERE code_hash = ? AND challenge = ? AND expires_at > ? RETURNING payload, expires_at",
        )
        .bind(codeHash, challenge, now())
        .first<{ payload: string; expires_at: number }>();
      if (!row)
        return c.json(
          { error: "Authorization code is invalid or expired" },
          400,
        );
      let identity: Identity;
      try {
        // Bind the ciphertext to this exact one-time code and deadline. A write
        // to the isolated handshake DB cannot transplant another session payload.
        identity = await open(row.payload, options.secret(c), {
          codeHash,
          challenge,
          expiresAt: row.expires_at,
        });
      } catch {
        return c.json(
          { error: "Authorization code is invalid or expired" },
          400,
        );
      }
      const user = await options.authenticate(c, identity.cookie);
      if (!user || user.id !== identity.user.id)
        return c.json({ error: "Session expired" }, 401);
      c.header(
        "Set-Cookie",
        `${identity.cookie}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      );
      return c.json({ user });
    });
}
