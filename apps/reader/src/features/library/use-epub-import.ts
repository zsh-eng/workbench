import { DuplicateBookDialog } from "./DuplicateBookDialog";
import {
  countOutcomes,
  importSummary,
  ImportProblemsSheet,
  type ImportOutcome,
} from "./ImportOutcomes";
import {
  LazyArrivalSheet,
  preloadArrivals,
} from "@/features/arrivals/LazyArrivingCover";
import { useToast } from "@/hooks/use-toast";
import { markEpubPreparationReady } from "@/hooks/use-epub-processor";
import { importBooks } from "@/lib/background-activity";
import { appArrivals } from "@/lib/book-arrivals";
import {
  asBookImportError,
  BookImportError,
  describeImportError,
  importErrorDetails,
} from "@/lib/book-import-errors";
import { addBookFromFile, DuplicateBookError } from "@/lib/book-service";
import { copyText } from "@/lib/clipboard";
import { arrivingBooks } from "@/lib/debug-switch";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import type { Book } from "@/lib/db";
import { useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useNavigate } from "react-router-dom";

/** Every import says how it went in this one toast, changed in place. */
const IMPORT_TOAST = "book-import";

const isEpubName = (file: File) => file.name.toLowerCase().endsWith(".epub");

async function settle(
  fileName: string,
  work: Promise<Book>,
): Promise<ImportOutcome> {
  try {
    return { fileName, status: "added", book: await work };
  } catch (error) {
    if (error instanceof DuplicateBookError)
      return { fileName, status: "duplicate", book: error.existingBook };
    return { fileName, status: "failed", error: asBookImportError(error) };
  }
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
 * Each import ends in one toast, which says why a file was not added: for
 * one file, in the toast itself; for a batch, behind See why.
 */
export function EpubImportProvider({ children }: { children: ReactNode }) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [duplicateBook, setDuplicateBook] = useState<Book | null>(null);
  const [showDuplicateDialog, setShowDuplicateDialog] = useState(false);
  const [problems, setProblems] = useState<readonly ImportOutcome[] | null>(
    null,
  );
  const [showProblems, setShowProblems] = useState(false);
  // Debug → Arriving books: the book that arrives in the arrival sheet.
  const [sheetKey, setSheetKey] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast, dismiss } = useToast();

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

  // Try again in a toast runs the import as it is now.
  const importRef = useRef<
    (files: readonly File[], retrying: boolean) => Promise<void>
  >(async () => {});

  /** One file that was not added: why, and what to do, in the toast. */
  const showFailure = useCallback(
    (file: File, error: BookImportError) => {
      const copy = describeImportError(error);
      const show = (copied: boolean) =>
        toast({
          id: IMPORT_TOAST,
          message: copy.title,
          description: `${copy.what} ${copy.next}`,
          variant: "destructive",
          duration: 10000,
          action:
            error.kind === "unexpected"
              ? {
                  label: copied ? "Details copied" : "Copy details",
                  onClick: (event) => {
                    event.preventDefault();
                    void copyText(importErrorDetails(error, file.name)).then(
                      (done) => done && show(true),
                    );
                  },
                }
              : copy.retry
                ? {
                    label: "Try again",
                    onClick: (event) => {
                      event.preventDefault();
                      void importRef.current([file], true);
                    },
                  }
                : undefined,
        });
      show(false);
    },
    [toast],
  );

  const importFiles = useCallback(
    async (chosen: FileList | readonly File[], retrying = false) => {
      if (isProcessing || chosen.length === 0) return;

      const allFiles = Array.from(chosen);
      const epubFiles = allFiles.filter(isEpubName);

      if (epubFiles.length === 0) {
        toast({
          id: IMPORT_TOAST,
          message: "Only EPUB files can be added.",
          variant: "destructive",
        });
        return;
      }

      setIsProcessing(true);
      // The toast that offered Try again says it is trying.
      if (retrying)
        toast({
          id: IMPORT_TOAST,
          message: "Adding the book…",
          variant: "loading",
          duration: Infinity,
        });

      // Debug → Arriving books: each file is a job, and its place shows now.
      const arrivals = arrivingBooks.get() ? importBooks(epubFiles) : null;
      // One book on its own arrives in a sheet; several fill the grid.
      const sheet = arrivals !== null && epubFiles.length === 1;
      if (arrivals) {
        preloadArrivals();
        navigate("/");
        if (sheet) {
          // The place waits for the sheet from the first frame, so the grid
          // does not draw the cover before the sheet takes it.
          appArrivals.present(arrivals.keys[0]!, true);
          setSheetKey(arrivals.keys[0]!);
        }
      }

      try {
        // In the order chosen. A file without an .epub name is not tried.
        const outcomes: ImportOutcome[] = [];
        for (const file of allFiles) {
          const index = epubFiles.indexOf(file);
          const outcome =
            index === -1
              ? ({
                  fileName: file.name,
                  status: "failed",
                  error: new BookImportError({
                    kind: "not-epub",
                    format: "name",
                  }),
                } as const)
              : await settle(
                  file.name,
                  arrivals ? arrivals.outcomes[index]! : addBookFromFile(file),
                );
          if (outcome.status === "added")
            markEpubPreparationReady(queryClient, outcome.book);
          outcomes.push(outcome);
        }

        // The sheet says how it went, and offers Read now.
        if (sheet) {
          if (retrying) dismiss(IMPORT_TOAST);
          return;
        }

        const counts = countOutcomes(outcomes);
        if (counts.added > 0) {
          await queryClient.invalidateQueries({ queryKey: ["books"] });
          // Arrivals went to the Library at the start, and you may have
          // opened a book since; their confirmation comes with the last cover.
          if (arrivals) await arrivals.rested();
          else navigate("/");
        }

        const [only] = outcomes;
        if (outcomes.length === 1 && only!.status === "duplicate") {
          if (retrying) dismiss(IMPORT_TOAST);
          setDuplicateBook(only!.book);
          setShowDuplicateDialog(true);
          return;
        }
        if (outcomes.length === 1 && only!.status === "failed") {
          showFailure(epubFiles[0]!, only!.error);
          return;
        }

        const notAdded = outcomes.filter(
          (outcome) => outcome.status !== "added",
        );
        const bookToOpen =
          counts.added === 1
            ? outcomes.find((outcome) => outcome.status === "added")!.book
            : null;
        toast({
          id: IMPORT_TOAST,
          message: importSummary(counts),
          variant:
            counts.added === 0 && counts.failed > 0 ? "destructive" : "default",
          ...(counts.failed > 0
            ? {
                duration: 10000,
                action: {
                  label: "See why",
                  onClick: () => {
                    setProblems(notAdded);
                    setShowProblems(true);
                  },
                },
              }
            : bookToOpen
              ? {
                  duration: 10000,
                  action: {
                    label: "Open book",
                    onClick: () => navigate(`/reader/${bookToOpen.id}`),
                  },
                }
              : {}),
        });
      } finally {
        arrivals?.end();
        setIsProcessing(false);
      }
    },
    [dismiss, isProcessing, navigate, queryClient, showFailure, toast],
  );
  importRef.current = importFiles;

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
      ? createElement(LazyArrivalSheet, {
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
          onChooseFile: openFilePicker,
          // A sheet closing late leaves a newer book's sheet open.
          onDone: () =>
            setSheetKey((current) => (current === sheetKey ? null : current)),
        })
      : null,
    duplicateBook
      ? createElement(DuplicateBookDialog, {
          open: showDuplicateDialog,
          onOpenChange: setShowDuplicateDialog,
          existingBook: duplicateBook,
        })
      : null,
    problems
      ? createElement(ImportProblemsSheet, {
          outcomes: problems,
          isOpen: showProblems,
          onOpenChange: setShowProblems,
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
