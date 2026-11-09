import {
  compareBooksByDateAddedDesc,
  compareBooksByLastReadDesc,
} from "@/lib/library-sort";
import type { Book } from "@/lib/db";
import { parseFileId } from "@/lib/files/file-id";
import { describe, expect, it } from "vitest";

function makeBook(id: string, dateAdded: number): Book {
  return {
    id,
    sourceFileId: parseFileId("xxh64:1111111111111111"),
    cover: null,
    title: id,
    author: "Author",
    fileSize: 100,
    dateAdded,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
  };
}

describe("compareBooksByDateAddedDesc", () => {
  it("sorts most recently added first", () => {
    const old = makeBook("old", 100);
    const newest = makeBook("newest", 300);
    const mid = makeBook("mid", 200);

    const sorted = [old, newest, mid].sort(compareBooksByDateAddedDesc);
    expect(sorted.map((b) => b.id)).toEqual(["newest", "mid", "old"]);
  });

  it("breaks date ties deterministically by id", () => {
    const a = makeBook("a", 100);
    const b = makeBook("b", 100);

    expect([a, b].sort(compareBooksByDateAddedDesc).map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
    expect([b, a].sort(compareBooksByDateAddedDesc).map((x) => x.id)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("compareBooksByLastReadDesc", () => {
  it("sorts most recently read first", () => {
    const older = makeBook("older", 100);
    const newer = makeBook("newer", 200);
    const lastReadByBook = new Map([
      ["older", 1000],
      ["newer", 2000],
    ]);

    const sorted = [older, newer].sort(
      compareBooksByLastReadDesc(lastReadByBook),
    );
    expect(sorted.map((b) => b.id)).toEqual(["newer", "older"]);
  });

  it("sorts never-read books below read books, by date added", () => {
    const read = makeBook("read", 100);
    const neverReadNew = makeBook("never-read-new", 300);
    const neverReadOld = makeBook("never-read-old", 200);
    const lastReadByBook = new Map([["read", 5000]]);

    const sorted = [neverReadNew, read, neverReadOld].sort(
      compareBooksByLastReadDesc(lastReadByBook),
    );
    expect(sorted.map((b) => b.id)).toEqual([
      "read",
      "never-read-new",
      "never-read-old",
    ]);
  });

  it("falls back to date added when last-read timestamps tie", () => {
    const a = makeBook("a", 100);
    const b = makeBook("b", 200);
    const lastReadByBook = new Map([
      ["a", 1000],
      ["b", 1000],
    ]);

    const sorted = [a, b].sort(compareBooksByLastReadDesc(lastReadByBook));
    expect(sorted.map((x) => x.id)).toEqual(["b", "a"]);
  });
});
