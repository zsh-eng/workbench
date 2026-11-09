import { Database } from "bun:sqlite";
import { renameSync, rmSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEVICE } from "./spaced-apply";

/**
 * Folds the mirror's Spaced records into plain, indexed tables in a separate
 * file (`spaced.sqlite`). The mirror stores one last-writer-wins record per
 * entity as JSON; joining those in SQL views is too slow at ~100k records.
 * The output is rebuilt from scratch each run and is safe to delete.
 */

// FSRS-6 decay (w[20]) from apps/spaced2/src/lib/review/fsrs6-personal-parameters.ts.
const DECAY = 0.1001;
const FACTOR = Math.pow(0.9, -1 / DECAY) - 1;
const DAY = 86_400_000;

/** Device-local record of who wrote each `wb spaced apply` run; never synced. */
export const LEDGER = "spaced-ledger.jsonl";

/** Maps record key -> "model · effort · date" for keys `wb spaced apply` stored. */
function readLedger(path: string) {
  const byKey = new Map<string, string>();
  if (!existsSync(path)) return byKey;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as { at: string; model?: string | null; effort?: string | null; keys: string[] };
      const label = [e.model ?? "unknown model", e.effort, e.at.slice(0, 10)].filter(Boolean).join(" · ");
      for (const key of e.keys) byKey.set(key, label);
    } catch {
      continue;
    }
  }
  return byKey;
}

type Payload = Record<string, any>;

const SCHEMA = `
CREATE TABLE decks(deck_id TEXT PRIMARY KEY,name TEXT,description TEXT,deleted INTEGER NOT NULL);
CREATE TABLE cards(card_id TEXT PRIMARY KEY,front TEXT,back TEXT,decks TEXT,state TEXT,due TEXT,
  stability REAL,difficulty REAL,reps INTEGER,lapses INTEGER,last_review TEXT,retrievability REAL,
  created_at TEXT,content_modified TEXT,deleted INTEGER NOT NULL,suspended_until TEXT,
  suspended_forever INTEGER NOT NULL,bookmarked INTEGER NOT NULL,note_id TEXT,sibling_tag TEXT,
  content_by TEXT,suspended_by TEXT,deleted_by TEXT);
CREATE TABLE card_decks(card_id TEXT NOT NULL,deck_id TEXT NOT NULL,deck TEXT,PRIMARY KEY(card_id,deck_id));
CREATE TABLE reviews(review_id TEXT PRIMARY KEY,card_id TEXT NOT NULL,grade TEXT,state_before TEXT,
  reviewed_at TEXT,duration_ms INTEGER,elapsed_days REAL,scheduled_days REAL,
  stability_before REAL,difficulty_before REAL);
CREATE INDEX reviews_card ON reviews(card_id,reviewed_at);
CREATE INDEX reviews_time ON reviews(reviewed_at);
CREATE INDEX card_decks_deck ON card_decks(deck);
-- Cards still in the review rotation: not deleted and not suspended forever.
CREATE VIEW active_cards AS SELECT * FROM cards WHERE NOT deleted AND NOT suspended_forever;
CREATE VIEW card_stats AS SELECT c.card_id,c.decks,c.front,count(r.review_id) AS reviews,
  sum(r.grade='Again') AS agains,sum(r.grade='Manual') AS manual,
  round(sum(r.duration_ms)/60000.0,1) AS minutes,min(r.reviewed_at) AS first_review,max(r.reviewed_at) AS last_review
  FROM cards c LEFT JOIN reviews r USING(card_id) GROUP BY c.card_id;
CREATE VIEW deck_summary AS SELECT d.name AS deck,count(*) AS cards,
  sum(NOT c.deleted AND NOT c.suspended_forever) AS active,sum(c.suspended_forever AND NOT c.deleted) AS suspended,
  sum(c.deleted) AS deleted,sum(c.state='New' AND NOT c.deleted AND NOT c.suspended_forever) AS new,
  round(avg(CASE WHEN NOT c.deleted AND NOT c.suspended_forever AND c.state!='New' THEN c.stability END),1) AS avg_stability_days,
  max(c.created_at) AS newest_card
  FROM card_decks cd JOIN decks d USING(deck_id) JOIN cards c USING(card_id) GROUP BY d.name;
`;

export function buildSpaced(mirror: Database, path: string, now = Date.now()) {
  const decks = new Map<string, Payload>();
  const cards = new Map<string, Payload>();
  const content = new Map<string, Payload & { ts: number }>();
  const deleted = new Map<string, boolean>();
  const suspended = new Map<string, string | null>();
  const bookmarked = new Map<string, boolean>();
  const metadata = new Map<string, Payload>();
  const membership: Payload[] = [];
  const reviews: Payload[] = [];
  const undone = new Set<string>();
  // Who wrote the current version, when it came from `wb spaced apply`.
  const ledger = readLedger(join(dirname(path), LEDGER));
  const by = { cardContent: new Map<string, string>(), cardSuspended: new Map<string, string>(), cardDeleted: new Map<string, string>() };

  const rows = mirror
    .query<{ key: string; value: string; device_id: string }, []>(
      "SELECT key, value, device_id FROM records WHERE namespace='spaced' AND is_deleted=0",
    )
    .iterate();
  for (const { key, value, device_id } of rows) {
    let op: { type?: string; payload?: Payload; timestamp?: number };
    try {
      op = JSON.parse(value);
    } catch {
      continue;
    }
    const p = op.payload;
    if (!p) continue;
    if (device_id === DEVICE && op.type && op.type in by)
      by[op.type as keyof typeof by].set(p.cardId, ledger.get(key) ?? DEVICE);
    switch (op.type) {
      case "deck":
        decks.set(p.id, p);
        break;
      case "card":
        cards.set(p.id, p);
        break;
      case "cardContent":
        content.set(p.cardId, { ...p, ts: op.timestamp ?? 0 });
        break;
      case "cardDeleted":
        deleted.set(p.cardId, !!p.deleted);
        break;
      case "cardSuspended":
        suspended.set(p.cardId, p.suspended ?? null);
        break;
      case "cardBookmarked":
        bookmarked.set(p.cardId, !!p.bookmarked);
        break;
      case "cardMetadata":
        metadata.set(p.cardId, p);
        break;
      case "updateDeckCard":
        if (p.present) membership.push(p);
        break;
      case "reviewLog":
        reviews.push(p);
        break;
      case "reviewLogDeleted":
        if (p.deleted) undone.add(p.reviewLogId);
        break;
    }
  }

  const deckName = (id: string) => {
    const d = decks.get(id);
    return d && !d.deleted ? (d.name as string) : undefined;
  };
  const cardDecks = new Map<string, string[]>();
  for (const m of membership) {
    const name = deckName(m.deckId);
    if (!name) continue;
    cardDecks.set(m.cardId, [...(cardDecks.get(m.cardId) ?? []), name]);
  }

  const temporary = `${path}.building`;
  rmSync(temporary, { force: true });
  const out = new Database(temporary, { create: true, strict: true });
  chmodSync(temporary, 0o600);
  try {
    out.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF;");
    out.exec(SCHEMA);
    out.transaction(() => {
      const deck = out.query("INSERT INTO decks VALUES(?,?,?,?)");
      for (const d of decks.values())
        deck.run(
          d.id,
          d.name ?? null,
          d.description ?? null,
          d.deleted ? 1 : 0,
        );

      const card = out.query(
        "INSERT INTO cards VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      );
      for (const c of cards.values()) {
        const text = content.get(c.id);
        const meta = metadata.get(c.id);
        const until = suspended.get(c.id) ?? null;
        const last = c.last_review ? Date.parse(c.last_review) : NaN;
        const retrievability =
          c.state !== "New" && c.stability > 0 && Number.isFinite(last)
            ? Math.pow(1 + (FACTOR * (now - last)) / DAY / c.stability, -DECAY)
            : null;
        card.run(
          c.id,
          text?.front ?? null,
          text?.back ?? null,
          cardDecks.get(c.id)?.sort().join(", ") ?? null,
          c.state ?? null,
          c.due ?? null,
          c.stability ?? null,
          c.difficulty ?? null,
          c.reps ?? null,
          c.lapses ?? null,
          c.last_review ?? null,
          retrievability === null
            ? null
            : Math.round(retrievability * 1000) / 1000,
          c.createdAt ? new Date(c.createdAt).toISOString() : null,
          text?.ts ? new Date(text.ts).toISOString() : null,
          deleted.get(c.id) ? 1 : 0,
          until,
          until && until >= "9000" ? 1 : 0,
          bookmarked.get(c.id) ? 1 : 0,
          meta?.noteId ?? null,
          meta?.siblingTag ?? null,
          by.cardContent.get(c.id) ?? null,
          by.cardSuspended.get(c.id) ?? null,
          by.cardDeleted.get(c.id) ?? null,
        );
      }

      const link = out.query("INSERT OR IGNORE INTO card_decks VALUES(?,?,?)");
      for (const m of membership) {
        const name = deckName(m.deckId);
        if (name) link.run(m.cardId, m.deckId, name);
      }

      const review = out.query(
        "INSERT OR IGNORE INTO reviews VALUES(?,?,?,?,?,?,?,?,?,?)",
      );
      for (const r of reviews) {
        if (undone.has(r.id)) continue;
        review.run(
          r.id,
          r.cardId,
          r.grade ?? null,
          r.state ?? null,
          r.review ?? null,
          r.duration ?? null,
          r.elapsed_days ?? null,
          r.scheduled_days ?? null,
          r.stability ?? null,
          r.difficulty ?? null,
        );
      }
    })();
  } finally {
    out.close();
  }
  renameSync(temporary, path);

  const result = new Database(path, { readonly: true });
  try {
    return {
      path,
      ...result
        .query<
          { decks: number; cards: number; active: number; reviews: number },
          []
        >(
          `SELECT (SELECT count(*) FROM decks WHERE NOT deleted) AS decks,
            (SELECT count(*) FROM cards) AS cards,
            (SELECT count(*) FROM active_cards) AS active,
            (SELECT count(*) FROM reviews) AS reviews`,
        )
        .get()!,
    };
  } finally {
    result.close();
  }
}
