import type Dexie from "dexie";
import type { Table } from "dexie";
import type { StoredOperation } from "../../src/lib/sync/records";

export type RawRecord = { key: string; value: string };
export type PreparedRecord = { table: string; row: StoredOperation; json: string };
export type SavedRecord = Pick<PreparedRecord, "table" | "row">;
export type SqlRow = { id: string; type: string; timestamp: number; value: string; key: string };
export type SqlValue = string | number | bigint | Uint8Array | null;
export interface SqlStatement {
  bind(values: (SqlValue | undefined)[]): void;
  step(): boolean;
  reset(): void;
  finalize(): void;
}
export interface SqlDatabase {
  exec(sql: string): unknown;
  exec(sql: string, options: { rowMode: "object"; returnValue: "resultRows" }): SqlRow[];
  selectValue(sql: string): SqlValue;
  prepare(sql: string): SqlStatement;
  close(): void;
}
export interface SqlPool {
  OpfsSAHPoolDb: new (path: string) => SqlDatabase;
  removeVfs(): Promise<boolean>;
}
export type OutboxRecord = {
  key: string; value: string; isDeleted: boolean; schemaVersion: number;
  hlc: { wallTimeMs: number; counter: number };
};
export type BenchmarkDexie = Dexie & {
  operations: Table<StoredOperation>;
  _sync_outbox: Table<OutboxRecord>;
};
export type Fixture = {
  records: RawRecord[];
  expected: Record<string, { count: number; hash: string }>;
};
export type BrowserSample = {
  verified: boolean; cleaned: boolean; engine: string; scope: string;
  writeMs: number; hostLoad?: number[];
};
