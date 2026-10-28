import { db, updateCurrentDeviceReadingSession } from "@/lib/db";
import {
  ActivityTracker,
  fromReaderSession,
  READER_GAP_MS,
  toReaderSession,
  type ReaderPosition,
} from "@workbench/activity-time";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

beforeEach(async () => {
  await db.open();
});
afterEach(async () => {
  await db.delete();
});

it("saves the shared session as the Reader's row, retrying a failed write", async () => {
  let now = 100;
  const persist = vi
    .fn(updateCurrentDeviceReadingSession)
    .mockRejectedValueOnce(new Error("Storage unavailable"));
  const onError = vi.fn();
  const tracker = new ActivityTracker<ReaderPosition>({
    app: "reader",
    gapMs: READER_GAP_MS.tablet,
    now: () => now,
    createId: () => "retry-session",
    persist: (session) => persist(toReaderSession(session, "reader-1")),
    onError,
  });
  tracker.begin(
    { kind: "book", id: "book" },
    { position: { spineIndex: 1, progress: 20 } },
  );
  await tracker.whenIdle();
  expect(onError).toHaveBeenCalledOnce();

  now += 60_000;
  tracker.input();
  tracker.move({ spineIndex: 2, progress: 0 });
  const ended = tracker.end();
  await tracker.whenIdle();

  const row = await db.readingSessions.get("retry-session");
  expect(row).toMatchObject({
    bookId: "book",
    readerInstanceId: "reader-1",
    startedAt: 100,
    endedAt: now,
    activeMs: 60_000,
    startSpineIndex: 1,
    endSpineIndex: 2,
    // The current schema keeps a field it does not index: no new version.
    gapMs: 300_000,
  });
  // The row reads back as the same shared session, with this device's id.
  const { isDeleted: _deleted, ...stored } = row!;
  expect(fromReaderSession(stored)).toEqual({
    ...ended!,
    device: stored.deviceId,
  });
  // Other devices receive the whole row, its gap included.
  const outbox = await db._sync_outbox.toArray();
  expect(outbox).toHaveLength(1);
  expect(JSON.parse(outbox[0]!.value)).toEqual(row);
});
