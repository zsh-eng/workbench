import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  createNamespacedHttpClient,
  createSyncClientState,
  type SyncClientState,
} from "@zsh-eng/local-sync";
import xxhash from "xxhash-wasm";
import worker from "../src/index";
const origin = "http://localhost:8792";
async function user() {
  const response = await SELF.fetch(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "http://localhost:5175",
    },
    body: JSON.stringify({
      email: `${crypto.randomUUID()}@example.test`,
      password: "test-password-123",
      name: "Local reader",
    }),
  });
  expect(response.status).toBe(200);
  return response.headers.get("set-cookie")!.split(";")[0];
}
const change = (value: string, counter = 1, isDeleted = false) => ({
  key: "same/key",
  value,
  schemaVersion: 1,
  hlc: { wallTimeMs: 1000, counter },
  isDeleted,
});
function client(cookie: string, namespace: string) {
  let state: SyncClientState = createSyncClientState(crypto.randomUUID());
  const store = {
    read: () => state,
    write: (s: SyncClientState) => {
      state = s;
    },
  };
  const http = createNamespacedHttpClient({
    origin,
    namespace,
    stateStore: store,
    fetch: (input, init) =>
      SELF.fetch(input, {
        ...init,
        headers: {
          ...Object.fromEntries(new Headers(init?.headers)),
          Cookie: cookie,
        },
      }),
  });
  return { ...http, store };
}
it("uses one real auth session with independent app winners, tombstones, pages and streams", async () => {
  const cookie = await user();
  const reader = client(cookie, "reader"),
    spaced = client(cookie, "spaced");
  const a = await reader.remote.getScope!(),
    b = await spaced.remote.getScope!();
  expect(a.userId).toBe(b.userId);
  await reader.remote.push("reader-device", [change("reader")]);
  await spaced.remote.push("spaced-device", [change("spaced", 20)]);
  const duplicate = await reader.remote.push("reader-device", [
    change("stale", 0),
  ]);
  expect(duplicate.results[0].winner.value).toBe("reader");
  await reader.remote.push("reader-device", [
    change("deleted", 2, true),
    { ...change("second"), key: "second/key" },
  ]);
  const page = await reader.remote.pull("new-device", {
    cursor: 0,
    excludeOwnDevice: false,
    limit: 1,
  });
  expect(page.records).toHaveLength(1);
  expect(page.hasMore).toBe(true);
  const rest = await reader.remote.pull("new-device", {
    cursor: page.cursor,
    head: page.head,
    excludeOwnDevice: false,
  });
  expect([...page.records, ...rest.records].map((r) => r.value)).toEqual([
    "deleted",
    "second",
  ]);
  const streamed = [];
  for await (const page of spaced.remote.pullStream!(
    "new-device",
    { cursor: 0, excludeOwnDevice: false },
    new AbortController().signal,
  ))
    streamed.push(...page.records);
  expect(streamed.map((r) => r.value)).toEqual(["spaced"]);
  expect(
    (await client(await user(), "reader").request("/sync/v3/state")).status,
  ).toBe(200);
  const other = client(await user(), "reader");
  await other.remote.getScope!();
  expect(
    (
      await other.remote.pull("new-device", {
        cursor: 0,
        excludeOwnDevice: false,
      })
    ).records,
  ).toEqual([]);
  expect(
    (await SELF.fetch(`${origin}/api/apps/reader/sync/v3/state`)).status,
  ).toBe(401);
  expect(
    (
      await SELF.fetch(`${origin}/api/apps/arctic/sync/v3/state`, {
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(404);
});

it("isolates files with identical IDs and preserves another app's file after deletion", async () => {
  const cookie = await user();
  const reader = client(cookie, "reader"),
    spaced = client(cookie, "spaced");
  const bytes = new TextEncoder().encode("shared file fixture");
  const id = `xxh64:${(await xxhash()).h64Raw(bytes).toString(16).padStart(16, "0")}`;
  for (const app of [reader, spaced]) {
    const response = await app.request(`/files/${id}`, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": "text/html" },
    });
    expect((await response.json()).createdAt).toBeTypeOf("number");
  }
  expect(
    (await reader.request("/files").then((r) => r.json())).files,
  ).toHaveLength(1);
  await reader.request(`/files/${id}`, { method: "DELETE" });
  await expect(reader.request(`/files/${id}`)).rejects.toThrow("404");
  const response = await spaced.request(`/files/${id}`);
  expect(await response.text()).toBe("shared file fixture");
  expect(response.headers.get("Content-Disposition")).toBe("attachment");
  await expect(
    client(await user(), "spaced").request(`/files/${id}`),
  ).rejects.toThrow("404");
});

it("rejects stale epochs and a different account without changing local state", async () => {
  const cookie = await user(),
    reader = client(cookie, "reader");
  const scope = await reader.remote.getScope!();
  reader.store.write({
    ...reader.store.read(),
    pullCursor: 123,
    bootstrapped: true,
  });
  await env.DATABASE.prepare(
    "UPDATE sync_streams SET epoch='replacement' WHERE user_id=? AND namespace='reader'",
  )
    .bind(scope.userId)
    .run();
  await expect(
    reader.remote.push("device", [change("must not write")]),
  ).rejects.toThrow("409");
  await expect(reader.remote.getScope!()).rejects.toThrow("epoch changed");
  expect(reader.store.read().pullCursor).toBe(123);
  expect(
    (
      await env.DATABASE.prepare(
        "SELECT count(*) AS n FROM sync_records WHERE user_id=?",
      )
        .bind(scope.userId)
        .first()
    ).n,
  ).toBe(0);
  const foreign = client(await user(), "reader");
  foreign.store.write(reader.store.read());
  await expect(foreign.remote.getScope!()).rejects.toThrow("account");
});

it("shares the browser session across allowed origins and revokes access on logout", async () => {
  const cookie = await user();
  for (const from of ["http://localhost:5175", "http://localhost:5180"]) {
    const response = await SELF.fetch(`${origin}/api/me`, {
      headers: { Cookie: cookie, Origin: from },
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(from);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBe(
      "true",
    );
  }
  expect(
    (
      await SELF.fetch(`${origin}/api/me`, {
        headers: { Cookie: cookie, Origin: "https://untrusted.example" },
      })
    ).status,
  ).toBe(403);
  const response = await SELF.fetch(`${origin}/api/auth/sign-out`, {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: "http://localhost:5180",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  expect(response.status).toBe(200);
  expect(
    (await SELF.fetch(`${origin}/api/me`, { headers: { Cookie: cookie } }))
      .status,
  ).toBe(401);
});

it("authenticates migrated verified PBKDF2 accounts through the real sign-in route", async () => {
  const id = crypto.randomUUID(),
    email = `${id}@example.test`,
    now = Date.now();
  await env.DATABASE.prepare(
    "INSERT INTO user(id,name,email,email_verified,created_at,updated_at) VALUES(?,?,?,?,?,?)",
  )
    .bind(id, "Migrated fixture", email, 1, now, now)
    .run();
  await env.DATABASE.prepare(
    "INSERT INTO account(id,account_id,provider_id,user_id,password,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      id,
      "credential",
      id,
      "legacy-pbkdf2:Xj+SO0CHAnpDOZyhr2+KAojZiIxA+ns2Oa3M8/uCxACqqWLH6PfCNTuEtuBfyUmt",
      now,
      now,
    )
    .run();
  const login = (password: string) =>
    worker.fetch(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5180",
        },
        body: JSON.stringify({ email, password }),
      }),
      { ...env, LOCAL_DEVELOPMENT: "false" },
    );
  await env.DATABASE.prepare("UPDATE user SET email_verified=0 WHERE id=?")
    .bind(id)
    .run();
  expect((await login("test-user-password")).status).toBe(403);
  await env.DATABASE.prepare("UPDATE user SET email_verified=1 WHERE id=?")
    .bind(id)
    .run();
  expect((await login("wrong-password")).status).toBe(401);
  const response = await login("test-user-password");
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect(
    (await SELF.fetch(`${origin}/api/me`, { headers: { Cookie: cookie } }))
      .status,
  ).toBe(200);
});
