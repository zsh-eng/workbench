/**
 * Restore lab: a new device signs in to a large synthetic Spaced account
 * over a slow link (docs/FIRST_REVIEW.md).
 *
 * The link is Reader's restore-lab proxy, which shapes the API and serves
 * one or more app builds over HTTPS and HTTP/2; this script seeds one
 * account per size on a local sync-server:
 *
 *   bun scripts/restore-lab.ts seed large     # small | medium | large
 *   bun scripts/restore-lab.ts seed large large-grades  # another account
 *
 * The accounts are synthetic. Their shape is inferred from the schema and
 * from the totals in docs/OPFS_STORAGE_BENCHMARK.md (about 30,000 card and
 * deck records of 10 MB, 67,000 review records of 34 MB), not from any
 * user's records. Records go to the server in the order of an account
 * migrated from the old backend (scripts/sync-migration/convert.ts: each
 * legacy table in turn, review logs last), then three weeks of reviews made
 * since, which move each reviewed card's record to the end.
 */
import { encodeSyncKey } from "@zsh-eng/local-sync";
import { toStoredOperation } from "../src/lib/sync/records";
import type { Operation } from "../src/lib/sync/schema";

// RESTORE_LAB_API moves the lab to other ports. Port 5632 is the shaped
// link; LAB_API_UPSTREAM is the sync-server behind it.
export const LAB_API = process.env.RESTORE_LAB_API ?? "https://localhost:5632";
const API_UPSTREAM = process.env.LAB_API_UPSTREAM ?? "http://127.0.0.1:5631";
/** An origin the server trusts; any of the lab's app origins. */
const APP_ORIGIN =
  process.env.RESTORE_LAB_APP_ORIGIN ?? "https://localhost:5633";

/**
 * A local test account per size, or another account of that size by
 * `name`; the password is for the local server only.
 */
export const labAccount = (size: LabSize, name: string = size) => ({
  email: `${name}@spaced-restore-lab.test`,
  password: "spaced-restore-lab-password",
  name: `Spaced restore lab (${name})`,
});

/**
 * Account sizes. `large` is about 100,000 records, as the largest account
 * is: 7,000 cards with about 4.3 card and deck records each and about 10
 * reviews each. `recent` reviews are the newest, made after the migration.
 */
export const LAB_SIZES = {
  small: { cards: 100, decks: 3, reviews: 700, recent: 60 },
  medium: { cards: 1_000, decks: 12, reviews: 6_600, recent: 400 },
  large: { cards: 7_000, decks: 40, reviews: 66_000, recent: 3_000 },
} as const;
export type LabSize = keyof typeof LAB_SIZES;

/** The same numbers in every run. */
function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const DAY = 86_400_000;
const WORDS = (
  "the of and a to in is was that for it with as on be at by this from " +
  "which or an are not have one all were when there can more if no out so " +
  "what up time about into than them only other new some could these two " +
  "may first then do any like my now over such our man me even most made"
).split(" ");

/**
 * Every record of a synthetic account, in the server's order, as push
 * changes.
 */
function labChanges(size: LabSize, now = Date.now()) {
  const profile = LAB_SIZES[size];
  const next = random(profile.cards);
  const pick = <T>(items: readonly T[]) =>
    items[Math.floor(next() * items.length)]!;
  const text = (length: number) =>
    Array.from({ length }, () => pick(WORDS)).join(" ");
  // UUID-shaped, as the app's identifiers are, and the same in every run.
  const id = (kind: string, index: number) => {
    const hex = (value: number, length: number) =>
      (value >>> 0).toString(16).padStart(length, "0").slice(-length);
    let hash = 2_166_136_261;
    for (const char of `${size}:${kind}`)
      hash = Math.imul(hash ^ char.charCodeAt(0), 16_777_619);
    return `${hex(index, 8)}-${hex(hash, 4)}-4${hex(hash >>> 16, 3)}-8${hex(index >>> 12, 3)}-1ab${hex(hash, 9)}`;
  };
  // The migration happened three weeks ago; history goes back two years.
  const migrated = now - 21 * DAY;
  const start = migrated - 730 * DAY;
  const changes: {
    key: string;
    value: string;
    isDeleted: boolean;
    time: number;
    device: string;
  }[] = [];
  const add = (op: Operation, device = "restore-lab-old-phone") => {
    const row = toStoredOperation(op);
    const table =
      row.type === "reviewLog" || row.type === "reviewLogDeleted"
        ? "reviewLogOperations"
        : "operations";
    changes.push({
      key: encodeSyncKey(table, row.id),
      value: JSON.stringify(row),
      isDeleted: row.isDeleted,
      time: op.timestamp,
      device,
    });
  };

  const decks = Array.from({ length: profile.decks }, (_, index) => ({
    id: id("deck", index),
    name: `${text(2).replace(/^./, (c) => c.toUpperCase())} ${index + 1}`,
    description: text(8),
  }));
  type LabCard = {
    id: string;
    created: number;
    state: "New" | "Learning" | "Review" | "Relearning";
    reviews: number[];
    lapses: number;
    due: number;
    stability: number;
    difficulty: number;
    scheduled: number;
    note?: string;
  };
  const cards: LabCard[] = [];
  for (let index = 0; index < profile.cards; index++) {
    const created = start + next() * (migrated - start - 30 * DAY);
    // One card in twenty is new, and new cards are due at once.
    const fresh = next() < 0.05;
    const state = fresh
      ? ("New" as const)
      : next() < 0.05
        ? pick(["Learning", "Relearning"] as const)
        : ("Review" as const);
    const stability = fresh ? 0 : 1 + next() * 180;
    const scheduled = fresh ? 0 : Math.max(1, Math.round(stability));
    // About one reviewed card in thirty is due today or overdue.
    const due = fresh
      ? created
      : next() < 0.035
        ? now - next() * 3 * DAY
        : now + DAY + next() * scheduled * DAY;
    cards.push({
      id: id("card", index),
      created,
      state,
      reviews: [],
      lapses: fresh ? 0 : Math.floor(next() * 4),
      due,
      stability,
      difficulty: fresh ? 0 : 1 + next() * 9,
      scheduled,
      // Three cards in five come from notes with two or three siblings.
      note: next() < 0.6 ? id("note", Math.floor(index / 2.5)) : undefined,
    });
  }
  const reviewed = cards.filter((card) => card.state !== "New");
  for (let index = 0; index < profile.reviews; index++) {
    const card = pick(reviewed);
    card.reviews.push(card.created + next() * (migrated - card.created));
  }
  for (const card of reviewed) card.reviews.sort((a, b) => a - b);

  const cardOp = (card: LabCard, at: number): Operation => ({
    type: "card",
    payload: {
      id: card.id,
      createdAt: Math.round(card.created),
      due: new Date(card.due),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: Math.round(card.scheduled * next()),
      scheduled_days: card.scheduled,
      learning_steps: 0,
      reps: card.reviews.length,
      lapses: card.lapses,
      state: card.state,
      last_review: card.reviews.length ? new Date(card.reviews.at(-1)!) : null,
    },
    timestamp: Math.round(at),
  });
  const reviewOp = (card: LabCard, at: number, index: number): Operation => ({
    type: "reviewLog",
    payload: {
      id: id(`review ${card.id}`, index),
      cardId: card.id,
      grade: next() < 0.12 ? "Again" : pick(["Hard", "Good", "Good", "Easy"]),
      state: index === 0 ? "New" : "Review",
      due: new Date(at - next() * 5 * DAY),
      stability: 1 + next() * 120,
      difficulty: 1 + next() * 9,
      elapsed_days: Math.round(next() * 60),
      last_elapsed_days: Math.round(next() * 60),
      scheduled_days: Math.round(next() * 90),
      learning_steps: 0,
      review: new Date(at),
      duration: Math.round(2_000 + next() * 18_000),
      createdAt: new Date(at),
    },
    timestamp: Math.round(at),
  });
  const last = (card: LabCard) => card.reviews.at(-1) ?? card.created;

  // The migrated account: each legacy table in turn.
  for (const card of cards) add(cardOp(card, last(card)));
  for (const card of cards)
    add({
      type: "cardContent",
      payload: {
        cardId: card.id,
        front: `${text(6 + Math.floor(next() * 22))}?`,
        back:
          next() < 0.3
            ? `- ${text(12)}\n- ${text(14)}\n- ${text(10)}`
            : `**${text(3)}** ${text(20 + Math.floor(next() * 40))}.`,
      },
      timestamp: Math.round(card.created + next() * DAY),
    });
  for (const card of cards)
    if (next() < 0.1)
      add({
        type: "cardDeleted",
        payload: { cardId: card.id, deleted: next() < 0.8 },
        timestamp: Math.round(last(card) + DAY),
      });
  for (const card of cards)
    if (next() < 0.03)
      add({
        type: "cardBookmarked",
        payload: { cardId: card.id, bookmarked: true },
        timestamp: Math.round(last(card)),
      });
  for (const card of cards)
    if (card.note || next() < 0.05)
      add({
        type: "cardSuspended",
        // Siblings were buried until a day that has passed; a few cards
        // are suspended for longer.
        payload: {
          cardId: card.id,
          suspended: new Date(
            next() < 0.05 ? now + 30 * DAY : last(card) + DAY,
          ),
        },
        timestamp: Math.round(last(card)),
      });
  for (const card of cards)
    if (card.note)
      add({
        type: "cardMetadata",
        payload: {
          cardId: card.id,
          noteId: card.note,
          siblingTag: pick(["c1", "c2", "c3", "reverse"]),
        },
        timestamp: Math.round(card.created),
      });
  for (const deck of decks)
    add({
      type: "deck",
      payload: { ...deck, deleted: false },
      timestamp: Math.round(start),
    });
  for (const card of cards) {
    const deck = pick(decks);
    const decksOfCard = next() < 0.2 ? [deck, pick(decks)] : [deck];
    for (const { id: deckId } of new Set(decksOfCard))
      add({
        type: "updateDeckCard",
        payload: { deckId, cardId: card.id, present: true },
        timestamp: Math.round(card.created),
      });
  }
  const logs: { card: LabCard; at: number; index: number }[] = [];
  for (const card of reviewed)
    card.reviews.forEach((at, index) => logs.push({ card, at, index }));
  for (const log of logs) add(reviewOp(log.card, log.at, log.index));
  for (const log of logs)
    if (next() < 0.006)
      add({
        type: "reviewLogDeleted",
        payload: {
          reviewLogId: id(`review ${log.card.id}`, log.index),
          deleted: true,
        },
        timestamp: Math.round(log.at + 30_000),
      });

  // Since the migration: each review writes the card and its log, and
  // buries the card's siblings until the next day.
  const recent = Array.from(
    { length: profile.recent },
    () => migrated + next() * (now - 3_600_000 - migrated),
  ).sort((a, b) => a - b);
  const siblings = new Map<string, LabCard[]>();
  for (const card of cards)
    if (card.note)
      siblings.set(card.note, [...(siblings.get(card.note) ?? []), card]);
  for (const at of recent) {
    const card = pick(reviewed);
    card.reviews.push(at);
    card.scheduled = Math.max(1, Math.round(card.scheduled * (1 + next())));
    card.due = next() < 0.04 ? now - next() * DAY : at + card.scheduled * DAY;
    add(cardOp(card, at), "restore-lab-phone");
    add(reviewOp(card, at, card.reviews.length - 1), "restore-lab-phone");
    for (const sibling of siblings.get(card.note ?? "") ?? [])
      if (sibling !== card)
        add(
          {
            type: "cardSuspended",
            payload: { cardId: sibling.id, suspended: new Date(at + DAY) },
            timestamp: Math.round(at),
          },
          "restore-lab-phone",
        );
  }
  return changes;
}

/** Seeds one account, unless it already has records, straight to the server. */
async function seed(size: LabSize, name?: string) {
  const account = labAccount(size, name);
  const headers = { Origin: APP_ORIGIN, "Content-Type": "application/json" };
  let auth = await fetch(`${API_UPSTREAM}/api/auth/sign-in/email`, {
    method: "POST",
    headers,
    body: JSON.stringify(account),
  });
  if (!auth.ok)
    auth = await fetch(`${API_UPSTREAM}/api/auth/sign-up/email`, {
      method: "POST",
      headers,
      body: JSON.stringify(account),
    });
  if (!auth.ok)
    throw new Error(`Sign-in failed: ${auth.status} ${await auth.text()}`);
  const cookie = auth.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  const api = `${API_UPSTREAM}/api/apps/spaced`;
  const base = { Origin: APP_ORIGIN, Cookie: cookie };
  const scope = JSON.stringify(
    await (await fetch(`${api}/sync/v3/state`, { headers: base })).json(),
  );
  const syncHeaders = { ...base, "X-Sync-Scope": scope };
  const existing = await (
    await fetch(`${api}/sync/v3/pull?cursor=0&limit=1&excludeOwnDevice=false`, {
      headers: { ...syncHeaders, "X-Device-ID": "restore-lab-seed" },
    })
  ).json();
  if (existing.records.length > 0) {
    console.log(`${account.email} already has records; nothing to seed.`);
    return;
  }

  const changes = labChanges(size);
  // Pushes within the server's limits: 500 changes and 1 MiB per request.
  // Each device pushes its own records, so their versions name it.
  let batch: object[] = [];
  /** A batch holds each key once; a key written again starts a new one. */
  const keys = new Set<string>();
  let device = changes[0]!.device;
  let bytes = 0;
  const flush = async () => {
    if (batch.length === 0) return;
    const response = await fetch(`${api}/sync/v3/push`, {
      method: "POST",
      headers: {
        ...syncHeaders,
        "X-Device-ID": device,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ changes: batch }),
    });
    if (!response.ok)
      throw new Error(
        `Push failed: ${response.status} ${await response.text()}`,
      );
    batch = [];
    keys.clear();
    bytes = 0;
  };
  let counter = 0;
  for (const change of changes) {
    const push = {
      key: change.key,
      value: change.value,
      isDeleted: change.isDeleted,
      schemaVersion: 1,
      hlc: { wallTimeMs: change.time, counter: counter++ % 1000 },
    };
    const length = JSON.stringify(push).length + 1;
    if (
      batch.length === 500 ||
      bytes + length > 900_000 ||
      change.device !== device ||
      keys.has(change.key)
    )
      await flush();
    device = change.device;
    keys.add(change.key);
    batch.push(push);
    bytes += length;
  }
  await flush();
  const final = await (
    await fetch(`${api}/sync/v3/pull?cursor=0&limit=1&excludeOwnDevice=false`, {
      headers: { ...syncHeaders, "X-Device-ID": "restore-lab-seed" },
    })
  ).json();
  console.log(
    `Seeded ${account.email}: ${changes.length} changes, head ${final.head}.`,
  );
}

if (import.meta.main) {
  const [command, size, name] = process.argv.slice(2);
  if (command === "seed" && size && size in LAB_SIZES)
    await seed(size as LabSize, name);
  else {
    console.error("usage: restore-lab.ts seed small|medium|large [name]");
    process.exit(64);
  }
}
