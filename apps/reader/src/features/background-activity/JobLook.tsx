import { BookCover } from "@/features/library/LibraryBooks";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { appArrivals, BOOK_IMPORT_KIND } from "@/lib/book-arrivals";
import type { Job } from "@workbench/background-activity";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

/**
 * How a book's job looks in the activity sheet: its cover, title and line.
 * A download reads its book; an import reads what the import has found so
 * far (book-arrivals.ts), and keeps it once the import's place has gone.
 */

const IMPORT_STEPS: Record<string, string> = {
  saving: "Saving the file",
  reading: "Reading the book",
  preparing: "Making the cover",
};

function useArrival(job: Job) {
  const records = useSyncExternalStore(
    appArrivals.subscribe,
    appArrivals.getSnapshot,
    appArrivals.getSnapshot,
  );
  return job.kind === BOOK_IMPORT_KIND
    ? records.find((record) => record.key === job.id)
    : undefined;
}

/** The book's cover, small, from the Library's decoded covers. */
function LibraryCover({ bookId }: { bookId: string }) {
  const { data } = useBooksWithStatuses();
  const book = data?.books.find((item) => item.id === bookId);
  const books = useMemo(() => (book ? [book] : []), [book]);
  const { coverUrls } = useLibraryCoverUrls(books);
  if (!book) return null;
  return (
    <BookCover
      book={book}
      coverUrl={coverUrls.get(book.id)}
      compact
      className="size-full"
    />
  );
}

/**
 * An import's cover as the EPUB holds it, from the moment it is read; for a
 * book without one, the Library's cover once the book exists.
 */
function ImportCover({ job }: { job: Job }) {
  // The place leaves after its batch; the row keeps the cover it had.
  const arrival = useArrival(job);
  const found = arrival?.cover ?? null;
  const [cover, setCover] = useState<Blob | null>(null);
  if (found && found !== cover) setCover(found);
  const madeBook = arrival?.bookId ?? arrival?.existingBookId ?? null;
  const [bookId, setBookId] = useState<string | null>(null);
  if (madeBook && madeBook !== bookId) setBookId(madeBook);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cover) return;
    const next = URL.createObjectURL(cover);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [cover]);
  if (!url) return bookId ? <LibraryCover bookId={bookId} /> : null;
  return (
    <img
      src={url}
      alt=""
      draggable={false}
      className="pointer-events-none size-full object-cover select-none"
    />
  );
}

export function JobCover({ job }: { job: Job }) {
  if (job.kind === BOOK_IMPORT_KIND) return <ImportCover job={job} />;
  const bookId = (job.input as { bookId?: string } | null)?.bookId;
  return bookId ? <LibraryCover bookId={bookId} /> : null;
}

/** An import is named by its file until the book's own title is read. */
export function JobTitle({ job }: { job: Job }) {
  const title = useArrival(job)?.title;
  const [known, setKnown] = useState<string | null>(null);
  if (title && title !== known) setKnown(title);
  return <>{title ?? known ?? job.title}</>;
}

/** An import's line in the words its place in the Library uses. */
export function JobLine({ job, line }: { job: Job; line: string }) {
  const arrival = useArrival(job);
  const [duplicate, setDuplicate] = useState(false);
  if (arrival?.existingBookId && !duplicate) setDuplicate(true);
  if (job.kind !== BOOK_IMPORT_KIND) return <>{line}</>;
  if (job.state === "running" && job.progress.phase)
    return <>{IMPORT_STEPS[job.progress.phase] ?? line}</>;
  if (job.state === "failed") return <>Couldn't add this file</>;
  if (job.state === "done")
    return <>{duplicate ? "Already in your library" : "In your library"}</>;
  return <>{line}</>;
}
