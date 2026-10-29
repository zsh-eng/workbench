import { operationSchema, type Operation } from "./schema";
import { syncTablePrefix } from "@zsh-eng/local-sync";
import type { SyncTableMap } from "@zsh-eng/local-sync/dexie";

// Materialized operation families: one current row per family and entity, not a replay log.
export type StoredOperation = Operation & { id: string; isDeleted: boolean };
function operationId(op: Operation): string {
  const p = op.payload;
  const id =
    op.type === "updateDeckCard"
      ? JSON.stringify([op.payload.deckId, op.payload.cardId])
      : "id" in p
        ? p.id
        : "cardId" in p
          ? p.cardId
          : p.reviewLogId;
  return JSON.stringify([op.type, id]);
}
export function toStoredOperation(input: Operation): StoredOperation {
  const op = operationSchema.parse(input);
  return {
    ...op,
    id: operationId(op),
    isDeleted: op.type === "updateDeckCard" && !op.payload.present,
  };
}
function decode(value: string, reviews: boolean) {
  const raw = JSON.parse(value);
  const row = toStoredOperation(operationSchema.parse(raw));
  if (raw.id !== row.id || raw.isDeleted !== row.isDeleted)
    throw new Error("Invalid record identity");
  if ((row.type === "reviewLog" || row.type === "reviewLogDeleted") !== reviews)
    throw new Error("Record is in the wrong table");
  return row;
}
export const syncTables: SyncTableMap = {
  operations: { schemaVersion: 1, decode: (value) => decode(value, false) },
  reviewLogOperations: {
    schemaVersion: 1,
    decode: (value) => decode(value, true),
  },
};

/**
 * What every page but Stats reads: the cards, their schedules, contents and
 * decks. A new device pulls these first, then the review history
 * (docs/FIRST_REVIEW.md).
 */
export const SPACED_RESTORE_PRIORITY = [syncTablePrefix("operations")];
