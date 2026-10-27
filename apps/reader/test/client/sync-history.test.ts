import { createSample } from "@/features/sync-history/ideas/sync-history-fixture";
import {
  holdRecentRows,
  recentRows,
  type RecentRow,
} from "@/features/sync-history/history-rows";
import { describeReaderRecord } from "@/features/sync-history/reader-describe";
import {
  encodeSyncKey,
  summarizeSyncHistory,
  type SyncJournalEntry,
} from "@zsh-eng/local-sync";
import { describe, expect, it } from "vitest";

// Mid-afternoon, so the sample's "today" stays on one day.
const NOW = new Date(2026, 9, 27, 15, 0).getTime();
const minute = 60_000;

function historyOf(
  sample: ReturnType<typeof createSample>,
  entries: readonly SyncJournalEntry[] = sample.entries,
) {
  return summarizeSyncHistory(entries, {
    now: NOW,
    describe: describeReaderRecord(sample.lookup),
    pending: sample.pending,
  });
}

const ids = (rows: readonly RecentRow[]) => rows.map((row) => row.id);
const kinds = (rows: readonly RecentRow[]) =>
  rows.map((row) => (row.type === "group" ? row.group.direction : row.type));

/** One more pass from `deviceId` with a highlight in Persuasion at `at`. */
function passFrom(deviceId: string, id: string, at: number): SyncJournalEntry {
  return {
    type: "pass",
    id: `${at.toString(36).padStart(9, "0")}-zzzz-test`,
    startedAt: at + minute,
    endedAt: at + minute,
    trigger: "interval",
    outcome: "synced",
    received: [
      { key: encodeSyncKey("highlights", id), deviceId, at, deleted: false },
    ],
    sent: [],
    counts: [],
  };
}

describe("Reader's words for sync history", () => {
  it("names books once, and says new for records made with the change", () => {
    const history = historyOf(createSample(NOW));
    const iPhone = history.groups.find(
      (group) => group.direction === "received" && group.deviceId === "iphone",
    )!;
    expect(
      iPhone.items.map((item) => [item.kind, item.verb, item.count]),
    ).toEqual([
      ["highlight", "added", 3],
      ["bookmark", "added", 1],
      ["progress", "changed", 1],
    ]);
    for (const item of iPhone.items)
      expect(item.containers.map((book) => book.label)).toEqual(["Persuasion"]);
    // The edit lost to the iPhone was to a highlight made days before.
    expect(history.lost).toHaveLength(1);
    expect(history.lost[0]!.item).toMatchObject({
      kind: "highlight",
      verb: "changed",
    });
    expect(history.lost[0]!.winner.deviceId).toBe("iphone");
  });
});

describe("Recent's arrangements", () => {
  it("sections: lost edits, what waits, then the groups, newest first", () => {
    const rows = recentRows(historyOf(createSample(NOW)));
    expect(kinds(rows)).toEqual([
      "lost",
      "waiting",
      "received",
      "sent",
      "received",
      "received",
      "failed",
      "sent",
      "received",
      "restored",
    ]);
  });

  it("timeline: what waits, then the lost edit where it happened", () => {
    const rows = recentRows(historyOf(createSample(NOW)), "timeline");
    expect(kinds(rows)).toEqual([
      "waiting",
      "received",
      "sent",
      "received",
      "lost",
      "received",
      "failed",
      "sent",
      "received",
      "restored",
    ]);
  });

  it("devices: one row per device, by its last change", () => {
    const rows = recentRows(historyOf(createSample(NOW)), "devices");
    expect(ids(rows).slice(2)).toEqual([
      "device:iphone",
      "device:this device",
      "device:mac",
      "device:ipad",
    ]);
  });
});

describe("Recent while it is open", () => {
  it("changes a row in place, puts a new one at the top of its part, and keeps a vanished one", () => {
    const sample = createSample(NOW);
    const held = recentRows(historyOf(sample));
    const later = [
      // The iPhone sends one more within ten minutes: the same group.
      passFrom("iphone", "persuasion-h3", NOW - minute),
      // The iPad sends one an hour after its last: a new group.
      passFrom("ipad", "middlemarch-h9", NOW),
    ];
    // And the lost edit has rolled out of the journal.
    const entries = [...sample.entries, ...later].filter(
      (entry) => entry.type !== "pass" || !entry.sent.some((sent) => sent.lost),
    );
    const rows = holdRecentRows(held, recentRows(historyOf(sample, entries)));

    expect(ids(rows).slice(0, held.length + 1)).toEqual([
      ids(held)[0],
      "waiting",
      expect.stringMatching(/^received:ipad:/),
      ...ids(held).slice(2),
    ]);
    expect(rows[0]).toMatchObject({ type: "lost", gone: true });
    const before = held[2]!;
    const after = rows.find((row) => row.id === before.id)!;
    expect(after.type === "group" && after.group.changes).toBe(
      before.type === "group" && before.group.changes + 1,
    );
  });

  it("by device, a device's next group keeps its row", () => {
    const sample = createSample(NOW);
    const held = recentRows(historyOf(sample), "devices");
    const entries = [
      ...sample.entries,
      passFrom("ipad", "middlemarch-h9", NOW),
    ];
    const rows = holdRecentRows(
      held,
      recentRows(historyOf(sample, entries), "devices"),
    );
    expect(ids(rows)).toEqual(ids(held));
    const iPad = rows.find((row) => row.id === "device:ipad")!;
    expect(iPad.type === "group" && iPad.group.to).toBe(NOW);
  });
});
