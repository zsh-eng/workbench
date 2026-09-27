import { chmod, mkdir, realpath, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { database, type Database } from "./database";
import { catalogue, MAX_NOTE_BYTES, readNote } from "./catalogue";
import { noteLinks, resolver, type NoteLink } from "./metadata";

// Bump when extraction or resolution rules change, so warm caches are rebuilt.
const INDEX_VERSION = "1";

interface StoredFile {
  path: string;
  fingerprint: string;
  error: string | null;
}
interface LinkRow extends NoteLink {
  id: number;
  source: string;
}
export class VaultIndex {
  private constructor(
    readonly root: string,
    private db: Database,
  ) {}
  static async open(root: string, path: string) {
    root = await realpath(root);
    if (!(await stat(root)).isDirectory()) throw new Error("Choose a vault directory.");
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const db = await database(path);
    await chmod(path, 0o600);
    db.exec(`CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS files (path TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, size INTEGER NOT NULL, markdown INTEGER NOT NULL, error TEXT);
      CREATE TABLE IF NOT EXISTS links (id INTEGER PRIMARY KEY, source TEXT NOT NULL REFERENCES files(path) ON DELETE CASCADE,
        destination TEXT NOT NULL, fragment TEXT NOT NULL, line INTEGER NOT NULL, offset INTEGER NOT NULL,
        embed INTEGER NOT NULL, syntax TEXT NOT NULL, target TEXT, reason TEXT);
      CREATE INDEX IF NOT EXISTS backlinks ON links(target,source,line);
      CREATE INDEX IF NOT EXISTS outgoing ON links(source);`);
    const owner = db.prepare("SELECT value FROM metadata WHERE key='root'").get() as
      | { value: string }
      | undefined;
    if (owner && owner.value !== root) {
      db.close();
      throw new Error("This index belongs to a different vault.");
    }
    db.prepare("INSERT OR IGNORE INTO metadata VALUES ('root',?)").run(root);
    return new VaultIndex(root, db);
  }
  static async read(root: string, path: string) {
    const db = await database(path, true);
    return new VaultIndex(root, db);
  }
  close() {
    this.db.close();
  }
  async refresh(trace?: (name: string, start: number, end: number) => void) {
    const start = performance.now();
    const entries = await catalogue(this.root);
    const enumerated = performance.now();
    trace?.("enumerate", start, enumerated);
    const db = this.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const old = new Map(
        (db.prepare("SELECT path,fingerprint,error FROM files").all() as StoredFile[]).map(
          (file) => [file.path, file],
        ),
      );
      const current = new Set(entries.map((file) => file.path));
      const version = db.prepare("SELECT value FROM metadata WHERE key='indexVersion'").get() as
        | { value: string }
        | undefined;
      const rebuild = version?.value !== INDEX_VERSION;
      const removed = [...old.keys()].filter((path) => !current.has(path));
      const topologyChanged =
        rebuild || removed.length > 0 || entries.some((file) => !old.has(file.path));
      const put = db.prepare(`INSERT INTO files VALUES (?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET
        fingerprint=excluded.fingerprint,size=excluded.size,markdown=excluded.markdown,error=excluded.error`);
      const remove = db.prepare("DELETE FROM files WHERE path=?");
      const clear = db.prepare("DELETE FROM links WHERE source=?");
      const insert = db.prepare(
        "INSERT INTO links(source,destination,fragment,line,offset,embed,syntax) VALUES (?,?,?,?,?,?,?)",
      );
      removed.forEach((path) => remove.run(path));
      let parsed = 0,
        bytes = 0,
        failures = 0,
        parseMs = 0,
        readMs = 0;
      const changed: string[] = [];
      for (const file of entries) {
        const previous = old.get(file.path);
        if (!rebuild && previous?.fingerprint === file.fingerprint && !previous.error) continue;
        changed.push(file.path);
        let links: NoteLink[] = [],
          error: string | null = null;
        if (file.markdown) {
          try {
            if (file.size > MAX_NOTE_BYTES) throw new Error("Note exceeds the 4 MiB index limit.");
            const readStart = performance.now();
            const text = readNote(this.root, file);
            readMs += performance.now() - readStart;
            trace?.("read-note", readStart, performance.now());
            const parseStart = performance.now();
            links = noteLinks(text);
            parseMs += performance.now() - parseStart;
            trace?.("parse-links", parseStart, performance.now());
            parsed++;
            bytes += file.size;
          } catch (caught) {
            failures++;
            error = caught instanceof Error ? caught.message : "Could not read note.";
          }
        }
        put.run(file.path, file.fingerprint, file.size, Number(file.markdown), error);
        clear.run(file.path);
        for (const link of links)
          insert.run(
            file.path,
            link.destination,
            link.fragment,
            link.line,
            link.offset,
            Number(link.embed),
            link.syntax,
          );
      }
      const parsedAt = performance.now();
      const resolve = resolver(current);
      const update = db.prepare("UPDATE links SET target=?,reason=? WHERE id=?");
      const query = db.prepare("SELECT * FROM links WHERE source=?");
      const rows = topologyChanged
        ? db.prepare("SELECT * FROM links").all()
        : changed.flatMap((path) => query.all(path));
      for (const row of rows as LinkRow[]) {
        const { target, reason } = resolve(row.source, row);
        update.run(target, reason, row.id);
      }
      db.prepare("INSERT OR REPLACE INTO metadata VALUES ('indexedAt',?)").run(
        new Date().toISOString(),
      );
      db.prepare("INSERT OR REPLACE INTO metadata VALUES ('indexVersion',?)").run(INDEX_VERSION);
      db.exec("COMMIT");
      trace?.("resolve-and-commit", parsedAt, performance.now());
      return {
        ...this.stats(),
        parsed,
        readBytes: bytes,
        changed: changed.length,
        removed: removed.length,
        failures,
        resolvedLinks: rows.length,
        timings: {
          enumerateMs: enumerated - start,
          readMs,
          parseMs,
          updateMs: parsedAt - enumerated,
          resolveAndCommitMs: performance.now() - parsedAt,
          totalMs: performance.now() - start,
        },
      };
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  stats() {
    const counts = this.db
      .prepare(`SELECT (SELECT count(*) FROM files) AS files,
      (SELECT count(*) FROM files WHERE markdown=1) AS notes,
      (SELECT count(*) FROM files WHERE error IS NOT NULL) AS failedNotes,
      (SELECT count(*) FROM links) AS links,
      (SELECT count(*) FROM links WHERE embed=1) AS embeds,
      (SELECT count(*) FROM links WHERE target IS NULL) AS unresolved,
      (SELECT count(*) FROM links WHERE reason='ambiguous') AS ambiguous`)
      .get() as Record<string, number>;
    return counts;
  }
  indexedAt() {
    return (
      this.db.prepare("SELECT value FROM metadata WHERE key='indexedAt'").get() as
        | { value: string }
        | undefined
    )?.value;
  }
  backlinks(path: string) {
    return this.db
      .prepare(
        `SELECT source,line,offset,fragment,embed FROM links WHERE target=? ORDER BY source,line LIMIT 1001`,
      )
      .all(path);
  }
  files() {
    return this.db.prepare("SELECT path,markdown,size FROM files ORDER BY path").all() as {
      path: string;
      markdown: number;
      size: number;
    }[];
  }
  targets(limit = 100) {
    return this.db
      .prepare(
        "SELECT target,count(*) AS count FROM links WHERE target IS NOT NULL GROUP BY target ORDER BY count(*) DESC LIMIT ?",
      )
      .all(limit) as { target: string; count: number }[];
  }
}
