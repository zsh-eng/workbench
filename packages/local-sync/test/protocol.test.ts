import {
  MAX_SYNC_KEY_BYTES,
  MAX_SYNC_PUSH_BODY_BYTES,
  MAX_SYNC_VALUE_BYTES,
  SyncRecordError,
  SyncValueTooLargeError,
  compareSyncVersions,
  decodeSyncKey,
  decodeSyncValue,
  encodeSyncKey,
  encodeSyncValue,
  syncClientStateSchema,
  syncPullBodySchema,
  syncPullResponseSchema,
  syncPushBodySchema,
} from "@zsh-eng/local-sync";
import { describe, expect, it } from "vitest";

const HLC = { wallTimeMs: 1_000, counter: 0 } as const;

describe("sync v2 protocol", () => {
  it("round-trips canonical logical keys", () => {
    const key = encodeSyncKey("highlights", "book/1:highlight/2");

    expect(key).toBe('["highlights","book/1:highlight/2"]');
    expect(decodeSyncKey(key)).toEqual(["highlights", "book/1:highlight/2"]);
    expect(() => decodeSyncKey('{"table":"highlights"}')).toThrow(
      "sync key must encode [tableName, recordId]",
    );
  });

  it("uses JSON as the initial client value encoding", () => {
    const value = { id: "highlight-1", text: "Opaque to the server" };
    const encoded = encodeSyncValue(value);

    expect(decodeSyncValue<typeof value>(encoded)).toEqual(value);
    expect(() => encodeSyncValue(undefined)).toThrow(
      "sync value must be JSON serializable",
    );
    expect(() =>
      encodeSyncValue({ text: "x".repeat(MAX_SYNC_VALUE_BYTES) }),
    ).toThrow(SyncValueTooLargeError);
  });

  it("retains soft-deleted values without parsing opaque server data", () => {
    const deletedValue = encodeSyncValue({
      id: "book-2",
      title: "Available for undo",
      isDeleted: true,
    });
    const body = {
      changes: [
        {
          key: encodeSyncKey("books", "book-1"),
          value: "not JSON, but still opaque to the server",
          isDeleted: false,
          schemaVersion: 1,
          hlc: HLC,
        },
        {
          key: encodeSyncKey("books", "book-2"),
          value: deletedValue,
          isDeleted: true,
          schemaVersion: 1,
          hlc: { wallTimeMs: 1_001, counter: 0 },
        },
      ],
    };

    const parsed = syncPushBodySchema.parse(body);

    expect(parsed.changes).toHaveLength(2);
    expect(parsed.changes[1]).toMatchObject({
      value: deletedValue,
      isDeleted: true,
    });
    expect(() =>
      syncPushBodySchema.parse({
        changes: [{ ...body.changes[1], value: null }],
      }),
    ).toThrow();
  });

  it("rejects duplicate keys and oversized encoded batches", () => {
    const change = {
      key: encodeSyncKey("books", "book-1"),
      value: "value",
      isDeleted: false,
      schemaVersion: 1,
      hlc: HLC,
    };

    expect(() =>
      syncPushBodySchema.parse({ changes: [change, change] }),
    ).toThrow("push batch contains a duplicate key");

    const largeValue = "x".repeat(64 * 1_024);
    expect(() =>
      syncPushBodySchema.parse({
        changes: Array.from({ length: 17 }, (_, index) => ({
          ...change,
          key: encodeSyncKey("books", `book-${index}`),
          value: largeValue,
        })),
      }),
    ).toThrow(
      `push body must not exceed ${MAX_SYNC_PUSH_BODY_BYTES} encoded bytes`,
    );
  });

  it("applies deterministic HLC last-write-wins ordering", () => {
    const older = { hlc: HLC, deviceId: "device-a" };
    const newerCounter = {
      hlc: { wallTimeMs: 1_000, counter: 1 },
      deviceId: "device-a",
    };
    const newerDevice = { hlc: HLC, deviceId: "device-b" };

    expect(compareSyncVersions(older, newerCounter)).toBe(-1);
    expect(compareSyncVersions(older, newerDevice)).toBe(-1);
    expect(compareSyncVersions(older, older)).toBe(0);
  });

  it("makes bootstrap device inclusion explicit across all pages", () => {
    expect(
      syncPullBodySchema.parse({
        cursor: 0,
        limit: 100,
        excludeOwnDevice: false,
      }),
    ).toEqual({ cursor: 0, limit: 100, excludeOwnDevice: false });

    expect(
      syncPullBodySchema.parse({
        cursor: 100,
        head: 300,
        limit: 100,
        excludeOwnDevice: false,
      }),
    ).toEqual({
      cursor: 100,
      head: 300,
      limit: 100,
      excludeOwnDevice: false,
    });
  });

  it("keeps the small durable client state outside Dexie", () => {
    expect(
      syncClientStateSchema.parse({
        deviceId: "device-a",
        hlc: HLC,
        pullCursor: 300,
        bootstrapped: true,
      }),
    ).toEqual({
      deviceId: "device-a",
      hlc: HLC,
      pullCursor: 300,
      bootstrapped: true,
    });
  });

  it("advances a complete filtered page to its fixed head", () => {
    expect(
      syncPullResponseSchema.parse({
        records: [],
        cursor: 120,
        head: 120,
        hasMore: false,
      }),
    ).toEqual({ records: [], cursor: 120, head: 120, hasMore: false });

    expect(() =>
      syncPullResponseSchema.parse({
        records: [],
        cursor: 100,
        head: 120,
        hasMore: false,
      }),
    ).toThrow("a complete page must advance its cursor to head");
  });

  it("rejects logical keys over the byte limit", () => {
    expect(() =>
      encodeSyncKey("books", "x".repeat(MAX_SYNC_KEY_BYTES)),
    ).toThrow(SyncRecordError);
  });
});
