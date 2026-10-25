import { env } from "cloudflare:test";
import { expect } from "vitest";

type Call = (path: string, init: RequestInit) => Promise<Response>;

/** The password behind the migrated accounts' PBKDF2 hash. */
export const MIGRATED_PASSWORD = "test-user-password";
const MIGRATED_HASH =
  "legacy-pbkdf2:Xj+SO0CHAnpDOZyhr2+KAojZiIxA+ns2Oa3M8/uCxACqqWLH6PfCNTuEtuBfyUmt";

/** The cookies a response sets, as one Cookie header. */
export const cookies = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

const post = (call: Call, path: string, origin: string, body: object) =>
  call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });

/** Adds a verified account whose password was migrated as PBKDF2. */
export async function migratedAccount() {
  const id = crypto.randomUUID(),
    email = `${id}@example.test`,
    now = Date.now();
  await env.DATABASE.batch([
    env.DATABASE.prepare(
      "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
    ).bind(id, "Migrated fixture", email, 1, now, now),
    env.DATABASE.prepare(
      "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(id, id, "credential", id, MIGRATED_HASH, now, now),
  ]);
  return { id, email };
}

/**
 * A new account signed in through the real sign-in route. Its PBKDF2
 * password checks natively; a sign-up's scrypt hash takes seconds in workerd,
 * so only tests about sign-up use `signUp`.
 */
export async function signedIn(call: Call, origin: string) {
  const { email } = await migratedAccount();
  const response = await post(call, "/api/auth/sign-in/email", origin, {
    email,
    password: MIGRATED_PASSWORD,
  });
  expect(response.status).toBe(200);
  return cookies(response);
}

/** A new account through the real sign-up route. */
export async function signUp(call: Call, origin: string) {
  const response = await post(call, "/api/auth/sign-up/email", origin, {
    email: `${crypto.randomUUID()}@example.test`,
    password: "test-password-123",
    name: "Local reader",
  });
  expect(response.status).toBe(200);
  return cookies(response);
}
