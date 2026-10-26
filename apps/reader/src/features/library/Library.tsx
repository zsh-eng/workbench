import { useAppShellReady } from "@/components/AppShell";
import {
  APP_HEADER_BUTTON,
  APP_PAGE_FRAME,
} from "@/components/app-header-styles";
import { PlaceHeader, usePlaceSearch } from "@/components/PlaceHeader";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  prefetchReaderBook,
  prefetchReaderBooks,
} from "@/features/reader/data/reader-cache/prefetch";
import { preloadReader } from "@/features/reader/load-reader";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useLocalBookPreparationRepair } from "@/hooks/use-local-book-preparation-repair";
import { useDebugEnabled } from "@/lib/debug-preference";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import type { Book } from "@/lib/db";
import { compareBooksByLastReadDesc } from "@/lib/library-sort";
import { MOTION } from "@/lib/motion";
import { warmPaginationWorker } from "@/lib/pagination-v2/worker/pagination-worker-service";
import { whenIdle } from "@/lib/prefetch";
import { getReadingFont } from "@/lib/reading-fonts";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import { cn } from "@/lib/utils";
import { useQueryClient } from "@tanstack/react-query";
import { Lightbulb, Plus, SlidersHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
  type DragEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { BookRow, BookTile, ReadingShelf, ShelfBook } from "./LibraryBooks";
import {
  LIBRARY_FILTERS,
  LIBRARY_SORTS,
  matchesFilter,
  matchesSearch,
  readingProgress,
  readViewPreferences,
  sortBooks,
  writeViewPreferences,
  type LibraryFilter,
  type LibraryLayout,
  type LibrarySort,
  type LibraryViewPreferences,
} from "./library-view";
import { useEpubImport } from "./use-epub-import";
import {
  ArrivalTile,
  useArrivalGrid,
  usePendingArrivalCount,
} from "@/features/arrivals/ArrivalTile";
import {
  DownloadAllForOffline,
  LibraryActivity,
  ON_DEVICE_FILTER,
  useOnDeviceFilter,
} from "@/features/background-activity/LibraryActivity";

// A new filter shows its books at once: the old list goes without a fade, so
// the switch does not wait for it.
const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: MOTION.enter },
  exit: { opacity: 0, transition: { duration: 0 } },
};

/**
 * True while a row scrolls sideways and has more to its right. The row's
 * edge fades only then, so a row that fits shows each label in full.
 */
function useMoreToTheRight() {
  const [row, setRow] = useState<HTMLElement | null>(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => {
    if (!row) return;
    const update = () =>
      setMore(row.scrollLeft + row.clientWidth < row.scrollWidth - 1);
    update();
    // Labels can widen when fonts load, so watch them as well as the row.
    const observer = new ResizeObserver(update);
    observer.observe(row);
    for (const child of row.children) observer.observe(child);
    row.addEventListener("scroll", update, { passive: true });
    return () => {
      observer.disconnect();
      row.removeEventListener("scroll", update);
    };
  }, [row]);
  return { ref: setRow, more };
}

/**
 * The Library. The books you are reading come first, on a shelf with their
 * progress; every other book is in the covers or the list below. Each book
 * shows once. Search turns the page title into the query and narrows the
 * page in place: press the button, /, Cmd-F, or start typing.
 */
export function Library() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { settings } = useReaderSettings();
  const { importFiles, isProcessing, openFilePicker } = useEpubImport();
  const { deleteBook } = useSync();
  const { data } = useBooksWithStatuses();
  const debugEnabled = useDebugEnabled();

  const [chosenFilter, setFilter] = useState<
    LibraryFilter | typeof ON_DEVICE_FILTER.value
  >("all");
  const onDevice = useOnDeviceFilter(
    data?.books,
    chosenFilter === ON_DEVICE_FILTER.value,
  );
  const filter =
    chosenFilter === ON_DEVICE_FILTER.value && !onDevice.enabled
      ? "all"
      : chosenFilter;
  const filterRow = useMoreToTheRight();
  const [view, setViewState] = useState(readViewPreferences);
  const placeSearch = usePlaceSearch();
  const [isDragging, setIsDragging] = useState(false);
  const { terms } = placeSearch;

  const setView = (next: Partial<LibraryViewPreferences>) =>
    setViewState((current) => {
      const updated = { ...current, ...next };
      writeViewPreferences(updated);
      return updated;
    });

  const { found, reading, shown } = useMemo(() => {
    if (!data) return { found: [], reading: [], shown: [] };
    const found = terms
      ? data.books.filter((book) => matchesSearch(book, terms))
      : data.books;
    const reading = found
      .filter((book) => data.statuses.get(book.id) === "reading")
      .sort(compareBooksByLastReadDesc(data.lastReadByBook));
    const shown = sortBooks(
      found.filter((book) =>
        filter === ON_DEVICE_FILTER.value
          ? data.statuses.get(book.id) !== "reading" &&
            !!onDevice.ids?.has(book.id)
          : matchesFilter(data.statuses.get(book.id) ?? null, filter),
      ),
      view.sort,
      data.lastReadByBook,
    );
    return { found, reading, shown };
  }, [data, filter, onDevice.ids, terms, view.sort]);

  const displayedBooks = useMemo(
    () => [...reading, ...shown],
    [reading, shown],
  );
  const { coverUrls, initialCoversReady, requestCover } = useLibraryCoverUrls(
    displayedBooks,
    { loadRemainingInBackground: true },
  );
  useLocalBookPreparationRepair(displayedBooks, initialCoversReady);

  // The first paint is atomic: books, the first covers and fonts together.
  // The latch does not hide the page again for search, sync or status changes.
  const booksLoaded = data !== undefined;
  const [fontsReady, setFontsReady] = useState(
    () => !("fonts" in document) || document.fonts.status === "loaded",
  );
  const [displayReady, setDisplayReady] = useState(false);
  useEffect(() => {
    if (fontsReady) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [fontsReady]);
  useLayoutEffect(() => {
    if (booksLoaded && initialCoversReady && fontsReady) setDisplayReady(true);
  }, [booksLoaded, fontsReady, initialCoversReady]);
  useAppShellReady(displayReady);

  // Warm the app-lifetime pagination worker after the reveal has painted, with
  // the reading font. Reader routes then reuse the loaded font.
  const readingFont = getReadingFont(settings.fontFamily).stack;
  useEffect(() => {
    if (!displayReady) return;
    let secondFrame: number | null = null;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() =>
        warmPaginationWorker([readingFont]),
      );
    });
    return () => {
      cancelAnimationFrame(firstFrame);
      if (secondFrame !== null) cancelAnimationFrame(secondFrame);
    };
  }, [displayReady, readingFont]);

  // The Reader is the next screen. Its code loads once this page has painted
  // and is idle, so opening a book downloads and parses nothing.
  useEffect(() => {
    if (displayReady) return whenIdle(preloadReader);
  }, [displayReady]);

  useEffect(() => {
    const books = data?.categorized.continueReading ?? [];
    if (books.length === 0) return;
    void prefetchReaderBooks(queryClient, books, {
      includeArtifacts: false,
      publisherBookStylingEnabled: settings.publisherBookStylingEnabled,
      matchPublisherBodyTextSize: settings.matchPublisherBodyTextSize,
    });
  }, [
    data?.categorized.continueReading,
    queryClient,
    settings.matchPublisherBodyTextSize,
    settings.publisherBookStylingEnabled,
  ]);

  const handlePrefetch = useCallback(
    (book: Book) => {
      void prefetchReaderBook(queryClient, book, {
        includeArtifacts: true,
        artifactLimit: 2,
        publisherBookStylingEnabled: settings.publisherBookStylingEnabled,
        matchPublisherBodyTextSize: settings.matchPublisherBodyTextSize,
      });
    },
    [
      queryClient,
      settings.matchPublisherBodyTextSize,
      settings.publisherBookStylingEnabled,
    ],
  );

  const handleRemove = useCallback(
    async (bookId: string) => {
      await deleteBook(bookId);
      toast({ message: "Removed book from library." });
    },
    [deleteBook, toast],
  );

  const first = reading[0] ?? shown[0];
  const openFirstMatch = () => {
    if (!terms || !first) return;
    beginReaderTrace({
      bookId: first.id,
      bookTitle: first.title,
      source: "library-search",
    });
    navigate(`/reader/${first.id}`);
  };

  // Arriving books hold their places where they will stay: newest first,
  // among the books you want to read.
  const gridItems = useArrivalGrid(
    shown,
    view.sort === "added" &&
      (filter === "all" || filter === "want-to-read") &&
      !terms,
  );
  const arriving = usePendingArrivalCount();
  const libraryEmpty =
    data !== undefined && data.books.length === 0 && arriving === 0;
  const nothingFound = terms !== "" && found.length === 0;
  const showShelf = reading.length > 0;
  const showRest =
    !libraryEmpty &&
    !nothingFound &&
    (!terms || shown.length > 0 || filter !== "all");

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(true);
  };
  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    if (event.currentTarget === event.target) setIsDragging(false);
  };
  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    setIsDragging(false);
    await importFiles(event.dataTransfer.files);
  };

  const addBooks = (compact: boolean) =>
    compact ? (
      <button
        type="button"
        aria-label="Add books"
        title="Add books"
        disabled={isProcessing}
        onClick={openFilePicker}
        className={APP_HEADER_BUTTON}
      >
        <Plus className="size-[18px]" strokeWidth={1.7} />
      </button>
    ) : (
      <button
        type="button"
        title="Add EPUB files, or drop them anywhere on this page"
        disabled={isProcessing}
        onClick={openFilePicker}
        className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40"
      >
        <Plus className="size-3.5" strokeWidth={1.8} />
        Add books
      </button>
    );

  const viewMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Sort and layout"
        title="Sort and layout"
        className={APP_HEADER_BUTTON}
      >
        <SlidersHorizontal className="size-4" strokeWidth={1.6} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pt-2 pb-1 text-xs font-normal text-muted-foreground">
            Sort by
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view.sort}
            onValueChange={(value) => setView({ sort: value as LibrarySort })}
          >
            {LIBRARY_SORTS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pt-2 pb-1 text-xs font-normal text-muted-foreground">
            Show as
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={view.layout}
            onValueChange={(value) =>
              setView({ layout: value as LibraryLayout })
            }
          >
            <DropdownMenuRadioItem value="covers">Covers</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="list">List</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DownloadAllForOffline books={data?.books ?? []} />
        {debugEnabled && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="pt-2 pb-1 text-xs font-normal text-muted-foreground">
                Debug
              </DropdownMenuLabel>
              <DropdownMenuCheckboxItem
                checked={view.livingCovers}
                onCheckedChange={(checked) =>
                  setView({ livingCovers: checked })
                }
              >
                Living covers
              </DropdownMenuCheckboxItem>
            </DropdownMenuGroup>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // Debug mode: straight to the newest Design ideas. It goes first, so the
  // other controls keep their places.
  const designIdeas = debugEnabled && (
    <Link
      to="/debug/ideas"
      aria-label="Design ideas"
      title="Design ideas"
      className={APP_HEADER_BUTTON}
    >
      <Lightbulb className="size-4" strokeWidth={1.6} />
    </Link>
  );

  const bookProps = (book: Book) => ({
    book,
    status: data?.statuses.get(book.id) ?? null,
    coverUrl: coverUrls.get(book.id),
    living: debugEnabled && view.livingCovers,
    onCoverRequest: requestCover,
    onPrefetch: handlePrefetch,
    onRemove: handleRemove,
  });

  return (
    <div
      className={cn("min-h-full bg-background", !displayReady && "invisible")}
      aria-busy={!displayReady}
      aria-hidden={!displayReady}
      onDragEnter={handleDragEnter}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <h1 className="sr-only">Library</h1>
      <PlaceHeader
        current="library"
        search={placeSearch}
        label="Search library"
        placeholder="Title or author"
        count={`${found.length} of ${data?.books.length ?? 0}`}
        onSubmit={openFirstMatch}
        actions={
          <>
            <LibraryActivity place="header" />
            <div className="flex items-center gap-0.5 max-md:hidden">
              {designIdeas}
              {addBooks(false)}
              {viewMenu}
            </div>
          </>
        }
      />

      <div className={cn(APP_PAGE_FRAME, "pb-24")}>
        {libraryEmpty && (
          <div className="py-24 text-center md:py-32">
            <p className="font-serif text-[26px] leading-tight md:text-[34px]">
              Your library is empty
            </p>
            <p className="mx-auto mt-3 max-w-sm text-[14px] text-muted-foreground">
              Drop EPUB files anywhere on this page, or add them from your
              files.
            </p>
            <Button
              className="mt-6"
              onClick={openFilePicker}
              disabled={isProcessing}
            >
              <Plus className="size-4" />
              Choose EPUB files
            </Button>
          </div>
        )}

        {nothingFound && (
          <div className="py-20 text-center">
            <p className="text-[14px] text-muted-foreground">
              No books match “{terms}”.
            </p>
            <Button
              variant="ghost"
              className="mt-3"
              onClick={() => {
                placeSearch.setSearch("");
                placeSearch.openSearch();
              }}
            >
              Clear search
            </Button>
          </div>
        )}

        {showShelf && (
          <ReadingShelf count={reading.length}>
            {reading.map((book) => (
              <ShelfBook
                key={book.id}
                {...bookProps(book)}
                progress={readingProgress(
                  book,
                  "reading",
                  data?.latestCheckpoints.get(book.id),
                )}
              />
            ))}
          </ReadingShelf>
        )}

        {showRest && (
          <>
            <h2 className="sr-only">Books</h2>
            <div
              className={cn(
                "flex items-center justify-between gap-3",
                showShelf ? "mt-9 md:mt-14" : "mt-5 md:mt-8",
              )}
            >
              <div
                ref={filterRow.ref}
                role="group"
                aria-label="Show"
                data-more={filterRow.more || undefined}
                className="flex min-w-0 items-center gap-3 overflow-x-auto [scrollbar-width:none] max-md:data-[more]:[mask-image:linear-gradient(to_right,black_calc(100%-20px),transparent)] md:gap-4"
              >
                {[
                  ...LIBRARY_FILTERS,
                  ...(onDevice.enabled ? [ON_DEVICE_FILTER] : []),
                ].map((option) => {
                  const active = option.value === filter;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setFilter(option.value)}
                      className={cn(
                        "shrink-0 rounded-sm py-2 text-[13px] whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                        active
                          ? "font-medium text-foreground"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <span className="shrink-0 font-numeric text-[12px] text-muted-foreground tabular-nums max-md:hidden">
                {shown.length} {shown.length === 1 ? "book" : "books"}
              </span>
              <div className="flex shrink-0 items-center md:hidden">
                {designIdeas}
                <LibraryActivity place="row" />
                {addBooks(true)}
                {viewMenu}
              </div>
            </div>

            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${filter}-${view.sort}-${view.layout}`}
                className="mt-6"
                {...FADE}
              >
                {gridItems.length === 0 ? (
                  <p className="py-20 text-center text-[14px] text-muted-foreground">
                    {terms
                      ? "No books here match."
                      : filter === ON_DEVICE_FILTER.value
                        ? "No books on this device yet. Sort and layout → Download all for offline."
                        : "No books here. Change a book’s status from its menu to file it here."}
                  </p>
                ) : view.layout === "covers" ? (
                  <ul className="grid grid-cols-2 gap-x-5 gap-y-10 sm:grid-cols-3 md:grid-cols-[repeat(auto-fill,minmax(128px,1fr))] md:gap-x-8">
                    {gridItems.map((item) =>
                      "book" in item ? (
                        <BookTile
                          key={item.book.id}
                          {...bookProps(item.book)}
                        />
                      ) : (
                        <ArrivalTile
                          key={item.arrivalKey}
                          arrivalKey={item.arrivalKey}
                        />
                      ),
                    )}
                  </ul>
                ) : (
                  <ul>
                    {shown.map((book) => (
                      <BookRow
                        key={book.id}
                        {...bookProps(book)}
                        lastRead={data?.lastReadByBook.get(book.id)}
                      />
                    ))}
                  </ul>
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}
      </div>

      <AnimatePresence>
        {isDragging && (
          <motion.div
            key="drop"
            className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-background/85 backdrop-blur-sm"
            {...FADE}
          >
            <div className="absolute inset-4 rounded-2xl border border-dashed border-foreground/20" />
            <div className="text-center">
              <p className="font-serif text-[30px] leading-tight">
                Drop to add to your library
              </p>
              <p className="mt-2 text-[14px] text-muted-foreground">
                EPUB files only
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
