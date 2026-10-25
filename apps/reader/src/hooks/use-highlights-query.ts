import {
  addHighlight as addHighlightToDb,
  deleteHighlight as deleteHighlightFromDb,
  getBookHighlights,
  getHighlights,
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
  chapter: (bookId: string, spineItemId: string) =>
    [...highlightKeys.all, bookId, spineItemId] as const,
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

/**
 * Hook for fetching highlights for a specific chapter
 */
export function useHighlightsQuery(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  return useQuery({
    queryKey: highlightKeys.chapter(bookId ?? "", spineItemId ?? ""),
    queryFn: () => getHighlights(bookId!, spineItemId!),
    enabled: !!bookId && !!spineItemId,
    staleTime: Infinity,
    gcTime: HIGHLIGHTS_QUERY_GC_TIME_MS,
  });
}

/**
 * Hook for adding a highlight with optimistic updates
 */
export function useAddHighlightMutation(
  bookId: string | undefined,
  fallbackSpineItemId?: string | undefined,
) {
  const queryClient = useQueryClient();
  const bookQueryKey = highlightKeys.book(bookId ?? "");

  return useMutation({
    networkMode: "always", // Commit local data and the sync outbox while offline.
    mutationFn: async (highlight: Highlight) => {
      await addHighlightToDb(highlight);
      return highlight;
    },
    onMutate: async (newHighlight) => {
      const chapterQueryKey = highlightKeys.chapter(
        bookId ?? "",
        newHighlight.spineItemId ?? fallbackSpineItemId ?? "",
      );

      // Cancel any outgoing refetches to avoid overwriting optimistic update
      await Promise.all([
        queryClient.cancelQueries({ queryKey: chapterQueryKey }),
        queryClient.cancelQueries({ queryKey: bookQueryKey }),
      ]);

      // Snapshot the previous value
      const previousHighlights =
        queryClient.getQueryData<Highlight[]>(chapterQueryKey);
      const previousBookHighlights =
        queryClient.getQueryData<Highlight[]>(bookQueryKey);

      // Optimistically add the new highlight
      queryClient.setQueryData<Highlight[]>(chapterQueryKey, (old = []) => [
        ...old,
        newHighlight,
      ]);
      queryClient.setQueryData<Highlight[]>(bookQueryKey, (old = []) => [
        ...old,
        newHighlight,
      ]);

      // Return context with previous value for rollback
      return {
        chapterQueryKey,
        previousHighlights,
        previousBookHighlights,
      };
    },
    onError: (err, _newHighlight, context) => {
      // Rollback to previous value on error
      if (context?.chapterQueryKey) {
        queryClient.setQueryData(
          context.chapterQueryKey,
          context.previousHighlights,
        );
      }
      queryClient.setQueryData(bookQueryKey, context?.previousBookHighlights);
      console.error("Failed to add highlight:", err);
      toast.error("Could not save highlight.", { id: "highlight-save-failed" });
    },
    onSettled: (_data, _error, newHighlight) => {
      // Refetch after error or success to ensure consistency
      queryClient.invalidateQueries({
        queryKey: highlightKeys.chapter(
          bookId ?? "",
          newHighlight.spineItemId ?? fallbackSpineItemId ?? "",
        ),
      });
      queryClient.invalidateQueries({ queryKey: bookQueryKey });
    },
  });
}

/**
 * Hook for deleting a highlight with optimistic updates
 */
export function useDeleteHighlightMutation(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  const queryClient = useQueryClient();
  const queryKey = highlightKeys.chapter(bookId ?? "", spineItemId ?? "");
  const bookQueryKey = highlightKeys.book(bookId ?? "");

  return useMutation({
    networkMode: "always", // Commit local data and the sync outbox while offline.
    mutationFn: async (highlightId: string) => {
      await deleteHighlightFromDb(highlightId);
      return highlightId;
    },
    onMutate: async (highlightId) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousHighlights =
        queryClient.getQueryData<Highlight[]>(queryKey);

      // Optimistically remove the highlight
      queryClient.setQueryData<Highlight[]>(queryKey, (old = []) =>
        old.filter((h) => h.id !== highlightId),
      );

      return { previousHighlights };
    },
    onError: (err, _highlightId, context) => {
      // Rollback on error
      if (context?.previousHighlights) {
        queryClient.setQueryData(queryKey, context.previousHighlights);
      }
      console.error("Failed to delete highlight:", err);
      toast.error("Could not delete highlight.", {
        id: "highlight-delete-failed",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: bookQueryKey });
    },
  });
}

/**
 * Hook for updating a highlight with optimistic updates
 */
export function useUpdateHighlightMutation(
  bookId: string | undefined,
  spineItemId: string | undefined,
) {
  const queryClient = useQueryClient();
  const queryKey = highlightKeys.chapter(bookId ?? "", spineItemId ?? "");
  const bookQueryKey = highlightKeys.book(bookId ?? "");

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
    onMutate: async ({ id, changes }) => {
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey });

      // Snapshot the previous value
      const previousHighlights =
        queryClient.getQueryData<Highlight[]>(queryKey);

      // Optimistically update the highlight
      queryClient.setQueryData<Highlight[]>(queryKey, (old = []) =>
        old.map((h) => (h.id === id ? { ...h, ...changes } : h)),
      );

      return { previousHighlights };
    },
    onError: (err, _variables, context) => {
      // Rollback on error
      if (context?.previousHighlights) {
        queryClient.setQueryData(queryKey, context.previousHighlights);
      }
      console.error("Failed to update highlight:", err);
      toast.error("Could not change highlight color.", {
        id: "highlight-colour-failed",
      });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: bookQueryKey });
    },
  });
}
