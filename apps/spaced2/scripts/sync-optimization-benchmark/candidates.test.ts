import "fake-indexeddb/auto";
import { expect, test } from "bun:test";
import Dexie, { type Table } from "dexie";
import {
  frameSize,
  tagFrame,
  installPackedRows,
  type packRow,
} from "./candidates";
import { syncTables, toStoredOperation } from "../../src/lib/sync/records";

test("parser metadata retains exact UTF-8 bytes without changing the page", () => {
  const page = { text: "日本語", records: [] };
  const bytes = new TextEncoder().encode(JSON.stringify(page)).length;
  expect(tagFrame(page, bytes)).toBe(page);
  expect(frameSize(page)).toBe(bytes);
  expect(Object.keys(page)).toEqual(["text", "records"]);
  expect(() => frameSize({})).toThrow("Missing parser");
});

test("packed rows retain indexes and decode to the original domain row", async () => {
  const db = new Dexie(crypto.randomUUID()) as Dexie & {
    operations: Table<
      ReturnType<typeof packRow>,
      string,
      ReturnType<typeof toStoredOperation>
    >;
  };
  db.version(1).stores({ operations: "id,type,timestamp" });
  installPackedRows(db);
  try {
    const row = toStoredOperation({
      type: "deck",
      timestamp: 123,
      payload: { id: "test", name: "Example", deleted: false, description: "" },
    });
    await db.operations.bulkPut([row]);
    const [packed] = await db.operations
      .where("type")
      .equals(row.type)
      .toArray();
    expect(packed.id).toBe(row.id);
    expect(packed.timestamp).toBe(row.timestamp);
    expect(syncTables.operations.decode!(packed.value)).toEqual(row);
  } finally {
    await db.delete();
  }
});

test("packed card hydration restores Date values", () => {
  const row = toStoredOperation({
    type: "card",
    timestamp: 123,
    payload: {
      id: "card",
      due: new Date("2026-09-19T00:00:00Z"),
      last_review: null,
      stability: 1,
      difficulty: 2,
      elapsed_days: 0,
      scheduled_days: 1,
      learning_steps: 0,
      reps: 1,
      lapses: 0,
      state: "Review",
    },
  });
  const restored = syncTables.operations.decode!(
    JSON.stringify(row),
  ) as typeof row;
  expect(restored).toEqual(row);
  expect(restored.payload).toHaveProperty(
    "due",
    new Date("2026-09-19T00:00:00Z"),
  );
});
