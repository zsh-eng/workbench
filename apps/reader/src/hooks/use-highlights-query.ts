import {
  addHighlight as addHighlightToDb,
  deleteHighlight as deleteHighlightFromDb,
  getBookHighlights,
  updateHighlight as updateHighlightInDb,
} from "@/lib/db";
import { withReaderTraceSpan } from "@/lib/reader-performance-trace";
import type { Highlight } from "@/types/highlight";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * Query keys for highlights
 */
export const highlightKeys = {
  all: ["highlights"] as const,
  book: (bookId: string) => [...highlightKeys.all, bookId] as const,
};

export const HIGHLIGHTS_QUERY_GC_TIME_MS = 30 * 60 * 1000;

/**
 * Hook for fetching all highlights for a specific book.
 */
export function useBookHighlightsQuery(bookId: string | undefined) {
  return useQuery({
    networkMode: "always", // Reader artifact preparation depends on this local read.
    queryKey: highlightKeys.book(bookId ?? ""),
    queryFn: () =>
      withReaderTraceSpan("highlights-read", "storage", () =>
        getBookHighlights(bookId!),
      ),
    enabled: !!bookId,
    staleTime: Infinity,
    gcTime: HIGHLIGHTS_QUERY_GC_TIME_MS,
  });
}

/** Adds a highlight, and shows it in the book's highlights at once. */
export function useAddHighlightMutation(bookId: string | undefined) {
  const queryClient = useQueryClient();
  const queryKey = highlightKeys.book(bookId ?? "");

  return useMutation({
    networkMode: "always", // Commit local data and the sync outbox while offline.
    mutationFn: async (highlight: Highlight) => {
      await addHighlightToDb(highlight);
      return highlight;
    },
    onMutate: async (newHighlight) => {
      // Keep an outgoing refetch from overwriting the optimistic update.
      await queryClient.cancelQueries({ queryKey });
      const previousHighlights =
        queryClient.getQueryData<Highlight[]>(queryKey);
      queryClient.setQueryData<Highlight[]>(queryKey, (old = []) => [
        ...old,
        newHighlight,
      ]);
      return { previousHighlights };
    },
    onError: (err, _newHighlight, context) => {
      queryClient.setQueryData(queryKey, context?.previousHighlights);
      console.error("Failed to add highlight:", err);
      toast.error("Could not save highlight.", { id: "highlight-save-failed" });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
    },
  });
}

export function useDeleteHighlightMutation(bookId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always", // Commit local data and the sync outbox while offline.
    mutationFn: async (highlightId: string) => {
      await deleteHighlightFromDb(highlightId);
      return highlightId;
    },
    onError: (err) => {
      console.error("Failed to delete highlight:", err);
      toast.error("Could not delete highlight.", {
        id: "highlight-delete-failed",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: highlightKeys.book(bookId ?? ""),
      });
    },
  });
}

export function useUpdateHighlightMutation(bookId: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    networkMode: "always", // Commit local data and the sync outbox while offline.
    mutationFn: async ({
      id,
      changes,
    }: {
      id: string;
      changes: Partial<Highlight>;
    }) => {
      await updateHighlightInDb(id, changes);
      return { id, changes };
    },
    onError: (err) => {
      console.error("Failed to update highlight:", err);
      toast.error("Could not change highlight color.", {
        id: "highlight-colour-failed",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: highlightKeys.book(bookId ?? ""),
      });
    },
  });
}
