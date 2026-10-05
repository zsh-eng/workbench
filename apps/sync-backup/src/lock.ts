import { Database } from "bun:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";

/** A separate SQLite file holds the process lease; the OS releases it after a crash. */
export function writerLock(directory: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, "writer.sqlite");
  const db = new Database(path, { create: true });
  chmodSync(path, 0o600);
  try {
    db.exec("PRAGMA busy_timeout=0; BEGIN IMMEDIATE");
  } catch {
    db.close();
    throw Error("Another wb writer is running");
  }
  return () => {
    db.exec("ROLLBACK");
    db.close();
  };
}
