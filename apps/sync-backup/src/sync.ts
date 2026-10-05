import {
  createNamespacedHttpClient,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import {
  mkdirSync,
  renameSync,
  writeFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join } from "node:path";
import { Store, keyParts, hasObject, objectPath } from "./store";
export function readFetch(origin: string, token: string): typeof fetch {
  return (async (input: any, init?: RequestInit) => {
    const u = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url,
    );
    const method =
      init?.method ?? (input instanceof Request ? input.method : "GET");
    if (
      u.origin !== origin ||
      method !== "GET" ||
      !(
        u.pathname === "/api/me" ||
        u.pathname === "/api/namespaces" ||
        /^\/api\/apps\/(reader|spaced)\/(sync\/v3\/(state|pull|pull-stream)|files(?:\/xxh64:[a-f0-9]{16})?\/?|me)$/.test(
          decodeURIComponent(u.pathname),
        )
      )
    )
      throw Error("Read-only transport refused request");
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${token}`);
    headers.set("User-Agent", "WorkbenchBackup/1");
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(u, {
        ...init,
        method: "GET",
        headers,
        redirect: "error",
        signal: init?.signal ?? AbortSignal.timeout(30000),
      });
      if (attempt < 3 && (r.status === 429 || r.status >= 500)) {
        await r.body?.cancel();
        await Bun.sleep(Math.min(30000, 1000 * 2 ** attempt));
        continue;
      }
      if (r.status === 401)
        throw Error("Session expired or revoked. Run wb auth login.");
      return r;
    }
  }) as typeof fetch;
}
export async function identity(send: typeof fetch, origin: string) {
  const r = await send(origin + "/api/me");
  if (!r.ok) throw Error(`Identity request failed (${r.status})`);
  return (await r.json()) as {
    userId: string;
    user: { email: string };
    expiresAt: string;
  };
}
export async function namespaces(send: typeof fetch, origin: string) {
  const r = await send(origin + "/api/namespaces");
  if (!r.ok) throw Error(`Namespace discovery failed (${r.status})`);
  const b = (await r.json()) as any;
  if (
    !Array.isArray(b.namespaces) ||
    b.namespaces.some((n: any) => !["reader", "spaced"].includes(n))
  )
    throw Error("Unsupported namespace registry");
  return b.namespaces as string[];
}
export async function pull(
  store: Store,
  origin: string,
  token: string,
  namespace: string,
  tables: string[] = [],
  batchSize = 5000,
) {
  const started = performance.now(),
    selection = tables.length
      ? JSON.stringify([...new Set(tables)].sort())
      : "*";
  const stateStore = store.state(namespace, selection);
  const send = readFetch(origin, token);
  const transport = createNamespacedHttpClient({
    origin,
    namespace,
    stateStore,
    fetch: send,
  });
  const scope = await transport.remote.getScope!();
  store.bindScope(scope);
  let cursor = stateStore.read()!.pullCursor,
    head: number | undefined,
    done = false,
    buffer: SyncRecord[] = [],
    bytes = 0,
    scanned = 0,
    saved = 0,
    sqliteMs = 0,
    requests = 0;
  const flush = () => {
    const start = performance.now();
    store.apply(namespace, buffer, stateStore, cursor);
    sqliteMs += performance.now() - start;
    saved += buffer.length;
    buffer = [];
    bytes = 0;
  };
  while (!done) {
    requests++;
    let sawPage = false;
    for await (const page of transport.remote.pullStream!(
      stateStore.read()!.deviceId,
      {
        cursor,
        ...(head === undefined ? {} : { head }),
        limit: 500,
        excludeOwnDevice: false,
      },
      AbortSignal.timeout(120000),
    )) {
      if (
        done ||
        page.cursor < cursor ||
        (page.hasMore && page.cursor === cursor) ||
        (head !== undefined && page.head !== head) ||
        page.records.some((r) => r.serverSeq <= cursor)
      )
        throw Error("Invalid pull cursor or head");
      sawPage = true;
      head = page.head;
      cursor = page.cursor;
      scanned += page.records.length;
      for (const r of page.records) {
        if (!tables.length || tables.includes(keyParts(r.key)[0] ?? "")) {
          buffer.push(r);
          bytes += r.value.length + r.key.length;
        }
      }
      if (buffer.length >= batchSize || bytes >= 8 * 1024 * 1024) flush();
      done = !page.hasMore;
    }
    if (!sawPage) throw Error("Empty sync stream");
    // Only mark completion after the stream's validated end marker.
    flush();
  }
  store.finish(namespace, selection, stateStore);
  return {
    namespace,
    selection,
    scanned,
    saved,
    cursor,
    requests,
    sqliteMs: Math.round(sqliteMs * 100) / 100,
    recordsMs: Math.round((performance.now() - started) * 100) / 100,
  };
}
export async function syncFiles(
  store: Store,
  origin: string,
  token: string,
  namespace: string,
) {
  const start = performance.now(),
    send = readFetch(origin, token),
    state = store.state(namespace, "*");
  const { request, remote } = createNamespacedHttpClient({
    origin,
    namespace,
    stateStore: state,
    fetch: send,
  });
  await remote.getScope!();
  const list = async () => {
    const r = await request("/files");
    const b = (await r.json()) as any;
    if (!Array.isArray(b.files)) throw Error("Invalid file catalog");
    for (const f of b.files)
      if (
        !/^xxh64:[a-f0-9]{16}$/.test(f.id) ||
        !Number.isSafeInteger(f.fileSize) ||
        f.fileSize < 0 ||
        f.fileSize > 100 * 1024 * 1024 ||
        typeof f.mediaType !== "string" ||
        !Number.isSafeInteger(f.createdAt)
      )
        throw Error("Invalid file metadata");
    return b.files as {
      id: string;
      fileSize: number;
      mediaType: string;
      createdAt: number;
    }[];
  };
  const files = await list();
  store.db.query("DELETE FROM file_scans WHERE namespace=?").run(namespace);
  store.db
    .transaction(() => {
      store.db
        .query("UPDATE files SET active=0 WHERE namespace=?")
        .run(namespace);
      const stmt = store.db.query(
        "INSERT INTO files(namespace,id,size,media_type,created_at,active) VALUES(?,?,?,?,?,1) ON CONFLICT(namespace,id) DO UPDATE SET active=1,size=excluded.size,media_type=excluded.media_type",
      );
      for (const f of files)
        stmt.run(namespace, f.id, f.fileSize, f.mediaType, f.createdAt);
    })
    .immediate();
  mkdirSync(join(store.directory, "objects"), { recursive: true, mode: 0o700 });
  let downloaded = 0,
    downloadBytes = 0,
    index = 0;
  const errors: string[] = [];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (index < files.length) {
        const f = files[index++];
        try {
          const prior = store.db
            .query<{ sha256: string | null }, [string, string]>(
              "SELECT sha256 FROM files WHERE namespace=? AND id=?",
            )
            .get(namespace, f.id)!;
          if (hasObject(store.directory, prior.sha256)) continue;
          const r = await request(
            "/files/" + encodeURIComponent(f.id),
            {},
            false,
          );
          const bytes = new Uint8Array(await r.arrayBuffer());
          if (
            bytes.length !== f.fileSize ||
            `xxh64:${Bun.hash.xxHash64(bytes).toString(16).padStart(16, "0")}` !==
              f.id
          )
            throw Error("Content hash or size mismatch");
          const hash = new Bun.CryptoHasher("sha256")
            .update(bytes)
            .digest("hex");
          const path = objectPath(store.directory, hash),
            temp = path + "." + crypto.randomUUID() + ".tmp";
          writeFileSync(temp, bytes, { mode: 0o600 });
          const fd = openSync(temp, "r");
          try {
            fsyncSync(fd);
          } finally {
            closeSync(fd);
          }
          renameSync(temp, path);
          const directoryFd = openSync(join(store.directory, "objects"), "r");
          try {
            fsyncSync(directoryFd);
          } finally {
            closeSync(directoryFd);
          }
          store.db
            .query(
              "UPDATE files SET sha256=?,verified_at=? WHERE namespace=? AND id=?",
            )
            .run(hash, new Date().toISOString(), namespace, f.id);
          downloaded++;
          downloadBytes += bytes.length;
        } catch (e) {
          errors.push(
            `${namespace}/${f.id}: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    }),
  );
  const after = await list();
  const fingerprint = (items: typeof files) =>
    JSON.stringify(items.map((f) => [f.id, f.fileSize, f.mediaType]).sort());
  const stable = fingerprint(files) === fingerprint(after);
  if (!stable)
    errors.push("File catalog changed during download; run sync again");
  if (!errors.length)
    store.db
      .query(
        "INSERT INTO file_scans VALUES(?,?) ON CONFLICT(namespace) DO UPDATE SET last_success=excluded.last_success",
      )
      .run(namespace, new Date().toISOString());
  return {
    namespace,
    catalogued: files.length,
    downloaded,
    downloadBytes,
    stable,
    errors,
    filesMs: Math.round((performance.now() - start) * 100) / 100,
  };
}
