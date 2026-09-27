/** Both runtimes expose synchronous SQLite. Index commands run outside the UI host. */
export interface Statement {
  run(...values: (string | number | null)[]): unknown;
  get(...values: (string | number | null)[]): unknown;
  all(...values: (string | number | null)[]): unknown[];
}
export interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}
export async function database(path: string): Promise<Database> {
  const moduleName = process.versions.bun ? "bun:sqlite" : "node:sqlite";
  const driver = await import(/* @vite-ignore */ moduleName);
  const db: Database = process.versions.bun
    ? new driver.Database(path)
    : new driver.DatabaseSync(path);
  db.exec("PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;");
  return db;
}
