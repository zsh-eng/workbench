import type { Context } from "hono";
import { syncPushBodySchema } from "@zsh-eng/local-sync";
import { boundedText } from "./cli-links";
import type { AppEnv } from "./env";

/**
 * The Spaced records a Workbench Backup credential may push: the ones the app
 * writes when a card is edited, suspended, deleted or created, and decks.
 * Values stay opaque here; the record key names the operation, and the value
 * must name the same one. `card` (a card's schedule) is accepted only for a
 * card that doesn't exist yet, and `cardMetadata` (its sibling note) only
 * beside that card's `card` record in the same push. Review logs live in another table and are
 * never accepted.
 */
const CARD_FIELDS = new Set([
  "cardContent",
  "cardSuspended",
  "cardDeleted",
  "deck",
  "updateDeckCard",
]);

/** Why a Workbench Backup credential's write to `spaced` is refused, or undefined. */
export async function cliSpacedPushProblem(c: Context<AppEnv>) {
  if (
    c.req.method !== "POST" ||
    decodeURIComponent(c.req.path) !== "/api/apps/spaced/sync/v3/push"
  )
    return "only a sync push can change cards";
  const text = await boundedText(c);
  if (text === undefined) return "the push is too large";
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return "the push is not JSON";
  }
  const parsed = syncPushBodySchema.safeParse(body);
  if (!parsed.success) return "the push is not a sync push";
  const { changes } = parsed.data;
  if (changes.some((change) => change.hlc.counter > 1_000_000))
    return "the version counter is too large";
  const newCards: string[] = [];
  const metadata: string[] = [];
  for (const change of changes) {
    const problem = recordProblem(change);
    if (problem) return problem;
    if (change.key.startsWith('["operations","[\\"card\\",')) newCards.push(change.key);
    if (change.key.startsWith('["operations","[\\"cardMetadata\\",'))
      metadata.push(change.key.replace("cardMetadata", "card"));
  }
  if (metadata.some((key) => !newCards.includes(key)))
    return "it may set sibling metadata only on a card it creates";
  if (newCards.length) {
    const stored = await c.env.DATABASE.prepare(
      "SELECT count(*) AS n FROM sync_records WHERE user_id=? AND namespace='spaced' AND key IN (SELECT value FROM json_each(?))",
    )
      .bind(c.get("user").id, JSON.stringify(newCards))
      .first<{ n: number }>();
    if (stored!.n > 0) return "it may create cards but not change a card's schedule";
  }
  return undefined;
}

/**
 * Why one pushed record isn't exactly a Spaced operation record, as the app
 * writes it (apps/spaced2/src/lib/sync/records.ts): the canonical key, the id
 * the payload names, schema 1 and not deleted. A record any client would fail
 * to decode would stop every device's sync, so near misses are refused too.
 */
function recordProblem(change: {
  key: string;
  value: string;
  isDeleted: boolean;
  schemaVersion: number;
}) {
  if (change.isDeleted) return "it may not remove a record";
  if (change.schemaVersion !== 1) return "a record has an unknown schema version";
  let table: unknown, inner: unknown, type: unknown, id: unknown, value: any;
  try {
    const key = JSON.parse(change.key);
    if (!Array.isArray(key) || key.length !== 2) throw Error();
    [table, inner] = key;
    if (typeof inner !== "string") throw Error();
    const parts = JSON.parse(inner);
    if (!Array.isArray(parts) || parts.length !== 2) throw Error();
    [type, id] = parts;
    value = JSON.parse(change.value);
  } catch {
    return "a record is not a Spaced operation";
  }
  if (table !== "operations") return "it may not write review history";
  if (typeof type !== "string" || typeof id !== "string")
    return "a record is not a Spaced operation";
  if (type !== "card" && type !== "cardMetadata" && !CARD_FIELDS.has(type))
    return `it may not write ${type} records`;
  if (
    change.key !== JSON.stringify([table, inner]) ||
    inner !== JSON.stringify([type, id])
  )
    return "a record's key isn't in Spaced's form";
  const p = value?.payload;
  if (
    !value ||
    typeof value !== "object" ||
    value.type !== type ||
    value.id !== inner ||
    value.isDeleted !== false ||
    !p ||
    typeof p !== "object"
  )
    return "a record's value doesn't match its key";
  const named =
    type === "card" || type === "deck"
      ? p.id === id
      : type === "updateDeckCard"
        ? typeof p.deckId === "string" &&
          typeof p.cardId === "string" &&
          id === JSON.stringify([p.deckId, p.cardId]) &&
          p.present === true
        : p.cardId === id;
  if (!named) return "a record's value doesn't match its key";
  return undefined;
}
