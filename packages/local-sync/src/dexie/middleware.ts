/**
 * Dexie middleware that atomically mirrors local domain writes into one
 * compacted outbox row per logical key.
 */

import {
  checkSyncValueSize,
  encodeSyncKey,
  type SyncHlc,
  type SyncPushChange,
} from "../protocol.js";
import type {
  DBCore,
  DBCoreDeleteRangeRequest,
  DBCoreDeleteRequest,
  DBCoreMutateResponse,
  DBCoreTable,
  Dexie,
} from "dexie";

import {
  SYNC_OUTBOX_TABLE,
  type SyncTableMap,
  type SyncTableDefinition,
} from "./tables.js";

export interface SyncV2MutationMiddlewareOptions {
  tables: SyncTableMap;
  nextHlcBatch: (count: number) => readonly SyncHlc[];
}

export function installSync(
  db: Dexie,
  tables: SyncTableMap,
  nextHlcBatch: (count: number) => readonly SyncHlc[],
): void {
  db.use(
    createSyncV2MutationMiddleware({
      tables,
      nextHlcBatch,
    }),
  );
}

export function createSyncV2MutationMiddleware(
  options: SyncV2MutationMiddlewareOptions,
) {
  const nextHlc = options.nextHlcBatch;
  const syncedTables = new Set(Object.keys(options.tables));

  return {
    stack: "dbcore" as const,
    name: "SyncV2MutationMiddleware",
    create(core: DBCore): DBCore {
      return {
        ...core,

        transaction(stores, mode, transactionOptions) {
          const needsOutbox =
            mode === "readwrite" &&
            stores.some((tableName) => syncedTables.has(tableName));
          const transactionStores =
            needsOutbox && !stores.includes(SYNC_OUTBOX_TABLE)
              ? [...stores, SYNC_OUTBOX_TABLE]
              : stores;

          return core.transaction(transactionStores, mode, transactionOptions);
        },

        table(tableName: string): DBCoreTable {
          const table = core.table(tableName);
          if (!syncedTables.has(tableName)) {
            return table;
          }

          const outbox = core.table(SYNC_OUTBOX_TABLE);
          return {
            ...table,
            async mutate(request) {
              if (request.type === "add" || request.type === "put") {
                const values = request.values.map(withDeletionState);
                const changes = createOutboxChanges(
                  table,
                  tableName,
                  options.tables[tableName]!,
                  values,
                  request.keys,
                  nextHlc(values.length),
                );
                const result = await table.mutate({ ...request, values });
                await writeSuccessfulChanges(
                  outbox,
                  request.trans,
                  changes,
                  result,
                );
                return result;
              }

              const existingValues = await readDeletedValues(table, request);
              if (existingValues.length === 0) {
                return emptyMutationResponse();
              }

              const tombstones = existingValues.map((value) => ({
                ...value,
                isDeleted: true,
              }));
              const changes = createOutboxChanges(
                table,
                tableName,
                options.tables[tableName]!,
                tombstones,
                undefined,
                nextHlc(tombstones.length),
              );
              const result = await table.mutate({
                type: "put",
                trans: request.trans,
                values: tombstones,
              });
              throwFirstMutationFailure(result);
              await writeSuccessfulChanges(
                outbox,
                request.trans,
                changes,
                result,
              );
              return emptyMutationResponse();
            },
          };
        },
      };
    },
  };
}

function withDeletionState(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Synced Dexie values must be objects");
  }

  const record = value as Record<string, unknown>;
  return {
    ...record,
    isDeleted: record.isDeleted === true,
  };
}

function createOutboxChanges(
  table: DBCoreTable,
  tableName: string,
  definition: SyncTableDefinition,
  values: readonly Record<string, unknown>[],
  requestKeys: readonly unknown[] | undefined,
  timestamps: readonly SyncHlc[],
): SyncPushChange[] {
  if (timestamps.length !== values.length) {
    throw new Error("HLC batch length must match the mutation batch length");
  }

  return values.map((value, index) => {
    const primaryKey =
      table.schema.primaryKey.extractKey?.(value) ?? requestKeys?.[index];
    if (typeof primaryKey !== "string" || primaryKey.length === 0) {
      throw new Error(`Synced table "${tableName}" requires a string key`);
    }

    // A value one record cannot hold fails the write, so nothing is stored
    // that could never sync. The error is typed, with the record's key.
    const key = encodeSyncKey(tableName, primaryKey);
    return {
      key,
      value: checkSyncValueSize(
        definition.encode ? definition.encode(value) : JSON.stringify(value),
        key,
      ),
      schemaVersion: definition.schemaVersion,
      hlc: timestamps[index]!,
      isDeleted: value.isDeleted === true,
    };
  });
}

async function writeSuccessfulChanges(
  outbox: DBCoreTable,
  transaction: Parameters<DBCoreTable["mutate"]>[0]["trans"],
  changes: readonly SyncPushChange[],
  domainResult: DBCoreMutateResponse,
): Promise<void> {
  const successfulChanges = changes.filter(
    (_, index) => !(index in domainResult.failures),
  );
  if (successfulChanges.length === 0) {
    return;
  }

  const outboxResult = await outbox.mutate({
    type: "put",
    trans: transaction,
    values: successfulChanges,
  });
  throwFirstMutationFailure(outboxResult);
}

async function readDeletedValues(
  table: DBCoreTable,
  request: DBCoreDeleteRequest | DBCoreDeleteRangeRequest,
): Promise<Record<string, unknown>[]> {
  if (request.type === "delete") {
    const values = await table.getMany({
      trans: request.trans,
      keys: request.keys,
    });
    return values.filter(isDomainRecord);
  }

  const response = await table.query({
    trans: request.trans,
    values: true,
    query: {
      index: table.schema.primaryKey,
      range: request.range,
    },
  });
  return response.result.filter(isDomainRecord);
}

function isDomainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function throwFirstMutationFailure(result: DBCoreMutateResponse): void {
  if (result.numFailures === 0) {
    return;
  }

  const failure = Object.values(result.failures)[0];
  throw failure ?? new Error("IndexedDB mutation failed");
}

function emptyMutationResponse(): DBCoreMutateResponse {
  return {
    numFailures: 0,
    failures: {},
    lastResult: undefined,
  };
}
