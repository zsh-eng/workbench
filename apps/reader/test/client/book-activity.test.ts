import {
  bookActivity,
  lineClauses,
  type BookChange,
} from "@/features/sync-history/book-activity";
import { createSample } from "@/features/sync-history/ideas/sync-history-fixture";
import { describeReaderRecord } from "@/features/sync-history/reader-describe";
import { summarizeSyncHistory } from "@zsh-eng/local-sync";
import { describe, expect, it } from "vitest";

// Mid-afternoon, so the sample's "today" stays on one day.
const NOW = new Date(2026, 9, 27, 15, 0).getTime();

function sampleBooks() {
  const sample = createSample(NOW);
  const history = summarizeSyncHistory(sample.entries, {
    now: NOW,
    describe: describeReaderRecord(sample.lookup),
    pending: sample.pending,
  });
  return bookActivity(history, NOW);
}

const change = (
  kind: string,
  verb: BookChange["verb"],
  count: number,
  one = kind,
): BookChange => ({ kind, one, other: `${one}s`, verb, count });

describe("Activity by book", () => {
  it("gives each book a row for each day it was touched, what still waits first", () => {
    const rows = sampleBooks().map((book) => [
      book.title,
      new Date(book.day).getDate(),
      book.waiting,
    ]);
    expect(rows).toEqual([
      ["Emma", 27, true],
      ["Persuasion", 27, false],
      ["Dracula", 27, false],
      ["Emma", 26, false],
      ["Middlemarch", 26, false],
    ]);
  });

  it("leaves out the restore and the failed syncs, which name no book of their own", () => {
    // The restore brought every book; none of them was touched since.
    const titles = sampleBooks().map((book) => book.title);
    expect(titles).not.toContain("Moby-Dick");
  });

  it("gives each device its own lines in a book, newest first", () => {
    const emma = sampleBooks()[0]!;
    // This device's waiting highlight and place, then the iPhone's edit.
    expect(emma.lines.map((line) => line.deviceId)).toEqual([null, "iphone"]);
    const persuasion = sampleBooks()[1]!;
    expect(persuasion.lines).toHaveLength(1);
    expect(lineClauses(persuasion.lines[0]!.changes, 0.38)).toEqual([
      "3 highlights and a bookmark",
      "Your place,\u00a038%",
    ]);
  });

  it("says each kind of change plainly, on a line of its own", () => {
    expect(
      lineClauses(
        [
          change("note", "removed", 16),
          change("note", "added", 1),
          change("highlight", "added", 6),
          change("highlight", "changed", 1),
        ],
        undefined,
      ),
    ).toEqual([
      "A note and 6 highlights",
      "Edited a highlight",
      "Removed 16 notes",
    ]);
    expect(
      lineClauses(
        [change("highlight", "removed", 2), change("progress", "changed", 1)],
        undefined,
      ),
    ).toEqual(["Removed 2 highlights", "Your place moved"]);
    expect(
      lineClauses(
        [change("book", "added", 1), change("progress", "changed", 1)],
        0.04,
      ),
    ).toEqual(["Added to your library", "Your place,\u00a04%"]);
    expect(lineClauses([change("book", "changed", 1)], undefined)).toEqual([
      "Book details updated",
    ]);
    expect(lineClauses([change("item", "added", 1)], undefined)).toEqual([
      "An item",
    ]);
  });
});
