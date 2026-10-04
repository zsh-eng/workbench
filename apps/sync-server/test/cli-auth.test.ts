import { env } from "cloudflare:test";
import { expect, it } from "vitest";
import worker from "../src/index";
import { digest } from "../src/cli-auth";
const origin = "http://localhost:8792";
const call = (path: string, init?: RequestInit) =>
  worker.fetch(new Request(origin + path, init), env);
const post = (
  path: string,
  body: object = {},
  headers: Record<string, string> = {},
) =>
  call(path, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
async function user() {
  const r = await post(
    "/api/auth/sign-up/email",
    {
      name: "CLI test",
      email: `${crypto.randomUUID()}@example.test`,
      password: "cli-test-password",
    },
    { Origin: origin },
  );
  expect(r.status).toBe(200);
  return r.headers
    .getSetCookie()
    .map((x) => x.split(";")[0])
    .join("; ");
}
it("authorizes device once, isolates identity, rejects all writes, expires and revokes credentials", async () => {
  const cookie = await user();
  const grant = (await (await post("/api/cli/device")).json()) as any;
  expect(grant.access_token).toBeUndefined();
  expect(
    (await post("/api/cli/token", { device_code: grant.device_code })).status,
  ).toBe(400);
  expect(
    (
      (await (
        await post("/api/cli/token", { device_code: grant.device_code })
      ).json()) as any
    ).error,
  ).toBe("slow_down");
  expect(
    (
      await post(
        "/api/cli/approve",
        { user_code: grant.user_code },
        { Cookie: cookie },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await post(
        "/api/cli/approve",
        { user_code: grant.user_code },
        { Origin: origin },
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await post(
        "/api/cli/approve",
        { user_code: grant.user_code },
        { Cookie: cookie, Origin: origin },
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await post(
        "/api/cli/approve",
        { user_code: grant.user_code },
        { Cookie: cookie, Origin: origin },
      )
    ).status,
  ).toBe(400);
  await env.DATABASE.prepare(
    "UPDATE cli_device_grants SET last_poll=0 WHERE device_hash=?",
  )
    .bind(await digest(grant.device_code))
    .run();
  const exchanges = await Promise.all([
    post("/api/cli/token", { device_code: grant.device_code }),
    post("/api/cli/token", { device_code: grant.device_code }),
  ]);
  expect(exchanges.filter((r) => r.status === 200)).toHaveLength(1);
  const { access_token: token } = (await exchanges
    .find((r) => r.status === 200)!
    .json()) as any;
  const headers = { Authorization: `Bearer ${token}` };
  const me = (await (await call("/api/me", { headers })).json()) as any;
  const browserMe = (await (
    await call("/api/me", { headers: { Cookie: cookie } })
  ).json()) as any;
  expect(me.userId).toBe(browserMe.userId);
  expect((await call("/api/namespaces", { headers })).status).toBe(200);
  const state = (await (
    await call("/api/apps/reader/sync/v3/state", { headers })
  ).json()) as any;
  const scoped = {
    ...headers,
    "X-Device-ID": "cli-test",
    "X-Sync-Scope": JSON.stringify(state),
  };
  expect(
    (
      await call(
        "/api/apps/reader/sync/v3/pull?cursor=0&excludeOwnDevice=false",
        { headers: scoped },
      )
    ).status,
  ).toBe(200);
  expect(
    (await post("/api/apps/reader/sync/v3/push", { changes: [] }, scoped))
      .status,
  ).toBe(403);
  expect(
    (
      await call("/api/apps/reader/files/xxh64:0000000000000000", {
        method: "PUT",
        headers: scoped,
        body: "x",
      })
    ).status,
  ).toBe(403);
  expect(
    (
      await call("/api/apps/reader/files/xxh64:0000000000000000", {
        method: "DELETE",
        headers: scoped,
      })
    ).status,
  ).toBe(403);
  expect((await call("/api/apps/reader/sessions", { headers })).status).toBe(
    403,
  );
  const stranger = await user();
  const other = await (
    await call("/api/apps/reader/sync/v3/state", {
      headers: { Cookie: stranger },
    })
  ).json();
  expect(
    (
      await call(
        "/api/apps/reader/sync/v3/pull?cursor=0&excludeOwnDevice=false",
        { headers: { ...scoped, "X-Sync-Scope": JSON.stringify(other) } },
      )
    ).status,
  ).toBe(409);
  await env.DATABASE.prepare(
    "UPDATE cli_tokens SET expires_at=0 WHERE token_hash=?",
  )
    .bind(await digest(token))
    .run();
  expect((await call("/api/me", { headers })).status).toBe(401);
  expect((await post("/api/cli/revoke", {}, headers)).status).toBe(200);
  expect(
    await env.DATABASE.prepare("SELECT * FROM cli_tokens WHERE token_hash=?")
      .bind(await digest(token))
      .first(),
  ).toBeNull();
}, 60000);
it("expires device grants and rejects replay and invalid codes", async () => {
  const g = (await (await post("/api/cli/device")).json()) as any;
  await env.DATABASE.prepare(
    "UPDATE cli_device_grants SET expires_at=0 WHERE device_hash=?",
  )
    .bind(await digest(g.device_code))
    .run();
  expect(
    (
      (await (
        await post("/api/cli/token", { device_code: g.device_code })
      ).json()) as any
    ).error,
  ).toBe("expired_token");
  expect(
    (await post("/api/cli/token", { device_code: "not-a-token" })).status,
  ).toBe(400);
});
