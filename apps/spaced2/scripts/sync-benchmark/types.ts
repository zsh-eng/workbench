import type { Table } from "dexie";
import type { SyncDexieDatabase } from "@zsh-eng/local-sync/dexie";
import type { StoredOperation } from "../../src/lib/sync/records";

export type BenchmarkDatabase = SyncDexieDatabase & {
  operations: Table<StoredOperation, string>;
  reviewLogOperations: Table<StoredOperation, string>;
};

export interface BenchmarkMetadata {
  records: number;
  head: number;
}

export interface BenchmarkResult {
  mode: string;
  delay: number;
  repeat: number;
  totalMs: number;
  prepareMs: number;
  writeMs: number;
  requests: number;
  writes: number;
  maxWriteMs: number;
  maxPrepareMs: number;
  peakQueueRecords: number;
  peakQueueJsonBytes: number;
  verified: boolean;
}
