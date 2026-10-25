/**
 * The real arrival on simulated imports, for Design ideas → Arriving books.
 * A demo has its own records and its own activity manager running the real
 * `book-import` kind; only the import itself is a stand-in that reports the
 * same steps on timers. The covers and depth maps are the public-domain
 * living-cover scenes. Nothing touches the app's library.
 */
import { loadSceneRegistry } from "@/features/living-covers/scene-registry";
import {
  ArrivalRecords,
  BOOK_IMPORT_KIND,
  bookImportKind,
} from "@/lib/book-arrivals";
import { DuplicateBookError, type AddBookOptions } from "@/lib/book-service";
import type { Book } from "@/lib/db";
import type { FileId } from "@/lib/files";
import {
  createActivityManager,
  type ActivityManager,
} from "@workbench/background-activity";

export interface SampleBook {
  id: string;
  title: string;
  author: string;
  /** A bundled living-cover scene, or none for a book without a cover. */
  scene: string | null;
}

/** Books already on the demo's shelf, set in type. */
export const SHELF: SampleBook[] = [
  {
    id: "middlemarch",
    title: "Middlemarch",
    author: "George Eliot",
    scene: null,
  },
  { id: "walden", title: "Walden", author: "Henry David Thoreau", scene: null },
  { id: "odyssey", title: "The Odyssey", author: "Homer", scene: null },
  {
    id: "bleak-house",
    title: "Bleak House",
    author: "Charles Dickens",
    scene: null,
  },
];

const ALICE: SampleBook = {
  id: "alice",
  title: "Alice’s Adventures in Wonderland",
  author: "Lewis Carroll",
  scene: "alice",
};
const PRIDE: SampleBook = {
  id: "pride",
  title: "Pride and Prejudice",
  author: "Jane Austen",
  scene: "pride-and-prejudice",
};
const TIME: SampleBook = {
  id: "time-machine",
  title: "The Time Machine",
  author: "H. G. Wells",
  scene: "time-machine",
};
const MOBY: SampleBook = {
  id: "moby-dick",
  title: "Moby-Dick",
  author: "Herman Melville",
  scene: null,
};
const FRANKENSTEIN: SampleBook = {
  id: "frankenstein",
  title: "Frankenstein",
  author: "Mary Shelley",
  scene: null,
};

/** One file in a scenario: its book, and how long each step takes. */
interface SampleFile {
  fileName: string;
  book: SampleBook;
  /** Milliseconds for saving, reading and preparing. */
  steps: [number, number, number];
  /** Already in the library. */
  duplicate?: boolean;
  /** The first attempt fails while reading; Try again works. */
  fails?: boolean;
}

export type ScenarioId = "one" | "five" | "trouble";

export const SCENARIOS: { id: ScenarioId; label: string }[] = [
  { id: "one", label: "One book" },
  { id: "five", label: "Five books" },
  { id: "trouble", label: "Slow, failed, duplicate" },
];

// Twice the steps measured in Chromium at 4× CPU slowdown, as an iPhone
// would take for a small EPUB.
const SCENARIO_FILES: Record<ScenarioId, SampleFile[]> = {
  one: [{ fileName: "alice.epub", book: ALICE, steps: [180, 260, 380] }],
  five: [
    { fileName: "alice.epub", book: ALICE, steps: [180, 260, 380] },
    {
      fileName: "pride-and-prejudice.epub",
      book: PRIDE,
      steps: [220, 300, 420],
    },
    { fileName: "moby-dick.epub", book: MOBY, steps: [150, 240, 200] },
    { fileName: "the-time-machine.epub", book: TIME, steps: [200, 280, 400] },
    {
      fileName: "frankenstein.epub",
      book: FRANKENSTEIN,
      steps: [150, 220, 200],
    },
  ],
  trouble: [
    { fileName: "alice.epub", book: ALICE, steps: [180, 260, 380] },
    {
      fileName: "pride-and-prejudice-illustrated.epub",
      book: PRIDE,
      steps: [1400, 3600, 1500],
    },
    {
      fileName: "scan-0041.epub",
      book: FRANKENSTEIN,
      steps: [200, 700, 200],
      fails: true,
    },
    {
      fileName: "the-time-machine.epub",
      book: TIME,
      steps: [160, 0, 0],
      duplicate: true,
    },
  ],
};

export interface SceneAssets {
  coverUrl: string;
  relief: string | null;
}

/** The bundled scenes' covers and depth maps, by scene id. */
export async function loadSceneAssets(): Promise<Map<string, SceneAssets>> {
  const entries = await loadSceneRegistry();
  return new Map(
    entries
      .filter((entry) => entry.source === "bundled" && entry.coverUrl)
      .map((entry) => [
        entry.scene.id,
        { coverUrl: entry.coverUrl!, relief: entry.scene.maps.depth || null },
      ]),
  );
}

export function sampleBook(
  sample: SampleBook,
  dateAdded: number,
  assets: Map<string, SceneAssets>,
): Book {
  const hasCover = sample.scene !== null && assets.has(sample.scene);
  return {
    id: `demo-${sample.id}`,
    sourceFileId: `demo:${sample.id}` as FileId,
    title: sample.title,
    author: sample.author,
    fileSize: 0,
    dateAdded,
    metadata: {},
    manifest: [],
    spine: [],
    toc: [],
    cover: hasCover
      ? { fileId: `demo-cover:${sample.id}` as FileId, blurHash: null }
      : null,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export interface ArrivalDemo {
  /** Tells one run's world from the next. */
  id: number;
  records: ArrivalRecords;
  manager: ActivityManager;
  /** The shelf before the import, newest first. */
  shelf: Book[];
  /** The books the import has added so far, newest first. */
  added: { subscribe(listener: () => void): () => void; get(): Book[] };
  /** Every file has an outcome, and the added books have come to rest. */
  finished: Promise<{ added: number; duplicates: number; failed: number }>;
  /** Cover URLs for the shelf and the books the import adds. */
  coverUrls: Map<string, string>;
  reliefFor(sourceFileId: string | null): string | null;
  dispose(): void;
}

let nextDemo = 1;

/** A fresh demo world for one run of a scenario. */
export function createArrivalDemo(
  scenario: ScenarioId,
  assets: Map<string, SceneAssets>,
  /** Confirm when the covers rest, as arrivals do; today confirms at once. */
  waitForRest = true,
): ArrivalDemo {
  const files = SCENARIO_FILES[scenario];
  const records = new ArrivalRecords();
  const now = Date.now();
  const shelf = SHELF.map((sample, index) =>
    sampleBook(sample, now - 86_400_000 * (index + 1), assets),
  );
  // The duplicate is already on the shelf.
  for (const file of files)
    if (file.duplicate)
      shelf.unshift(sampleBook(file.book, now - 3_600_000, assets));
  const coverUrls = new Map<string, string>();
  for (const sample of [...SHELF, ...files.map((file) => file.book)]) {
    const coverUrl = sample.scene ? assets.get(sample.scene)?.coverUrl : null;
    if (coverUrl) coverUrls.set(`demo-${sample.id}`, coverUrl);
  }
  const attempts = new Map<string, number>();
  let added: Book[] = [];
  const addedListeners = new Set<() => void>();
  const covers = new Map<string, Promise<Blob>>();
  const coverBlob = (url: string) => {
    let blob = covers.get(url);
    if (!blob) {
      blob = fetch(url).then((response) => response.blob());
      covers.set(url, blob);
    }
    return blob;
  };

  // The stand-in for addBookFromFile: the same steps, on timers.
  const importBook = async (file: File, options: AddBookOptions = {}) => {
    const sample = files.find((item) => item.fileName === file.name)!;
    const attempt = (attempts.get(file.name) ?? 0) + 1;
    attempts.set(file.name, attempt);
    const [saving, reading, preparing] = sample.steps;
    const sourceFileId = `demo:${sample.book.id}` as FileId;
    options.onStep?.({ stage: "saving" });
    await sleep(saving);
    if (sample.duplicate) {
      throw new DuplicateBookError(
        "A book with this file already exists in your library",
        shelf.find((book) => book.sourceFileId === sourceFileId)!,
      );
    }
    options.onStep?.({ stage: "reading", sourceFileId });
    await sleep(reading);
    if (sample.fails && attempt === 1)
      throw new Error("Failed to add book: Could not find OPF file in EPUB");
    const scene = sample.book.scene ? assets.get(sample.book.scene) : undefined;
    options.onStep?.({
      stage: "preparing",
      sourceFileId,
      title: sample.book.title,
      author: sample.book.author,
      cover: scene ? await coverBlob(scene.coverUrl) : null,
    });
    await sleep(preparing);
    const book = sampleBook(
      sample.book,
      options.dateAdded ?? Date.now(),
      assets,
    );
    // The database's write shows the book on the shelf, as the real one does.
    added = [...added, book].sort((a, b) => b.dateAdded - a.dateAdded);
    for (const listener of addedListeners) listener();
    return book;
  };

  const manager = createActivityManager({
    kinds: { [BOOK_IMPORT_KIND]: bookImportKind(records, importBook) },
    lanes: { import: 1 },
  });
  const { batch, keys } = records.start(files.map((file) => file.fileName));
  files.forEach((file, order) =>
    manager.start(
      BOOK_IMPORT_KIND,
      {
        key: keys[order]!,
        file: new File([], file.fileName),
        dateAdded: now - order,
      },
      { id: keys[order]!, origin: "user" },
    ),
  );
  const finished = Promise.allSettled(
    keys.map((key) => records.outcome(key)),
  ).then(async (results) => {
    if (waitForRest) await records.rested(batch, 4000);
    records.end(batch);
    return {
      added: results.filter((result) => result.status === "fulfilled").length,
      duplicates: results.filter(
        (result) =>
          result.status === "rejected" &&
          result.reason instanceof DuplicateBookError,
      ).length,
      failed: results.filter(
        (result) =>
          result.status === "rejected" &&
          !(result.reason instanceof DuplicateBookError),
      ).length,
    };
  });
  return {
    id: nextDemo++,
    records,
    manager,
    shelf,
    added: {
      subscribe(listener) {
        addedListeners.add(listener);
        return () => {
          addedListeners.delete(listener);
        };
      },
      get: () => added,
    },
    finished,
    coverUrls,
    reliefFor(sourceFileId) {
      const sample = files.find(
        (file) => `demo:${file.book.id}` === sourceFileId,
      )?.book;
      return sample?.scene ? (assets.get(sample.scene)?.relief ?? null) : null;
    },
    dispose: () => manager.dispose(),
  };
}
