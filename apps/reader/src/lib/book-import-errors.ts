import type { Book } from "@/lib/db";
import { SyncValueTooLargeError } from "@zsh-eng/local-sync";

/**
 * Why a file did not become a book. The importer decides the kind where the
 * problem shows: the parser for the file itself, the write for storage.
 * Every screen words it from the kind with `describeImportError`.
 */
export type BookImportFailure =
  | { kind: "not-epub"; format: NotEpubFormat }
  | { kind: "damaged" }
  | { kind: "drm" }
  | { kind: "incomplete"; missing: "package" | "contents" }
  | { kind: "storage" }
  | { kind: "too-large" }
  | { kind: "unexpected" };

/** What a file that is not an EPUB turned out to be. */
export type NotEpubFormat = "pdf" | "kindle" | "zip" | "name" | "unknown";

export type BookImportErrorKind = BookImportFailure["kind"];

export class BookImportError extends Error {
  readonly failure: BookImportFailure;
  readonly kind: BookImportErrorKind;

  constructor(failure: BookImportFailure, cause?: unknown) {
    super(technicalMessage(failure, cause), { cause });
    this.name = "BookImportError";
    this.failure = failure;
    this.kind = failure.kind;
  }
}

export class DuplicateBookError extends Error {
  existingBook: Book;

  constructor(message: string, existingBook: Book) {
    super(message);
    this.name = "DuplicateBookError";
    this.existingBook = existingBook;
  }
}

function technicalMessage(failure: BookImportFailure, cause: unknown) {
  const detail =
    failure.kind === "not-epub"
      ? ` (${failure.format})`
      : failure.kind === "incomplete"
        ? ` (no ${failure.missing})`
        : "";
  const reason = cause instanceof Error ? `: ${plainMessage(cause)}` : "";
  return `${failure.kind}${detail}${reason}`;
}

/**
 * A schema failure's message is its issues as JSON. Its issues' own
 * messages read as a sentence, for the details a reader copies.
 */
function plainMessage(error: Error): string {
  const issues = (error as { issues?: unknown }).issues;
  if (!Array.isArray(issues)) return error.message;
  return issues
    .map((issue: { message?: unknown }) => String(issue.message))
    .join("; ");
}

/**
 * Any failure of an import as a BookImportError. The browser reports a full
 * disk as QuotaExceededError, which Dexie passes on as the error itself or
 * as the `inner` error of the aborted transaction. A row too large to sync
 * fails the same write.
 */
export function asBookImportError(error: unknown): BookImportError {
  if (error instanceof BookImportError) return error;
  const kind = findCause(error, isQuotaError)
    ? "storage"
    : findCause(error, (cause) => cause instanceof SyncValueTooLargeError)
      ? "too-large"
      : "unexpected";
  return new BookImportError({ kind }, error);
}

function isQuotaError(error: unknown): boolean {
  return (error as { name?: unknown }).name === "QuotaExceededError";
}

function findCause(error: unknown, test: (cause: unknown) => boolean) {
  let current = error as { inner?: unknown; cause?: unknown } | undefined;
  for (let depth = 0; current && depth < 4; depth += 1) {
    if (test(current)) return true;
    current = (current.inner ?? current.cause) as typeof current;
  }
  return false;
}

export interface ImportErrorCopy {
  /** A few words, for a toast, a tile or a row. */
  title: string;
  /** One sentence on what happened. */
  what: string;
  /** What to do about it. */
  next: string;
  /** The same file can work on another try. */
  retry: boolean;
}

const NOT_EPUB: Record<NotEpubFormat, string> = {
  pdf: "It’s a PDF renamed to .epub.",
  kindle: "It’s a Kindle book (MOBI or AZW) renamed to .epub.",
  zip: "It’s a ZIP archive, but not an EPUB.",
  name: "Its name doesn’t end in .epub.",
  unknown:
    "Its name ends in .epub, but it’s another kind of file, such as a PDF, MOBI or AZW.",
};

export function describeImportError(error: BookImportError): ImportErrorCopy {
  const failure = error.failure;
  switch (failure.kind) {
    case "not-epub":
      return {
        title: "Not an EPUB",
        what: NOT_EPUB[failure.format],
        next:
          failure.format === "kindle"
            ? "Convert it to EPUB, for example with Calibre, then add that."
            : "Reader opens EPUB books only. Add an EPUB copy instead.",
        retry: false,
      };
    case "damaged":
      return {
        title: "File is damaged",
        what: "Part of the file is missing or broken, often because a download stopped early.",
        next: "Download it again, then add the new copy.",
        retry: false,
      };
    case "drm":
      return {
        title: "DRM-protected",
        what: "It’s locked with DRM, as books bought from stores often are.",
        next: "Export a DRM-free copy from the store, then add that.",
        retry: false,
      };
    case "incomplete":
      return {
        title: "EPUB is missing parts",
        what:
          failure.missing === "package"
            ? "It has no package file (OPF), which lists what the book contains."
            : "It doesn’t list any chapters to read.",
        next: "Download it again, or try another copy of the book.",
        retry: false,
      };
    case "storage":
      return {
        title: "Not enough storage",
        what: "This device ran out of space while saving the book.",
        next: "Free up some space, then try again.",
        retry: true,
      };
    case "too-large":
      return {
        title: "Too large to sync",
        what: "Its details, such as its title, are too long to sync between your devices.",
        next: "Edit the book’s details in an EPUB editor, such as Calibre, then add it again.",
        retry: false,
      };
    case "unexpected":
      return {
        title: "Couldn’t add this book",
        what: "Something unexpected went wrong.",
        next: "Try again, or copy the details to report it.",
        retry: true,
      };
  }
}

/** The technical account behind Copy details. */
export function importErrorDetails(
  error: BookImportError,
  fileName: string,
): string {
  const cause = error.cause;
  const trace =
    cause instanceof Error
      ? plainMessage(cause) !== cause.message
        ? `${cause.name}: ${plainMessage(cause)}`
        : cause.stack?.includes(cause.message)
          ? cause.stack
          : `${cause.name}: ${cause.message}\n${cause.stack ?? ""}`
      : String(cause ?? error.message);
  return [
    `File: ${fileName}`,
    `Problem: ${error.message}`,
    `Browser: ${navigator.userAgent}`,
    "",
    trace.trim(),
  ].join("\n");
}
