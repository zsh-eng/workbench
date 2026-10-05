import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  type SyncRecord,
  type SyncScope,
  createSyncClientState,
  type SyncClientState,
  type SyncClientStateStore,
} from "@zsh-eng/local-sync";

export class Store {
  db: Database;
  directory: string;
  path: string;
  constructor(directory: string) {
    this.directory = resolve(directory);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.path = join(this.directory, "mirror.sqlite");
    this.db = new Database(this.path, { create: true, strict: true });
    chmodSync(this.path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS scopes(namespace TEXT PRIMARY KEY,origin TEXT NOT NULL,user_id TEXT NOT NULL,epoch TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS cursors(namespace TEXT NOT NULL,selection TEXT NOT NULL,state TEXT NOT NULL,last_success TEXT,PRIMARY KEY(namespace,selection));
      CREATE TABLE IF NOT EXISTS records(namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,schema_version INTEGER NOT NULL,wall_time INTEGER NOT NULL,counter INTEGER NOT NULL,device_id TEXT NOT NULL,server_seq INTEGER NOT NULL,is_deleted INTEGER NOT NULL,table_name TEXT,record_id TEXT,PRIMARY KEY(namespace,key));
      CREATE INDEX IF NOT EXISTS records_table ON records(namespace,table_name,is_deleted);
      CREATE TABLE IF NOT EXISTS files(namespace TEXT NOT NULL,id TEXT NOT NULL,size INTEGER NOT NULL,media_type TEXT NOT NULL,created_at INTEGER NOT NULL,active INTEGER NOT NULL,sha256 TEXT,verified_at TEXT,PRIMARY KEY(namespace,id));
      CREATE TABLE IF NOT EXISTS file_scans(namespace TEXT PRIMARY KEY,last_success TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY,started_at TEXT NOT NULL,result TEXT NOT NULL);
      CREATE VIEW IF NOT EXISTS live_records AS SELECT * FROM records WHERE is_deleted=0;
      CREATE VIEW IF NOT EXISTS table_counts AS SELECT namespace,table_name,count(*) AS records,sum(is_deleted) AS tombstones FROM records GROUP BY namespace,table_name;
      CREATE VIEW IF NOT EXISTS reader_books AS SELECT record_id,value,json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.title') AS title FROM live_records WHERE namespace='reader' AND table_name='books';
      CREATE VIEW IF NOT EXISTS spaced_operations AS SELECT record_id,value,json_extract(CASE WHEN json_valid(value) THEN value ELSE '{}' END,'$.type') AS operation_type FROM live_records WHERE namespace='spaced';`);
  }
  bindIdentity(origin: string, userId: string) {
    const value = JSON.stringify({ origin, userId });
    const prior = this.db
      .query<{ value: string }, []>(
        "SELECT value FROM metadata WHERE key='identity'",
      )
      .get();
    if (prior && prior.value !== value)
      throw Error(
        "Account or server changed. Use a new --data-dir; the existing mirror is preserved.",
      );
    this.db
      .query("INSERT OR IGNORE INTO metadata VALUES('identity',?)")
      .run(value);
  }
  state(namespace: string, selection: string): SyncClientStateStore {
    const get = this.db.query<{ state: string }, [string, string]>(
      "SELECT state FROM cursors WHERE namespace=? AND selection=?",
    );
    const set = this.db.query(
      "INSERT INTO cursors(namespace,selection,state) VALUES(?,?,?) ON CONFLICT(namespace,selection) DO UPDATE SET state=excluded.state",
    );
    if (!get.get(namespace, selection))
      set.run(
        namespace,
        selection,
        JSON.stringify(
          createSyncClientState(
            `wb_${crypto.randomUUID().replaceAll("-", "")}`,
          ),
        ),
      );
    return {
      read: () => JSON.parse(get.get(namespace, selection)!.state),
      write: (s: SyncClientState) => {
        if (s.scope) this.bindScope(s.scope);
        set.run(namespace, selection, JSON.stringify(s));
      },
    };
  }
  bindScope(s: SyncScope) {
    this.bindIdentity(s.origin, s.userId);
    const prior = this.db
      .query<{ epoch: string }, [string]>(
        "SELECT epoch FROM scopes WHERE namespace=?",
      )
      .get(s.namespace);
    if (prior && prior.epoch !== s.epoch)
      throw Error(
        "Stream epoch changed. Use a new --data-dir; the existing mirror is preserved.",
      );
    this.db
      .query("INSERT OR IGNORE INTO scopes VALUES(?,?,?,?)")
      .run(s.namespace, s.origin, s.userId, s.epoch);
  }
  apply(
    namespace: string,
    records: SyncRecord[],
    stateStore: SyncClientStateStore,
    cursor: number,
  ) {
    const insert = this.db.query(
      `INSERT INTO records VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value,schema_version=excluded.schema_version,wall_time=excluded.wall_time,counter=excluded.counter,device_id=excluded.device_id,server_seq=excluded.server_seq,is_deleted=excluded.is_deleted,table_name=excluded.table_name,record_id=excluded.record_id WHERE excluded.server_seq>records.server_seq`,
    );
    this.db
      .transaction(() => {
        for (const r of records) {
          const [table, id] = keyParts(r.key);
          insert.run(
            namespace,
            r.key,
            r.value,
            r.schemaVersion,
            r.hlc.wallTimeMs,
            r.hlc.counter,
            r.deviceId,
            r.serverSeq,
            Number(r.isDeleted),
            table,
            id,
          );
        }
        stateStore.write({ ...stateStore.read()!, pullCursor: cursor });
      })
      .immediate();
  }
  finish(
    namespace: string,
    selection: string,
    stateStore: SyncClientStateStore,
  ) {
    this.db
      .transaction(() => {
        stateStore.write({ ...stateStore.read()!, bootstrapped: true });
        this.db
          .query(
            "UPDATE cursors SET last_success=? WHERE namespace=? AND selection=?",
          )
          .run(new Date().toISOString(), namespace, selection);
      })
      .immediate();
  }
  summary() {
    return {
      identity: this.db
        .query("SELECT value FROM metadata WHERE key='identity'")
        .get(),
      scopes: this.db.query("SELECT * FROM scopes").all(),
      tables: this.db
        .query("SELECT * FROM table_counts ORDER BY namespace,table_name")
        .all(),
      cursors: this.db
        .query(
          "SELECT namespace,selection,json_extract(state,'$.pullCursor') AS cursor,json_extract(state,'$.bootstrapped') AS complete,last_success FROM cursors",
        )
        .all(),
      files: this.db
        .query(
          "SELECT namespace,count(*) AS catalogued,sum(sha256 IS NOT NULL) AS downloaded FROM files WHERE active=1 GROUP BY namespace",
        )
        .all(),
      fileScans: this.db.query("SELECT * FROM file_scans").all(),
    };
  }
  close() {
    this.db.close();
  }
}
export function keyParts(key: string): [string | null, string | null] {
  try {
    const x = JSON.parse(key);
    return Array.isArray(x) &&
      x.length === 2 &&
      x.every((v) => typeof v === "string")
      ? [x[0], x[1]]
      : [null, null];
  } catch {
    return [null, null];
  }
}
export function objectPath(directory: string, hash: string) {
  if (!/^[a-f0-9]{64}$/.test(hash)) throw Error("Invalid object hash");
  return join(directory, "objects", hash);
}
export function hasObject(directory: string, hash: string | null) {
  return !!hash && existsSync(objectPath(directory, hash));
}
