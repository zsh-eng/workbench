import type Dexie from "dexie";
import type { StoredOperation } from "../../src/lib/sync/records";

/** Benchmark candidates only; no application schema or adapter changes. */
export const candidates = [
  { name: "baseline" },
  { name: "no-secondary-indexes", noIndexes: true },
  { name: "json-rows", packed: true },
  { name: "single-page-processing", lean: true },
  { name: "yield-every-4-pages", yieldPages: 4 },
  { name: "queue-2-pages", queuePages: 2 },
] as const;
export const combinations = [
  { name: "baseline" },
  { name: "no-indexes+single-pass", noIndexes: true, lean: true },
  {
    name: "no-indexes+single-pass+yield4",
    noIndexes: true,
    lean: true,
    yieldPages: 4,
  },
] as const;
export interface Candidate {
  name: string;
  size: number;
  fast: boolean;
  noIndexes?: boolean;
  packed?: boolean;
  lean?: boolean;
  yieldPages?: number;
  queuePages?: number;
}
export function packRow(row: StoredOperation) {
  return {
    id: row.id,
    type: row.type,
    timestamp: row.timestamp,
    value: JSON.stringify(row),
  };
}
export function installPackedRows(db: Dexie) {
  const original = db.Table.prototype.bulkPut;
  db.Table.prototype.bulkPut = function (
    this: Dexie["Table"]["prototype"],
    rows: readonly StoredOperation[],
    ...rest: Parameters<typeof original> extends [unknown, ...infer Rest]
      ? Rest
      : never
  ) {
    return original.call(this, rows.map(packRow), ...rest);
  } as typeof original;
}
export const frameSizes = new WeakMap<object, number>();
export function tagFrame<T extends object>(page: T, bytes: number): T {
  frameSizes.set(page, bytes);
  return page;
}
export function frameSize(page: object): number {
  const bytes = frameSizes.get(page);
  if (bytes === undefined) throw Error("Missing parser frame byte count");
  return bytes;
}
