import type { Table } from "dexie";
import {
  compareSyncVersions,
  decodeSyncKey,
  decodeSyncValue,
  type SyncPushChange,
  type SyncRecord,
} from "../protocol.js";
import type { SyncApplyResult, SyncEvent, SyncStorage } from "../storage.js";
import type { SyncDexieDatabase, SyncTableMap } from "./tables.js";

export interface PreparedRemoteRecord {
  source: SyncRecord;
  tableName: string;
  row: Record<string, unknown>;
}

/** Applies incoming data through a raw connection to avoid echoing remote writes. */
export class DexieSyncStorage implements SyncStorage<
  readonly PreparedRemoteRecord[]
> {
  private readonly db: SyncDexieDatabase;
  private readonly tables: SyncTableMap;
  private readonly onEvent: (event: SyncEvent) => void;

  constructor(options: {
    db: SyncDexieDatabase;
    tables: SyncTableMap;
    onEvent?: (event: SyncEvent) => void;
  }) {
    this.db = options.db;
    this.tables = options.tables;
    this.onEvent = options.onEvent ?? (() => {});
  }
  getPendingChanges(): Promise<SyncPushChange[]> {
    return this.db._sync_outbox.toArray();
  }
  prepareRemoteRecords(records: readonly SyncRecord[]): PreparedRemoteRecord[] {
    return prepareRemoteRecords(records, this.tables);
  }
  applyRemoteRecords(
    prepared: readonly PreparedRemoteRecord[],
    localDeviceId: string,
  ) {
    return applyPreparedRemoteRecords(
      this.db,
      prepared,
      localDeviceId,
      this.onEvent,
    );
  }
  reconcilePushResults(
    sent: readonly SyncPushChange[],
    prepared: readonly PreparedRemoteRecord[],
  ) {
    return reconcilePushResults(this.db, sent, prepared, this.onEvent);
  }
}

/** Compare pending local versions and apply eligible remote rows atomically. */
async function applyPreparedRemoteRecords(
  db: SyncDexieDatabase,
  prepared: readonly PreparedRemoteRecord[],
  localDeviceId: string,
  onEvent: (event: SyncEvent) => void,
): Promise<SyncApplyResult> {
  if (prepared.length === 0) {
    return { applied: 0, skipped: 0, keptLocal: [] };
  }

  const tables = getDomainTables(db, prepared);
  let applied = 0;
  const keptLocal: string[] = [];
  const events: SyncEvent[] = [];

  await db.transaction("rw", [db._sync_outbox, ...tables], async () => {
    const localChanges = await db._sync_outbox.bulkGet(
      prepared.map((record) => record.source.key),
    );
    const rowsByTable = new Map<string, Record<string, unknown>[]>();

    prepared.forEach((record, index) => {
      const localChange = localChanges[index];
      if (
        localChange !== undefined &&
        compareSyncVersions(
          { hlc: localChange.hlc, deviceId: localDeviceId },
          record.source,
        ) > 0
      ) {
        keptLocal.push(record.source.key);
        events.push({
          phase: "pull",
          outcome: "kept-local",
          key: record.source.key,
        });
        return;
      }

      const rows = rowsByTable.get(record.tableName) ?? [];
      rows.push(record.row);
      rowsByTable.set(record.tableName, rows);
      applied += 1;
      events.push({
        phase: "pull",
        outcome: "applied",
        key: record.source.key,
      });
    });

    await putRemoteRows(db, rowsByTable);
  });

  events.forEach(onEvent);
  return { applied, skipped: keptLocal.length, keptLocal };
}

/**
 * Reconcile only the exact outbox snapshot sent over the network. A local edit
 * made while the request is in flight has a new HLC and remains untouched.
 */
async function reconcilePushResults(
  db: SyncDexieDatabase,
  sentChanges: readonly SyncPushChange[],
  preparedWinners: readonly PreparedRemoteRecord[],
  onEvent: (event: SyncEvent) => void,
): Promise<number> {
  const tables = getDomainTables(db, preparedWinners);
  let reconciled = 0;
  const events: SyncEvent[] = [];

  await db.transaction("rw", [db._sync_outbox, ...tables], async () => {
    const currentChanges = await db._sync_outbox.bulkGet(
      sentChanges.map((change) => change.key),
    );
    const resolvedKeys: string[] = [];
    const rowsByTable = new Map<string, Record<string, unknown>[]>();

    sentChanges.forEach((sentChange, index) => {
      const currentChange = currentChanges[index];
      if (
        currentChange === undefined ||
        !sameSyncChange(currentChange, sentChange)
      ) {
        events.push({
          phase: "push",
          outcome: "edited-in-flight",
          key: sentChange.key,
        });
        return;
      }

      const winner = preparedWinners[index]!;
      events.push({
        phase: "push",
        outcome: winnerMatchesChange(winner.source, sentChange)
          ? "acknowledged"
          : "replaced",
        key: sentChange.key,
      });
      if (!winnerMatchesChange(winner.source, sentChange)) {
        const rows = rowsByTable.get(winner.tableName) ?? [];
        rows.push(winner.row);
        rowsByTable.set(winner.tableName, rows);
      }
      resolvedKeys.push(sentChange.key);
      reconciled += 1;
    });

    await putRemoteRows(db, rowsByTable);
    await db._sync_outbox.bulkDelete(resolvedKeys);
  });

  events.forEach(onEvent);
  return reconciled;
}

function prepareRemoteRecords(
  records: readonly SyncRecord[],
  tables: SyncTableMap,
): PreparedRemoteRecord[] {
  const seenKeys = new Set<string>();

  return records.map((record) => {
    if (seenKeys.has(record.key)) {
      throw new Error(`Sync response contains duplicate key ${record.key}`);
    }
    seenKeys.add(record.key);

    const [tableName, rowId] = decodeSyncKey(record.key);
    const definition = Object.hasOwn(tables, tableName)
      ? tables[tableName]
      : undefined;
    if (!definition) {
      throw new Error(`Sync response targets unknown table ${tableName}`);
    }
    if (record.schemaVersion !== definition.schemaVersion) {
      throw new Error(
        `Unsupported schema version ${record.schemaVersion} for ${record.key}`,
      );
    }

    const value = (definition.decode ?? decodeSyncValue<unknown>)(record.value);
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Sync value for ${record.key} must be an object`);
    }

    const row = value as Record<string, unknown>;
    if (row.id !== rowId) {
      throw new Error(`Sync value ID does not match key ${record.key}`);
    }
    if (row.isDeleted !== record.isDeleted) {
      throw new Error(`Sync deletion state does not match value ${record.key}`);
    }

    return { source: record, tableName, row };
  });
}

function getDomainTables(
  db: SyncDexieDatabase,
  records: readonly PreparedRemoteRecord[],
): Table[] {
  return [...new Set(records.map((record) => record.tableName))].map(
    (tableName) => db.table(tableName) as Table,
  );
}

async function putRemoteRows(
  db: SyncDexieDatabase,
  rowsByTable: ReadonlyMap<string, readonly Record<string, unknown>[]>,
): Promise<void> {
  for (const [tableName, rows] of rowsByTable) {
    await (
      db.table(tableName) as Table<Record<string, unknown>, string>
    ).bulkPut([...rows]);
  }
}

function sameSyncChange(left: SyncPushChange, right: SyncPushChange): boolean {
  return (
    left.key === right.key &&
    left.value === right.value &&
    left.schemaVersion === right.schemaVersion &&
    left.isDeleted === right.isDeleted &&
    left.hlc.wallTimeMs === right.hlc.wallTimeMs &&
    left.hlc.counter === right.hlc.counter
  );
}

function winnerMatchesChange(
  winner: SyncRecord,
  change: SyncPushChange,
): boolean {
  return sameSyncChange(winner, change);
}
