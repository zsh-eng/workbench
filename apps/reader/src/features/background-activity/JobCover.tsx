import { BookCover } from "@/features/library/LibraryBooks";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import type { Job } from "@workbench/background-activity";
import { useMemo } from "react";

/**
 * A downloading book's cover, small, for its row in the activity sheet. The
 * Library has usually decoded it already, so it shows at once.
 */
export function JobCover({ job }: { job: Job }) {
  const bookId = (job.input as { bookId?: string } | null)?.bookId;
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
