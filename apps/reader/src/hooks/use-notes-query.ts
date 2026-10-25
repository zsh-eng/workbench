import { getBookNotes } from "@/lib/db";
import { useQuery } from "@tanstack/react-query";

export const noteKeys = {
  all: ["notes"] as const,
  book: (bookId: string) => [...noteKeys.all, "book", bookId] as const,
};

/** One cached read serves both notebook ordering and margin notes. */
export function useBookNotesQuery(bookId: string) {
  return useQuery({
    queryKey: noteKeys.book(bookId),
    queryFn: () => getBookNotes(bookId),
  });
}
