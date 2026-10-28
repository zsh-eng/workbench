import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import type { SyncD1Database, SyncD1Statement } from "@zsh-eng/local-sync/hono";

/**
 * The package's actual SQL against SQLite. Reader also tests the adapter in
 * Cloudflare's D1 runtime with its production migrations and authentication.
 * `statements` keeps each query with its values, for query plans.
 */
export function sqliteD1(sqlite: DatabaseSync) {
  const statements: { sql: string; values: SQLInputValue[] }[] = [];
  class Statement implements SyncD1Statement {
    private values: SQLInputValue[] = [];
    constructor(private readonly sql: string) {}
    bind(...values: unknown[]) {
      this.values = values as SQLInputValue[];
      statements.push({ sql: this.sql, values: this.values });
      return this;
    }
    async first<T>(): Promise<T | null> {
      return (
        (sqlite.prepare(this.sql).get(...this.values) as T | undefined) ?? null
      );
    }
    async all<T>(): Promise<{ results: T[] }> {
      return { results: sqlite.prepare(this.sql).all(...this.values) as T[] };
    }
  }
  const database: SyncD1Database = {
    prepare: (sql) => new Statement(sql),
    async batch<T>(batch: SyncD1Statement[]) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of batch) results.push(await statement.all<T>());
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { database, statements };
}
