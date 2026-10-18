import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { useBookNotesQuery } from "@/hooks/use-notes-query";
import type { TOCItem } from "@/lib/db";
import type { ChapterCanonicalText } from "@/lib/pagination-v2";
import type { TextOffsetLocation } from "@/lib/pagination-v2/protocol";
import type { AnnotationColor, Highlight } from "@/types/highlight";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ReaderSessionChapterAccess,
  ReaderSessionResources,
} from "../hooks/use-reader-session";
import type { ChapterEntry } from "../types";
import { buildSearchSections, findSection } from "./search-sections";
import type {
  SearchWorkerChapter,
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "./search-protocol";
import {
  foldQuery,
  foldText,
  type SearchSnippet,
  type TextMatch,
} from "./search-text";

/** Enough to step through; a word on every page stops here. */
export const SEARCH_RESULT_LIMIT = 1000;
/** Results drawn at a time; a long list grows as it scrolls. */
const RESULTS_PAGE = 30;
const QUERY_KEY_PREFIX = "epub-reader-search-query:";

export interface ReaderSearchResult extends TextMatch {
  id: string;
  chapterIndex: number;
  blockId: string;
  snippet: SearchSnippet;
}

/** Results under one table of contents entry. */
export interface ReaderSearchChapterGroup {
  key: string;
  title: string;
  /** Index of the group's first result in the book's results. */
  firstIndex: number;
  results: ReaderSearchResult[];
}

/** One of the reader's own highlights or notes that matches the query. */
export interface ReaderSearchAnnotation {
  id: string;
  kind: "highlight" | "note";
  chapterIndex: number;
  offset: number;
  text: string;
  /** The passage a note is about. */
  quote?: string;
  color?: AnnotationColor;
}

export type ReaderSearchStatus = "idle" | "waiting" | "searching" | "done";

export interface ReaderSearchState {
  query: string;
  status: ReaderSearchStatus;
  results: ReaderSearchResult[];
  groups: ReaderSearchChapterGroup[];
  annotations: ReaderSearchAnnotation[];
  /** Pages of results that are laid out, by result id. */
  pages: Record<string, number | null>;
  searchedChapters: number;
  totalChapters: number;
  truncated: boolean;
  activeIndex: number | null;
  /** How many results the list draws. */
  shown: number;
  /** Main-thread time from the query to its first and last result. */
  firstResultMs: number | null;
  totalMs: number | null;
}

export interface ReaderSearch {
  state: ReaderSearchState;
  /** Searches for `query`, kept for this book unless `remember` is false. */
  setQuery: (query: string, options?: { remember?: boolean }) => void;
  /** Draws the next page of results. */
  showMore: () => void;
  cancel: () => void;
  /** Opens a result as a jump the reader can go back from. */
  open: (index: number) => void;
  next: () => void;
  previous: () => void;
  openAnnotation: (annotation: ReaderSearchAnnotation) => void;
  /** Leaves stepping; the query stays for next time. */
  exit: () => void;
}

interface UseReaderSearchOptions {
  bookId: string;
  /** Search starts its worker the first time the panel opens. */
  enabled: boolean;
  chapters: ChapterEntry[];
  toc: TOCItem[];
  chapterAccess: ReaderSessionChapterAccess;
  highlights: Highlight[];
  locations: Record<string, TextOffsetLocation | null>;
  locateTextOffsets: ReaderSessionResources["locateTextOffsets"];
  /** Changes whenever pages are laid out again, so page numbers follow. */
  layoutKey: string;
  /** The reader's chapter, and its first page shown, counted from 1. */
  currentChapterIndex: number;
  currentPageInChapter: number | null;
  goToTextOffset: (
    chapterIndex: number,
    offset: number,
    source: "search" | "highlight" | "note",
  ) => void;
}

function readSavedQuery(bookId: string): string {
  try {
    return getRuntimeStorage().getItem(QUERY_KEY_PREFIX + bookId) ?? "";
  } catch {
    return "";
  }
}

function saveQuery(bookId: string, query: string) {
  try {
    if (query) getRuntimeStorage().setItem(QUERY_KEY_PREFIX + bookId, query);
    else getRuntimeStorage().removeItem(QUERY_KEY_PREFIX + bookId);
  } catch {
    // The query is a convenience; searching works without storage.
  }
}

function toWorkerChapter(
  chapterIndex: number,
  text: ChapterCanonicalText,
): SearchWorkerChapter {
  return {
    chapterIndex,
    fullText: text.fullText,
    blockStarts: [...text.blockStarts],
  };
}

function includesFolded(text: string | undefined, folded: string): boolean {
  return !!text && foldText(text).text.includes(folded);
}

interface RunningSearch {
  id: number;
  query: string;
  startedAt: number;
  firstResultMs: number | null;
  /** Chapters the worker had text for when the search started. */
  chaptersWithText: number;
}

const EMPTY_RESULTS: ReaderSearchResult[] = [];

/**
 * Book search. The text is searched in a worker a chapter at a time, so a
 * long book never holds up a page turn, and results stream in book order.
 * Results are canonical text offsets: the engine places them on pages, so a
 * result opens the right page after any change of type or layout. Nothing
 * moves the reading position until a result is opened.
 */
export function useReaderSearch({
  bookId,
  enabled,
  chapters,
  toc,
  chapterAccess,
  highlights,
  locations,
  locateTextOffsets,
  layoutKey,
  currentChapterIndex,
  currentPageInChapter,
  goToTextOffset,
}: UseReaderSearchOptions): ReaderSearch {
  const [query, setQueryState] = useState(() => readSavedQuery(bookId));
  const [status, setStatus] = useState<ReaderSearchStatus>("idle");
  const [results, setResults] = useState<ReaderSearchResult[]>(EMPTY_RESULTS);
  const [progress, setProgress] = useState({ searched: 0, total: 0 });
  const [truncated, setTruncated] = useState(false);
  const [timing, setTiming] = useState<{
    firstResultMs: number | null;
    totalMs: number | null;
  }>({ firstResultMs: null, totalMs: null });
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [shown, setShown] = useState(RESULTS_PAGE);
  // Each book keeps its own last search.
  const [searchedBook, setSearchedBook] = useState(bookId);
  if (searchedBook !== bookId) {
    setSearchedBook(bookId);
    setQueryState(readSavedQuery(bookId));
    setActiveIndex(null);
  }
  const [textVersion, setTextVersion] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const sentTexts = useRef(new Map<number, ChapterCanonicalText>());
  const sentBook = useRef("");
  /** A step from the reader, waiting for its chapter's matches' pages. */
  const pendingStep = useRef<"next" | "previous" | null>(null);
  const locateRequest = useRef<{ startedAt: number; results: number } | null>(
    null,
  );
  const running = useRef<RunningSearch | null>(null);
  const searchIds = useRef(0);
  /** The last search finished without some chapters' text. */
  const searchedWithoutText = useRef(false);

  const handleMessage = useCallback((response: SearchWorkerResponse) => {
    const search = running.current;
    if (!search || response.searchId !== search.id) return;
    if (response.type === "progress") {
      const found = response.chapters.flatMap(({ chapterIndex, matches }) =>
        matches.map((match) => ({
          ...match,
          chapterIndex,
          id: `${chapterIndex}:${match.start}`,
        })),
      );
      if (found.length && search.firstResultMs === null) {
        search.firstResultMs = performance.now() - search.startedAt;
        performance.measure("reader-search:first-result", {
          start: search.startedAt,
          duration: search.firstResultMs,
          detail: { query: search.query },
        });
        setTiming({ firstResultMs: search.firstResultMs, totalMs: null });
      }
      if (found.length) setResults((previous) => [...previous, ...found]);
      setProgress({
        searched: response.searchedChapters,
        total: response.totalChapters,
      });
      return;
    }
    const totalMs = performance.now() - search.startedAt;
    performance.measure("reader-search:complete", {
      start: search.startedAt,
      duration: totalMs,
      detail: {
        query: search.query,
        matches: response.totalMatches,
        workerMs: response.totalMs,
        workerFirstMatchMs: response.firstMatchMs,
      },
    });
    running.current = null;
    searchedWithoutText.current = response.missingChapters > 0;
    setTruncated(response.truncated);
    setTiming({ firstResultMs: search.firstResultMs, totalMs });
    setStatus("done");
    // Text that arrived while this search ran is searched again.
    if (
      response.missingChapters > 0 &&
      sentTexts.current.size > search.chaptersWithText
    )
      setTextVersion((version) => version + 1);
  }, []);

  // The worker starts with the first search and lives as long as the book.
  useEffect(() => {
    if (!enabled || workerRef.current) return;
    const worker = new Worker(new URL("./search.worker.ts", import.meta.url), {
      type: "module",
    });
    // Messages that arrive within a frame render once: a fast search's
    // first match and its end come together.
    let queued: SearchWorkerResponse[] = [];
    worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      if (!queued.length)
        requestAnimationFrame(() => {
          const responses = queued;
          queued = [];
          responses.forEach(handleMessage);
        });
      queued.push(event.data);
    };
    workerRef.current = worker;
    sentTexts.current.clear();
    setTextVersion((version) => version + 1);
  }, [enabled, handleMessage]);
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  // Hand the worker each chapter's text once it is loaded.
  useEffect(() => {
    const worker = workerRef.current;
    if (!worker || !textVersion) return;
    const startedAt = performance.now();
    const post = (request: SearchWorkerRequest) => worker.postMessage(request);
    if (sentBook.current !== bookId) {
      sentBook.current = bookId;
      sentTexts.current.clear();
    }
    post({ type: "setBook", bookKey: bookId, chapterCount: chapters.length });
    const added: SearchWorkerChapter[] = [];
    chapters.forEach((_, chapterIndex) => {
      const text = chapterAccess.getCanonicalText(chapterIndex);
      if (!text || sentTexts.current.get(chapterIndex) === text) return;
      sentTexts.current.set(chapterIndex, text);
      added.push(toWorkerChapter(chapterIndex, text));
    });
    if (!added.length) return;
    post({ type: "addChapters", bookKey: bookId, chapters: added });
    performance.measure("reader-search:send-text", {
      start: startedAt,
      detail: { chapters: added.length },
    });
    // A search that ran before this text arrived runs again.
    if (!running.current && searchedWithoutText.current)
      setTextVersion((version) => version + 1);
  }, [bookId, chapterAccess, chapters, textVersion]);

  const foldedQuery = foldQuery(query);
  const workerReady = textVersion > 0;

  // Each new query replaces the running search.
  useEffect(() => {
    const worker = workerRef.current;
    if (running.current) {
      worker?.postMessage({
        type: "cancel",
        searchId: running.current.id,
      } satisfies SearchWorkerRequest);
      running.current = null;
    }
    setResults(EMPTY_RESULTS);
    setActiveIndex(null);
    setShown(RESULTS_PAGE);
    setTruncated(false);
    setTiming({ firstResultMs: null, totalMs: null });
    setProgress({ searched: 0, total: chapters.length });
    searchedWithoutText.current = false;
    if (!foldedQuery) {
      setStatus("idle");
      return;
    }
    if (!worker || !workerReady) {
      setStatus("waiting");
      return;
    }
    const id = ++searchIds.current;
    running.current = {
      id,
      query: foldedQuery,
      startedAt: performance.now(),
      firstResultMs: null,
      chaptersWithText: sentTexts.current.size,
    };
    setStatus("searching");
    // Folding is idempotent, so the worker can take the folded query.
    worker.postMessage({
      type: "search",
      searchId: id,
      query: foldedQuery,
      limit: SEARCH_RESULT_LIMIT,
    } satisfies SearchWorkerRequest);
    // `textVersion` runs the search again when more text arrives.
  }, [chapters.length, foldedQuery, textVersion, workerReady]);

  const setQuery = useCallback(
    (next: string, options?: { remember?: boolean }) => {
      pendingStep.current = null;
      setQueryState(next);
      if (options?.remember !== false)
        saveQuery(bookId, next.trim() ? next : "");
    },
    [bookId],
  );

  const cancel = useCallback(() => {
    const search = running.current;
    if (!search) return;
    workerRef.current?.postMessage({
      type: "cancel",
      searchId: search.id,
    } satisfies SearchWorkerRequest);
    running.current = null;
    setStatus("done");
  }, []);

  // Fragment targets and headings live in a chapter's blocks, which arrive
  // as each chapter is parsed, so the sections are placed again as they do.
  const parsedChapters = enabled
    ? chapters.filter(
        (chapter) => chapterAccess.getBlocks(chapter.index) !== null,
      ).length
    : 0;
  const sections = useMemo(
    () =>
      parsedChapters
        ? buildSearchSections(
            toc,
            chapters,
            chapterAccess.getBlocks,
            chapterAccess.getCanonicalText,
          )
        : [],
    [chapterAccess, chapters, parsedChapters, toc],
  );
  const resultGroups = useMemo(() => {
    const grouped: (ReaderSearchChapterGroup & { section: boolean })[] = [];
    results.forEach((result, index) => {
      const section = findSection(sections, result.chapterIndex, result.start);
      const key = section
        ? `section:${section.order}`
        : `chapter:${result.chapterIndex}`;
      const last = grouped.at(-1);
      if (last?.key === key) {
        last.results.push(result);
        return;
      }
      grouped.push({
        key,
        title: section?.title ?? "",
        section: !!section,
        firstIndex: index,
        results: [result],
      });
    });
    return grouped;
  }, [results, sections]);

  // Results are placed on pages again whenever the layout changes.
  useEffect(() => {
    if (!results.length) return;
    const timer = window.setTimeout(() => {
      // Only results on screen, those near the reader for stepping from
      // where they are, and the last of each group on screen, whose page
      // ends the group's title, need a page.
      const groupEnds = new Set(
        resultGroups
          .filter((group) => group.firstIndex < shown)
          .map((group) => group.results.at(-1)!.id),
      );
      const byChapter = new Map<number, { id: string; offset: number }[]>();
      const wanted = results.filter(
        (result, index) =>
          index < shown ||
          result.chapterIndex === currentChapterIndex ||
          groupEnds.has(result.id),
      );
      for (const result of wanted) {
        const offsets = byChapter.get(result.chapterIndex) ?? [];
        offsets.push({ id: result.id, offset: result.start });
        byChapter.set(result.chapterIndex, offsets);
      }
      locateRequest.current = {
        startedAt: performance.now(),
        results: wanted.length,
      };
      locateTextOffsets(
        [...byChapter].flatMap(([chapterIndex, offsets]) => {
          const text = chapterAccess.getCanonicalText(chapterIndex);
          return text
            ? [{ chapterIndex, blockStarts: [...text.blockStarts], offsets }]
            : [];
        }),
        "search",
      );
    }, 80);
    return () => window.clearTimeout(timer);
  }, [
    chapterAccess,
    currentChapterIndex,
    layoutKey,
    locateTextOffsets,
    resultGroups,
    results,
    shown,
  ]);
  useEffect(() => {
    const request = locateRequest.current;
    if (!request) return;
    locateRequest.current = null;
    performance.measure("reader-search:locate", {
      start: request.startedAt,
      detail: { results: request.results },
    });
  }, [locations]);

  const pages = useMemo(() => {
    const byId: Record<string, number | null> = {};
    for (const result of results)
      byId[result.id] = locations[result.id]?.page ?? null;
    return byId;
  }, [locations, results]);

  // A file with no table of contents entry or heading is named by its
  // pages; its file name means nothing to a reader.
  const groups = useMemo(
    () =>
      resultGroups.map(({ section, ...group }) => {
        if (section) return group;
        const first = pages[group.results[0]!.id];
        const last = pages[group.results.at(-1)!.id];
        return {
          ...group,
          title: !first
            ? ""
            : !last
              ? `From page ${first}`
              : last !== first
                ? `Pages ${first}–${last}`
                : `Page ${first}`,
        };
      }),
    [pages, resultGroups],
  );

  const notes = useBookNotesQuery(bookId).data;
  const annotations = useMemo(() => {
    if (!foldedQuery) return [];
    const chapterOf = new Map(
      chapters.map((chapter) => [chapter.spineItemId, chapter.index]),
    );
    const found: ReaderSearchAnnotation[] = [];
    for (const note of notes ?? []) {
      const chapterIndex = chapterOf.get(note.anchor.spineItemId);
      if (chapterIndex === undefined || note.kind !== "note") continue;
      if (
        !includesFolded(note.content, foldedQuery) &&
        !includesFolded(note.quote?.text, foldedQuery)
      )
        continue;
      found.push({
        id: note.id,
        kind: "note",
        chapterIndex,
        offset: note.anchor.startOffset,
        text: note.content,
        quote: note.quote?.text,
        color: note.quote?.color,
      });
    }
    const quoted = new Set(
      (notes ?? []).flatMap((note) =>
        note.kind === "note" && note.highlightId ? [note.highlightId] : [],
      ),
    );
    for (const highlight of highlights) {
      const chapterIndex = chapterOf.get(highlight.spineItemId);
      if (chapterIndex === undefined || quoted.has(highlight.id)) continue;
      if (!includesFolded(highlight.selectedText, foldedQuery)) continue;
      found.push({
        id: highlight.id,
        kind: "highlight",
        chapterIndex,
        offset: highlight.startOffset,
        text: highlight.selectedText,
        color: highlight.color,
      });
    }
    return found.sort(
      (a, b) => a.chapterIndex - b.chapterIndex || a.offset - b.offset,
    );
  }, [chapters, foldedQuery, highlights, notes]);

  const open = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) return;
      pendingStep.current = null;
      setActiveIndex(index);
      setShown((count) =>
        Math.max(count, Math.ceil((index + 1) / RESULTS_PAGE) * RESULTS_PAGE),
      );
      goToTextOffset(result.chapterIndex, result.start, "search");
    },
    [goToTextOffset, results],
  );

  // Stepping starts from where the reader is. Read at the step, so a page
  // turn does not make a new search object for everything that shows it.
  const position = useRef({
    currentChapterIndex,
    currentPageInChapter,
    locations,
  });
  useLayoutEffect(() => {
    position.current = { currentChapterIndex, currentPageInChapter, locations };
  });
  /**
   * Whether a result sits after (1), at (0) or before (-1) the reader.
   * Within a chapter it compares pages of that chapter: book page numbers
   * shift while earlier chapters are still being laid out.
   */
  const compareToReader = useCallback((result: ReaderSearchResult) => {
    const { currentChapterIndex, currentPageInChapter, locations } =
      position.current;
    if (result.chapterIndex !== currentChapterIndex)
      return Math.sign(result.chapterIndex - currentChapterIndex);
    const page = locations[result.id]?.pageInChapter;
    return page && currentPageInChapter
      ? Math.sign(page - currentPageInChapter)
      : 0;
  }, []);

  // Until the matches in the reader's chapter are on pages, a step could
  // only tell the chapter and would open its first match, which may be
  // behind the reader. Such a step waits for them in `pendingStep`.
  const placingReaderChapter = useCallback(() => {
    const { currentChapterIndex, locations } = position.current;
    return results.some(
      (result) =>
        result.chapterIndex === currentChapterIndex &&
        !(result.id in locations),
    );
  }, [results]);

  const stepFromReader = useCallback(
    (direction: "next" | "previous") => {
      if (placingReaderChapter()) {
        pendingStep.current = direction;
        return;
      }
      pendingStep.current = null;
      if (direction === "next") {
        const after = results.findIndex(
          (result) => compareToReader(result) >= 0,
        );
        open(after < 0 ? 0 : after);
      } else {
        let before = results.length - 1;
        while (before >= 0 && compareToReader(results[before]!) > 0) before--;
        open(before < 0 ? results.length - 1 : before);
      }
    },
    [compareToReader, open, placingReaderChapter, results],
  );
  useEffect(() => {
    const direction = pendingStep.current;
    if (direction && !placingReaderChapter()) stepFromReader(direction);
  }, [locations, placingReaderChapter, stepFromReader]);

  const next = useCallback(() => {
    if (!results.length) return;
    if (activeIndex === null) stepFromReader("next");
    else if (activeIndex < results.length - 1) open(activeIndex + 1);
  }, [activeIndex, open, results.length, stepFromReader]);

  const previous = useCallback(() => {
    if (!results.length) return;
    if (activeIndex === null) stepFromReader("previous");
    else if (activeIndex > 0) open(activeIndex - 1);
  }, [activeIndex, open, results.length, stepFromReader]);

  const openAnnotation = useCallback(
    (annotation: ReaderSearchAnnotation) => {
      setActiveIndex(null);
      goToTextOffset(
        annotation.chapterIndex,
        annotation.offset,
        annotation.kind,
      );
    },
    [goToTextOffset],
  );

  const exit = useCallback(() => {
    pendingStep.current = null;
    setActiveIndex(null);
  }, []);
  const showMore = useCallback(
    () => setShown((count) => count + RESULTS_PAGE),
    [],
  );

  const state = useMemo<ReaderSearchState>(
    () => ({
      query,
      status,
      results,
      groups,
      annotations,
      pages,
      searchedChapters: progress.searched,
      totalChapters: progress.total || chapters.length,
      truncated,
      activeIndex,
      shown,
      firstResultMs: timing.firstResultMs,
      totalMs: timing.totalMs,
    }),
    [
      activeIndex,
      annotations,
      chapters.length,
      groups,
      pages,
      progress,
      query,
      results,
      shown,
      status,
      timing,
      truncated,
    ],
  );
  return useMemo(
    () => ({
      state,
      setQuery,
      showMore,
      cancel,
      open,
      next,
      previous,
      openAnnotation,
      exit,
    }),
    [
      cancel,
      exit,
      next,
      open,
      openAnnotation,
      previous,
      setQuery,
      showMore,
      state,
    ],
  );
}
