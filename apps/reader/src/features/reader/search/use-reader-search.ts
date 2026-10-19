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
  SearchStart,
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

/**
 * Enough to step through. A search starts at the reader, so a word on every
 * page keeps the matches nearest it.
 */
export const SEARCH_RESULT_LIMIT = 1000;
/** Results from the reader's page placed on pages, to step from it. */
const READER_RESULTS_PLACED = 32;
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
  /**
   * The query changed and its first results have not arrived, so `results`
   * are still the last query's. Typing never blanks the list.
   */
  pending: boolean;
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
  /** Search has opened: its worker starts now, with all the text at once. */
  enabled: boolean;
  /**
   * The book is showing: the worker starts when the page is idle and folds
   * the text there, so the first search only has to match.
   */
  warm?: boolean;
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
  /** Canonical offset in the reader's chapter where its page begins. */
  readerOffset: number | null;
  goToTextOffset: (
    chapterIndex: number,
    offset: number,
    source: "search" | "highlight" | "note" | "search-preview",
  ) => void;
  /**
   * Opens results without moving the reading position or adding to the
   * history, for a preview of a book that is being read elsewhere.
   */
  previewOnly?: boolean;
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

/** Runs `callback` when the page is idle. Returns a cancel. */
function whenIdle(callback: () => void): () => void {
  if (typeof window.requestIdleCallback === "function") {
    const id = window.requestIdleCallback(callback, { timeout: 2000 });
    return () => window.cancelIdleCallback(id);
  }
  const id = window.setTimeout(callback, 100);
  return () => window.clearTimeout(id);
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
  /** Its results have replaced the last query's. */
  replaced: boolean;
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
  warm = false,
  chapters,
  toc,
  chapterAccess,
  highlights,
  locations,
  locateTextOffsets,
  layoutKey,
  currentChapterIndex,
  currentPageInChapter,
  readerOffset,
  goToTextOffset,
  previewOnly = false,
}: UseReaderSearchOptions): ReaderSearch {
  const [query, setQueryState] = useState(() => readSavedQuery(bookId));
  const [status, setStatus] = useState<ReaderSearchStatus>("idle");
  const [pending, setPending] = useState(false);
  const [results, setResults] = useState<ReaderSearchResult[]>(EMPTY_RESULTS);
  const [progress, setProgress] = useState({ searched: 0, total: 0 });
  const [truncated, setTruncated] = useState(false);
  const [timing, setTiming] = useState<{
    firstResultMs: number | null;
    totalMs: number | null;
  }>({ firstResultMs: null, totalMs: null });
  const [activeId, setActiveId] = useState<string | null>(null);
  const [shown, setShown] = useState(RESULTS_PAGE);
  // Each book keeps its own last search.
  const [searchedBook, setSearchedBook] = useState(bookId);
  if (searchedBook !== bookId) {
    setSearchedBook(bookId);
    setQueryState(readSavedQuery(bookId));
    setActiveId(null);
  }
  const [textVersion, setTextVersion] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const sentTexts = useRef(new Map<number, ChapterCanonicalText>());
  const sentBook = useRef("");
  /** A step from the reader, waiting for the nearest results' pages. */
  const pendingStep = useRef<"next" | "previous" | null>(null);
  /**
   * Where the reader's page begins: the start of its first text block.
   * Searches start here, and a step from the reader compares with it.
   */
  const readerStart = useRef<SearchStart | null>(null);
  useLayoutEffect(() => {
    readerStart.current =
      readerOffset === null
        ? null
        : { chapterIndex: currentChapterIndex, offset: readerOffset };
  });
  /** The results the latest pages are for. */
  const placedResults = useRef<ReaderSearchResult[] | null>(null);
  const locateRequest = useRef<{
    startedAt: number;
    results: ReaderSearchResult[];
    wanted: number;
  } | null>(null);
  const running = useRef<RunningSearch | null>(null);
  const searchIds = useRef(0);
  /** The last search finished without some chapters' text. */
  const searchedWithoutText = useRef(false);

  const handleMessage = useCallback((response: SearchWorkerResponse) => {
    if (response.type === "folded") {
      performance.measure("reader-search:fold", {
        start: performance.now() - response.ms,
        duration: response.ms,
        detail: { chapters: response.chapters, workerMs: response.ms },
      });
      return;
    }
    const search = running.current;
    if (!search || response.searchId !== search.id) return;
    // The last query's results stay until this one's first message.
    if (!search.replaced) {
      search.replaced = true;
      setPending(false);
      setResults(EMPTY_RESULTS);
      setShown(RESULTS_PAGE);
      setTruncated(false);
      setTiming({ firstResultMs: null, totalMs: null });
    }
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
      // A search starts at the reader and wraps, so earlier chapters can
      // arrive last; the list stays in book order.
      if (found.length)
        setResults((previous) =>
          [...previous, ...found].sort(
            (a, b) => a.chapterIndex - b.chapterIndex || a.start - b.start,
          ),
        );
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

  // The worker starts when the page is first idle, or when search opens,
  // and lives as long as the book.
  const [warmed, setWarmed] = useState(false);
  useEffect(() => {
    if (!warm || warmed || enabled) return;
    return whenIdle(() => setWarmed(true));
  }, [enabled, warm, warmed]);
  const started = enabled || warmed;
  useEffect(() => {
    if (!started || workerRef.current) return;
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
  }, [handleMessage, started]);
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
    const post = (request: SearchWorkerRequest) => worker.postMessage(request);
    if (sentBook.current !== bookId) {
      sentBook.current = bookId;
      sentTexts.current.clear();
    }
    post({ type: "setBook", bookKey: bookId, chapterCount: chapters.length });
    const unsent = chapters.flatMap((_, chapterIndex) => {
      const text = chapterAccess.getCanonicalText(chapterIndex);
      return text && sentTexts.current.get(chapterIndex) !== text
        ? [{ chapterIndex, text }]
        : [];
    });
    const send = (batch: typeof unsent) => {
      const startedAt = performance.now();
      const added: SearchWorkerChapter[] = batch.map(
        ({ chapterIndex, text }) => {
          sentTexts.current.set(chapterIndex, text);
          return toWorkerChapter(chapterIndex, text);
        },
      );
      post({ type: "addChapters", bookKey: bookId, chapters: added });
      performance.measure("reader-search:send-text", {
        start: startedAt,
        detail: { chapters: added.length },
      });
    };
    if (!unsent.length) return;
    if (enabled) {
      send(unsent);
      // A search that ran before this text arrived runs again.
      if (!running.current && searchedWithoutText.current)
        setTextVersion((version) => version + 1);
      return;
    }
    // Before search opens, a chapter at a time while the page is idle:
    // copying a whole book to the worker would hold up a frame.
    let sent = 0;
    let cancel = whenIdle(function sendNext() {
      send([unsent[sent++]!]);
      if (sent < unsent.length) cancel = whenIdle(sendNext);
    });
    return () => cancel();
  }, [bookId, chapterAccess, chapters, enabled, textVersion]);

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
    setActiveId(null);
    searchedWithoutText.current = false;
    // A warm worker only folds: searching waits until search opens.
    if (!foldedQuery || !worker || !workerReady || !enabled) {
      setPending(false);
      setResults(EMPTY_RESULTS);
      setShown(RESULTS_PAGE);
      setTruncated(false);
      setTiming({ firstResultMs: null, totalMs: null });
      setProgress({ searched: 0, total: chapters.length });
      setStatus(foldedQuery ? "waiting" : "idle");
      return;
    }
    const id = ++searchIds.current;
    running.current = {
      id,
      query: foldedQuery,
      startedAt: performance.now(),
      firstResultMs: null,
      chaptersWithText: sentTexts.current.size,
      replaced: false,
    };
    setPending(true);
    setStatus("searching");
    // Folding is idempotent, so the worker can take the folded query.
    worker.postMessage({
      type: "search",
      searchId: id,
      query: foldedQuery,
      limit: SEARCH_RESULT_LIMIT,
      from: readerStart.current ?? undefined,
    } satisfies SearchWorkerRequest);
    // `textVersion` runs the search again when more text arrives.
  }, [chapters.length, enabled, foldedQuery, textVersion, workerReady]);

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
    if (!search.replaced) {
      setPending(false);
      setResults(EMPTY_RESULTS);
    }
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

  // Results are placed on pages again whenever the layout changes, after a
  // short pause, so a word being typed is not placed at every letter.
  useEffect(() => {
    if (!results.length) return;
    const timer = window.setTimeout(() => {
      // Only results on screen, the last of each group on screen, whose
      // page ends the group's title, and the first few from the reader's
      // page, which a step from the reader picks between, need a page.
      const groupEnds = new Set(
        resultGroups
          .filter((group) => group.firstIndex < shown)
          .map((group) => group.results.at(-1)!.id),
      );
      const reader = readerStart.current;
      let nearReader = 0;
      const byChapter = new Map<number, { id: string; offset: number }[]>();
      const wanted = results.filter((result, index) => {
        if (index < shown || groupEnds.has(result.id)) return true;
        if (
          reader?.chapterIndex === result.chapterIndex &&
          result.start >= reader.offset &&
          nearReader < READER_RESULTS_PLACED
        ) {
          nearReader++;
          return true;
        }
        return false;
      });
      for (const result of wanted) {
        const offsets = byChapter.get(result.chapterIndex) ?? [];
        offsets.push({ id: result.id, offset: result.start });
        byChapter.set(result.chapterIndex, offsets);
      }
      locateRequest.current = {
        startedAt: performance.now(),
        results,
        wanted: wanted.length,
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
    }, 40);
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
    placedResults.current = request.results;
    performance.measure("reader-search:locate", {
      start: request.startedAt,
      detail: { results: request.wanted },
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

  // The active result is kept by id: matches from earlier chapters can
  // arrive after it and move it down the list.
  const activeIndex = useMemo(() => {
    if (activeId === null) return null;
    const index = results.findIndex((result) => result.id === activeId);
    return index < 0 ? null : index;
  }, [activeId, results]);

  const open = useCallback(
    (index: number) => {
      const result = results[index];
      if (!result) return;
      pendingStep.current = null;
      setActiveId(result.id);
      setShown((count) =>
        Math.max(count, Math.ceil((index + 1) / RESULTS_PAGE) * RESULTS_PAGE),
      );
      goToTextOffset(
        result.chapterIndex,
        result.start,
        previewOnly ? "search-preview" : "search",
      );
    },
    [goToTextOffset, previewOnly, results],
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
   * Within the reader's chapter a placed result compares pages of that
   * chapter, since book page numbers shift while earlier chapters are laid
   * out. Any other compares with where the reader's page begins.
   */
  const compareToReader = useCallback((result: ReaderSearchResult) => {
    const { currentChapterIndex, currentPageInChapter, locations } =
      position.current;
    if (result.chapterIndex !== currentChapterIndex)
      return Math.sign(result.chapterIndex - currentChapterIndex);
    const page = locations[result.id]?.pageInChapter;
    if (page && currentPageInChapter)
      return Math.sign(page - currentPageInChapter);
    const reader = readerStart.current;
    if (reader?.chapterIndex !== result.chapterIndex) return 0;
    return result.start < reader.offset ? -1 : 1;
  }, []);

  const stepFromReader = useCallback(
    (direction: "next" | "previous") => {
      // Until these results nearest the reader are on pages, a step waits
      // in `pendingStep`, or it could open a match on the page before, in a
      // paragraph that runs onto the reader's page.
      if (placedResults.current !== results) {
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
    [compareToReader, open, results],
  );
  useEffect(() => {
    const direction = pendingStep.current;
    if (direction && placedResults.current === results)
      stepFromReader(direction);
  }, [locations, results, stepFromReader]);

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
      setActiveId(null);
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
    setActiveId(null);
  }, []);
  const showMore = useCallback(
    () => setShown((count) => count + RESULTS_PAGE),
    [],
  );

  const state = useMemo<ReaderSearchState>(
    () => ({
      query,
      status,
      pending,
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
      pending,
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
