import { useAllHighlightsQuery } from "@/features/highlights/use-all-highlights-query";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useReadingSessionsQuery } from "@/hooks/use-reading-sessions-query";
import type { Book } from "@/lib/db";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-constants";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { useMemo, useState } from "react";
import {
  createSampleLibrary,
  type StudioBook,
  type StudioHighlight,
  type StudioLibrary,
  type StudioSession,
  type StudioTone,
} from "./sample-library";

export type StudioSource = "sample" | "library";

const TONES: StudioTone[] = ["green", "blue", "magenta", "ink", "yellow", "cyan", "purple"];
const SIGLUM_STOPWORDS = new Set(["a", "an", "and", "of", "the", "in", "on", "to", "for"]);
const MIN_LIBRARY_ITEMS = 3;

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createSiglum(title: string, used: Set<string>): string {
  const words = title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((word) => word && !SIGLUM_STOPWORDS.has(word.toLowerCase()));
  const base =
    words.length > 1
      ? words.slice(0, 2).map((word) => word[0].toUpperCase()).join("")
      : (words[0] ?? "B").slice(0, 2).replace(/^./, (letter) => letter.toUpperCase());
  let siglum = base;
  let suffix = 2;
  while (used.has(siglum)) {
    siglum = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(siglum);
  return siglum;
}

function getSpineIndex(book: Book, spineItemId: string): number {
  return Math.max(0, book.spine.findIndex((item) => item.idref === spineItemId));
}

function getBookFraction(book: Book | undefined, spineIndex: number, progress: number): number {
  const spineCount = Math.max(1, book?.spine.length ?? 1);
  return Math.min(1, Math.max(0, (spineIndex + progress / 100) / spineCount));
}

/** Maps local Reader rows to the plain shapes the prototypes render. */
function buildLibraryStudio(
  bookRows: readonly Book[],
  highlightGroups: ReturnType<typeof useAllHighlightsQuery>["data"],
  sessionRows: ReturnType<typeof useReadingSessionsQuery>["data"],
  statusRows: ReturnType<typeof useBooksWithStatuses>["data"],
  coverUrls: ReadonlyMap<string, string>,
): StudioLibrary {
  const booksById = new Map(bookRows.map((book) => [book.id, book]));
  const sessions: StudioSession[] = (sessionRows?.sessions ?? [])
    .filter((session) => session.activeMs > 0 && booksById.has(session.bookId))
    .map((session) => {
      const book = booksById.get(session.bookId);
      return {
        id: session.id,
        bookId: session.bookId,
        startedAt: session.startedAt,
        activeMs: session.activeMs,
        startFraction: getBookFraction(book, session.startSpineIndex, session.startScrollProgress),
        endFraction: getBookFraction(book, session.endSpineIndex, session.endScrollProgress),
      };
    });
  // The latest session's end position approximates progress through the book.
  const latestSession = new Map<string, StudioSession>();
  for (const session of sessions) {
    const current = latestSession.get(session.bookId);
    if (!current || session.startedAt > current.startedAt) latestSession.set(session.bookId, session);
  }

  const usedSigla = new Set<string>();
  const books: StudioBook[] = bookRows.map((book) => {
    const status = statusRows?.statuses.get(book.id) ?? "want-to-read";
    const latest = latestSession.get(book.id);
    return {
      id: book.id,
      title: book.title || "Untitled",
      author: book.author || "Unknown author",
      siglum: createSiglum(book.title || "Book", usedSigla),
      coverUrl: coverUrls.get(book.id) ?? null,
      tone: TONES[hashString(book.id) % TONES.length],
      origin: "library",
      status,
      addedAt: book.dateAdded,
      lastReadAt: statusRows?.lastReadByBook.get(book.id) ?? latest?.startedAt ?? null,
      progress: status === "finished" ? 1 : (latest?.endFraction ?? 0),
    };
  });
  const highlightColorNames = new Set<string>(HIGHLIGHT_COLORS.map((color) => color.name));

  const highlights: StudioHighlight[] = (highlightGroups ?? []).flatMap((group) =>
    group.highlights.flatMap((highlight) => {
      if (!highlightColorNames.has(highlight.color)) return [];
      const spineIndex = getSpineIndex(group.book, highlight.spineItemId);
      return [
        {
          id: highlight.id,
          bookId: highlight.bookId,
          text: highlight.selectedText.trim(),
          before: highlight.textBefore,
          after: highlight.textAfter,
          color: highlight.color as StudioHighlight["color"],
          createdAt: highlight.createdAt,
          chapter: getChapterTitleFromSpine(group.book, spineIndex),
          locator: spineIndex + 1,
          note: null,
        },
      ];
    }),
  );

  return { books, highlights, sessions };
}

export interface StudioLibraryState {
  library: StudioLibrary;
  source: StudioSource;
  canUseLibrary: boolean;
  libraryCounts: { books: number; highlights: number; sessions: number };
  setSource: (source: StudioSource) => void;
}

/**
 * Supplies the prototypes with the reader's own library when it has enough
 * material, and with the public-domain sample library otherwise.
 */
export function useStudioLibrary(): StudioLibraryState {
  const highlightsQuery = useAllHighlightsQuery();
  const sessionsQuery = useReadingSessionsQuery();
  const statusesQuery = useBooksWithStatuses();
  const [sample] = useState(() => createSampleLibrary());
  const [requestedSource, setRequestedSource] = useState<StudioSource | null>(null);

  const bookRows = useMemo(() => {
    const byId = new Map<string, Book>();
    for (const book of sessionsQuery.data?.books ?? []) byId.set(book.id, book);
    for (const group of highlightsQuery.data ?? []) byId.set(group.book.id, group.book);
    return [...byId.values()];
  }, [highlightsQuery.data, sessionsQuery.data?.books]);

  const { coverUrls } = useLibraryCoverUrls(bookRows, { loadRemainingInBackground: true });

  const libraryStudio = useMemo(
    () =>
      buildLibraryStudio(bookRows, highlightsQuery.data, sessionsQuery.data, statusesQuery.data, coverUrls),
    [bookRows, coverUrls, highlightsQuery.data, sessionsQuery.data, statusesQuery.data],
  );

  const hasHighlights = libraryStudio.highlights.length >= MIN_LIBRARY_ITEMS;
  const hasSessions = libraryStudio.sessions.length >= MIN_LIBRARY_ITEMS;
  const hasBooks = libraryStudio.books.length >= MIN_LIBRARY_ITEMS;
  const canUseLibrary = hasHighlights || hasSessions || hasBooks;
  const source: StudioSource =
    canUseLibrary ? (requestedSource ?? "library") : "sample";

  // A library with highlights but no sessions (or the reverse) borrows only
  // the missing half from the sample, so every prototype has material.
  const library = useMemo((): StudioLibrary => {
    if (source === "sample") return sample;
    const needsSample = !hasHighlights || !hasSessions;
    return {
      books: needsSample ? [...libraryStudio.books, ...sample.books] : libraryStudio.books,
      highlights: hasHighlights ? libraryStudio.highlights : sample.highlights,
      sessions: hasSessions ? libraryStudio.sessions : sample.sessions,
    };
  }, [hasHighlights, hasSessions, libraryStudio, sample, source]);

  return {
    library,
    source,
    canUseLibrary,
    libraryCounts: {
      books: libraryStudio.books.length,
      highlights: libraryStudio.highlights.length,
      sessions: libraryStudio.sessions.length,
    },
    setSource: setRequestedSource,
  };
}
