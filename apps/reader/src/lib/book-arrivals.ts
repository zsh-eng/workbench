import {
  addBookFromFile,
  DuplicateBookError,
  type BookImportStep,
} from "@/lib/book-service";
import type { Book } from "@/lib/db";
import type { FileId } from "@/lib/files";
import { JobError, type JobKind } from "@workbench/background-activity";

/**
 * Books on their way into the Library, as background jobs.
 *
 * Each chosen file is one `book-import` job: the activity manager runs them
 * one at a time, in the order chosen, reports their steps as the job's
 * phase, and owns retry. A job carries only its state and progress, so this
 * store keeps what the import finds on the way: the file's id, the title,
 * the cover as the EPUB holds it, and how it ended. The Library joins the
 * two to hold each book's place and draw its arrival.
 *
 * Nothing here is saved: a reload forgets arrivals, and the books that
 * finished are in the database.
 */
export interface ArrivalRecord {
  /** The job's id. */
  key: string;
  batch: number;
  /** Its place in the batch, in the order the files were chosen. */
  order: number;
  fileName: string;
  sourceFileId: FileId | null;
  title: string | null;
  author: string | null;
  /** The cover as the EPUB holds it, from the moment it is read. */
  cover: Blob | null;
  /** Entries at the top of its table of contents, once read. */
  chapters: number | null;
  bookId: string | null;
  /** For a duplicate, the copy already in the library, and its cover. */
  existingBookId: string | null;
  existingCover: FileId | null;
  error: string | null;
  /** The drawing has come to rest and the plain cover has taken over. */
  settled: boolean;
  /**
   * The arrival sheet shows this book. Its place in the grid stays empty
   * until the sheet closes and the cover comes down into it.
   */
  presented: boolean;
}

export interface BookImportInput {
  key: string;
  file: File;
  /** When the book counts as added: a batch counts down, so it keeps its order. */
  dateAdded: number;
}

export const BOOK_IMPORT_KIND = "book-import";

/**
 * How long a batch's places stay after its last book: long enough for the
 * last arrival to come to rest and for a duplicate's note to be read.
 */
const BATCH_LINGER_MS = 5000;

/** Batches count across every store, so a key names one file for the page's life. */
let nextBatch = 1;

interface Outcome {
  resolve: (book: Book) => void;
  reject: (error: unknown) => void;
  promise: Promise<Book>;
}

function deferred(): Outcome {
  let resolve!: (book: Book) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Book>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  // A caller may never wait for a book it did not need.
  promise.catch(() => undefined);
  return { resolve, reject, promise };
}

export class ArrivalRecords {
  private records: readonly ArrivalRecord[] = [];
  private readonly outcomes = new Map<string, Outcome>();
  /** Batches whose places have had their time. */
  private readonly ended = new Set<number>();
  private readonly listeners = new Set<() => void>();

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = () => this.records;

  /** Hold a place for each file, in order. The newest batch comes first. */
  start(names: readonly string[]): { batch: number; keys: string[] } {
    const batch = nextBatch++;
    const added = names.map(
      (fileName, order): ArrivalRecord => ({
        key: `import:${batch}:${order}`,
        batch,
        order,
        fileName,
        sourceFileId: null,
        title: null,
        author: null,
        cover: null,
        chapters: null,
        bookId: null,
        existingBookId: null,
        existingCover: null,
        error: null,
        settled: false,
        presented: false,
      }),
    );
    for (const record of added) this.outcomes.set(record.key, deferred());
    this.publish([...added, ...this.records]);
    return { batch, keys: added.map((record) => record.key) };
  }

  /** The book the import made, or its error: a duplicate or a failure. */
  outcome(key: string): Promise<Book> {
    return this.outcomes.get(key)!.promise;
  }

  found(key: string, step: BookImportStep) {
    if (step.stage === "saving") {
      this.update(key, { error: null });
      return;
    }
    this.update(key, {
      sourceFileId: step.sourceFileId,
      ...(step.stage === "preparing"
        ? {
            title: step.title,
            author: step.author,
            cover: step.cover,
            chapters: step.chapters,
          }
        : {}),
    });
  }

  ready(key: string, book: Book) {
    this.update(key, {
      bookId: book.id,
      sourceFileId: book.sourceFileId,
      title: book.title,
      author: book.author,
      chapters: book.toc.length || null,
    });
    this.outcomes.get(key)?.resolve(book);
  }

  duplicate(key: string, error: DuplicateBookError) {
    const existing = error.existingBook;
    this.update(key, {
      existingBookId: existing.id,
      existingCover: existing.cover?.fileId ?? null,
      sourceFileId: existing.sourceFileId,
      title: existing.title,
      author: existing.author,
    });
    this.outcomes.get(key)?.reject(error);
  }

  failed(key: string, error: unknown) {
    this.update(key, {
      error: error instanceof Error ? error.message : String(error),
    });
    this.outcomes.get(key)?.reject(error);
  }

  /** The batch's loop has finished; its places leave once they were seen. */
  end(batch: number) {
    window.setTimeout(() => {
      this.ended.add(batch);
      this.prune();
    }, BATCH_LINGER_MS);
  }

  /**
   * By now each book of an ended batch has come to rest, or was never in
   * view. Failures keep their place until they are tried again or
   * dismissed, and a book in the arrival sheet until the sheet closes.
   */
  private prune() {
    const next = this.records.filter(
      (record) =>
        !this.ended.has(record.batch) ||
        record.presented ||
        (record.error !== null && record.bookId === null),
    );
    if (next.length !== this.records.length) this.publish(next);
  }

  /** The arrival sheet shows the book, or has let it go to its place. */
  present(key: string, presented: boolean) {
    const record = this.records.find((item) => item.key === key);
    if (!record || record.presented === presented) return;
    this.update(key, { presented });
    // A book let go after its batch ended keeps its place while it lands.
    if (!presented && this.ended.has(record.batch))
      window.setTimeout(() => this.prune(), BATCH_LINGER_MS);
  }

  /**
   * Resolves when every book the batch added has come to rest on the shelf,
   * so the confirmation arrives with the last cover; at most after `limitMs`.
   */
  rested(batch: number, limitMs: number): Promise<void> {
    return new Promise((resolve) => {
      const check = () => {
        const open = this.records.some(
          (record) =>
            record.batch === batch && record.bookId !== null && !record.settled,
        );
        if (open) return;
        done();
      };
      const timer = window.setTimeout(() => done(), limitMs);
      const stop = this.subscribe(check);
      const done = () => {
        window.clearTimeout(timer);
        stop();
        resolve();
      };
      check();
    });
  }

  /** The drawing is at rest: the Library's own cover takes over. */
  settle(key: string) {
    if (this.records.find((record) => record.key === key)?.settled !== false)
      return;
    this.update(key, { settled: true });
  }

  /** Remove a place, such as a failure you have seen. */
  dismiss(key: string) {
    this.outcomes.delete(key);
    this.publish(this.records.filter((record) => record.key !== key));
  }

  private update(key: string, change: Partial<ArrivalRecord>) {
    this.publish(
      this.records.map((record) =>
        record.key === key ? { ...record, ...change } : record,
      ),
    );
  }

  private publish(next: readonly ArrivalRecord[]) {
    this.records = next;
    for (const listener of this.listeners) listener();
  }
}

/**
 * The job kind. `importBook` is the real import; Design ideas pass a timed
 * stand-in that reports the same steps.
 */
export function bookImportKind(
  records: ArrivalRecords,
  importBook: typeof addBookFromFile = addBookFromFile,
): JobKind<BookImportInput> {
  return {
    lane: "import",
    needsNetwork: false,
    // A file in memory cannot outlive the page.
    persist: false,
    retry: { attempts: 1 },
    title: (input) => input.file.name.replace(/\.epub$/i, ""),
    async run(input, { progress }) {
      try {
        const book = await importBook(input.file, {
          dateAdded: input.dateAdded,
          onStep: (step) => {
            records.found(input.key, step);
            progress({ phase: step.stage });
          },
        });
        records.ready(input.key, book);
      } catch (error) {
        // The same file is already here: the job is done, the place says so.
        if (error instanceof DuplicateBookError) {
          records.duplicate(input.key, error);
          return;
        }
        records.failed(input.key, error);
        throw new JobError({
          reason: "other",
          message: error instanceof Error ? error.message : String(error),
          retryable: false,
        });
      }
    },
  };
}

/** The app's arrivals: the real imports. */
export const appArrivals = new ArrivalRecords();
