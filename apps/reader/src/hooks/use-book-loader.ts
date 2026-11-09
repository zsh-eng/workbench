import { useToast } from "@/hooks/use-toast";
import { getAllBooks, getBook, type Book } from "@/lib/db";
import { withReaderTraceSpan } from "@/lib/reader-performance-trace";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

export interface UseBookLoaderReturn {
  /** The loaded book data */
  book: Book | null;
  /** Whether the book is currently loading */
  isLoading: boolean;
}

/**
 * Query key factory for book queries
 */
export const bookKeys = {
  all: ["books"] as const,
  list: () => [...bookKeys.all, "list"] as const,
  detail: (bookId: string) => [...bookKeys.all, bookId] as const,
};

/**
 * Hook for querying all books in the library
 */
export function useBooks() {
  return useQuery({
    networkMode: "always", // Books are stored in IndexedDB.
    queryKey: bookKeys.list(),
    queryFn: async () => {
      return await getAllBooks();
    },
    staleTime: 5 * 60 * 1000, // Consider data fresh for 5 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
  });
}

/**
 * Hook for querying book data
 */
function useBook(bookId: string | undefined) {
  return useQuery({
    networkMode: "always", // Metadata lives in IndexedDB.
    queryKey: bookKeys.detail(bookId ?? ""),
    queryFn: async () => {
      if (!bookId) {
        throw new Error("No book ID provided");
      }
      const book = await withReaderTraceSpan(
        "book-metadata-read",
        "storage",
        () => getBook(bookId),
      );
      if (!book) {
        throw new Error("Book not found");
      }
      return book;
    },
    enabled: !!bookId,
    staleTime: 10 * 60 * 1000, // Consider data fresh for 10 minutes
    gcTime: 30 * 60 * 1000, // Keep in cache for 30 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });
}

/**
 * Hook for loading book metadata.
 *
 * Reader location is loaded by the checkpoint controller.
 */
export function useBookLoader(bookId: string | undefined): UseBookLoaderReturn {
  const navigate = useNavigate();
  const { toast } = useToast();

  const bookQuery = useBook(bookId);

  // Handle errors and navigation
  useEffect(() => {
    if (!bookId) {
      toast({
        message: "Couldn’t open this book.",
        variant: "destructive",
      });
      navigate("/");
      return;
    }

    if (bookQuery.error) {
      console.error("Error loading book:", bookQuery.error);
      toast({
        message: "Couldn’t load this book.",
        variant: "destructive",
      });
      navigate("/");
    }
  }, [bookId, bookQuery.error, navigate, toast]);

  return {
    book: bookQuery.data ?? null,
    isLoading: bookQuery.isLoading,
  };
}
