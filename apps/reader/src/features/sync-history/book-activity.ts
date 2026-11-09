import type { SyncHistory, SyncHistoryItem } from "@zsh-eng/local-sync";

/** One kind of change in one book, counted: "3 highlights added". */
export interface BookChange {
  kind: string;
  one: string;
  other: string;
  verb: "added" | "changed" | "removed";
  count: number;
}

/** What one device did to one book. `deviceId` is null for this device. */
export interface BookDeviceLine {
  deviceId: string | null;
  /** Its newest change, by that device's clock. */
  at: number;
  changes: BookChange[];
}

/** A book you touched on one day, with a line for each device that touched it. */
export interface BookActivity {
  /** The book and the day: a book touched on two days has a row for each. */
  id: string;
  bookId: string;
  /** The start of its day, by this device's clock. */
  day: number;
  title: string;
  /** Its newest change, by the clock of the device that made it. */
  at: number;
  /** This device has changes to it that have not reached the server. */
  waiting: boolean;
  /** Newest first. */
  lines: BookDeviceLine[];
}

const startOfDay = (at: number) => new Date(at).setHours(0, 0, 0, 0);

/**
 * This device's sync history by book and day: what came from each device
 * and what this device sent or still holds, for each book it names. What
 * still waits counts as today's. Restores (every
 * book at once) and failures (no book) are left out, and so are edits that
 * lost to a newer one: sync keeps the newest edit, so nothing was lost that
 * you need to act on. Books with changes waiting come first, then the
 * newest.
 */
export function bookActivity(
  history: SyncHistory,
  now = Date.now(),
): BookActivity[] {
  const books = new Map<string, BookActivity>();
  const add = (
    deviceId: string | null,
    at: number,
    items: readonly SyncHistoryItem[],
    waiting: boolean,
  ) => {
    for (const item of items)
      for (const container of item.containers) {
        const day = startOfDay(waiting ? now : at);
        const id = `${day}:${container.id}`;
        let book = books.get(id);
        if (!book) {
          book = {
            id,
            bookId: container.id,
            day,
            title: container.label,
            at,
            waiting,
            lines: [],
          };
          books.set(id, book);
        }
        book.at = Math.max(book.at, at);
        book.waiting ||= waiting;
        let line = book.lines.find((other) => other.deviceId === deviceId);
        if (!line) {
          line = { deviceId, at, changes: [] };
          book.lines.push(line);
        }
        line.at = Math.max(line.at, at);
        const change = line.changes.find(
          (other) => other.kind === item.kind && other.verb === item.verb,
        );
        if (change) change.count += container.count;
        else
          line.changes.push({
            kind: item.kind,
            one: item.one,
            other: item.other,
            verb: item.verb,
            count: container.count,
          });
      }
  };
  for (const group of history.groups)
    if (group.direction === "received" || group.direction === "sent")
      add(group.deviceId, group.to, group.items, false);
  if (history.waiting)
    add(null, history.waiting.since, history.waiting.items, true);
  for (const book of books.values()) book.lines.sort((a, b) => b.at - a.at);
  return [...books.values()].sort(
    (a, b) => Number(b.waiting) - Number(a.waiting) || b.at - a.at,
  );
}

const article = (noun: string) => (/^[aeiou]/i.test(noun) ? "an" : "a");

/** "a highlight", "3 highlights". */
function counted(change: BookChange): string {
  return change.count === 1
    ? `${article(change.one)} ${change.one}`
    : `${change.count.toLocaleString()} ${change.other}`;
}

/** "a, b and c" */
function list(parts: readonly string[]): string {
  return parts.length < 2
    ? (parts[0] ?? "")
    : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/**
 * One device's changes to a book, a line for each kind: "Added to your
 * library", "3 highlights and a bookmark", "Edited a note", "Removed 16
 * notes", "Your place, 42%". `place` is where that device's reading
 * position now is in the book, from 0 to 1, if it is known.
 */
export function lineClauses(
  changes: readonly BookChange[],
  place: number | undefined,
): string[] {
  const book = changes.find((change) => change.kind === "book");
  const others = changes.filter(
    (change) => change.kind !== "book" && change.kind !== "progress",
  );
  const of = (verb: BookChange["verb"]) =>
    list(
      others
        .filter((change) => change.verb === verb)
        .map((change) => counted(change)),
    );
  const added = of("added");
  const edited = of("changed");
  const removed = of("removed");
  const moved = changes.some(
    (change) => change.kind === "progress" && change.verb !== "removed",
  );
  const clauses = [
    book?.verb === "added" && "added to your library",
    book?.verb === "removed" && "removed from your library",
    added,
    edited && `edited ${edited}`,
    removed && `removed ${removed}`,
    moved &&
      (place === undefined
        ? "your place moved"
        : `your place,\u00a0${Math.round(place * 100)}%`),
  ].filter((clause): clause is string => Boolean(clause));
  return (clauses.length ? clauses : ["book details updated"]).map(
    (clause) => clause.charAt(0).toUpperCase() + clause.slice(1),
  );
}
