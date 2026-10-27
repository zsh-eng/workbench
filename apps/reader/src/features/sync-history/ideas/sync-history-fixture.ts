import {
  createMemorySyncJournalStore,
  createSyncJournal,
  encodeSyncKey,
  type SyncJournal,
  type SyncJournalCount,
  type SyncJournalEntry,
  type SyncJournalPass,
  type SyncJournalReceived,
  type SyncJournalSent,
  type SyncPendingChange,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import { SAMPLE_BOOKS } from "@/features/background-activity/ideas/sample-books";
import type { DeviceType } from "@/types/session";
import type { ReaderLookup } from "../reader-describe";
import type { DeviceNamer } from "../RecentHistory";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

/** The sample's other devices: an iPhone, an iPad and a Mac. */
const DEVICES: Record<string, { label: string; type: DeviceType }> = {
  iphone: { label: "iPhone", type: "mobile" },
  ipad: { label: "iPad", type: "tablet" },
  mac: { label: "Mac", type: "desktop" },
};

export const SAMPLE_NAMES: DeviceNamer = {
  name: (deviceId) =>
    deviceId && DEVICES[deviceId]
      ? `your ${DEVICES[deviceId].label}`
      : deviceId === null
        ? "this device"
        : "another device",
  type: (deviceId) => (deviceId && DEVICES[deviceId]?.type) || null,
};

type Table = "books" | "highlights" | "notes" | "readingState";

/**
 * Six days of one reader's sync on this device: the restore when it was
 * set up, the iPad and the Mac on other days, a dropped connection this
 * morning, an edit lost to the iPhone, the iPhone's last half hour, and
 * one change still waiting.
 */
export function createSample(now = Date.now()) {
  // What Reader's describer would read from the rows behind each key.
  const records = new Map<
    string,
    ReaderLookup["records"] extends ReadonlyMap<string, infer Facts>
      ? Facts
      : never
  >();
  const item = (
    table: Table,
    id: string,
    bookId: string,
    createdAt: number,
    bookmark = false,
  ) => {
    const key = encodeSyncKey(table, id);
    records.set(key, { bookId, createdAt, ...(bookmark ? { bookmark } : {}) });
    return key;
  };
  const from = (
    deviceId: string,
    key: string,
    at: number,
  ): SyncJournalReceived => ({ key, deviceId, at, deleted: false });
  const sent = (key: string, at: number): SyncJournalSent => ({
    key,
    at,
    deleted: false,
  });
  let seq = 0;
  const pass = (
    startedAt: number,
    parts: Partial<SyncJournalPass> = {},
  ): SyncJournalPass => ({
    type: "pass",
    id: `${startedAt.toString(36).padStart(9, "0")}-${(seq++).toString(36).padStart(4, "0")}-sample`,
    startedAt,
    endedAt: startedAt + 800,
    trigger: "interval",
    outcome: "synced",
    received: [],
    sent: [],
    counts: [],
    ...parts,
  });
  const count = (
    deviceId: string,
    table: string,
    changes: number,
  ): SyncJournalCount => ({
    direction: "received",
    deviceId,
    table,
    changes,
    deleted: 0,
    restore: true,
  });

  const restoredAt = now - 6 * day;
  const yesterday = now - day;
  const entries: SyncJournalEntry[] = [
    pass(restoredAt, {
      trigger: "sign-in",
      restore: true,
      endedAt: restoredAt + 40_000,
      counts: [
        count("mac", "books", 9),
        count("iphone", "books", 3),
        count("mac", "highlights", 112),
        count("iphone", "highlights", 31),
        count("iphone", "notes", 22),
        count("mac", "readingState", 12),
      ],
    }),
    pass(yesterday - 2 * hour, {
      received: [
        ...[0, 1, 2, 3, 4].map((index) =>
          from(
            "ipad",
            item(
              "highlights",
              `middlemarch-h${index}`,
              "middlemarch",
              yesterday - 2 * hour - (8 - index) * minute,
            ),
            yesterday - 2 * hour - (8 - index) * minute,
          ),
        ),
        from(
          "ipad",
          item("readingState", "middlemarch", "middlemarch", restoredAt),
          yesterday - 2 * hour - minute,
        ),
      ],
    }),
    pass(yesterday - 30 * minute, {
      trigger: "change",
      sent: [
        sent(
          item("notes", "emma-n1", "emma", yesterday - 33 * minute),
          yesterday - 33 * minute,
        ),
        sent(
          item("notes", "emma-n2", "emma", yesterday - 31 * minute),
          yesterday - 31 * minute,
        ),
      ],
    }),
    pass(now - 3 * hour, {
      trigger: "online",
      outcome: "failed",
      failure: { kind: "network" },
      repeats: 3,
      endedAt: now - 3 * hour + 6 * minute,
      recoveredAt: now - 2 * hour - 50 * minute,
    }),
    pass(now - 95 * minute, {
      received: [
        from(
          "mac",
          item("books", "dracula", "dracula", now - 99 * minute),
          now - 99 * minute,
        ),
        from(
          "mac",
          item("readingState", "dracula", "dracula", now - 99 * minute),
          now - 97 * minute,
        ),
      ],
    }),
    pass(now - 40 * minute, {
      trigger: "change",
      sent: [
        {
          ...sent(
            item("highlights", "emma-h3", "emma", restoredAt),
            now - 42 * minute,
          ),
          lost: { deviceId: "iphone", at: now - 38 * minute, deleted: false },
        },
      ],
      received: [
        from(
          "iphone",
          item("highlights", "emma-h3", "emma", restoredAt),
          now - 38 * minute,
        ),
      ],
    }),
    pass(now - 2 * minute, {
      received: [
        ...[0, 1, 2].map((index) =>
          from(
            "iphone",
            item(
              "highlights",
              `persuasion-h${index}`,
              "persuasion",
              now - (9 - index * 2) * minute,
            ),
            now - (9 - index * 2) * minute,
          ),
        ),
        from(
          "iphone",
          item("notes", "persuasion-b1", "persuasion", now - 4 * minute, true),
          now - 4 * minute,
        ),
        from(
          "iphone",
          item("readingState", "persuasion", "persuasion", restoredAt),
          now - 3 * minute,
        ),
      ],
    }),
    pass(now - 20 * minute, {
      trigger: "change",
      sent: [
        sent(
          item("readingState", "emma", "emma", restoredAt),
          now - 21 * minute,
        ),
      ],
    }),
  ];
  const pending: SyncPendingChange[] = [
    {
      key: item("highlights", "emma-h9", "emma", now - minute),
      at: now - minute,
      deleted: false,
    },
  ];

  const journal = createSyncJournal({
    store: createMemorySyncJournalStore(entries),
  });
  let nextSeq = 1;
  /** The iPhone sends one more highlight in _Persuasion_, as a pass would bring it. */
  function iPhoneSyncs(at = Date.now()) {
    const key = item(
      "highlights",
      `persuasion-live${nextSeq}`,
      "persuasion",
      at,
    );
    const record: SyncRecord = {
      key,
      value: "{}",
      isDeleted: false,
      schemaVersion: 1,
      hlc: { wallTimeMs: at, counter: 0 },
      deviceId: "iphone",
      serverSeq: nextSeq++,
    };
    const recorder = journal.begin("interval");
    recorder.pulled({ records: [record], restoring: false });
    recorder.end({ outcome: "synced" });
  }

  return {
    entries,
    journal: journal as SyncJournal,
    pending,
    iPhoneSyncs,
    /** Reader's describer reads this in place of the database; the iPhone's records join it. */
    lookup: {
      records,
      titles: new Map(SAMPLE_BOOKS.map((book) => [book.id, book.title])),
    } satisfies ReaderLookup,
  };
}
