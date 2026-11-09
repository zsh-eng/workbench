/**
 * `wb spaced apply FILE`: applies a `spaced-changes-v1` change set to Spaced
 * as a sync client. It reads the cards from the mirror (synced just before),
 * plans every change against them, and with `--apply` pushes the records
 * Spaced itself writes for those changes: card content, suspension,
 * deletion, decks and deck membership, and new cards. The shared API accepts
 * no other Spaced writes from this credential: never a review log, and never
 * a change to an existing card's schedule.
 *
 * A change may carry `expect` (the card state it was written against); a card
 * that no longer matches is skipped. Applying writes an undo change set whose
 * `expect` is the state it left, so an old undo never overwrites newer edits.
 */
import type { Database } from "bun:sqlite";
import {
  compareSyncHlc,
  createNamespacedHttpClient,
  createSyncClientState,
  observeSyncHlc,
  tickSyncHlcBatch,
  type SyncClientState,
  type SyncHlc,
} from "@zsh-eng/local-sync";

export const CHANGE_SET_VERSION = "spaced-changes-v1";
/** Device ID on every record `wb spaced apply` pushes; the server keeps it per record. */
export const DEVICE = "wb-spaced";
// Spaced treats a card suspended until at least local 31 Dec 9999 as
// suspended forever; the last instant of that day is past it in every zone.
const FOREVER = "9999-12-31T23:59:59.999Z";

type Expect = {
  front?: string;
  back?: string;
  suspended?: string | null;
  deleted?: boolean;
};
type ById = { cardId: string; reason?: string; expect?: Expect };
export type Change =
  | (ById & { action: "suspend"; until?: string })
  | (ById & { action: "unsuspend" | "delete" | "undelete" })
  | (ById & { action: "edit"; front: string; back: string })
  | {
      action: "create";
      deck: string;
      front: string;
      back: string;
      reason?: string;
      /** Cards in one file with the same note are siblings: Spaced buries them for the day. */
      note?: string;
      /** The sibling's role within its note (e.g. "c1", "forward"); defaults to its position. */
      variant?: string;
    };
export type ChangeSet = { version: string; title?: string; changes: Change[] };

const ACTIONS = ["suspend", "unsuspend", "delete", "undelete", "edit", "create"];

/** Checks the file's shape; throws with the first problem. */
export function parseChangeSet(text: string): ChangeSet {
  let value: any;
  try {
    value = JSON.parse(text);
  } catch {
    throw Error("The change set is not valid JSON.");
  }
  if (value?.version !== CHANGE_SET_VERSION)
    throw Error(`Not a ${CHANGE_SET_VERSION} file.`);
  if (!Array.isArray(value.changes) || !value.changes.length)
    throw Error("The change set has no changes.");
  const filled = (s: unknown) => typeof s === "string" && s.trim().length > 0;
  const date = (s: unknown) => typeof s === "string" && !Number.isNaN(Date.parse(s));
  value.changes.forEach((change: any, index: number) => {
    const where = `changes[${index}]`;
    if (!ACTIONS.includes(change?.action)) throw Error(`${where}: unknown action`);
    if (change.action === "create") {
      if (!filled(change.deck) || !filled(change.front) || !filled(change.back))
        throw Error(`${where}: create needs deck, front and back`);
      if (change.note !== undefined && !filled(change.note)) throw Error(`${where}: note is empty`);
      if (change.variant !== undefined && (!filled(change.variant) || change.note === undefined))
        throw Error(`${where}: variant needs a note`);
      return;
    }
    if (!filled(change.cardId)) throw Error(`${where}: needs a cardId`);
    if (change.action === "edit" && (!filled(change.front) || !filled(change.back)))
      throw Error(`${where}: edit needs front and back`);
    if (change.until !== undefined && !date(change.until))
      throw Error(`${where}: until is not a date`);
    const s = change.expect?.suspended;
    if (s !== undefined && s !== null && !date(s))
      throw Error(`${where}: expect.suspended is not a date`);
  });
  return value;
}

/** A Spaced operation as the app stores it in the `operations` table. */
type Stored = { type: string; payload: any; timestamp: number; id: string; isDeleted: boolean };
const inner = (type: string, id: string) => JSON.stringify([type, id]);
const recordKey = (type: string, id: string) =>
  JSON.stringify(["operations", inner(type, id)]);
const operation = (type: string, id: string, payload: unknown, timestamp: number, isDeleted = false) => ({
  key: recordKey(type, id),
  value: JSON.stringify({ type, payload, timestamp, id: inner(type, id), isDeleted }),
});

type Card = {
  id: string;
  front: string;
  back: string;
  suspended: string | null;
  deleted: boolean;
  /** The timestamps of the current records, so a new one is later. */
  stamps: Record<"cardContent" | "cardSuspended" | "cardDeleted", number>;
};

/** The current Spaced cards and decks in the mirror. */
export function readSpaced(db: Database) {
  const rows = db
    .query<{ value: string }, []>(
      "SELECT value FROM records WHERE namespace='spaced' AND table_name='operations' AND is_deleted=0",
    )
    .all();
  const cards = new Map<string, Card>();
  const decks = new Map<string, string>();
  const card = (id: string) => {
    let found = cards.get(id);
    if (!found) {
      found = {
        id,
        front: "",
        back: "",
        suspended: null,
        deleted: false,
        stamps: { cardContent: 0, cardSuspended: 0, cardDeleted: 0 },
      };
      cards.set(id, found);
    }
    return found;
  };
  const exists = new Set<string>();
  for (const { value } of rows) {
    let op: Stored;
    try {
      op = JSON.parse(value);
    } catch {
      continue;
    }
    const p = op.payload ?? {};
    if (op.type === "card") exists.add(p.id);
    else if (op.type === "deck" && !p.deleted) decks.set(p.name, p.id);
    else if (op.type === "cardContent")
      Object.assign(card(p.cardId), { front: p.front, back: p.back }).stamps.cardContent = op.timestamp;
    else if (op.type === "cardSuspended") {
      const c = card(p.cardId);
      c.suspended = p.suspended ?? null;
      c.stamps.cardSuspended = op.timestamp;
    } else if (op.type === "cardDeleted") {
      const c = card(p.cardId);
      c.deleted = !!p.deleted;
      c.stamps.cardDeleted = op.timestamp;
    }
  }
  for (const id of cards.keys()) if (!exists.has(id)) cards.delete(id);
  const latest = db
    .query<{ wall_time: number; counter: number }, []>(
      "SELECT wall_time,counter FROM records WHERE namespace='spaced' ORDER BY wall_time DESC,counter DESC LIMIT 1",
    )
    .get();
  return {
    cards,
    decks,
    clock: { wallTimeMs: latest?.wall_time ?? 0, counter: latest?.counter ?? 0 },
  };
}
type Spaced = ReturnType<typeof readSpaced>;

/** When a card is suspended until, or null when it isn't suspended now. */
const suspension = (card: Card, now: number) =>
  card.suspended && Date.parse(card.suspended) > now
    ? new Date(card.suspended).toISOString()
    : null;
const sameTime = (a?: string | null, b?: string | null) =>
  a == null || b == null ? (a ?? null) === (b ?? null) : Date.parse(a) === Date.parse(b);
const forever = (iso: string | null) => !!iso && Date.parse(iso) >= Date.UTC(9999, 11, 30);

function blocker(change: Exclude<Change, { action: "create" }>, card: Card | undefined, now: number) {
  if (!card) return "card not found";
  const e = change.expect;
  if (
    e &&
    ((e.front !== undefined && e.front !== card.front) ||
      (e.back !== undefined && e.back !== card.back) ||
      (e.deleted !== undefined && e.deleted !== card.deleted) ||
      (e.suspended !== undefined && !sameTime(e.suspended, suspension(card, now))))
  )
    return "changed since this file was made";
  if (change.action === "undelete") return card.deleted ? undefined : "not deleted";
  if (card.deleted) return "card deleted";
  const current = suspension(card, now);
  switch (change.action) {
    case "suspend":
      return (change.until === undefined ? forever(current) : sameTime(change.until, current))
        ? "already suspended"
        : undefined;
    case "unsuspend":
      return current ? undefined : "not suspended";
    case "edit":
      return card.front === change.front && card.back === change.back ? "unchanged" : undefined;
  }
  return undefined;
}

export type Planned = { change: Change; skip?: string };
export type Plan = { title?: string; items: Planned[]; newDecks: string[]; problems: string[] };

export function planChangeSet(set: ChangeSet, spaced: Spaced, now = Date.now()): Plan {
  const problems: string[] = [];
  const seen = new Set<string>();
  const newDecks = new Set<string>();
  const items = set.changes.map((change): Planned => {
    if (change.action === "create") {
      if (!spaced.decks.has(change.deck)) newDecks.add(change.deck);
      return { change };
    }
    if (seen.has(change.cardId)) problems.push(`Card ${change.cardId} has more than one change.`);
    seen.add(change.cardId);
    return { change, skip: blocker(change, spaced.cards.get(change.cardId), now) };
  });
  return { title: set.title, items, newDecks: [...newDecks].sort(), problems };
}

/** The records for each pending change, and the change that undoes it. */
export function changeRecords(plan: Plan, spaced: Spaced, now: number) {
  const decks = new Map(spaced.decks);
  const deckRecords = plan.newDecks
    .filter((name) => !decks.has(name))
    .map((name) => {
      const id = crypto.randomUUID();
      decks.set(name, id);
      return operation("deck", id, { id, name, description: "", deleted: false }, now);
    });
  // One Spaced note ID per note label in this file; variants count up within it.
  const notes = new Map<string, { id: string; count: number }>();
  const steps = plan.items
    .filter((item) => !item.skip)
    .map(({ change }) => {
      if (change.action === "create") {
        const id = crypto.randomUUID();
        let sibling: { noteId: string; siblingTag: string } | undefined;
        if (change.note !== undefined) {
          const note = notes.get(change.note) ?? { id: crypto.randomUUID(), count: 0 };
          notes.set(change.note, note);
          note.count += 1;
          sibling = { noteId: note.id, siblingTag: change.variant ?? `c${note.count}` };
        }
        const deckId = decks.get(change.deck)!;
        const due = new Date(now).toISOString();
        return {
          records: [
            operation("card", id, {
              id,
              createdAt: now,
              due,
              stability: 0,
              difficulty: 0,
              elapsed_days: 0,
              scheduled_days: 0,
              learning_steps: 0,
              reps: 0,
              lapses: 0,
              state: "New",
              last_review: null,
            }, now),
            operation("cardContent", id, { cardId: id, front: change.front, back: change.back }, now),
            operation("updateDeckCard", JSON.stringify([deckId, id]), { deckId, cardId: id, present: true }, now),
            ...(sibling ? [operation("cardMetadata", id, { cardId: id, ...sibling }, now)] : []),
          ],
          undo: { action: "delete", cardId: id, expect: { deleted: false } } as Change,
        };
      }
      const card = spaced.cards.get(change.cardId)!;
      const after = (type: keyof Card["stamps"]) => Math.max(now, card.stamps[type] + 1);
      switch (change.action) {
        case "suspend":
        case "unsuspend": {
          const until =
            change.action === "unsuspend"
              ? new Date(0).toISOString()
              : "until" in change && change.until
                ? new Date(change.until).toISOString()
                : FOREVER;
          const before = suspension(card, now);
          const left = Date.parse(until) > now ? until : null;
          return {
            records: [operation("cardSuspended", card.id, { cardId: card.id, suspended: until }, after("cardSuspended"))],
            undo: (before
              ? { action: "suspend", cardId: card.id, until: before, expect: { suspended: left } }
              : { action: "unsuspend", cardId: card.id, expect: { suspended: left } }) as Change,
          };
        }
        case "edit":
          return {
            records: [operation("cardContent", card.id, { cardId: card.id, front: change.front, back: change.back }, after("cardContent"))],
            undo: {
              action: "edit",
              cardId: card.id,
              front: card.front,
              back: card.back,
              expect: { front: change.front, back: change.back },
            } as Change,
          };
        case "delete":
        case "undelete": {
          const deleted = change.action === "delete";
          return {
            records: [operation("cardDeleted", card.id, { cardId: card.id, deleted }, after("cardDeleted"))],
            undo: { action: deleted ? "undelete" : "delete", cardId: card.id, expect: { deleted } } as Change,
          };
        }
      }
    });
  return { deckRecords, steps };
}

/** Pushes records; resolves to whether each one is stored. */
type Pusher = (changes: { key: string; value: string }[]) => Promise<boolean[]>;

/** A push to Spaced as this CLI: each change newer than every record seen. */
export async function spacedPusher(origin: string, send: typeof fetch, clock: SyncHlc): Promise<Pusher> {
  let state: SyncClientState = createSyncClientState(DEVICE);
  const { remote } = createNamespacedHttpClient({
    origin,
    namespace: "spaced",
    fetch: send,
    stateStore: { read: () => state, write: (next) => void (state = next) },
  });
  await remote.getScope!();
  return async (changes) => {
    const hlcs = tickSyncHlcBatch(clock, changes.length, Date.now());
    clock = hlcs.at(-1) ?? clock;
    const sent = changes.map((change, index) => ({
      ...change,
      isDeleted: false,
      schemaVersion: 1,
      hlc: hlcs[index]!,
    }));
    const { results } = await remote.push!(DEVICE, sent);
    return results.map(({ accepted, winner }, index) => {
      clock = observeSyncHlc(clock, [winner.hlc]);
      const mine = sent[index]!;
      // A record another device changed meanwhile keeps that device's version.
      return (
        accepted ||
        (winner.value === mine.value &&
          winner.deviceId === DEVICE &&
          compareSyncHlc(winner.hlc, mine.hlc) === 0)
      );
    });
  };
}

export type ApplyResult = {
  applied: number;
  skipped: number;
  /** Changes not stored: refused by a newer change elsewhere, or not tried. */
  failed: number;
  error?: string;
  undo?: ChangeSet;
  /** Keys of every record this run stored, for the local provenance ledger. */
  storedKeys: string[];
};

// Under the server's 500 changes and 1 MiB per push.
const MAX_RECORDS = 400;
const MAX_BYTES = 700_000;

/** Groups steps into pushes that stay under the server's limits. */
function chunks<T extends { records: { key: string; value: string }[] }>(steps: T[]) {
  const out: T[][] = [];
  let current: T[] = [];
  let records = 0;
  let bytes = 0;
  for (const step of steps) {
    const size = step.records.reduce((n, r) => n + r.key.length + r.value.length + 120, 0);
    if (current.length && (records + step.records.length > MAX_RECORDS || bytes + size > MAX_BYTES)) {
      out.push(current);
      current = [];
      records = 0;
      bytes = 0;
    }
    current.push(step);
    records += step.records.length;
    bytes += size;
  }
  if (current.length) out.push(current);
  return out;
}

/**
 * Pushes the plan. A change counts as applied when all its records are
 * stored; any change with a stored record gets an undo entry, so the undo
 * file covers everything that landed even when a push is partly refused.
 */
export async function applyPlan(plan: Plan, spaced: Spaced, push: Pusher, now = Date.now()): Promise<ApplyResult> {
  if (plan.problems.length) throw Error(plan.problems[0]);
  const { deckRecords, steps } = changeRecords(plan, spaced, now);
  const skipped = plan.items.length - steps.length;
  const undo: Change[] = [];
  const refused: string[] = [];
  const storedKeys: string[] = [];
  let applied = 0;
  const result = (extra: Partial<ApplyResult> = {}): ApplyResult => ({
    applied,
    skipped,
    failed: steps.length - applied,
    storedKeys,
    undo: undo.length
      ? { version: CHANGE_SET_VERSION, title: `Undo: ${plan.title ?? "change set"}`, changes: [...undo].reverse() }
      : undefined,
    ...(refused.length
      ? { error: `${refused.length} changed elsewhere meanwhile and kept that version (e.g. ${refused[0]}); sync and try again` }
      : {}),
    ...extra,
  });
  try {
    if (deckRecords.length) {
      const stored = await push(deckRecords);
      deckRecords.forEach((record, i) => stored[i] && storedKeys.push(record.key));
      if (stored.some((ok) => !ok)) return result({ error: "a new deck was not stored; nothing else was pushed" });
    }
    for (const chunk of chunks(steps)) {
      const stored = await push(chunk.flatMap((step) => step.records));
      let index = 0;
      for (const step of chunk) {
        const mine = stored.slice(index, index + step.records.length);
        step.records.forEach((record, i) => mine[i] && storedKeys.push(record.key));
        index += step.records.length;
        if (mine.some(Boolean)) undo.push(step.undo);
        if (mine.every(Boolean)) applied += 1;
        else refused.push(step.records[0]!.key);
      }
    }
  } catch (error) {
    return result({
      error: `${error instanceof Error ? error.message : String(error)}. A push's answer may be lost: run the file again as a dry run; changes that landed show as skipped (new cards may repeat).`,
    });
  }
  return result();
}

/** Counts per action, applied and skipped, and the skip reasons. */
export function describePlan(plan: Plan) {
  const actions: Record<string, { apply: number; skip: number }> = {};
  const reasons: Record<string, number> = {};
  for (const { change, skip } of plan.items) {
    const row = (actions[change.action] ??= { apply: 0, skip: 0 });
    row[skip ? "skip" : "apply"] += 1;
    if (skip) reasons[skip] = (reasons[skip] ?? 0) + 1;
  }
  return { title: plan.title, actions, skipReasons: reasons, newDecks: plan.newDecks, problems: plan.problems };
}
