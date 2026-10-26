import { DuplicateBookDialog } from "./DuplicateBookDialog";
import {
  LazyArrivalSheet,
  preloadArrivals,
} from "@/features/arrivals/LazyArrivingCover";
import { useToast } from "@/hooks/use-toast";
import { markEpubPreparationReady } from "@/hooks/use-epub-processor";
import { importBooks } from "@/lib/background-activity";
import { appArrivals } from "@/lib/book-arrivals";
import { addBookFromFile, DuplicateBookError } from "@/lib/book-service";
import { arrivingBooks } from "@/lib/debug-switch";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import type { Book } from "@/lib/db";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

/** Compact batch feedback keeps added, skipped, and failed counts distinct. */
function importFeedback(
  added: number,
  duplicates: number,
  failed: number,
  ignored: number,
): string {
  const skipped = duplicates + ignored;
  if (!added && !failed)
    return ignored
      ? `Skipped ${skipped} files.`
      : `Skipped ${duplicates} existing book${duplicates === 1 ? "" : "s"}.`;
  if (!skipped && !failed)
    return `Added ${added} book${added === 1 ? "" : "s"}.`;
  if (!added && !skipped)
    return `Could not add ${failed} book${failed === 1 ? "" : "s"}.`;
  const parts = [
    added && `added ${added}`,
    skipped && `skipped ${skipped}`,
    failed && `failed ${failed}`,
  ]
    .filter(Boolean)
    .join("; ");
  return `${parts[0].toUpperCase()}${parts.slice(1)}.`;
}

interface EpubImportContextValue {
  isProcessing: boolean;
  importFiles: (files: FileList | readonly File[]) => Promise<void>;
  openFilePicker: () => void;
}

const EpubImportContext = createContext<EpubImportContextValue | null>(null);

/**
 * Coordinates EPUB imports for both the persistent sidebar and Library drop
 * target. Successful imports return to the Library and refresh its local query.
 */
export function EpubImportProvider({ children }: { children: ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [duplicateBook, setDuplicateBook] = useState<Book | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  // Debug → Arriving books: the book that arrives in the arrival sheet.
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();

  // Debug → Arriving books: each book stands in its place on the shelf as
  // soon as it is ready, also after Try again, not when the batch ends.
  useEffect(() => {
    const shelved = new Set<string>();
    return appArrivals.subscribe(() => {
      for (const { bookId } of appArrivals.getSnapshot()) {
        if (!bookId || shelved.has(bookId)) continue;
        shelved.add(bookId);
        void queryClient.invalidateQueries({ queryKey: ["books"] });
      }
    });
  }, [queryClient]);

  const importFiles = useCallback(
    async (files: FileList | readonly File[]) => {
      if (isProcessing || files.length === 0) return;

      const allFiles = Array.from(files);
      const epubFiles = allFiles.filter((file) =>
        file.name.toLowerCase().endsWith(".epub"),
      );
      const nonEpubCount = allFiles.length - epubFiles.length;

      if (epubFiles.length === 0) {
        toast({
          message: "Only EPUB files can be added.",
          variant: "destructive",
        });
        return;
      }

      setIsProcessing(true);

      let successCount = 0;
      let lastImportedBook: Book | null = null;
      let duplicateCount = 0;
      let errorCount = 0;
      let lastDuplicateBook: Book | null = null;
      // Debug → Arriving books: each file is a job, and its place shows now.
      const arrivals = arrivingBooks.get() ? importBooks(epubFiles) : null;
      // One book on its own arrives in a sheet; several fill the grid.
      const sheet = arrivals !== null && epubFiles.length === 1;
      if (arrivals) {
        preloadArrivals();
        navigate("/");
        if (sheet) setSheetKey(arrivals.keys[0]!);
      }

      try {
        for (const [index, file] of epubFiles.entries()) {
          try {
            const importedBook = arrivals
              ? await arrivals.outcomes[index]!
              : await addBookFromFile(file);
            markEpubPreparationReady(queryClient, importedBook);
            successCount += 1;
            lastImportedBook = importedBook;
          } catch (error) {
            console.error("Error adding book:", error);
            if (error instanceof DuplicateBookError) {
              duplicateCount += 1;
              lastDuplicateBook = error.existingBook;
            } else {
              errorCount += 1;
            }
          }
        }

        // The sheet says how it went, and offers Read now.
        if (sheet) return;

        const message = importFeedback(
          successCount,
          duplicateCount,
          errorCount,
          nonEpubCount,
        );

        if (successCount > 0) {
          await queryClient.invalidateQueries({ queryKey: ["books"] });
          // Arrivals went to the Library at the start, and you may have
          // opened a book since; their confirmation comes with the last cover.
          if (arrivals) await arrivals.rested();
          else navigate("/");
          const bookToOpen = successCount === 1 ? lastImportedBook : null;
          toast({
            message,
            ...(bookToOpen
              ? {
                  duration: 10000,
                  action: {
                    label: "Open book",
                    onClick: () => navigate(`/reader/${bookToOpen.id}`),
                  },
                }
              : {}),
          });
          return;
        }

        if (
          duplicateCount === 1 &&
          epubFiles.length === 1 &&
          lastDuplicateBook
        ) {
          setDuplicateBook(lastDuplicateBook);
          setShowDuplicateDialog(true);
          return;
        }

        if (duplicateCount > 0 && errorCount === 0) {
          toast({
            message,
          });
          return;
        }

        toast({
          message,
          variant: "destructive",
        });
      } finally {
        arrivals?.end();
        setIsProcessing(false);
      }
    },
    [isProcessing, navigate, queryClient, toast],
  );

  const openFilePicker = useCallback(() => {
    if (isProcessing) return;
    if (arrivingBooks.get()) preloadArrivals();

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".epub";
    input.multiple = true;
    input.style.position = "absolute";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    document.body.appendChild(input);

    const removeInput = () => {
      if (input.isConnected) input.remove();
    };

    input.onchange = () => {
      if (input.files) void importFiles(input.files);
      removeInput();
    };
    input.addEventListener("cancel", removeInput, { once: true });
    input.click();
  }, [importFiles, isProcessing]);

  const value = useMemo<EpubImportContextValue>(
    () => ({ isProcessing, importFiles, openFilePicker }),
    [importFiles, isProcessing, openFilePicker],
  );

  return createElement(
    EpubImportContext.Provider,
    { value },
    children,
    sheetKey
      ? createElement(
          Suspense,
          { fallback: null },
          createElement(LazyArrivalSheet, {
            key: sheetKey,
            arrivalKey: sheetKey,
            onOpenBook: (bookId: string, title: string) => {
              beginReaderTrace({
                bookId,
                bookTitle: title,
                source: "arrival-sheet",
              });
              navigate(`/reader/${bookId}`);
            },
            onDone: () => setSheetKey(null),
          }),
        )
      : null,
    duplicateBook
      ? createElement(DuplicateBookDialog, {
          open: showDuplicateDialog,
          onOpenChange: setShowDuplicateDialog,
          existingBook: duplicateBook,
        })
      : null,
  );
}

export function useEpubImport(): EpubImportContextValue {
  const context = useContext(EpubImportContext);
  if (!context) {
    throw new Error("useEpubImport must be used within EpubImportProvider");
  }
  return context;
}
