/**
 * A bounded record, on this device, of what each sync pass moved: keys,
 * devices and times, never values. See docs/SYNC_HISTORY.md.
 */
import type { SyncFailure } from "./status.js";
import type { SyncPassObserver } from "./storage.js";
import type { SyncPushChange, SyncRecord } from "./protocol.js";

/** Why a pass started, as the controller saw it. */
export type SyncTrigger =
  /** The controller started. */
  | "start"
  /** The periodic timer. */
  | "interval"
  /** The app asked for a sync, as after a local change. */
  | "change"
  /** A retry after a failure. */
  | "retry"
  /** The network came back. */
  | "online"
  /** The page came back into view. */
  | "visible"
  /** The person asked (Sync now). */
  | "manual"
  /** The credentials changed, so the controller ran again. */
  | "sign-in";

/** A record that arrived. `at` is its HLC wall time: when its device wrote it. */
export interface SyncJournalReceived {
  key: string;
  deviceId: string;
  at: number;
  deleted: boolean;
  /** A newer edit on this device kept it out. */
  keptLocal?: true;
}

/** A change this device sent. `lost` names the newer version that won. */
export interface SyncJournalSent {
  key: string;
  at: number;
  deleted: boolean;
  lost?: { deviceId: string; at: number; deleted: boolean };
}

/** Changes counted per table, where a pass or a day keeps no keys. */
export interface SyncJournalCount {
  direction: "received" | "sent";
  /** The origin device of received changes. */
  deviceId?: string;
  table: string;
  changes: number;
  deleted: number;
  keptLocal?: number;
  /** Counted from a restore. */
  restore?: true;
}

export interface SyncJournalPass {
  type: "pass";
  id: string;
  startedAt: number;
  endedAt: number;
  trigger: SyncTrigger;
  outcome: "synced" | "failed" | "cancelled";
  failure?: { kind: SyncFailure["kind"]; status?: number };
  /** Identical failures, with no success between, folded into this entry. */
  repeats?: number;
  /** When sync next succeeded after this failure. */
  recoveredAt?: number;
  /** The device's first download. */
  restore?: true;
  received: SyncJournalReceived[];
  sent: SyncJournalSent[];
  counts: SyncJournalCount[];
}

/** Older passes of one local day, rolled up into counts. Lost edits keep their detail. */
export interface SyncJournalDay {
  type: "day";
  id: string;
  /** The day's start (local midnight). */
  day: number;
  startedAt: number;
  endedAt: number;
  passes: number;
  failures: number;
  counts: SyncJournalCount[];
  lost: SyncJournalSent[];
}

export type SyncJournalEntry = SyncJournalPass | SyncJournalDay;

export type SyncPassResult =
  | { outcome: "synced" }
  | { outcome: "cancelled" }
  | { outcome: "failed"; failure: SyncFailure };

/** One pass in progress: hears its commits, then its end. */
export interface SyncPassRecorder extends SyncPassObserver {
  end(result: SyncPassResult): void;
}

export interface SyncJournalSnapshot {
  entries: readonly SyncJournalEntry[];
  /** False until a view's first read of the store finishes. */
  loaded: boolean;
}

export interface SyncJournal {
  /** Starts recording a pass. The controller calls this; so can an app without one. */
  begin(trigger: SyncTrigger): SyncPassRecorder;
  /** The first listener reads the store, so a view sees other tabs' passes. */
  subscribe(listener: () => void): () => void;
  getSnapshot(): SyncJournalSnapshot;
  /** Reads and compacts the store again. */
  refresh(): Promise<void>;
  /** Resolves when every write so far has settled. */
  flush(): Promise<void>;
}

/** Where entries live. `compact` reads and writes in one transaction. */
export interface SyncJournalStore {
  load(): Promise<SyncJournalEntry[]>;
  put(entry: SyncJournalEntry): Promise<void>;
  compact(
    decide: (entries: SyncJournalEntry[]) => {
      put: SyncJournalEntry[];
      remove: string[];
    },
  ): Promise<SyncJournalEntry[]>;
}

export interface SyncJournalLimits {
  /** Entries older than this are dropped. */
  maxAgeMs: number;
  /** Detailed passes kept before the oldest roll up into days. */
  maxEntries: number;
  /** Detailed keys kept before the oldest passes roll up into days. */
  maxKeys: number;
  /** A pass that receives more keys keeps counts instead. */
  maxPassKeys: number;
  /** Compact after this many writes. */
  compactEvery: number;
}

export const DEFAULT_SYNC_JOURNAL_LIMITS: SyncJournalLimits = {
  maxAgeMs: 30 * 24 * 60 * 60_000,
  maxEntries: 1_000,
  maxKeys: 8_000,
  maxPassKeys: 500,
  compactEvery: 50,
};

export interface SyncJournalOptions {
  store: SyncJournalStore;
  now?: () => number;
  /** The table a key belongs to, for counts. */
  kindOf?: (key: string) => string;
  /** The start of the local day that holds a time. */
  dayOf?: (time: number) => number;
  limits?: Partial<SyncJournalLimits>;
  /** A store error. The pass it belongs to is dropped; sync goes on. */
  onError?: (error: unknown) => void;
}

/**
 * The table in a key: the first part of `encodeSyncKey`'s pair, the text
 * before the first `/` (as Arctic writes keys), or "record".
 */
export function syncKeyTable(key: string): string {
  if (key.startsWith("[")) {
    try {
      const decoded: unknown = JSON.parse(key);
      if (Array.isArray(decoded) && typeof decoded[0] === "string")
        return decoded[0];
    } catch {
      // Not a pair: fall through to the slash form.
    }
  }
  const slash = key.indexOf("/");
  return slash > 0 ? key.slice(0, slash) : "record";
}

/** Local midnight. */
export function localDayStart(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** The same version: its clock, deletion and value. */
function sameVersion(winner: SyncRecord, sent: SyncPushChange): boolean {
  return (
    winner.hlc.wallTimeMs === sent.hlc.wallTimeMs &&
    winner.hlc.counter === sent.hlc.counter &&
    winner.isDeleted === sent.isDeleted &&
    winner.value === sent.value
  );
}

let sequence = 0;
function entryId(startedAt: number): string {
  sequence = (sequence + 1) % 1_000_000;
  return `${startedAt.toString(36).padStart(9, "0")}-${sequence.toString(36).padStart(4, "0")}-${Math.random().toString(36).slice(2, 8)}`;
}

function addCount(counts: SyncJournalCount[], count: SyncJournalCount): void {
  const same = counts.find(
    (item) =>
      item.direction === count.direction &&
      item.deviceId === count.deviceId &&
      item.table === count.table &&
      item.restore === count.restore,
  );
  if (!same) {
    counts.push({ ...count });
    return;
  }
  same.changes += count.changes;
  same.deleted += count.deleted;
  if (count.keptLocal) same.keptLocal = (same.keptLocal ?? 0) + count.keptLocal;
}

export function createSyncJournal(options: SyncJournalOptions): SyncJournal {
  const { store } = options;
  const now = options.now ?? (() => Date.now());
  const kindOf = options.kindOf ?? syncKeyTable;
  const dayOf = options.dayOf ?? localDayStart;
  const limits = { ...DEFAULT_SYNC_JOURNAL_LIMITS, ...options.limits };
  const onError =
    options.onError ??
    ((error: unknown) => console.error("Sync journal:", error));
  const listeners = new Set<() => void>();
  let snapshot: SyncJournalSnapshot = { entries: [], loaded: false };
  let chain: Promise<unknown> = Promise.resolve();
  let writes = 0;
  /** The last failure this page stored, until a pass succeeds. */
  let lastFailure: SyncJournalPass | null = null;

  function publish(entries: readonly SyncJournalEntry[], loaded = true) {
    snapshot = { entries, loaded };
    for (const listener of [...listeners]) listener();
  }

  /** Runs store work in order; an error drops that step and the chain goes on. */
  function enqueue<T>(work: () => Promise<T>): Promise<T | undefined> {
    const step = chain.then(work).catch((error: unknown) => {
      onError(error);
      return undefined;
    });
    chain = step;
    return step;
  }

  /** Compacts the store; `read` also makes the result the snapshot. */
  function compactNow(read: boolean): Promise<unknown> {
    return enqueue(async () => {
      const entries = await store.compact((current) =>
        compactEntries(current, now(), limits, kindOf, dayOf),
      );
      writes = 0;
      if (read || snapshot.loaded) publish(sorted(entries));
    });
  }

  function save(entry: SyncJournalPass) {
    void enqueue(async () => {
      await store.put(entry);
      if (snapshot.loaded) {
        const others = snapshot.entries.filter((item) => item.id !== entry.id);
        publish(sorted([...others, entry]));
      }
    });
    writes += 1;
    if (writes >= limits.compactEvery) {
      writes = 0;
      void compactNow(false);
    }
  }

  function begin(trigger: SyncTrigger): SyncPassRecorder {
    const startedAt = now();
    const received = new Map<string, SyncJournalReceived>();
    const sent = new Map<string, SyncJournalSent>();
    const counts: SyncJournalCount[] = [];
    let restore = false;
    /** Too many keys for one entry: the rest of the pass keeps counts. */
    let bulk = false;
    let ended = false;

    const countReceived = (item: SyncJournalReceived) =>
      addCount(counts, {
        direction: "received",
        deviceId: item.deviceId,
        table: kindOf(item.key),
        changes: 1,
        deleted: item.deleted ? 1 : 0,
        ...(item.keptLocal ? { keptLocal: 1 } : {}),
        ...(restore ? { restore: true as const } : {}),
      });
    /** Lost edits keep their detail whatever the size. */
    const countSent = (item: SyncJournalSent) => {
      if (item.lost) return false;
      addCount(counts, {
        direction: "sent",
        table: kindOf(item.key),
        changes: 1,
        deleted: item.deleted ? 1 : 0,
      });
      return true;
    };
    function toCounts() {
      bulk = true;
      for (const item of received.values()) countReceived(item);
      received.clear();
      for (const [key, item] of sent) if (countSent(item)) sent.delete(key);
    }

    return {
      pulled({ records, keptLocal, restoring }) {
        if (ended) return;
        restore ||= restoring;
        const kept = new Set(keptLocal);
        for (const record of records) {
          const item: SyncJournalReceived = {
            key: record.key,
            deviceId: record.deviceId,
            at: record.hlc.wallTimeMs,
            deleted: record.isDeleted,
            ...(kept.has(record.key) ? { keptLocal: true as const } : {}),
          };
          if (restore || bulk) {
            countReceived(item);
            continue;
          }
          received.delete(item.key);
          received.set(item.key, item);
        }
        if (received.size > limits.maxPassKeys) toCounts();
      },
      pushed({ sent: changes, results }) {
        if (ended) return;
        changes.forEach((change, index) => {
          const winner = results[index]!.winner;
          const item: SyncJournalSent = {
            key: change.key,
            at: change.hlc.wallTimeMs,
            deleted: change.isDeleted,
            ...(sameVersion(winner, change)
              ? {}
              : {
                  lost: {
                    deviceId: winner.deviceId,
                    at: winner.hlc.wallTimeMs,
                    deleted: winner.isDeleted,
                  },
                }),
          };
          if (bulk && countSent(item)) return;
          sent.delete(change.key);
          sent.set(change.key, item);
        });
        if (sent.size > limits.maxPassKeys) toCounts();
      },
      end(result) {
        if (ended) return;
        ended = true;
        const endedAt = now();
        const moved = received.size > 0 || sent.size > 0 || counts.length > 0;
        const failure =
          result.outcome === "failed"
            ? {
                kind: result.failure.kind,
                ...("status" in result.failure &&
                result.failure.status !== undefined
                  ? { status: result.failure.status }
                  : {}),
              }
            : undefined;
        if (result.outcome === "synced" && lastFailure) {
          // The streak is over: say when.
          save({ ...lastFailure, recoveredAt: endedAt });
          lastFailure = null;
        }
        if (!moved) {
          if (!failure) return;
          if (
            lastFailure &&
            keysOf(lastFailure) === 0 &&
            lastFailure.counts.length === 0 &&
            lastFailure.failure?.kind === failure.kind &&
            lastFailure.failure.status === failure.status
          ) {
            lastFailure = {
              ...lastFailure,
              endedAt,
              repeats: (lastFailure.repeats ?? 1) + 1,
            };
            save(lastFailure);
            return;
          }
        }
        const entry: SyncJournalPass = {
          type: "pass",
          id: entryId(startedAt),
          startedAt,
          endedAt,
          trigger,
          outcome: result.outcome,
          ...(failure ? { failure } : {}),
          ...(restore ? { restore: true as const } : {}),
          received: [...received.values()],
          sent: [...sent.values()],
          counts,
        };
        if (failure) lastFailure = entry;
        save(entry);
      },
    };
  }

  return {
    begin,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) void compactNow(true);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    refresh: async () => {
      await compactNow(true);
    },
    flush: async () => {
      await chain;
    },
  };
}

function sorted(entries: readonly SyncJournalEntry[]): SyncJournalEntry[] {
  return [...entries].sort(
    (a, b) => a.startedAt - b.startedAt || a.id.localeCompare(b.id),
  );
}

const keysOf = (entry: SyncJournalPass) =>
  entry.received.length + entry.sent.length;

/**
 * Drops what is too old, then rolls the oldest passes up into their days
 * until the detail fits the limits.
 */
function compactEntries(
  entries: SyncJournalEntry[],
  now: number,
  limits: SyncJournalLimits,
  kindOf: (key: string) => string,
  dayOf: (time: number) => number,
): { put: SyncJournalEntry[]; remove: string[] } {
  const remove: string[] = [];
  const cutoff = now - limits.maxAgeMs;
  const days = new Map<number, SyncJournalDay>();
  const passes: SyncJournalPass[] = [];
  for (const entry of entries) {
    if (entry.endedAt < cutoff) remove.push(entry.id);
    else if (entry.type === "day") days.set(entry.day, entry);
    else passes.push(entry);
  }
  passes.sort((a, b) => a.startedAt - b.startedAt);
  let keys = passes.reduce((sum, entry) => sum + keysOf(entry), 0);
  let count = passes.length;
  const changed = new Map<number, SyncJournalDay>();
  for (const entry of passes) {
    if (count <= limits.maxEntries && keys <= limits.maxKeys) break;
    const day = dayOf(entry.startedAt);
    const rolled = rollUp(
      changed.get(day) ?? days.get(day),
      entry,
      day,
      kindOf,
    );
    changed.set(day, rolled);
    remove.push(entry.id);
    count -= 1;
    keys -= keysOf(entry);
  }
  return { put: [...changed.values()], remove };
}

function rollUp(
  current: SyncJournalDay | undefined,
  entry: SyncJournalPass,
  day: number,
  kindOf: (key: string) => string,
): SyncJournalDay {
  const next: SyncJournalDay = current
    ? {
        ...current,
        counts: current.counts.map((count) => ({ ...count })),
        lost: [...current.lost],
      }
    : {
        type: "day",
        id: `day-${day}`,
        day,
        startedAt: entry.startedAt,
        endedAt: entry.endedAt,
        passes: 0,
        failures: 0,
        counts: [],
        lost: [],
      };
  next.startedAt = Math.min(next.startedAt, entry.startedAt);
  next.endedAt = Math.max(next.endedAt, entry.endedAt);
  next.passes += entry.repeats ?? 1;
  if (entry.outcome === "failed") next.failures += entry.repeats ?? 1;
  for (const item of entry.received)
    addCount(next.counts, {
      direction: "received",
      deviceId: item.deviceId,
      table: kindOf(item.key),
      changes: 1,
      deleted: item.deleted ? 1 : 0,
      ...(item.keptLocal ? { keptLocal: 1 } : {}),
    });
  for (const item of entry.sent) {
    if (item.lost) {
      next.lost.push(item);
      continue;
    }
    addCount(next.counts, {
      direction: "sent",
      table: kindOf(item.key),
      changes: 1,
      deleted: item.deleted ? 1 : 0,
    });
  }
  for (const count of entry.counts) addCount(next.counts, count);
  return next;
}

/** A journal store in memory, for tests and apps without IndexedDB. */
export function createMemorySyncJournalStore(
  initial: readonly SyncJournalEntry[] = [],
): SyncJournalStore & { entries(): SyncJournalEntry[] } {
  const rows = new Map(initial.map((entry) => [entry.id, entry]));
  const copy = <T>(value: T): T => structuredClone(value);
  return {
    entries: () => [...rows.values()].map(copy),
    load: async () => [...rows.values()].map(copy),
    put: async (entry) => {
      rows.set(entry.id, copy(entry));
    },
    compact: async (decide) => {
      const { put, remove } = decide([...rows.values()].map(copy));
      for (const id of remove) rows.delete(id);
      for (const entry of put) rows.set(entry.id, copy(entry));
      return [...rows.values()].map(copy);
    },
  };
}
