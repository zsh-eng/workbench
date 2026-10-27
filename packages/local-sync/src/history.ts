/**
 * Turns journal entries into the groups a person reads: what came from
 * which device, what this device sent, what was lost to a newer edit and
 * what is still waiting. Pure; each app names things with `describe`.
 * See docs/SYNC_HISTORY.md.
 */
import {
  localDayStart,
  syncKeyTable,
  type SyncJournalCount,
  type SyncJournalEntry,
  type SyncJournalPass,
  type SyncJournalSent,
  type SyncTrigger,
} from "./journal.js";
import type { SyncFailure } from "./status.js";

/** What the app is asked to name. Counted changes (a restore, a past day) have no key. */
export interface SyncItemRef {
  table: string;
  key?: string;
  deleted: boolean;
  /** When the change was made, by its device's clock. */
  at?: number;
}

/** The app's words for one change. */
export interface SyncItemDescription {
  /** Changes of one kind are counted together, such as "highlight". */
  kind: string;
  one: string;
  other: string;
  /** A mass noun, counted by its containers: "reading progress in 2 books". */
  mass?: boolean;
  verb?: "added" | "changed" | "removed";
  /** What holds it, such as its book. */
  container?: { id: string; label: string; one: string; other: string };
}

export interface SyncHistoryItem {
  kind: string;
  one: string;
  other: string;
  mass: boolean;
  verb: "added" | "changed" | "removed";
  /** Distinct records, or counted changes. */
  count: number;
  containers: { id: string; label: string; count: number }[];
  containerNoun?: { one: string; other: string };
}

export type SyncHistoryDirection = "received" | "sent" | "restored" | "failed";

export interface SyncHistoryGroup {
  /** Stable while the group grows, so a view can keep its row in place. */
  id: string;
  direction: SyncHistoryDirection;
  /** Who made the changes: the origin device of received ones, else null (this device). */
  deviceId: string | null;
  /** When the changes were made, by their devices' clocks, capped at when this device saw them. */
  from: number;
  to: number;
  /** When this device saw them: the end of the passes that carried them. */
  seenFrom: number;
  seenTo: number;
  /** An older group, one per day. */
  byDay: boolean;
  /** Distinct records changed, or counted changes. */
  changes: number;
  items: SyncHistoryItem[];
  /** Received records that a newer edit here kept out. */
  keptLocal: number;
  /** A restore: changes per origin device (this device's own included). */
  devices?: { deviceId: string; changes: number }[];
  /** A failure streak. */
  failure?: {
    kind: SyncFailure["kind"];
    status?: number;
    tries: number;
    recoveredAt?: number;
    trigger: SyncTrigger;
  };
}

/** An edit on this device that a newer version replaced on the server. */
export interface SyncLostEdit {
  key: string;
  at: number;
  deleted: boolean;
  seenAt: number;
  item: SyncHistoryItem;
  winner: { deviceId: string; at: number; deleted: boolean };
}

/** A pending outbox change, as the app reads it. */
export interface SyncPendingChange {
  key: string;
  at: number;
  deleted: boolean;
}

export interface SyncHistory {
  /** Newest first. */
  lost: SyncLostEdit[];
  /** What only this device has, from `pending`; null when nothing waits. */
  waiting: {
    changes: number;
    since: number;
    items: SyncHistoryItem[];
  } | null;
  /** Newest first. */
  groups: SyncHistoryGroup[];
  /** The newest received group per origin device. */
  lastFrom: ReadonlyMap<string, SyncHistoryGroup>;
}

export interface SyncHistoryOptions {
  now: number;
  describe?: (ref: SyncItemRef) => SyncItemDescription;
  pending?: readonly SyncPendingChange[];
  /** Changes this close together, by when they were made, form one group. */
  gapMs?: number;
  kindOf?: (key: string) => string;
  dayOf?: (time: number) => number;
}

export const SYNC_HISTORY_GAP_MS = 10 * 60_000;

/** A table's name as its own noun, for apps that name nothing. */
export function describeSyncTable(ref: SyncItemRef): SyncItemDescription {
  return {
    kind: ref.table,
    one: `${ref.table} record`,
    other: `${ref.table} records`,
    verb: ref.deleted ? "removed" : "changed",
  };
}

/** One change, ready to group. */
interface Change {
  direction: "received" | "sent";
  deviceId: string | null;
  at: number;
  seenAt: number;
  key?: string;
  table: string;
  deleted: boolean;
  count: number;
  keptLocal: number;
}

/** A group while it gathers changes. */
interface Draft {
  group: SyncHistoryGroup;
  keyed: Map<string, Change>;
  counted: Change[];
}

export function summarizeSyncHistory(
  entries: readonly SyncJournalEntry[],
  options: SyncHistoryOptions,
): SyncHistory {
  const describe = options.describe ?? describeSyncTable;
  const kindOf = options.kindOf ?? syncKeyTable;
  const dayOf = options.dayOf ?? localDayStart;
  const gapMs = options.gapMs ?? SYNC_HISTORY_GAP_MS;
  const today = dayOf(options.now);
  const ordered = [...entries].sort((a, b) => a.startedAt - b.startedAt);

  const changes: Change[] = [];
  const lost: SyncLostEdit[] = [];
  const groups: SyncHistoryGroup[] = [];
  const restores: SyncJournalPass[][] = [];
  const failures: SyncJournalPass[][] = [];
  let restoreRun: SyncJournalPass[] | null = null;

  const lostEdit = (item: SyncJournalSent, seenAt: number) => {
    if (!item.lost) return;
    lost.push({
      key: item.key,
      at: Math.min(item.at, seenAt),
      deleted: item.deleted,
      seenAt,
      winner: item.lost,
      item: itemsOf(
        [
          {
            ref: {
              table: kindOf(item.key),
              key: item.key,
              deleted: item.deleted,
              at: item.at,
            },
            count: 1,
          },
        ],
        describe,
      )[0]!,
    });
  };
  const counted = (count: SyncJournalCount, at: number, seenAt: number) =>
    changes.push({
      direction: count.direction,
      deviceId:
        count.direction === "received" ? (count.deviceId ?? null) : null,
      at,
      seenAt,
      table: count.table,
      deleted: count.deleted > 0 && count.deleted === count.changes,
      count: count.changes,
      keptLocal: count.keptLocal ?? 0,
    });

  for (const entry of ordered) {
    if (entry.type === "day") {
      for (const count of entry.counts)
        counted(count, entry.endedAt, entry.endedAt);
      for (const item of entry.lost) lostEdit(item, entry.endedAt);
      continue;
    }
    const seenAt = entry.endedAt;
    for (const item of entry.received)
      changes.push({
        direction: "received",
        deviceId: item.deviceId,
        at: Math.min(item.at, seenAt),
        seenAt,
        key: item.key,
        table: kindOf(item.key),
        deleted: item.deleted,
        count: 1,
        keptLocal: item.keptLocal ? 1 : 0,
      });
    for (const item of entry.sent) {
      if (item.lost) {
        lostEdit(item, seenAt);
        continue;
      }
      changes.push({
        direction: "sent",
        deviceId: null,
        at: Math.min(item.at, seenAt),
        seenAt,
        key: item.key,
        table: kindOf(item.key),
        deleted: item.deleted,
        count: 1,
        keptLocal: 0,
      });
    }
    if (entry.restore) {
      // A resumed restore joins the one it continues.
      if (!restoreRun) restores.push((restoreRun = []));
      restoreRun.push(entry);
      for (const count of entry.counts)
        if (count.direction === "sent") counted(count, entry.startedAt, seenAt);
    } else {
      if (entry.outcome === "synced") restoreRun = null;
      for (const count of entry.counts) counted(count, entry.startedAt, seenAt);
    }
    if (entry.outcome === "failed") {
      const last = failures.at(-1);
      const previous = last?.at(-1);
      if (
        last &&
        previous &&
        entry.startedAt - previous.endedAt <= gapMs &&
        dayOf(entry.startedAt) === dayOf(previous.startedAt)
      )
        last.push(entry);
      else failures.push([entry]);
    }
  }

  // Received and sent changes: one group per device and direction, while
  // each change is within the gap of the last; one per day before today.
  const open = new Map<string, Draft>();
  changes.sort((a, b) => a.at - b.at);
  const drafts: Draft[] = [];
  for (const change of changes) {
    const who = `${change.direction}:${change.deviceId ?? "here"}`;
    const day = dayOf(change.at);
    const byDay = day < today;
    const slot = byDay ? `${who}:day:${day}` : who;
    let draft = open.get(slot);
    if (draft && !byDay && change.at - draft.group.to > gapMs)
      draft = undefined;
    if (!draft) {
      draft = {
        group: {
          id: byDay
            ? `${who}:day:${day}`
            : `${who}:${change.at}:${change.key ?? change.table}`,
          direction: change.direction,
          deviceId: change.deviceId,
          from: change.at,
          to: change.at,
          seenFrom: change.seenAt,
          seenTo: change.seenAt,
          byDay,
          changes: 0,
          items: [],
          keptLocal: 0,
        },
        keyed: new Map(),
        counted: [],
      };
      open.set(slot, draft);
      drafts.push(draft);
    }
    const group = draft.group;
    group.to = Math.max(group.to, change.at);
    group.seenFrom = Math.min(group.seenFrom, change.seenAt);
    group.seenTo = Math.max(group.seenTo, change.seenAt);
    if (change.key) draft.keyed.set(change.key, change);
    else draft.counted.push(change);
  }
  for (const { group, keyed, counted } of drafts) {
    const all = [...keyed.values(), ...counted];
    group.changes = all.reduce((sum, change) => sum + change.count, 0);
    group.keptLocal = all.reduce((sum, change) => sum + change.keptLocal, 0);
    group.items = itemsOf(all.map(toRef), describe);
    groups.push(group);
  }

  for (const run of restores) {
    const first = run[0]!;
    const last = run.at(-1)!;
    const byDevice = new Map<string, number>();
    const counts: SyncJournalCount[] = [];
    for (const entry of run)
      for (const count of entry.counts) {
        if (count.direction !== "received") continue;
        counts.push(count);
        if (count.deviceId)
          byDevice.set(
            count.deviceId,
            (byDevice.get(count.deviceId) ?? 0) + count.changes,
          );
      }
    const changed = counts.reduce((sum, count) => sum + count.changes, 0);
    if (changed === 0) continue;
    groups.push({
      id: `restored:${first.id}`,
      direction: "restored",
      deviceId: null,
      from: first.startedAt,
      to: last.endedAt,
      seenFrom: first.endedAt,
      seenTo: last.endedAt,
      byDay: dayOf(last.endedAt) < today,
      changes: changed,
      items: itemsOf(
        counts.map((count) => ({
          ref: { table: count.table, deleted: false },
          count: count.changes,
        })),
        describe,
      ),
      keptLocal: counts.reduce((sum, count) => sum + (count.keptLocal ?? 0), 0),
      devices: [...byDevice]
        .map(([deviceId, changes]) => ({ deviceId, changes }))
        .sort((a, b) => b.changes - a.changes),
    });
  }

  for (const run of failures) {
    const first = run[0]!;
    const last = run.at(-1)!;
    const tries = run.reduce((sum, entry) => sum + (entry.repeats ?? 1), 0);
    groups.push({
      id: `failed:${first.id}`,
      direction: "failed",
      deviceId: null,
      from: first.startedAt,
      to: last.endedAt,
      seenFrom: first.endedAt,
      seenTo: last.endedAt,
      byDay: dayOf(last.endedAt) < today,
      changes: 0,
      items: [],
      keptLocal: 0,
      failure: {
        kind: last.failure!.kind,
        ...(last.failure!.status !== undefined
          ? { status: last.failure!.status }
          : {}),
        tries,
        ...(last.recoveredAt !== undefined
          ? { recoveredAt: last.recoveredAt }
          : {}),
        trigger: first.trigger,
      },
    });
  }

  groups.sort((a, b) => b.to - a.to || a.id.localeCompare(b.id));
  const lastFrom = new Map<string, SyncHistoryGroup>();
  for (const group of groups)
    if (
      group.direction === "received" &&
      group.deviceId &&
      !lastFrom.has(group.deviceId)
    )
      lastFrom.set(group.deviceId, group);

  const pending = options.pending ?? [];
  return {
    lost: lost.sort((a, b) => b.at - a.at),
    waiting: pending.length
      ? {
          changes: pending.length,
          since: Math.min(
            ...pending.map((change) => Math.min(change.at, options.now)),
          ),
          items: itemsOf(
            pending.map((change) => ({
              ref: {
                table: kindOf(change.key),
                key: change.key,
                deleted: change.deleted,
                at: change.at,
              },
              count: 1,
            })),
            describe,
          ),
        }
      : null,
    groups,
    lastFrom,
  };
}

function toRef(change: Change): { ref: SyncItemRef; count: number } {
  return {
    ref: {
      table: change.table,
      deleted: change.deleted,
      ...(change.key ? { key: change.key, at: change.at } : {}),
    },
    count: change.count,
  };
}

/** One item per kind and verb, with its containers, the largest first. */
function itemsOf(
  refs: readonly { ref: SyncItemRef; count: number }[],
  describe: (ref: SyncItemRef) => SyncItemDescription,
): SyncHistoryItem[] {
  const items = new Map<string, SyncHistoryItem>();
  for (const { ref, count } of refs) {
    const description = describe(ref);
    const verb = description.verb ?? (ref.deleted ? "removed" : "changed");
    const id = `${description.kind}:${verb}`;
    let item = items.get(id);
    if (!item) {
      item = {
        kind: description.kind,
        one: description.one,
        other: description.other,
        mass: description.mass ?? false,
        verb,
        count: 0,
        containers: [],
      };
      items.set(id, item);
    }
    item.count += count;
    const container = description.container;
    if (!container) continue;
    item.containerNoun = { one: container.one, other: container.other };
    const held = item.containers.find((entry) => entry.id === container.id);
    if (held) held.count += count;
    else
      item.containers.push({ id: container.id, label: container.label, count });
  }
  return [...items.values()].sort(
    (a, b) => b.count - a.count || a.kind.localeCompare(b.kind),
  );
}

/**
 * Default English for an item: "3 highlights in X", "5 highlights in 2
 * books", "reading progress in 2 books", "1 book added".
 */
export function phraseSyncItem(item: SyncHistoryItem): string {
  const where =
    item.containers.length === 1
      ? item.containers[0]!.label
      : item.containers.length > 1
        ? `${item.containers.length} ${item.containerNoun!.other}`
        : null;
  if (item.mass) {
    const verb = item.verb === "removed" ? " removed" : "";
    return where ? `${item.one}${verb} in ${where}` : `${item.one}${verb}`;
  }
  const counted = `${item.count} ${item.count === 1 ? item.one : item.other}`;
  if (item.verb === "added")
    return where
      ? `${item.count} new ${item.count === 1 ? item.one : item.other} in ${where}`
      : `${counted} added`;
  if (item.verb === "removed")
    return where ? `${counted} removed from ${where}` : `${counted} removed`;
  return where ? `${counted} in ${where}` : `${counted} changed`;
}
