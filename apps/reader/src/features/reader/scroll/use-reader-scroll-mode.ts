import type {
  ChapterColumnLayout,
  ContentAnchor,
  ResolvedSpread,
  ResolvedSpreadWindow,
  SpreadIntent,
} from "@/lib/pagination-v2";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { sameReaderAnchor } from "../jump-history";
import { getLeadingVisiblePage, type ReaderLocation } from "../reader-location";
import type { ChapterEntry } from "../types";
import type { ReaderSessionChapterAccess } from "../hooks/use-reader-session";
import {
  pullResistance,
  type ScrollPosition,
  type ScrollStageEnter,
  type ScrollStageHandle,
  type ScrollStageStart,
} from "./ScrollStage";
import {
  loadScrollPlace,
  saveScrollPlace,
  setReadingModePreference,
  useReadingModePreference,
  type ReadingMode,
} from "./reading-mode-preference";
import {
  buildColumnSelectionSpread,
  buildColumnViewSpread,
  countChapterWords,
  formatMinutes,
  READING_WORDS_PER_MINUTE,
} from "./scroll-model";
import { captureSelection, type SelectionLocators } from "./selection-transfer";

export type { ReadingMode };

/** Pull distance, after resistance, at which a release enters scroll mode. */
export const PULL_THRESHOLD_PX = 64;

/**
 * - off: paged reading.
 * - opening: waits for the chapter column; the page stays on screen.
 * - pulling: a pull from pages drags the column; release decides.
 * - on: the scroll stage shows. Until `entered`, the paged spread stays
 *   mounted under it, so the switch never shows an empty frame. `pending`
 *   is a jump to another chapter whose column has not arrived yet.
 * - closing: the snap runs; the spread mounts once it shows the target page.
 */
type ScrollPhase =
  | { kind: "off" }
  | {
      kind: "opening";
      chapterIndex: number;
      start: ScrollStageStart;
      enter: ScrollStageEnter;
      /** Hides the paged spread until the column shows (reopening a book). */
      restoring: boolean;
      selection: SelectionLocators | null;
    }
  | {
      kind: "pulling";
      chapterIndex: number;
      pageIndex: number;
      generation: number;
    }
  | {
      kind: "on";
      chapterIndex: number;
      start: ScrollStageStart;
      enter: ScrollStageEnter;
      entered: boolean;
      restoring: boolean;
      selection: SelectionLocators | null;
      generation: number;
      pending: { chapterIndex: number; start: ScrollStageStart } | null;
    }
  | {
      kind: "closing";
      chapterIndex: number;
      pageIndex: number;
      animationDone: boolean;
      swapping: boolean;
      generation: number;
    };

interface UseReaderScrollModeOptions {
  bookId: string | undefined;
  enabled: boolean;
  /** Pull-to-scroll needs touch; the switch works everywhere. */
  touch: boolean;
  /** The reader has painted its first spread. */
  ready: boolean;
  spread: ResolvedSpread | null;
  spreadWindow: ResolvedSpreadWindow | null;
  column: ChapterColumnLayout | null;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  totalPages: number;
  chapterAccess: ReaderSessionChapterAccess;
  setScrollChapter: (chapterIndex: number | null) => void;
  goToAnchor: (anchor: ContentAnchor, intent: SpreadIntent) => void;
  goToChapter: (chapterIndex: number) => void;
  /** The paged spread's content, for a selection that moves into scroll. */
  stageContentRef: RefObject<HTMLDivElement | null>;
  /** Scroll mode's location; null in pages. */
  onLocationChange: (location: ReaderLocation | null) => void;
}

const NAVIGATION_INTENTS = new Set<SpreadIntent["kind"]>(["jump", "history"]);

type SpreadPage = NonNullable<ReturnType<typeof getLeadingVisiblePage>>;

function spreadPages(spread: ResolvedSpread | null): SpreadPage[] {
  return (spread?.slots ?? []).flatMap((slot) =>
    slot.kind === "page" ? [slot.page] : [],
  );
}

/**
 * Page jumps carry the page's own anchor, a line from its middle; the column
 * opens such a jump at the page's top. Any other anchor is an exact place.
 */
function resolveStart(
  start: ScrollStageStart,
  column: ChapterColumnLayout,
): ScrollStageStart {
  if (start.kind !== "anchor" || start.exact) return start;
  const pageIndex = column.pageAnchors.findIndex((anchor) =>
    sameReaderAnchor(anchor, start.anchor),
  );
  return pageIndex >= 0 ? { kind: "page", pageIndex } : start;
}

/**
 * The page a spread was opened for. A two-page spread can lead with the end
 * of the previous chapter; the engine's anchor names the page meant.
 */
function targetPage(
  spread: ResolvedSpread | null,
  anchor: ContentAnchor | null | undefined,
): SpreadPage | null {
  const pages = spreadPages(spread);
  return (
    (anchor &&
      pages.find((page) => page.chapterIndex === anchor.chapterIndex)) ||
    pages[0] ||
    null
  );
}

/**
 * Owns the Debug-mode reading layout for one Reader: Pages or Scroll.
 *
 * Content anchors carry the place across modes. Scroll → Pages snaps the
 * page that holds the reading line into place; Pages → Scroll opens at that
 * page's offset, from the settings switch, a pull past the threshold, or the
 * selection chip. While scrolling, the location goes to the reader as a
 * mode-neutral `ReaderLocation`: progress, sessions, history and page numbers
 * follow it without moving the paged engine. Jumps (contents, scrubber,
 * links, notes, history) still run through the engine and move the column to
 * the exact anchor. Leaving scroll mode moves the engine once.
 */
export function useReaderScrollMode({
  bookId,
  enabled,
  touch,
  ready,
  spread,
  spreadWindow,
  column,
  chapterEntries,
  chapterStartPages,
  totalPages,
  chapterAccess,
  setScrollChapter,
  goToAnchor,
  goToChapter,
  stageContentRef,
  onLocationChange,
}: UseReaderScrollModeOptions) {
  const preferredMode = useReadingModePreference();
  const [phase, setPhase] = useState<ScrollPhase>({ kind: "off" });
  const [position, setPosition] = useState<ScrollPosition | null>(null);
  const [renderedRows, setRenderedRows] = useState("");
  const handleRef = useRef<ScrollStageHandle>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const handledSpreadRef = useRef<ResolvedSpread | null>(null);
  const restoredRef = useRef(false);
  const generationRef = useRef(0);
  const lastSettledRef = useRef<ScrollPosition | null>(null);
  const windowing = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("scrollWindow") !== "off",
    [],
  );

  const leadingPage = getLeadingVisiblePage(spread);
  const leadingChapter = leadingPage?.chapterIndex ?? null;

  // Pages mode keeps the current chapter's column ready, so a pull or the
  // selection chip can start without waiting for the worker.
  const subscribedChapter =
    !enabled || !ready
      ? null
      : phase.kind === "off"
        ? leadingChapter
        : phase.kind === "on" && phase.pending
          ? phase.pending.chapterIndex
          : phase.chapterIndex;
  useEffect(() => {
    setScrollChapter(subscribedChapter);
  }, [setScrollChapter, subscribedChapter]);

  const stageColumn =
    (phase.kind === "on" ||
      phase.kind === "closing" ||
      phase.kind === "pulling") &&
    column?.chapterIndex === phase.chapterIndex
      ? column
      : null;
  const mode: ReadingMode =
    phase.kind === "off" || phase.kind === "closing" ? "pages" : "scroll";

  const open = useCallback(
    (options: {
      page?: SpreadPage | null;
      start?: ScrollStageStart;
      enter?: ScrollStageEnter;
      restoring?: boolean;
      selection?: SelectionLocators | null;
    }) => {
      const page = options.page ?? getLeadingVisiblePage(spread);
      if (!page) return false;
      setPhase({
        kind: "opening",
        chapterIndex: page.chapterIndex,
        start: options.start ?? {
          kind: "page",
          pageIndex: page.currentPageInChapter - 1,
        },
        enter: options.enter ?? "keep-page",
        restoring: options.restoring ?? false,
        selection: options.selection ?? null,
      });
      return true;
    },
    [spread],
  );

  const close = useCallback(
    (velocityX = 0) => {
      if (phase.kind !== "on" || !phase.entered || !stageColumn) return;
      const handle = handleRef.current;
      if (!handle) return;
      const { pageIndex, finished } = handle.snapToPage({ velocityX });
      const anchor = stageColumn.pageAnchors[pageIndex];
      // The pages own the place again: the engine's move to the snapped page
      // is the reading move that progress and history record.
      onLocationChange(null);
      if (anchor) {
        goToAnchor(anchor, { kind: "linear", direction: "forward" });
      }
      setPhase({
        kind: "closing",
        chapterIndex: stageColumn.chapterIndex,
        pageIndex,
        animationDone: false,
        swapping: false,
        generation: phase.generation,
      });
      void finished.then(() =>
        setPhase((current) =>
          current.kind === "closing"
            ? { ...current, animationDone: true }
            : current,
        ),
      );
    },
    [goToAnchor, onLocationChange, phase, stageColumn],
  );

  const setMode = useCallback(
    (next: ReadingMode, options: { velocityX?: number } = {}) => {
      setReadingModePreference(next);
      if (next === "scroll") {
        if (phase.kind === "off") open({});
        return;
      }
      close(options.velocityX);
    },
    [close, open, phase.kind],
  );

  // Debug mode turned off: return to pages without animation.
  useEffect(() => {
    if (enabled || phase.kind === "off") return;
    setPhase({ kind: "off" });
    onLocationChange(null);
  }, [enabled, onLocationChange, phase.kind]);

  // A book last read in scroll mode reopens in scroll mode, at the line that
  // was at the top of the view. The engine opened at that exact anchor.
  useEffect(() => {
    if (restoredRef.current || !enabled || !ready) return;
    if (!spread || phase.kind !== "off") return;
    restoredRef.current = true;
    if (preferredMode !== "scroll") return;
    const anchor = spreadWindow?.anchor;
    const page = targetPage(spread, anchor);
    const place = bookId ? loadScrollPlace(bookId) : null;
    open({
      page,
      start:
        anchor && page && anchor.chapterIndex === page.chapterIndex
          ? {
              kind: "anchor",
              anchor,
              // The line last at the top of the view, not a page jump.
              exact: place !== null && sameReaderAnchor(place, anchor),
            }
          : undefined,
      enter: "fade-all",
      restoring: true,
    });
  }, [
    bookId,
    enabled,
    open,
    phase.kind,
    preferredMode,
    ready,
    spread,
    spreadWindow,
  ]);

  // The column arrived: show the stage.
  useEffect(() => {
    if (phase.kind !== "opening") return;
    if (column?.chapterIndex !== phase.chapterIndex) return;
    handledSpreadRef.current = spread;
    lastSettledRef.current = null;
    generationRef.current += 1;
    setPhase({
      kind: "on",
      chapterIndex: phase.chapterIndex,
      start: resolveStart(phase.start, column),
      enter: phase.enter,
      entered: false,
      restoring: phase.restoring,
      selection: phase.selection,
      generation: generationRef.current,
      pending: null,
    });
  }, [column, phase, spread]);

  // A jump to another chapter: show its column once it arrives.
  useEffect(() => {
    if (phase.kind !== "on" || !phase.pending) return;
    if (column?.chapterIndex !== phase.pending.chapterIndex) return;
    generationRef.current += 1;
    lastSettledRef.current = null;
    setPhase({
      ...phase,
      chapterIndex: phase.pending.chapterIndex,
      start: resolveStart(phase.pending.start, column),
      enter: "fade-all",
      entered: true,
      restoring: false,
      selection: null,
      generation: generationRef.current,
      pending: null,
    });
  }, [column, phase]);

  // The snap is done and pagination shows the same page: swap stages.
  useEffect(() => {
    if (phase.kind !== "closing" || !phase.animationDone || phase.swapping) {
      return;
    }
    const shown = spreadPages(spread).some(
      (page) =>
        page.chapterIndex === phase.chapterIndex &&
        page.currentPageInChapter - 1 === phase.pageIndex,
    );
    if (!shown) return;
    setPhase({ ...phase, swapping: true });
  }, [phase, spread]);

  // Keep the scroll stage over the new spread for two frames, so the spread
  // paints (and its images decode) before the stage goes.
  useEffect(() => {
    if (phase.kind !== "closing" || !phase.swapping) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setPosition(null);
        setPhase({ kind: "off" });
        onLocationChange(null);
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [onLocationChange, phase]);

  // Contents, scrubber, links, notes, chapter keys and history move the
  // column to the engine's exact anchor.
  useEffect(() => {
    if (phase.kind !== "on" || !spread) return;
    if (handledSpreadRef.current === spread) return;
    handledSpreadRef.current = spread;
    if (!NAVIGATION_INTENTS.has(spread.intent.kind)) return;
    const anchor = spreadWindow?.anchor ?? null;
    const page = targetPage(spread, anchor);
    if (!page) return;
    const pageIndex = page.currentPageInChapter - 1;
    // Settled against the column once it is the target chapter's.
    const start: ScrollStageStart =
      anchor && anchor.chapterIndex === page.chapterIndex
        ? { kind: "anchor", anchor }
        : { kind: "page", pageIndex };

    if (page.chapterIndex === phase.chapterIndex && column) {
      const settled = resolveStart(start, column);
      const handle = handleRef.current;
      if (!handle) return;
      if (settled.kind === "anchor" && handle.scrollToAnchor(settled.anchor)) {
        return;
      }
      handle.scrollToPage(pageIndex);
      return;
    }
    setPhase({
      ...phase,
      pending: { chapterIndex: page.chapterIndex, start },
    });
  }, [column, phase, spread, spreadWindow]);

  const toLocation = useCallback(
    (next: ScrollPosition, intent: SpreadIntent): ReaderLocation | null => {
      if (!stageColumn) return null;
      const firstPage = chapterStartPages[stageColumn.chapterIndex];
      const fallbackPage = getLeadingVisiblePage(spread);
      const currentPage =
        firstPage !== null && firstPage !== undefined
          ? firstPage + next.pageIndex
          : (fallbackPage?.currentPage ?? 1);
      return {
        chapterIndex: stageColumn.chapterIndex,
        pageIndexInChapter: next.pageIndex,
        totalPagesInChapter: Math.max(1, stageColumn.pageStarts.length),
        currentPage,
        totalPages: Math.max(totalPages, currentPage),
        anchor: next.topAnchor,
        intent,
      };
    },
    [chapterStartPages, spread, stageColumn, totalPages],
  );

  // Page numbers and totals grow while the rest of the book paginates.
  useEffect(() => {
    if (phase.kind !== "on" || !position) return;
    onLocationChange(toLocation(position, { kind: "replace" }));
  }, [onLocationChange, phase.kind, position, toLocation]);

  const onPageChange = useCallback(
    (next: ScrollPosition) => {
      if (phase.kind !== "on") return;
      setPosition(next);
      // A live page number; not a reading move yet.
      onLocationChange(toLocation(next, { kind: "replace" }));
    },
    [onLocationChange, phase.kind, toLocation],
  );

  const onPositionSettled = useCallback(
    (next: ScrollPosition, cause: "user" | "program") => {
      if (phase.kind !== "on") return;
      setPosition(next);
      const previous = lastSettledRef.current;
      lastSettledRef.current = next;
      // Only the reader's own scrolling is a reading move. Opening, jumps
      // and relayouts update the place without adding history.
      const moved =
        cause === "user" &&
        (!previous?.topAnchor ||
          !next.topAnchor ||
          !sameReaderAnchor(previous.topAnchor, next.topAnchor));
      const direction =
        previous && previous.pageIndex > next.pageIndex
          ? "backward"
          : "forward";
      if (moved && bookId && next.topAnchor) {
        saveScrollPlace(bookId, next.topAnchor);
      }
      onLocationChange(
        toLocation(
          next,
          moved ? { kind: "linear", direction } : { kind: "replace" },
        ),
      );
    },
    [bookId, onLocationChange, phase.kind, toLocation],
  );

  const onEntered = useCallback(() => {
    setPhase((current) =>
      current.kind === "on"
        ? { ...current, entered: true, restoring: false }
        : current,
    );
  }, []);

  // The selection chip: select the same text in the column once it shows.
  useEffect(() => {
    if (phase.kind !== "on" || !phase.entered || !phase.selection) return;
    handleRef.current?.restoreSelection(phase.selection);
    setPhase({ ...phase, selection: null });
  }, [phase]);

  /** Selection chip: moves a page selection into scroll mode. */
  const enterWithSelection = useCallback(
    (captured?: SelectionLocators | null) => {
      if (phase.kind !== "off") return false;
      const container = stageContentRef.current?.querySelector(
        '[data-reader-spread-layer="current"]',
      );
      const selection =
        captured ??
        (container ? captureSelection(container, window.getSelection()) : null);
      setReadingModePreference("scroll");
      return open({ selection });
    },
    [open, phase.kind, stageContentRef],
  );

  // Pull to scroll, driven by the pages' touch handler.
  const pull = useMemo(
    () => ({
      canStart: () =>
        enabled &&
        touch &&
        phase.kind === "off" &&
        leadingChapter !== null &&
        column?.chapterIndex === leadingChapter,
      start: () => {
        const page = getLeadingVisiblePage(spread);
        if (!page || column?.chapterIndex !== page.chapterIndex) return false;
        generationRef.current += 1;
        setPhase({
          kind: "pulling",
          chapterIndex: page.chapterIndex,
          pageIndex: page.currentPageInChapter - 1,
          generation: generationRef.current,
        });
        return true;
      },
      move: (distance: number) => {
        handleRef.current?.setPullOffset(pullResistance(distance));
      },
      end: (distance: number) => {
        const offset = pullResistance(distance);
        const commit = offset >= PULL_THRESHOLD_PX;
        const handle = handleRef.current;
        if (!handle) {
          setPhase({ kind: "off" });
          return;
        }
        handle.setPullOffset(offset);
        void handle.finishPull(commit).then(() => {
          if (!commit) {
            setPhase((current) =>
              current.kind === "pulling" ? { kind: "off" } : current,
            );
            return;
          }
          setReadingModePreference("scroll");
          handledSpreadRef.current = spread;
          lastSettledRef.current = null;
          setPhase((current) =>
            current.kind === "pulling"
              ? {
                  kind: "on",
                  chapterIndex: current.chapterIndex,
                  start: { kind: "page", pageIndex: current.pageIndex },
                  enter: "pull",
                  entered: false,
                  restoring: false,
                  selection: null,
                  // Same generation: the pulled stage stays mounted.
                  generation: current.generation,
                  pending: null,
                }
              : current,
          );
        });
      },
    }),
    [column, enabled, leadingChapter, phase.kind, spread, touch],
  );

  const chapterWords = useMemo(() => {
    if (!stageColumn) return null;
    const text = chapterAccess.getCanonicalText(stageColumn.chapterIndex);
    return text ? countChapterWords(text) : null;
  }, [chapterAccess, stageColumn]);

  const nextChapter = useMemo(() => {
    if (!stageColumn) return null;
    const nextIndex = stageColumn.chapterIndex + 1;
    const entry = chapterEntries[nextIndex];
    if (!entry) return null;
    const text = chapterAccess.getCanonicalText(nextIndex);
    return {
      index: nextIndex,
      title: entry.title,
      readingTime: text
        ? formatMinutes(countChapterWords(text) / READING_WORDS_PER_MINUTE)
        : null,
    };
  }, [chapterAccess, chapterEntries, stageColumn]);

  // The scroll stage is on top from its first frame, so selections belong to
  // it even while the paged spread is still mounted underneath.
  const selectable = phase.kind === "on";
  const selectionSpread = useMemo(
    () =>
      stageColumn && selectable
        ? buildColumnSelectionSpread(stageColumn)
        : null,
    [selectable, stageColumn],
  );
  const viewSpread = useMemo(
    () =>
      stageColumn && selectable && position
        ? buildColumnViewSpread(
            stageColumn,
            position.topAnchor,
            position.firstVisiblePage,
          )
        : null,
    [position, selectable, stageColumn],
  );

  const firstGlobalPage = stageColumn
    ? (chapterStartPages[stageColumn.chapterIndex] ?? null)
    : null;
  const visiblePages =
    phase.kind === "on" && position && firstGlobalPage !== null
      ? {
          first: firstGlobalPage + position.firstVisiblePage,
          last: firstGlobalPage + position.lastVisiblePage,
        }
      : null;

  const progressLabel =
    phase.kind !== "on" || !position || chapterWords === null
      ? null
      : position.progress >= 0.995
        ? "End of chapter"
        : `${Math.round(position.progress * 100)}% of chapter · ${formatMinutes(
            ((1 - position.progress) * chapterWords) / READING_WORDS_PER_MINUTE,
          )} left`;

  const stageVisible =
    phase.kind === "on" || phase.kind === "closing" || phase.kind === "pulling";
  const stageStart: ScrollStageStart | null =
    phase.kind === "on"
      ? phase.start
      : phase.kind === "pulling" || phase.kind === "closing"
        ? { kind: "page", pageIndex: phase.pageIndex }
        : null;
  const stageEnter: ScrollStageEnter =
    phase.kind === "on"
      ? phase.enter
      : phase.kind === "pulling"
        ? "pull"
        : "keep-page";
  const previewing = phase.kind === "on" && spread?.intent.kind === "preview";
  const stageGeneration =
    phase.kind === "on" || phase.kind === "closing" || phase.kind === "pulling"
      ? phase.generation
      : 0;

  return {
    mode,
    /** The saved layout choice, for the settings switch. */
    preferredMode: enabled ? preferredMode : ("pages" as const),
    setMode,
    switchDisabled:
      phase.kind === "opening" ||
      phase.kind === "closing" ||
      phase.kind === "pulling" ||
      (phase.kind === "on" && !phase.entered),
    /** The paged spread renders: always, except under a settled stage. */
    showSpreadStage:
      phase.kind === "off" ||
      phase.kind === "opening" ||
      phase.kind === "pulling" ||
      (phase.kind === "on" &&
        (!phase.entered || previewing || phase.pending !== null)) ||
      (phase.kind === "closing" && phase.swapping),
    /** The spread draws above the column: a scrubber preview or a jump. */
    spreadAboveStage:
      phase.kind === "on" &&
      phase.entered &&
      (previewing || phase.pending !== null),
    /** Reopening in scroll mode hides the page until the column shows. */
    hideSpreadStage:
      (phase.kind === "opening" || phase.kind === "on") && phase.restoring,
    /** Gestures follow the visible stage; a pull stays with the pages. */
    scrollGestures: phase.kind === "on" || phase.kind === "closing",
    stage:
      stageColumn && stageVisible && stageStart
        ? {
            column: stageColumn,
            handleRef,
            contentRef: scrollContentRef,
            onRowsChange: ({ start, end }: { start: number; end: number }) =>
              setRenderedRows(`${start}:${end}`),
            start: stageStart,
            enter: stageEnter,
            windowing,
            pullThresholdPx: PULL_THRESHOLD_PX,
            keyboardEnabled: !touch,
            firstGlobalPage,
            nextChapter,
            onOpenNextChapter: () => {
              if (nextChapter) goToChapter(nextChapter.index);
            },
            onPreviousChapter: () => {
              if (stageColumn.chapterIndex > 0) {
                goToChapter(stageColumn.chapterIndex - 1);
              }
            },
            onNextChapter: () => {
              if (nextChapter) goToChapter(nextChapter.index);
            },
            onEntered,
            onPageChange,
            onPositionSettled,
            onSwipeToPages: (velocityX: number) =>
              setMode("pages", { velocityX }),
          }
        : null,
    /** Remounts the stage for each chapter and each entry into scroll. */
    stageKey: stageColumn
      ? `${stageColumn.chapterIndex}:${stageGeneration}`
      : "none",
    selectionSpread,
    /** What the view shows, for capturing a note's page target. */
    viewSpread,
    visiblePages,
    annotationContainerRef: selectionSpread
      ? scrollContentRef
      : stageContentRef,
    /** Changes when the scroll view mounts other rows. */
    renderedRows,
    progressLabel,
    pull,
    enterWithSelection,
    /** Selections in pages can offer the chip. */
    chipAvailable: enabled && phase.kind === "off",
  };
}
