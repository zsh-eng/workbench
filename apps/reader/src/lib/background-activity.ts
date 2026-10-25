import {
  getRuntimeOnline,
  getRuntimeStorage,
  subscribeRuntimeOnline,
} from "@/features/sync-lab/runtime";
import { getAppUpdate, holdUpdatesWhile } from "@/lib/app-update";
import {
  appArrivals,
  BOOK_IMPORT_KIND,
  bookImportKind,
} from "@/lib/book-arrivals";
import { prepareBook } from "@/lib/book-preparation";
import { getBook, type Book } from "@/lib/db";
import { files } from "@/lib/files";
import { SHARED_STORAGE_SUFFIX } from "@/lib/shared-api";
import { syncService } from "@/lib/sync-service";
import {
  createActivityManager,
  JobError,
  syncAsJob,
  type JobKind,
} from "@workbench/background-activity";

/** A book to keep on this device. The title is for the list after a reload. */
export interface BookDownloadInput {
  bookId: string;
  title: string;
}

export const bookJobId = (bookId: string) => `book:${bookId}`;

const bookDownload: JobKind<BookDownloadInput> = {
  lane: "network",
  persist: true,
  retry: { attempts: 4 },
  title: (input) => input.title,
  async run(input, { signal, progress }) {
    const book = await getBook(input.bookId);
    if (!book)
      throw new JobError({
        reason: "rejected",
        message: "This book is no longer in your library",
        retryable: false,
      });
    let blob: Blob | undefined;
    if (!(await files.hasLocal(book.sourceFileId))) {
      progress({ phase: "downloading" });
      blob = await files.get(book.sourceFileId, {
        signal,
        onProgress: (bytes, total) =>
          progress({ bytes, totalBytes: total ?? null }),
      });
    }
    signal.throwIfAborted();
    // Unzipping runs in fflate's workers; the main thread only stores.
    progress({ phase: "preparing" });
    await prepareBook(book, blob);
  },
};

/**
 * The Reader's background work: books downloading for offline, and, tracked
 * from their owners, record sync and the app update. It starts held and
 * runs after the first paint (`startBackgroundActivity`).
 */
export const activity = createActivityManager({
  kinds: {
    "book-download": bookDownload,
    [BOOK_IMPORT_KIND]: bookImportKind(appArrivals),
  },
  // Imports run one at a time, in the order the files were chosen.
  lanes: { network: 2, import: 1 },
  network: { isOnline: getRuntimeOnline, subscribe: subscribeRuntimeOnline },
  persist: {
    storage: getRuntimeStorage(),
    key: "reader-activity-v1" + SHARED_STORAGE_SUFFIX,
  },
  paused: true,
});

/** Download books for offline. Books already here are only prepared. */
export function downloadBooks(books: readonly Book[]): void {
  for (const book of books)
    activity.start(
      "book-download",
      { bookId: book.id, title: book.title },
      { id: bookJobId(book.id), origin: "user" },
    );
}

/**
 * Add books from files as import jobs, behind Debug → Arriving books. Each
 * file holds its place in the Library at once; the outcomes settle in order.
 */
export function importBooks(files: readonly File[]) {
  const { batch, keys } = appArrivals.start(files.map((file) => file.name));
  const startedAt = Date.now();
  files.forEach((file, order) =>
    activity.start(
      BOOK_IMPORT_KIND,
      { key: keys[order]!, file, dateAdded: startedAt - order },
      { id: keys[order]!, origin: "user" },
    ),
  );
  return {
    outcomes: keys.map((key) => appArrivals.outcome(key)),
    /** Every added book has come to rest on the shelf, or 4 s have passed. */
    rested: () => appArrivals.rested(batch, 4000),
    end: () => appArrivals.end(batch),
  };
}

/** A download you asked for holds a calm update until it ends. */
holdUpdatesWhile(() =>
  activity
    .getSnapshot()
    .jobs.some(
      (job) =>
        job.kind === "book-download" &&
        job.origin === "user" &&
        (job.state === "running" ||
          job.state === "queued" ||
          job.state === "retrying"),
    ),
);

let started = false;

/** Run the queue and follow sync and the update. Once per page. */
export function startBackgroundActivity(): void {
  if (started) return;
  started = true;
  activity.track("sync", syncAsJob(syncService.controller));
  const update = getAppUpdate();
  if (update) activity.track("app-update", update.asJob());
  activity.resume();
}
