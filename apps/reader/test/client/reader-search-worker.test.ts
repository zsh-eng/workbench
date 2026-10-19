import { createSearchHandler } from "@/features/reader/search/search-handler";
import type {
  SearchWorkerChapter,
  SearchWorkerResponse,
} from "@/features/reader/search/search-protocol";
import { describe, expect, it } from "vitest";

const CHAPTER_COUNT = 300;
const PARAGRAPH =
  "The needle lay somewhere in the haystack, and nobody had looked for it in years. ";

/** A book long enough that searching it takes many slices. */
function book(): SearchWorkerChapter[] {
  return Array.from({ length: CHAPTER_COUNT }, (_, chapterIndex) => ({
    chapterIndex,
    fullText: PARAGRAPH.repeat(300),
    blockStarts: [[`text-${chapterIndex}`, 0]],
  }));
}

function waitFor(condition: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      if (condition()) resolve();
      else if (Date.now() - started > 5000) reject(new Error("Timed out"));
      else setTimeout(check, 5);
    };
    check();
  });
}

function setUp() {
  const posted: SearchWorkerResponse[] = [];
  const handle = createSearchHandler((response) => posted.push(response));
  handle({ type: "setBook", bookKey: "book", chapterCount: CHAPTER_COUNT });
  handle({ type: "addChapters", bookKey: "book", chapters: book() });
  const of = (searchId: number) =>
    posted.filter((response) => response.searchId === searchId);
  return { handle, of };
}

describe("search worker", () => {
  it("streams the first match before the book is searched", async () => {
    const { handle, of } = setUp();
    handle({ type: "search", searchId: 1, query: "NEEDLE", limit: 100_000 });
    const first = of(1)[0];
    expect(first).toMatchObject({ type: "progress" });
    expect(first?.type === "progress" && first.searchedChapters).toBe(1);

    await waitFor(() => of(1).some((response) => response.type === "done"));
    const done = of(1).at(-1)!;
    expect(done).toMatchObject({
      type: "done",
      totalMatches: CHAPTER_COUNT * 300,
      truncated: false,
      missingChapters: 0,
    });
  });

  it("stops a search that is cancelled", async () => {
    const { handle, of } = setUp();
    // The first slice runs before the request returns.
    handle({ type: "search", searchId: 1, query: "needle", limit: 100_000 });
    handle({ type: "cancel", searchId: 1 });
    const sent = of(1).length;
    expect(sent).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(of(1)).toHaveLength(sent);
    expect(of(1).some((response) => response.type === "done")).toBe(false);
  });

  it("starts at the reader and keeps the matches nearest it", async () => {
    const { handle, of } = setUp();
    const offset = PARAGRAPH.length * 100;
    const from = { chapterIndex: 120, offset };
    const matches = async (searchId: number, limit: number) => {
      handle({ type: "search", searchId, query: "needle", limit, from });
      await waitFor(() =>
        of(searchId).some((response) => response.type === "done"),
      );
      return of(searchId).flatMap((response) =>
        response.type === "progress"
          ? response.chapters.flatMap(({ chapterIndex, matches }) =>
              matches.map((match) => [chapterIndex, match.start]),
            )
          : [],
      );
    };

    // The first match is the reader's next one; the limit keeps those after.
    const near = await matches(1, 450);
    expect(near[0]).toEqual([120, offset + "The ".length]);
    expect(near).toHaveLength(450);
    expect(near.every(([chapter]) => chapter === 120 || chapter === 121)).toBe(
      true,
    );

    // With no limit it wraps round to the chapter's start, then stops.
    const all = await matches(2, 100_000);
    expect(all).toHaveLength(CHAPTER_COUNT * 300);
    expect(all.at(-1)).toEqual([120, offset - PARAGRAPH.length + 4]);
    expect(of(2).at(-1)).toMatchObject({
      type: "done",
      truncated: false,
      missingChapters: 0,
    });
    const last = of(2).findLast((response) => response.type === "progress");
    expect(last?.type === "progress" && last.searchedChapters).toBe(
      CHAPTER_COUNT,
    );
  });

  it("searches a book opened while the last one is still being prepared", async () => {
    const { handle, of } = setUp();
    // The first book's text is still being folded in the background.
    handle({ type: "setBook", bookKey: "other", chapterCount: 1 });
    handle({
      type: "addChapters",
      bookKey: "other",
      chapters: [
        {
          chapterIndex: 0,
          fullText: "A pin, then another pin.",
          blockStarts: [["text-0", 0]],
        },
      ],
    });
    const total = async (searchId: number, query: string) => {
      handle({ type: "search", searchId, query, limit: 100 });
      await waitFor(() =>
        of(searchId).some((response) => response.type === "done"),
      );
      return of(searchId).at(-1);
    };
    expect(await total(1, "pin")).toMatchObject({
      type: "done",
      totalMatches: 2,
      missingChapters: 0,
    });
    expect(await total(2, "needle")).toMatchObject({ totalMatches: 0 });
  });

  it("stops a search that a newer query replaces", async () => {
    const { handle, of } = setUp();
    handle({ type: "search", searchId: 1, query: "needle", limit: 100_000 });
    handle({ type: "search", searchId: 2, query: "haystack", limit: 5 });
    await waitFor(() => of(2).some((response) => response.type === "done"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(of(1).some((response) => response.type === "done")).toBe(false);
    expect(of(2).at(-1)).toMatchObject({
      type: "done",
      totalMatches: 5,
      truncated: true,
    });
  });
});
