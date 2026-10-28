import { SELF, env } from "cloudflare:test";
import { expect, it } from "vitest";
import {
  createNamespacedHttpClient,
  createSyncClientState,
  syncTablePrefix,
  SyncHttpError,
  type SyncClientState,
} from "@zsh-eng/local-sync";
import xxhash from "xxhash-wasm";
import {
  downloadFiles,
  FILE_BATCH_TYPE,
  readFileBatch,
} from "@workbench/file-batch";
import worker from "../src/index";
import { digest } from "../src/cli-auth";
import {
  migratedAccount,
  MIGRATED_PASSWORD,
  signedIn,
  signUp,
} from "./accounts";
const origin = "http://localhost:8792";
// Requests from the Reader's origin.
const call = (path: string, init: RequestInit) =>
  SELF.fetch(origin + path, init);
const user = () => signedIn(call, "http://localhost:5175");
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
  const cookie = await signUp(call, "http://localhost:5175");
  const reader = client(cookie, "reader"),
    spaced = client(cookie, "spaced"),
    arctic = client(cookie, "arctic");
  const a = await reader.remote.getScope!(),
    b = await spaced.remote.getScope!();
  expect(a.userId).toBe(b.userId);
  expect((await arctic.remote.getScope!()).userId).toBe(a.userId);
  await arctic.remote.push("iphone", [change("arctic")]);
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
  expect(
    (
      await arctic.remote.pull("mac", { cursor: 0, excludeOwnDevice: false })
    ).records.map((r) => r.value),
  ).toEqual(["arctic"]);
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
      await SELF.fetch(`${origin}/api/apps/unknown/sync/v3/state`, {
        headers: { Cookie: cookie },
      })
    ).status,
  ).toBe(404);
});

it("filters a pull by key prefix inside the same session, app and scope checks", async () => {
  const cookie = await signUp(call, "http://localhost:5175");
  const reader = client(cookie, "reader"),
    spaced = client(cookie, "spaced"),
    other = client(await user(), "reader");
  const keyed = (key: string, value: string) => ({ ...change(value), key });
  await reader.remote.push("phone", [
    keyed('["highlights","1"]', "highlight"),
    keyed('["books","1"]', "book"),
    keyed('["booksArchive","1"]', "archive"),
  ]);
  await spaced.remote.push("phone", [keyed('["books","2"]', "spaced book")]);
  await other.remote.push("phone", [keyed('["books","3"]', "other book")]);
  const books = syncTablePrefix("books");
  const read = async (app: ReturnType<typeof client>) => {
    const records = [];
    for await (const page of app.remote.pullPrefixed!(
      "new-device",
      { cursor: 0, excludeOwnDevice: false },
      [books],
      new AbortController().signal,
    ))
      records.push(...page.records);
    return records.map((record) => record.value);
  };
  expect(await read(reader)).toEqual(["book"]);
  expect(await read(spaced)).toEqual(["spaced book"]);
  expect(await read(other)).toEqual(["other book"]);

  const path = `/api/apps/reader/sync/v3/pull-stream?cursor=0&excludeOwnDevice=false&prefix=${encodeURIComponent(books)}`;
  const scope = await reader.remote.getScope!();
  const headers = { Cookie: cookie, "X-Device-ID": "new-device" };
  expect((await SELF.fetch(origin + path)).status).toBe(401);
  expect(
    (
      await SELF.fetch(origin + path, {
        headers: { ...headers, "X-Sync-Scope": JSON.stringify({ ...scope, epoch: "stale" }) },
      })
    ).status,
  ).toBe(409);
  expect(
    (await SELF.fetch(origin + path.replace("/reader/", "/unknown/"), { headers }))
      .status,
  ).toBe(404);
  const refused = await SELF.fetch(`${origin + path}&prefix=%C3%BC`, {
    headers: { ...headers, "X-Sync-Scope": JSON.stringify(scope) },
  });
  expect(refused.status).toBe(400);
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

it("keeps Arctic's article text in arctic-content: HTML without scripts, at most 2 MiB, apart from native Arctic", async () => {
  const cookie = await user();
  const content = client(cookie, "arctic-content"),
    arctic = client(cookie, "arctic");
  const hash = await xxhash();
  const upload = async (
    text: string | Uint8Array,
    type = "text/html; charset=utf-8",
  ) => {
    const bytes =
      typeof text === "string" ? new TextEncoder().encode(text) : text;
    const id = `xxh64:${hash.h64Raw(bytes).toString(16).padStart(16, "0")}`;
    return content
      .request(`/files/${id}`, {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": type },
      })
      .then(
        (response) => ({ status: response.status, id }),
        (error: Error) => ({
          status: Number(/\d{3}/.exec(error.message)?.[0]),
          id,
        }),
      );
  };
  const page =
    "<article><h1>Ice</h1><p>Sea ice keeps its own time.</p></article>";
  const saved = await upload(page);
  expect(saved.status).toBe(200);
  expect(await (await content.request(`/files/${saved.id}`)).text()).toBe(page);
  // The record that names the copy syncs in the same namespace.
  await content.remote.push("web", [
    { ...change(JSON.stringify({ file: saved.id })), key: "content/ice" },
  ]);
  expect(
    (
      await content.remote.pull("mac", { cursor: 0, excludeOwnDevice: false })
    ).records.map((record) => record.key),
  ).toEqual(["content/ice"]);

  expect((await upload(page, "application/octet-stream")).status).toBe(415);
  expect((await upload(`${page}<SCRIPT src="x.js"></SCRIPT>`)).status).toBe(
    415,
  );
  expect(
    (await upload(new Uint8Array(2 * 1024 * 1024 + 1).fill(97))).status,
  ).toBe(413);

  // Native Arctic sees none of it: no files, and no content records.
  await expect(arctic.request("/files")).rejects.toThrow("404");
  expect(
    (await arctic.remote.pull("mac", { cursor: 0, excludeOwnDevice: false }))
      .records,
  ).toEqual([]);
  expect(
    await (
      await SELF.fetch(`${origin}/api/namespaces`, {
        headers: { Cookie: cookie },
      })
    ).json(),
  ).toEqual({
    namespaces: [
      "reader",
      "spaced",
      "arctic",
      "arctic-content",
      "arctic-annotations",
      "arctic-reading",
    ],
  });
});

it("keeps Arctic highlights and reading sessions in their own record namespaces", async () => {
  const cookie = await user();
  for (const namespace of ["arctic-annotations", "arctic-reading"]) {
    const records = client(cookie, namespace);
    await records.remote.push("web", [
      { ...change(JSON.stringify({ seconds: 42 })), key: "session/A" },
    ]);
    expect(
      (
        await records.remote.pull("phone", {
          cursor: 0,
          excludeOwnDevice: false,
        })
      ).records.map((record) => record.key),
    ).toEqual(["session/A"]);
    // Records only, as native Arctic.
    await expect(records.request("/files")).rejects.toThrow("404");
  }
  expect(
    (
      await client(cookie, "arctic").remote.pull("phone", {
        cursor: 0,
        excludeOwnDevice: false,
      })
    ).records,
  ).toEqual([]);
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
  for (const from of [
    "http://localhost:5175",
    "http://localhost:5180",
    "http://localhost:5186",
  ]) {
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
  const { id, email } = await migratedAccount();
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
  expect((await login(MIGRATED_PASSWORD)).status).toBe(403);
  await env.DATABASE.prepare("UPDATE user SET email_verified=1 WHERE id=?")
    .bind(id)
    .run();
  expect((await login("wrong-password")).status).toBe(401);
  const response = await login(MIGRATED_PASSWORD);
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie")!.split(";")[0];
  expect(
    (await SELF.fetch(`${origin}/api/me`, { headers: { Cookie: cookie } }))
      .status,
  ).toBe(200);
});

it("sends many files in one streamed batch: the account's own, within its byte limit, and Reader's one at a time", async () => {
  const cookie = await user();
  const content = client(cookie, "arctic-content"),
    spaced = client(cookie, "spaced"),
    reader = client(cookie, "reader");
  const hash = await xxhash();
  const put = async (
    app: ReturnType<typeof client>,
    bytes: Uint8Array,
    type: string,
  ) => {
    const id = `xxh64:${hash.h64Raw(bytes).toString(16).padStart(16, "0")}`;
    await app.request(`/files/${id}`, {
      method: "PUT",
      body: bytes,
      headers: { "Content-Type": type },
    });
    return id;
  };
  const html = (n: number) =>
    `<article><p>Copy ${n}.</p>${"<p>Sea ice keeps its own time.</p>".repeat(80)}</article>`;
  const texts = new Map<string, string>();
  for (let n = 0; n < 40; n++)
    texts.set(
      await put(content, new TextEncoder().encode(html(n)), "text/html; charset=utf-8"),
      html(n),
    );
  const removed = await put(content, new TextEncoder().encode(html(99)), "text/html");
  await content.request(`/files/${removed}`, { method: "DELETE" });
  const foreign = await put(
    client(await user(), "arctic-content"),
    new TextEncoder().encode(html(98)),
    "text/html",
  );
  // Answers of any status, as the apps pass them on.
  const answer = (error: unknown) =>
    error instanceof SyncHttpError && error.response
      ? error.response
      : Promise.reject(error);
  const transport = (app: ReturnType<typeof client>) => ({
    fetchBatch: (ids: string[], signal: AbortSignal) =>
      app
        .request(
          "/files/batch",
          {
            method: "POST",
            body: JSON.stringify({ ids }),
            headers: {
              "Content-Type": "application/json",
              "Accept-Encoding": "gzip",
            },
            signal,
          },
          false,
        )
        .catch(answer),
    fetchOne: (id: string, signal: AbortSignal) =>
      app.request(`/files/${id}`, { signal }, false).catch(answer),
    backoffMs: 0,
  });
  const kept = new Map<string, { text: string; type: string }>();
  const failed: string[] = [];
  const result = await downloadFiles({
    ids: [...texts.keys(), removed, foreign],
    ...transport(content),
    store: async (id, bytes, type) => {
      kept.set(id, { text: new TextDecoder().decode(bytes), type });
    },
    onFailed: (id) => failed.push(id),
  });
  expect(result).toEqual({ stored: 40, failed: 2 });
  expect(failed.sort()).toEqual([removed, foreign].sort());
  for (const [id, text] of texts)
    expect(kept.get(id)).toEqual({
      text,
      type: "text/html; charset=utf-8",
    });

  // Text arrives compressed; one answer stops at 1 MiB of file bytes.
  const images = [] as string[];
  for (let n = 0; n < 3; n++)
    images.push(
      await put(spaced, new Uint8Array(400 * 1024).fill(n + 1), "image/png"),
    );
  const textBatch = await transport(content).fetchBatch(
    [...texts.keys()].slice(0, 2),
    new AbortController().signal,
  );
  expect(textBatch.headers.get("Content-Encoding")).toBe("gzip");
  const first = await transport(spaced).fetchBatch(
    images,
    new AbortController().signal,
  );
  expect(first.headers.get("Content-Type")).toBe(FILE_BATCH_TYPE);
  const frames = [];
  for await (const item of readFileBatch(first.body!)) frames.push(item);
  expect(frames.map((item) => [item.id, item.status])).toEqual([
    [images[0], 200],
    [images[1], 200],
  ]);
  const sizes = new Map<string, number>();
  expect(
    await downloadFiles({
      ids: images,
      ...transport(spaced),
      store: async (id, bytes) => {
        sizes.set(id, bytes.byteLength);
      },
    }),
  ).toEqual({ stored: 3, failed: 0 });
  expect([...sizes.values()]).toEqual([409600, 409600, 409600]);

  // Reader's books stay one request each: its batch route is absent.
  const books = [
    await put(reader, new TextEncoder().encode("book one"), "application/epub+zip"),
    await put(reader, new TextEncoder().encode("book two"), "application/epub+zip"),
  ];
  const fetched: string[] = [];
  const readerTransport = transport(reader);
  expect(
    await downloadFiles({
      ids: books,
      ...readerTransport,
      fetchOne: (id, signal) => {
        fetched.push(id);
        return readerTransport.fetchOne(id, signal);
      },
      store: async () => {},
    }),
  ).toEqual({ stored: 2, failed: 0 });
  expect(fetched.sort()).toEqual([...books].sort());

  // Requests that are not a batch of file IDs.
  const status = (body: string, type = "application/json") =>
    content
      .request(
        "/files/batch",
        { method: "POST", body, headers: { "Content-Type": type } },
        false,
      )
      .then((r) => r.status, (error: SyncHttpError) => error.status);
  const ids = (n: number) =>
    Array.from({ length: n }, (_, i) => `xxh64:${i.toString(16).padStart(16, "0")}`);
  expect(await status(JSON.stringify({ ids: ids(33) }))).toBe(400);
  expect(await status(JSON.stringify({ ids: ["batch"] }))).toBe(400);
  expect(await status(JSON.stringify({ ids: ids(1) }), "text/plain")).toBe(415);

  // A Workbench Backup credential reads batches as it reads single files.
  const token = `wb_${"1".repeat(64)}`;
  const me = (await (
    await SELF.fetch(`${origin}/api/me`, { headers: { Cookie: cookie } })
  ).json()) as { userId: string };
  await env.DATABASE.prepare(
    "INSERT INTO cli_tokens(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)",
  )
    .bind(await digest(token), me.userId, Date.now(), Date.now() + 60_000)
    .run();
  const cli = (namespace: string) =>
    SELF.fetch(`${origin}/api/apps/${namespace}/files/batch`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ids: images.slice(0, 1) }),
    });
  const read = await cli("spaced");
  expect(read.status).toBe(200);
  await read.body?.cancel();
  expect((await cli("reader")).status).toBe(403);
});
