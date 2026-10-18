import type {
  ChapterColumnLayout,
  ContentAnchor,
  ResolvedSpread,
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
import type { ChapterEntry } from "../types";
import type { ReaderSessionChapterAccess } from "../hooks/use-reader-session";
import type { ScrollPosition, ScrollStageHandle } from "./ScrollStage";
import {
  buildColumnSelectionSpread,
  countChapterWords,
  formatMinutes,
  READING_WORDS_PER_MINUTE,
} from "./scroll-model";

export type ReadingMode = "pages" | "scroll";

/**
 * - off: paged reading.
 * - opening: waits for the chapter column; the page stays on screen.
 * - on: the scroll stage shows. Until `entered`, the paged spread stays
 *   mounted under it, so the switch never shows an empty frame.
 * - closing: the snap runs; the spread mounts once it shows the target page.
 */
type ScrollPhase =
  | { kind: "off" }
  | { kind: "opening"; chapterIndex: number; pageIndex: number }
  | {
      kind: "on";
      chapterIndex: number;
      pageIndex: number;
      enter: "keep-page" | "fade-all";
      entered: boolean;
    }
  | {
      kind: "closing";
      chapterIndex: number;
      pageIndex: number;
      animationDone: boolean;
      swapping: boolean;
    };

interface UseReaderScrollModeOptions {
  enabled: boolean;
  spread: ResolvedSpread | null;
  column: ChapterColumnLayout | null;
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  chapterAccess: ReaderSessionChapterAccess;
  setScrollChapter: (chapterIndex: number | null) => void;
  goToAnchor: (anchor: ContentAnchor, intent: SpreadIntent) => void;
  goToChapter: (chapterIndex: number) => void;
  stageContentRef: RefObject<HTMLDivElement | null>;
}

function leadingPage(spread: ResolvedSpread | null) {
  const slot = spread?.slots.find((candidate) => candidate.kind === "page");
  return slot?.kind === "page" ? slot.page : null;
}

const NAVIGATION_INTENTS = new Set<SpreadIntent["kind"]>(["jump", "history"]);

/**
 * Owns the Debug-mode Pages/Scroll switch for one Reader.
 *
 * Content anchors carry the place across modes. Scroll → Pages snaps to a
 * real page boundary; Pages → Scroll opens that page's column offset. While
 * scrolling, the settled position goes to pagination as a linear move, so
 * checkpoints, reading sessions and history keep working from the scroll
 * position. Jumps (contents, scrubber, chapter buttons) move the column.
 */
export function useReaderScrollMode({
  enabled,
  spread,
  column,
  chapterEntries,
  chapterStartPages,
  chapterAccess,
  setScrollChapter,
  goToAnchor,
  goToChapter,
  stageContentRef,
}: UseReaderScrollModeOptions) {
  const [phase, setPhase] = useState<ScrollPhase>({ kind: "off" });
  const [position, setPosition] = useState<{
    chapterIndex: number;
    pageIndex: number;
    progress: number;
  } | null>(null);
  const handleRef = useRef<ScrollStageHandle>(null);
  const scrollContentRef = useRef<HTMLDivElement>(null);
  const lastSyncedAnchorRef = useRef<ContentAnchor | null>(null);
  const handledSpreadRef = useRef<ResolvedSpread | null>(null);
  const windowing = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("scrollWindow") !== "off",
    [],
  );

  const stageVisible = phase.kind === "on" || phase.kind === "closing";
  const stageColumn = stageVisible ? column : null;
  const mode: ReadingMode =
    phase.kind === "off" || phase.kind === "closing" ? "pages" : "scroll";

  const setMode = useCallback(
    (next: ReadingMode) => {
      if (next === "scroll") {
        if (phase.kind !== "off") return;
        const page = leadingPage(spread);
        if (!page) return;
        setScrollChapter(page.chapterIndex);
        setPhase({
          kind: "opening",
          chapterIndex: page.chapterIndex,
          pageIndex: page.currentPageInChapter - 1,
        });
        return;
      }

      if (phase.kind !== "on" || !phase.entered || !column) return;
      const handle = handleRef.current;
      if (!handle) return;
      const { pageIndex, finished } = handle.snapToPage();
      const anchor = column.pageAnchors[pageIndex];
      if (anchor) {
        goToAnchor(anchor, { kind: "linear", direction: "forward" });
      }
      setPhase({
        kind: "closing",
        chapterIndex: column.chapterIndex,
        pageIndex,
        animationDone: false,
        swapping: false,
      });
      void finished.then(() =>
        setPhase((current) =>
          current.kind === "closing"
            ? { ...current, animationDone: true }
            : current,
        ),
      );
    },
    [column, goToAnchor, phase, setScrollChapter, spread],
  );

  // Debug mode turned off: return to pages without animation.
  useEffect(() => {
    if (enabled || phase.kind === "off") return;
    setScrollChapter(null);
    setPhase({ kind: "off" });
  }, [enabled, phase.kind, setScrollChapter]);

  useEffect(() => {
    if (phase.kind !== "opening") return;
    if (column?.chapterIndex !== phase.chapterIndex) return;
    lastSyncedAnchorRef.current = null;
    handledSpreadRef.current = spread;
    setPosition({
      chapterIndex: phase.chapterIndex,
      pageIndex: phase.pageIndex,
      progress: 0,
    });
    setPhase({
      kind: "on",
      chapterIndex: phase.chapterIndex,
      pageIndex: phase.pageIndex,
      enter: "keep-page",
      entered: false,
    });
  }, [column, phase, spread]);

  // The snap is done and pagination shows the same page: swap stages.
  useEffect(() => {
    if (phase.kind !== "closing" || !phase.animationDone || phase.swapping) {
      return;
    }
    const page = leadingPage(spread);
    if (
      page?.chapterIndex !== phase.chapterIndex ||
      page.currentPageInChapter - 1 !== phase.pageIndex
    ) {
      return;
    }
    setPhase({ ...phase, swapping: true });
  }, [phase, spread]);

  // Keep the scroll stage over the new spread for two frames, so the spread
  // paints (and its images decode) before the stage goes.
  useEffect(() => {
    if (phase.kind !== "closing" || !phase.swapping) return;
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        setScrollChapter(null);
        setPosition(null);
        setPhase({ kind: "off" });
      });
    });
    return () => cancelAnimationFrame(frame);
  }, [phase, setScrollChapter]);

  // Contents, scrubber, chapter buttons and history move the column.
  useEffect(() => {
    if (phase.kind !== "on" || !spread) return;
    if (handledSpreadRef.current === spread) return;
    handledSpreadRef.current = spread;
    if (!NAVIGATION_INTENTS.has(spread.intent.kind)) return;
    const page = leadingPage(spread);
    if (!page) return;
    const pageIndex = page.currentPageInChapter - 1;
    lastSyncedAnchorRef.current = null;
    setPosition({ chapterIndex: page.chapterIndex, pageIndex, progress: 0 });
    if (page.chapterIndex === phase.chapterIndex) {
      handleRef.current?.scrollToPage(pageIndex);
      return;
    }
    setScrollChapter(page.chapterIndex);
    setPhase({
      kind: "on",
      chapterIndex: page.chapterIndex,
      pageIndex,
      enter: "fade-all",
      entered: true,
    });
  }, [phase, setScrollChapter, spread]);

  const onEntered = useCallback(() => {
    setPhase((current) =>
      current.kind === "on" ? { ...current, entered: true } : current,
    );
  }, []);

  const onPageChange = useCallback(
    (pageIndex: number) => {
      if (!column) return;
      setPosition((current) => ({
        chapterIndex: column.chapterIndex,
        pageIndex,
        progress: current?.progress ?? 0,
      }));
    },
    [column],
  );

  const onPositionSettled = useCallback(
    (settled: ScrollPosition) => {
      if (!column || phase.kind !== "on") return;
      setPosition({
        chapterIndex: column.chapterIndex,
        pageIndex: settled.pageIndex,
        progress: settled.progress,
      });
      const anchor = settled.anchor;
      if (!anchor) return;
      const previous = lastSyncedAnchorRef.current;
      if (previous && sameReaderAnchor(previous, anchor)) return;
      lastSyncedAnchorRef.current = anchor;
      const enginePage = leadingPage(spread);
      const direction =
        enginePage &&
        enginePage.chapterIndex === column.chapterIndex &&
        enginePage.currentPageInChapter - 1 > settled.pageIndex
          ? "backward"
          : "forward";
      // The checkpoint, reading session and history follow pagination.
      goToAnchor(anchor, { kind: "linear", direction });
    },
    [column, goToAnchor, phase.kind, spread],
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

  const firstGlobalPage = stageColumn
    ? (chapterStartPages[stageColumn.chapterIndex] ?? null)
    : null;
  const livePage =
    phase.kind === "on" &&
    position &&
    stageColumn &&
    position.chapterIndex === stageColumn.chapterIndex &&
    firstGlobalPage !== null
      ? firstGlobalPage + position.pageIndex
      : null;

  const progressLabel =
    phase.kind !== "on" || !position || chapterWords === null
      ? null
      : position.progress >= 0.995
        ? "End of chapter"
        : `${Math.round(position.progress * 100)}% of chapter · ${formatMinutes(
            ((1 - position.progress) * chapterWords) / READING_WORDS_PER_MINUTE,
          )} left`;

  return {
    mode,
    setMode,
    switchDisabled:
      phase.kind === "opening" ||
      phase.kind === "closing" ||
      (phase.kind === "on" && !phase.entered),
    /** The paged spread renders: always, except under a settled scroll stage. */
    showSpreadStage:
      phase.kind === "off" ||
      phase.kind === "opening" ||
      (phase.kind === "on" && !phase.entered) ||
      (phase.kind === "closing" && phase.swapping),
    /** Gestures follow the visible stage. */
    scrollGestures: stageVisible,
    stage:
      stageColumn && (phase.kind === "on" || phase.kind === "closing")
        ? {
            column: stageColumn,
            handleRef,
            contentRef: scrollContentRef,
            initialPageIndex:
              stageColumn.chapterIndex === phase.chapterIndex
                ? phase.pageIndex
                : 0,
            enter: phase.kind === "on" ? phase.enter : ("keep-page" as const),
            windowing,
            firstGlobalPage,
            nextChapter,
            onOpenNextChapter: () => {
              if (nextChapter) goToChapter(nextChapter.index);
            },
            onEntered,
            onPageChange,
            onPositionSettled,
          }
        : null,
    /** Remounts the stage for each chapter. */
    stageKey: stageColumn ? `${stageColumn.chapterIndex}` : "none",
    selectionSpread,
    annotationContainerRef: selectionSpread
      ? scrollContentRef
      : stageContentRef,
    livePage,
    progressLabel,
  };
}
