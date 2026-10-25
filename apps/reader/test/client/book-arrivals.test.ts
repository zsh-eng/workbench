import type { Arrival } from "@/features/arrivals/arrival-store";
import {
  ArrivalRecords,
  BOOK_IMPORT_KIND,
  bookImportKind,
} from "@/lib/book-arrivals";
import { DuplicateBookError, type AddBookOptions } from "@/lib/book-service";
import type { Book } from "@/lib/db";
import type { FileId } from "@/lib/files";
import { compareBooksByDateAddedDesc } from "@/lib/library-sort";
import { createActivityManager } from "@workbench/background-activity";
import { cleanup, render, renderHook } from "@testing-library/react";
import { createElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

function book(name: string, dateAdded: number): Book {
  return {
    id: `book-${name}`,
    sourceFileId: `file-${name}` as FileId,
    title: name,
    author: "Anon",
    fileSize: 1,
    dateAdded,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    cover: null,
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A stand-in for `addBookFromFile` that reports the same steps. Files named
 * in `duplicates` are already in the library; files in `failures` fail on
 * their first try.
 */
function fakeImport({
  duplicates = [] as string[],
  failures = [] as string[],
} = {}) {
  const steps = new Map<string, string[]>();
  const tries = new Map<string, number>();
  let running = 0;
  let mostAtOnce = 0;
  const importBook = async (file: File, options: AddBookOptions = {}) => {
    const name = file.name.replace(/\.epub$/, "");
    const sourceFileId = `file-${name}` as FileId;
    const tried = (tries.get(name) ?? 0) + 1;
    tries.set(name, tried);
    const log = (step: string) =>
      steps.set(name, [...(steps.get(name) ?? []), step]);
    running += 1;
    mostAtOnce = Math.max(mostAtOnce, running);
    try {
      log("saving");
      options.onStep?.({ stage: "saving" });
      // Later files are quicker, so order cannot come from timing.
      await wait(12 - name.length);
      if (duplicates.includes(name))
        throw new DuplicateBookError("Already here", book(name, 0));
      log("reading");
      options.onStep?.({ stage: "reading", sourceFileId });
      await wait(2);
      if (failures.includes(name) && tried === 1)
        throw new Error("Could not find OPF file in EPUB");
      log("preparing");
      options.onStep?.({
        stage: "preparing",
        sourceFileId,
        title: name,
        author: "Anon",
        cover: null,
      });
      await wait(2);
      return book(name, options.dateAdded ?? Date.now());
    } finally {
      running -= 1;
    }
  };
  return { importBook, steps, mostAtOnce: () => mostAtOnce };
}

/** Starts one import job per file, as the Library does. */
function importBatch(names: string[], fake: ReturnType<typeof fakeImport>) {
  const records = new ArrivalRecords();
  const manager = createActivityManager({
    kinds: { [BOOK_IMPORT_KIND]: bookImportKind(records, fake.importBook) },
    lanes: { import: 1 },
  });
  const { keys } = records.start(names.map((name) => `${name}.epub`));
  const startedAt = Date.now();
  names.forEach((name, order) =>
    manager.start(
      BOOK_IMPORT_KIND,
      {
        key: keys[order]!,
        file: new File([], `${name}.epub`),
        dateAdded: startedAt - order,
      },
      { id: keys[order]!, origin: "user" },
    ),
  );
  const outcomes = keys.map((key) => records.outcome(key));
  return { records, manager, keys, outcomes };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("a batch of arriving books", () => {
  it("adds every book, one at a time, in the order the files were chosen", async () => {
    const names = ["a", "bb", "ccc", "dddd", "eeeee"];
    const fake = fakeImport();
    const { records, manager, outcomes } = importBatch(names, fake);

    const books = await Promise.all(outcomes);

    expect(
      books.toSorted(compareBooksByDateAddedDesc).map((b) => b.title),
    ).toEqual(names);
    expect(records.getSnapshot().map((record) => record.title)).toEqual(names);
    expect(records.getSnapshot().every((record) => record.bookId)).toBe(true);
    for (const name of names)
      expect(fake.steps.get(name)).toEqual(["saving", "reading", "preparing"]);
    expect(fake.mostAtOnce()).toBe(1);
    manager.dispose();
  });

  it("keeps a duplicate and a failure in their places, and Try again adds the book", async () => {
    const fake = fakeImport({ duplicates: ["dup"], failures: ["bad"] });
    const { records, manager, keys, outcomes } = importBatch(
      ["first", "dup", "bad", "last"],
      fake,
    );

    const results = await Promise.allSettled(outcomes);

    expect(results.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
      "rejected",
      "fulfilled",
    ]);
    const [, dup, bad] = records.getSnapshot();
    expect(dup?.existingBookId).toBe("book-dup");
    expect(bad?.error).toMatch(/OPF/);
    expect(bad?.bookId).toBeNull();

    manager.retry(keys[2]!);
    await vi.waitFor(() =>
      expect(records.getSnapshot()[2]?.bookId).toBe("book-bad"),
    );
    expect(records.getSnapshot()[2]?.error).toBeNull();
    manager.dispose();
  });
});

describe("the covers grid while books arrive", () => {
  async function grid(records: ArrivalRecords, shown: Book[], hold = true) {
    const { ArrivalProvider } =
      await import("@/features/arrivals/arrival-store");
    const { useArrivalGrid } = await import("@/features/arrivals/ArrivalTile");
    const manager = createActivityManager({ kinds: {} });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        ArrivalProvider,
        {
          records,
          source: manager,
          look: "develop",
          reliefFor: () => null,
        },
        children,
      );
    return renderHook(() => useArrivalGrid(shown, hold), { wrapper });
  }

  const describeItems = (items: ({ book: Book } | { arrivalKey: string })[]) =>
    items.map((item) => ("book" in item ? item.book.title : item.arrivalKey));

  it("holds a place for each file, and a finished book stands in its own place", async () => {
    const records = new ArrivalRecords();
    const { keys } = records.start(["one.epub", "two.epub", "three.epub"]);
    const older = book("older", 1);
    const second = book("two", 3);
    records.ready(keys[1]!, second);

    const { result } = await grid(records, [second, older]);

    expect(describeItems(result.current)).toEqual([
      keys[0],
      "two",
      keys[2],
      "older",
    ]);
  });

  it("shows only the books where a place would not stay", async () => {
    const records = new ArrivalRecords();
    records.start(["one.epub"]);
    const older = book("older", 1);

    const { result } = await grid(records, [older], false);

    expect(describeItems(result.current)).toEqual(["older"]);
  });
});

describe("reduced motion", () => {
  it("never draws an arriving cover: the paper gives way to the cover once it is ready", async () => {
    vi.stubGlobal(
      "matchMedia",
      (query: string) =>
        ({
          matches: query.includes("prefers-reduced-motion"),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const { ArrivingCover } = await import("@/features/arrivals/ArrivingCover");
    const onSettled = vi.fn();
    const arrival = (stage: "preparing" | "ready"): Arrival => ({
      key: "import:1:0",
      batch: 1,
      order: 0,
      fileName: "one.epub",
      sourceFileId: "file-one" as FileId,
      title: "One",
      author: "Anon",
      cover: new Blob(["cover"], { type: "image/png" }),
      bookId: stage === "ready" ? "book-one" : null,
      existingBookId: null,
      error: null,
      settled: false,
      progress: { stage, fraction: stage === "ready" ? 1 : 0.7 },
      changedAt: 0,
    });
    const cover = (stage: "preparing" | "ready") =>
      createElement(ArrivingCover, {
        arrival: arrival(stage),
        look: "develop",
        plain: createElement("img", { alt: "One" }),
        plainReady: true,
        onSettled,
      });

    const view = render(cover("preparing"));
    const box = view.container.querySelector("[data-arrival]");
    expect(box?.getAttribute("data-arrival-look")).toBe("still");
    expect(view.container.querySelector("[data-arrival-canvas]")).toBeNull();
    expect(onSettled).not.toHaveBeenCalled();

    view.rerender(cover("ready"));
    expect(view.container.querySelector("[data-arrival-canvas]")).toBeNull();
    await vi.waitFor(() => expect(onSettled).toHaveBeenCalledOnce());
  });
});
