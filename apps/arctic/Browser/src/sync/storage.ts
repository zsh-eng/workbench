import {
  compareSyncHlc,
  nextSyncHlcBatch,
  type SyncClientStateStore,
  type SyncHlc,
  type SyncPushChange,
  type SyncRecord,
  type SyncStorage,
} from "@zsh-eng/local-sync";
import { namespaceRange, promised, transact } from "./idb";

export type Fields = Record<string, unknown>;
type Stored = SyncRecord & { ns: string };

/**
 * An edit that this browser has not uploaded. A field edit applies to the
 * latest record when it is sent, so another device's change to a different
 * field survives, as in the phone's merge. A whole value replaces the record.
 */
type Pending = {
  ns: string;
  key: string;
  hlc: SyncHlc;
  rev: number;
  patch?: Fields;
  base?: Fields;
  value?: string;
  isDeleted?: boolean;
};

export type View = { value: string; isDeleted: boolean };

/** JSON with sorted keys, as the phone encodes its records. */
export function encodeSorted(value: unknown): string {
  return JSON.stringify(value, (_, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]]),
        )
      : item,
  );
}

const same = (left: unknown, right: unknown) =>
  encodeSorted(left) === encodeSorted(right);

/** Null removes a field, as Swift omits nil optionals. */
function applyFields(value: Fields, patch: Fields): Fields {
  const next = { ...value };
  for (const [key, item] of Object.entries(patch))
    if (item === null) delete next[key];
    else next[key] = item;
  return next;
}

/**
 * One namespace's records in IndexedDB, with an in-memory copy for the UI.
 * Every write commits to IndexedDB before the copy and listeners change.
 */
export class RecordStorage implements SyncStorage<readonly SyncRecord[]> {
  private rows = new Map<string, Stored>();
  private pending = new Map<string, Pending>();
  private sent = new Map<string, number>();
  /** Edits and remote records apply one at a time, each to the state the last one committed. */
  private lock: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(keys: string[]) => void>();
  /** Changes whenever a record changes. */
  revision = 0;

  constructor(
    private readonly db: IDBDatabase,
    readonly ns: string,
    private readonly clock: SyncClientStateStore,
    /** Restores invariants after fields merge, such as "unsaved is not archived". */
    private readonly normalize: (fields: Fields) => Fields = (fields) => fields,
  ) {}

  async load() {
    await transact(this.db, ["records", "outbox"], "readonly", async (tx) => {
      const [rows, pending] = await Promise.all([
        promised<Stored[]>(
          tx.objectStore("records").getAll(namespaceRange(this.ns)),
        ),
        promised<Pending[]>(
          tx.objectStore("outbox").getAll(namespaceRange(this.ns)),
        ),
      ]);
      this.rows = new Map(rows.map((row) => [row.key, row]));
      this.pending = new Map(pending.map((item) => [item.key, item]));
    });
  }

  subscribe(listener: (keys: string[]) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  get size() {
    return this.rows.size;
  }

  get pendingCount() {
    return this.pending.size;
  }

  keys() {
    return new Set([...this.rows.keys(), ...this.pending.keys()]);
  }

  /** The record as this browser shows it: the synced value with unsent edits applied. */
  view(key: string): View | undefined {
    const row = this.rows.get(key);
    const pending = this.pending.get(key);
    if (!pending) return row;
    if (pending.patch) {
      if (!row || row.isDeleted) return row;
      return { value: this.merged(row, pending.patch), isDeleted: false };
    }
    return { value: pending.value!, isDeleted: pending.isDeleted ?? false };
  }

  synced(key: string): View | undefined {
    return this.rows.get(key);
  }

  /** Changes fields of a live record. */
  edit(key: string, fields: Fields) {
    return this.serial(() => this.editNow(key, fields));
  }

  private async editNow(key: string, fields: Fields) {
    const row = this.rows.get(key);
    if (!row || row.isDeleted)
      throw new Error("This article is no longer in your library.");
    const previous = this.pending.get(key);
    const next: Pending = {
      ns: this.ns,
      key,
      hlc: this.tick(),
      rev: (previous?.rev ?? 0) + 1,
      patch: { ...(previous?.patch ?? {}), ...fields },
      base: previous?.base ?? JSON.parse(row.value),
    };
    if (previous?.value !== undefined) {
      // A field edit after a whole-value write changes that value.
      next.patch = undefined;
      next.base = undefined;
      next.value = encodeSorted(
        this.normalize(applyFields(JSON.parse(previous.value), fields)),
      );
      next.isDeleted = previous.isDeleted;
    }
    await this.commitPending([next]);
  }

  /** Writes whole values, or removals, in one transaction. */
  write(changes: { key: string; value: string; isDeleted?: boolean }[]) {
    return this.serial(() => this.writeNow(changes));
  }

  private async writeNow(
    changes: { key: string; value: string; isDeleted?: boolean }[],
  ) {
    const writes = changes.map((change) => ({
      ns: this.ns,
      key: change.key,
      hlc: this.tick(),
      rev: (this.pending.get(change.key)?.rev ?? 0) + 1,
      value: change.value,
      isDeleted: change.isDeleted ?? false,
    }));
    await this.commitPending(writes);
  }

  async getPendingChanges(): Promise<SyncPushChange[]> {
    this.sent.clear();
    const changes: SyncPushChange[] = [];
    for (const pending of this.pending.values()) {
      let value = pending.value;
      if (pending.patch) {
        const row = this.rows.get(pending.key);
        if (!row || row.isDeleted) continue;
        value = this.merged(row, pending.patch);
      }
      if (value === undefined) continue;
      this.sent.set(pending.key, pending.rev);
      changes.push({
        key: pending.key,
        value,
        isDeleted: pending.isDeleted ?? false,
        schemaVersion: 1,
        hlc: pending.hlc,
      });
    }
    return changes;
  }

  prepareRemoteRecords(records: readonly SyncRecord[]) {
    const keys = new Set<string>();
    for (const record of records) {
      if (keys.has(record.key))
        throw new Error(`Sync response repeats ${record.key}`);
      keys.add(record.key);
    }
    return records;
  }

  async applyRemoteRecords(records: readonly SyncRecord[]) {
    if (records.length === 0) return { applied: 0, skipped: 0 };
    await this.commitRemote(records.map((record) => ({ record })));
    return { applied: records.length, skipped: 0 };
  }

  async reconcilePushResults(
    sent: readonly SyncPushChange[],
    winners: readonly SyncRecord[],
  ) {
    await this.commitRemote(
      winners.map((record, index) => ({ record, sent: sent[index] })),
    );
    return sent.length;
  }

  /** Records whose fields this browser changed: the base, the edit and the newer record merge. */
  private rebase(pending: Pending, record: SyncRecord): Pending | null {
    const later = compareSyncHlc(record.hlc, pending.hlc) >= 0;
    if (!pending.patch) return later ? null : pending;
    if (record.isDeleted) return null;
    const value = JSON.parse(record.value) as Fields;
    const patch = { ...pending.patch };
    // A later edit of the same field on another device wins that field.
    if (later)
      for (const field of Object.keys(patch))
        if (!same(value[field], pending.base?.[field])) delete patch[field];
    if (
      Object.keys(patch).length === 0 ||
      encodeSorted(this.normalize(applyFields(value, patch))) === record.value
    )
      return null;
    return {
      ...pending,
      patch,
      base: value,
      rev: pending.rev + 1,
      hlc: later ? this.tick() : pending.hlc,
    };
  }

  private commitRemote(items: { record: SyncRecord; sent?: SyncPushChange }[]) {
    return this.serial(() => this.commitRemoteNow(items));
  }

  private async commitRemoteNow(
    items: { record: SyncRecord; sent?: SyncPushChange }[],
  ) {
    const rows: Stored[] = [];
    const pending = new Map<string, Pending | null>();
    for (const { record, sent } of items) {
      rows.push({ ...record, ns: this.ns });
      const current = this.pending.get(record.key);
      if (!current) continue;
      const accepted =
        sent !== undefined &&
        sent.value === record.value &&
        sent.isDeleted === record.isDeleted &&
        compareSyncHlc(sent.hlc, record.hlc) === 0;
      if (accepted && this.sent.get(record.key) === current.rev)
        pending.set(record.key, null);
      else if (!accepted) pending.set(record.key, this.rebase(current, record));
      // An edit made while its upload was in flight stays queued.
    }
    await transact(this.db, ["records", "outbox"], "readwrite", async (tx) => {
      const records = tx.objectStore("records");
      const outbox = tx.objectStore("outbox");
      for (const row of rows) records.put(row);
      for (const [key, item] of pending)
        if (item) outbox.put(item);
        else outbox.delete([this.ns, key]);
    });
    for (const row of rows) this.rows.set(row.key, row);
    for (const [key, item] of pending)
      if (item) this.pending.set(key, item);
      else this.pending.delete(key);
    this.emit(rows.map((row) => row.key));
  }

  private async commitPending(items: Pending[]) {
    await transact(this.db, ["outbox"], "readwrite", async (tx) => {
      for (const item of items) tx.objectStore("outbox").put(item);
    });
    for (const item of items) this.pending.set(item.key, item);
    this.emit(items.map((item) => item.key));
  }

  private merged(row: Stored, patch: Fields) {
    return encodeSorted(
      this.normalize(applyFields(JSON.parse(row.value), patch)),
    );
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.lock.then(work, work);
    this.lock = run.catch(() => {});
    return run;
  }

  private tick() {
    return nextSyncHlcBatch(1, this.clock, Date.now())[0]!;
  }

  private emit(keys: string[]) {
    this.revision++;
    for (const listener of this.listeners) listener(keys);
  }
}
