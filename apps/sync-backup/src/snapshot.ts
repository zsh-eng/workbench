import { Database } from "bun:sqlite";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  copyFileSync,
  readdirSync,
  renameSync,
  existsSync,
  statSync,
  constants,
  openSync,
  fsyncSync,
  closeSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { Store, objectPath } from "./store";
const durable = (path: string) => {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
};
const sha = (path: string) =>
  new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");
export function completeness(store: Store) {
  const missing: string[] = [];
  for (const f of store.db
    .query<{ namespace: string; id: string; sha256: string | null }, []>(
      "SELECT namespace,id,sha256 FROM files WHERE active=1",
    )
    .all())
    if (!f.sha256 || !existsSync(objectPath(store.directory, f.sha256)))
      missing.push(`${f.namespace}/${f.id}`);
  let unsupportedKeys = 0,
    externalReferences = 0;
  const refs = new Set<string>();
  for (const r of store.db
    .query<
      {
        namespace: string;
        key: string;
        value: string;
        table_name: string | null;
      },
      []
    >("SELECT namespace,key,value,table_name FROM records WHERE is_deleted=0")
    .iterate()) {
    if (!r.table_name) unsupportedKeys++;
    for (const match of r.value.matchAll(/xxh64(?::|%3[aA])([a-f0-9]{16})/g))
      refs.add(`${r.namespace}/xxh64:${match[1]}`);
    // External URLs are reported, not fetched. This is a conservative scan, not a domain decoder.
    if (/https?:\/\//.test(r.value)) externalReferences++;
  }
  for (const ref of refs) {
    const [namespace, id] = ref.split("/");
    const file = store.db
      .query<{ sha256: string | null }, [string, string]>(
        "SELECT sha256 FROM files WHERE namespace=? AND id=?",
      )
      .get(namespace, id);
    if (!file?.sha256 || !existsSync(objectPath(store.directory, file.sha256)))
      missing.push(ref);
  }
  const coverage = store.db
    .query<{ namespace: string }, []>(
      "SELECT namespace FROM cursors WHERE selection='*' AND json_extract(state,'$.bootstrapped')=1",
    )
    .all()
    .map((r) => r.namespace);
  const fileCoverage = store.db
    .query<{ namespace: string }, []>("SELECT namespace FROM file_scans")
    .all()
    .map((r) => r.namespace);
  return {
    missingFiles: [...new Set(missing)],
    recordNamespaces: coverage,
    fileNamespaces: fileCoverage,
    unsupportedKeys,
    recordsContainingURLs: externalReferences,
    referenceScan:
      "xxh64 IDs only; external URLs and unsynced device data are not captured",
    complete:
      ["reader", "spaced"].every(
        (n) => coverage.includes(n) && fileCoverage.includes(n),
      ) &&
      !missing.length &&
      !unsupportedKeys,
  };
}
export function snapshot(store: Store, destination?: string) {
  const id =
    new Date().toISOString().replaceAll(":", "-") +
    "-" +
    crypto.randomUUID().slice(0, 8);
  const parent = join(store.directory, "snapshots");
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  const target = destination ?? join(parent, id),
    temporary = target + ".partial";
  if (existsSync(target) || existsSync(temporary))
    throw Error("Snapshot destination already exists");
  mkdirSync(temporary, { recursive: true, mode: 0o700 });
  mkdirSync(join(temporary, "objects"), { mode: 0o700 });
  const dbPath = join(temporary, "records.sqlite");
  store.db.query("VACUUM INTO ?").run(dbPath);
  const files = store.db
    .query<{ namespace: string; id: string; size: number; sha256: string }, []>(
      "SELECT namespace,id,size,sha256 FROM files WHERE sha256 IS NOT NULL",
    )
    .all();
  for (const f of files) {
    const source = objectPath(store.directory, f.sha256),
      dest = objectPath(temporary, f.sha256);
    if (existsSync(source) && !existsSync(dest))
      copyFileSync(source, dest, constants.COPYFILE_FICLONE);
  }
  const manifest = {
    format: 1,
    id,
    createdAt: new Date().toISOString(),
    databaseSha256: sha(dbPath),
    summary: store.summary(),
    coverage: completeness(store),
    files,
    consistency:
      "Observed local state; not an atomic server snapshot or complete edit history",
  };
  writeFileSync(
    join(temporary, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { mode: 0o600 },
  );
  verifySnapshot(temporary);
  for (const hash of new Set(files.map((f) => f.sha256)))
    durable(objectPath(temporary, hash));
  durable(dbPath);
  durable(join(temporary, "manifest.json"));
  durable(join(temporary, "objects"));
  durable(temporary);
  renameSync(temporary, target);
  durable(resolve(target, ".."));
  return { path: target, ...manifest };
}
export function verifySnapshot(directory: string) {
  const m = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  if (
    m.format !== 1 ||
    sha(join(directory, "records.sqlite")) !== m.databaseSha256
  )
    throw Error("Snapshot database checksum failed");
  const db = new Database(join(directory, "records.sqlite"), {
    readonly: true,
  });
  try {
    if (
      (db.query("PRAGMA integrity_check").get() as any).integrity_check !== "ok"
    )
      throw Error("SQLite integrity check failed");
    const expected = db
      .query(
        "SELECT namespace,id,size,sha256 FROM files WHERE sha256 IS NOT NULL ORDER BY namespace,id",
      )
      .all();
    const sort = (fs: any[]) =>
      JSON.stringify(
        fs
          .map((f) => ({
            namespace: f.namespace,
            id: f.id,
            size: f.size,
            sha256: f.sha256,
          }))
          .sort((a, b) =>
            (a.namespace + "/" + a.id).localeCompare(b.namespace + "/" + b.id),
          ),
      );
    if (sort(expected) !== sort(m.files))
      throw Error("File manifest differs from database");
  } finally {
    db.close();
  }
  for (const f of m.files) {
    const path = objectPath(directory, f.sha256);
    if (
      statSync(path).size !== f.size ||
      sha(path) !== f.sha256 ||
      `xxh64:${Bun.hash.xxHash64(readFileSync(path)).toString(16).padStart(16, "0")}` !==
        f.id
    )
      throw Error(`File verification failed: ${f.namespace}/${f.id}`);
  }
  return {
    ok: true,
    path: directory,
    files: m.files.length,
    coverage: m.coverage,
  };
}
export function listSnapshots(directory: string) {
  const path = join(directory, "snapshots");
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((n) => !n.endsWith(".partial"))
    .map((n) => {
      const m = JSON.parse(
        readFileSync(join(path, n, "manifest.json"), "utf8"),
      );
      return {
        id: n,
        createdAt: m.createdAt,
        complete: m.coverage.complete,
        path: join(path, n),
      };
    });
}
