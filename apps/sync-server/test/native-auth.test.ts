import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../src/index";
import { pkceChallenge } from "@workbench/arctic-sync-server/native-auth";

const origin = "https://localhost:8792";
const bindings = {
  ...env,
  BASE_URL: origin,
  GOOGLE_CLIENT_ID: "native-test",
  GOOGLE_CLIENT_SECRET: "test-only",
};
const cookieHeader = (r: Response) =>
  r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
const request = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(origin + path, init), bindings);

// Google itself is outside this test. Use a real Better Auth login in the
// browser, then exercise the production start/finish/exchange routes and D1.
async function signedInBrowser() {
  const response = await request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify({
      name: "Native fixture",
      email: `${crypto.randomUUID()}@example.test`,
      password: "native-test-password",
    }),
  });
  expect(response.status).toBe(200);
  return cookieHeader(response);
}
async function authorization(cookie: string) {
  const verifier = crypto.randomUUID() + crypto.randomUUID();
  const state = await pkceChallenge(crypto.randomUUID());
  const start = await request(
    `/api/arctic/auth/start?state=${state}&challenge=${await pkceChallenge(verifier)}`,
  );
  expect(start.status).toBe(302);
  const google = new URL(start.headers.get("location")!);
  expect(google.origin).toBe("https://accounts.google.com");
  expect(google.searchParams.get("redirect_uri")).toBe(
    `${origin}/api/auth/callback/google`,
  );
  const flowCookie = cookieHeader(start);
  const flow = /__Secure-arctic.auth_flow=([^;]+)/.exec(flowCookie)![1];
  const finish = `/api/arctic/auth/finish?flow=${flow}`;
  const response = await request(finish, {
    headers: { Cookie: `${cookie}; ${flowCookie}` },
  });
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get("location")!);
  expect(`${callback.protocol}//${callback.host}${callback.pathname}`).toBe(
    "articles://auth/callback",
  );
  expect(callback.searchParams.get("state")).toBe(state);
  expect(callback.searchParams.has("error")).toBe(false);
  expect(callback.searchParams.has("token")).toBe(false);
  expect(
    (await request(finish, { headers: { Cookie: flowCookie } })).status,
  ).toBe(400);
  return { code: callback.searchParams.get("code")!, verifier };
}
const exchange = (body: { code: string; verifier: string }) =>
  request("/api/arctic/auth/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

it("exchanges a one-use native code into shared auth and scoped Arctic sync, then revokes it", async () => {
  const browser = await signedInBrowser();
  const grant = await authorization(browser);
  expect((await exchange({ ...grant, verifier: "x".repeat(64) })).status).toBe(
    400,
  );
  const response = await exchange(grant);
  expect(response.status).toBe(200);
  const cookie = cookieHeader(response);
  expect(cookie).toContain("__Secure-workbench.session_token=");
  expect((await exchange(grant)).status).toBe(400);
  const state = await request("/api/apps/arctic/sync/v3/state", {
    headers: { Cookie: cookie },
  });
  const scope = (await state.json()) as { userId: string; namespace: string };
  expect(scope.namespace).toBe("arctic");
  // Force a live but renewal-due session. Middleware must pass Better Auth's
  // refreshed Set-Cookie through to URLSession, not drop it at the API boundary.
  const oldExpiry = Date.now() + 2 * 24 * 60 * 60 * 1000;
  await env.DATABASE.prepare(
    "UPDATE session SET updated_at=?, expires_at=? WHERE user_id=?",
  )
    .bind(Date.now() - 3 * 24 * 60 * 60 * 1000, oldExpiry, scope.userId)
    .run();
  const renewed = await request("/api/apps/arctic/sync/v3/state", {
    headers: { Cookie: cookie },
  });
  expect(renewed.status).toBe(200);
  expect(cookieHeader(renewed)).toContain("__Secure-workbench.session_token=");
  const saved = await env.DATABASE.prepare(
    "SELECT expires_at AS expires FROM session WHERE user_id=?",
  )
    .bind(scope.userId)
    .first<{ expires: number }>();
  expect(saved!.expires).toBeGreaterThan(oldExpiry);
  const headers = {
    Cookie: cookie,
    "X-Sync-Scope": JSON.stringify(scope),
    "X-Device-ID": "native-phone",
    "Content-Type": "application/json",
  };
  const push = await request("/api/apps/arctic/sync/v3/push", {
    method: "POST",
    headers,
    body: JSON.stringify({
      changes: [
        {
          key: "article/test",
          value: '{"title":"Native test"}',
          schemaVersion: 1,
          isDeleted: false,
          hlc: { wallTimeMs: 1000, counter: 0 },
        },
      ],
    }),
  });
  expect(push.status).toBe(200);
  const pull = await request(
    "/api/apps/arctic/sync/v3/pull?cursor=0&excludeOwnDevice=false",
    { headers: { ...headers, "X-Device-ID": "native-mac" } },
  );
  expect(((await pull.json()) as { records: unknown[] }).records).toHaveLength(
    1,
  );
  expect((await request("/api/apps/arctic/files", { headers })).status).toBe(
    404,
  );
  expect(
    (
      await request("/api/apps/arctic/files/xxh64:0000000000000000", {
        headers,
        method: "PUT",
        body: "no media",
      })
    ).status,
  ).toBe(404);
  await request("/api/auth/sign-out", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(
    (await request("/api/apps/arctic/sync/v3/state", { headers })).status,
  ).toBe(401);
});

it("rejects expired and revoked native grants without minting a credential", async () => {
  const browser = await signedInBrowser();
  const expired = await authorization(browser);
  await env.DATABASE.prepare(
    "UPDATE native_auth_codes SET expires_at=0 WHERE code_hash=?",
  )
    .bind(await pkceChallenge(expired.code))
    .run();
  expect((await exchange(expired)).status).toBe(400);
  const revoked = await authorization(browser);
  await request("/api/auth/sign-out", {
    method: "POST",
    headers: {
      Cookie: browser,
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect((await exchange(revoked)).status).toBe(401);
});
