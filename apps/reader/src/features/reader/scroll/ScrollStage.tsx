import type { ChapterColumnLayout, ContentAnchor } from "@/lib/pagination-v2";
import { cn } from "@/lib/utils";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  memo,
  useEffect,
  useEffectEvent,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEventHandler,
  type Ref,
  type RefObject,
} from "react";
import { flushSync } from "react-dom";
import { PageSliceView } from "../PageSliceView";
import { SWIPE_SETTLE_SPRING } from "../hooks/use-spread-swipe-navigation";
import {
  buildScrollRows,
  findAnchorOffset,
  findFirstFullyVisibleLine,
  findFirstRowEndingAfter,
  findLastRowStartingBefore,
  findLineAtOrAfter,
  findLineTextPosition,
  findPageAtOffset,
  findTextPositionOffset,
  READING_LINE_FRACTION,
  readingLineOffset,
  resolveSnapPage,
  type ScrollRow,
} from "./scroll-model";
import {
  createColumnTextPoints,
  wordEnds,
  wordStartsBackward,
  type ChapterTextSource,
} from "./column-text-points";
import { restoreSelection, type SelectionLocators } from "./selection-transfer";

/** Rows rendered beyond each edge of the view. */
const OVERSCAN_ROWS = 12;
/** Fewer rows than this ahead: move the range in a task after the frame. */
const DEFERRED_MOVE_ROWS = 6;
/** Fewer rows than this ahead: move the range in the scroll event itself. */
const URGENT_MOVE_ROWS = 2;
const CHROME_SCROLL_TRAVEL_PX = 24;
const SETTLE_DELAY_MS = 180;
const FADE_IN_MS = 320;
const FADE_OUT_MS = 200;
const END_CARD_GAP_PX = 48;
const END_CARD_HEIGHT_PX = 112;
const MAX_IMAGE_WAIT_FRAMES = 30;
/** Ticks fade out this long after scrolling stops, like iOS indicators. */
const TICKS_HIDE_DELAY_MS = 1000;
/**
 * Height of the soft edge above the bottom safe area: a little more than
 * half a line, so the lines being read stay sharp.
 */
export const SCROLL_EDGE_BLUR_PX = 20;
/** The edge's blur at the screen edge. Text keeps its shape under it. */
const SCROLL_EDGE_BLUR_RADIUS_PX = 1.5;
/** Sideways travel that returns to pages on release. */
const SWIPE_EXIT_DISTANCE_PX = 64;
const SWIPE_EXIT_VELOCITY = 0.45; // px per ms
const SWIPE_LOCK_PX = 12;

export interface ScrollPosition {
  /** Page that holds the reading line; the page a switch would show. */
  pageIndex: number;
  /** Anchor of the first line at the top of the reading area. */
  topAnchor: ContentAnchor | null;
  /** Anchor of the line at the reading line. */
  readingAnchor: ContentAnchor | null;
  /** 0 at the chapter top, 1 when its last line reaches the view. */
  progress: number;
  firstVisiblePage: number;
  lastVisiblePage: number;
}

export type ScrollStageStart =
  | { kind: "page"; pageIndex: number }
  /** `exact`: never read as a page jump, even on a page's own anchor. */
  | { kind: "anchor"; anchor: ContentAnchor; exact?: boolean }
  | { kind: "offset"; pageIndex: number; offset: number };

/**
 * - keep-page: the start page is on screen as a spread; other lines fade in.
 * - fade-all: a new chapter or a restored position fades in.
 * - pull: the start page follows a pull from pages until it commits.
 */
export type ScrollStageEnter = "keep-page" | "fade-all" | "pull";

/**
 * A page selection handed to the column. It is selected again as the column
 * appears; an extension then grows it across the page break while the
 * column eases the text on the other side into view.
 */
export interface SelectionHandoff {
  locators: SelectionLocators | null;
  extension: {
    /** "end": grows past the page's foot; "start": back past its head. */
    edge: "end" | "start";
    /** The canonical range the selection grows to. */
    start: number;
    end: number;
    /** Where the page's selection stopped; growth starts here. */
    grownFrom: number;
    text: ChapterTextSource;
  } | null;
  /** Without an extension: ease the lines past this edge into view. */
  reveal?: "end" | "start";
  /** The selection is in place and the view at rest. */
  onDone?: () => void;
}

/** How long the column takes to bring the other page's words in. */
const HANDOFF_MS = 620;
/** Where a grown selection's far end comes to rest, down the view. */
const HANDOFF_END_AT = 0.56;
const HANDOFF_START_AT = 0.3;

export interface ScrollStageHandle {
  /**
   * Stops any fling and moves the reading line's page into its paged
   * position, or the given page. Lines of other pages fade out. A sideways
   * velocity carries a swipe back to centre in the same spring.
   */
  snapToPage: (options?: { velocityX?: number; pageIndex?: number }) => {
    pageIndex: number;
    finished: Promise<void>;
  };
  /** Puts a page's top at the top of the reading area, without animation. */
  scrollToPage: (pageIndex: number) => void;
  /** Puts the line that holds an anchor at the top of the reading area. */
  scrollToAnchor: (anchor: ContentAnchor) => boolean;
  /** Pull phase only: moves the column up by this many pixels. */
  setPullOffset: (offset: number) => void;
  /**
   * Pull phase only. Commit keeps the text where it is and becomes the
   * scroll view; cancel springs back to the page.
   */
  finishPull: (commit: boolean) => Promise<void>;
  /** Selects the same text as a selection made on a page. */
  restoreSelection: (locators: SelectionLocators) => boolean;
  /** Takes a page selection as the column appears; see SelectionHandoff. */
  takeSelection: (handoff: SelectionHandoff) => void;
}

interface ScrollStageProps {
  handleRef: Ref<ScrollStageHandle>;
  column: ChapterColumnLayout;
  baseFontSize: number;
  bodyLineHeight: number;
  paddingTopPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
  /** Book page number of the chapter's first page, once known. */
  firstGlobalPage: number | null;
  start: ScrollStageStart;
  enter: ScrollStageEnter;
  /** Receives the content element; selections and highlights live in it. */
  contentRef: RefObject<HTMLDivElement | null>;
  /** Render only the rows near the view. Off renders the whole chapter. */
  windowing: boolean;
  /** Pull distance at which a release enters scroll mode. */
  pullThresholdPx: number;
  /** Arrow, space and page keys scroll; left and right change chapter. */
  keyboardEnabled: boolean;
  nextChapter: { title: string; readingTime: string | null } | null;
  onOpenNextChapter: () => void;
  onPreviousChapter: () => void;
  onNextChapter: () => void;
  onPageChange: (position: ScrollPosition) => void;
  /**
   * The view came to rest. "user" means the reader scrolled there; "program"
   * covers opening, jumps and relayouts, which are not reading moves.
   */
  onPositionSettled: (
    position: ScrollPosition,
    cause: "user" | "program",
  ) => void;
  onScrollDirection: (direction: "up" | "down") => void;
  onEntered: () => void;
  /** A sideways swipe asks to return to pages. */
  onSwipeToPages: (velocityX: number) => void;
  /** The snap is starting; the chrome hides so no line sits under it. */
  onSnapStart?: () => void;
  onLinkActivate?: (href: string) => boolean;
  /** Other rows mounted; marks drawn over the text repaint. */
  onRowsChange: (rows: RowRange) => void;
  /**
   * The reader's header and footer show. Their own frosted bars cover the
   * edges, so the edges' blur stands down under them.
   */
  chromeVisible?: boolean;
}

type Phase =
  | { kind: "mounting" }
  | { kind: "pulling" }
  | { kind: "entering" }
  | { kind: "settled" }
  | { kind: "snapping"; pageIndex: number };

interface RowRange {
  start: number;
  end: number;
}

function sameRange(a: RowRange, b: RowRange): boolean {
  return a.start === b.start && a.end === b.end;
}

function unionRange(a: RowRange, b: RowRange | null): RowRange {
  if (!b) return a;
  return { start: Math.min(a.start, b.start), end: Math.max(a.end, b.end) };
}

function rowRangeForPage(rows: readonly ScrollRow[], pageIndex: number) {
  let start = -1;
  let end = -1;
  for (let index = 0; index < rows.length; index++) {
    if (rows[index]!.pageIndex !== pageIndex) continue;
    if (start < 0) start = index;
    end = index + 1;
  }
  return start < 0 ? null : { start, end };
}

function rowIndexOf(node: Node | null): number | null {
  const element =
    node instanceof Element ? node : (node?.parentElement ?? null);
  const row = element?.closest("[data-scroll-row-index]");
  if (!row) return null;
  return Number(row.getAttribute("data-scroll-row-index"));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest("input, textarea, select, [contenteditable='true']") !== null
  );
}

/** Rubber band for a pull: free at first, then firmer. */
export function pullResistance(distance: number): number {
  if (distance <= 0) return 0;
  const limit = 220;
  return limit * (1 - 1 / (1 + (distance * 0.7) / limit));
}

interface ScrollRowViewProps {
  row: ScrollRow;
  index: number;
  top: number;
  width: number;
  baseFontSize: number;
  dimmed: boolean;
  current: boolean;
  fadeMs: number;
}

const ScrollRowView = memo(function ScrollRowView({
  row,
  index,
  top,
  width,
  baseFontSize,
  dimmed,
  current,
  fadeMs,
}: ScrollRowViewProps) {
  return (
    <div
      data-scroll-row-index={index}
      data-page-index={row.pageIndex}
      data-scroll-row-current={current ? "true" : undefined}
      className="absolute left-0"
      style={{
        top,
        width,
        height: row.height,
        opacity: dimmed ? 0 : 1,
        transition: `opacity ${fadeMs}ms cubic-bezier(0.22, 1, 0.36, 1)`,
      }}
    >
      <PageSliceView
        slice={row.slice}
        sliceIndex={index}
        baseFontSize={baseFontSize}
      />
    </div>
  );
});

/**
 * Softens text where it runs under the status bar or the home indicator, as
 * iOS does at a scroll view's edges: one light backdrop blur that grows
 * towards the screen edge, under a tint of the page colour that keeps the
 * status bar and home indicator legible. Text still shows through, softened.
 * One layer of at most 1.5px keeps it cheap on a phone, and stays light even
 * where a browser draws a backdrop blur without its mask. `?scrollEdge=fade`
 * drops the blur, for comparing frame times.
 */
function ProgressiveEdgeBlur({
  visible,
  covered,
  edge,
  height,
}: {
  visible: boolean;
  /** The chrome's frosted bar is over it, so it stands down. */
  covered: boolean;
  edge: "top" | "bottom";
  height: string;
}) {
  const fadeOnly = useMemo(
    () =>
      new URLSearchParams(window.location.search).get("scrollEdge") === "fade",
    [],
  );
  const towards = edge === "bottom" ? "to bottom" : "to top";
  const mask = `linear-gradient(${towards}, transparent, black 60%)`;
  return (
    <div
      aria-hidden="true"
      data-reader-scroll-edge={fadeOnly ? "fade" : "blur"}
      data-reader-scroll-edge-side={edge}
      className={cn(
        "pointer-events-none absolute inset-x-0 z-[2]",
        edge === "bottom" ? "bottom-0" : "top-0",
      )}
      style={{
        height,
        opacity: visible && !covered ? 1 : 0,
        // Standing down waits for the chrome to slide over the edge first.
        transition: `opacity 200ms ease-out ${visible && covered ? "200ms" : "0ms"}`,
      }}
    >
      {!fadeOnly && (
        <div
          className="absolute inset-0"
          style={{
            backdropFilter: `blur(${SCROLL_EDGE_BLUR_RADIUS_PX}px)`,
            WebkitBackdropFilter: `blur(${SCROLL_EDGE_BLUR_RADIUS_PX}px)`,
            maskImage: mask,
            WebkitMaskImage: mask,
          }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${towards}, transparent, color-mix(in oklab, var(--background) ${fadeOnly ? 80 : 65}%, transparent))`,
        }}
      />
    </div>
  );
}

/**
 * Scroll mode for one chapter.
 *
 * The chapter column comes from the pagination worker with exact offsets, so
 * this stage virtualizes without estimates: rows are absolutely positioned at
 * their column offsets, a binary search finds the view, and only the rows
 * near the view mount. The range moves in a task after the frame while
 * enough rows remain ahead, and in the scroll event when the view could
 * reach unmounted space first. Rows of an active selection stay mounted.
 *
 * Page boundaries are known in the same coordinates, which makes the mode
 * switches geometric. Entering keeps the page's lines in place. Leaving snaps
 * the page that holds the reading line, a third of the way down, into its
 * paged position with one translation, without DOM measurement.
 *
 * The stage runs to the bottom edge of the screen, and under the status bar
 * where the page may draw there. Soft edges sit under both, and the column
 * ends with enough space for its last line to clear the bottom one.
 */
export function ScrollStage({
  handleRef,
  column,
  baseFontSize,
  bodyLineHeight,
  paddingTopPx: readingTopPx,
  paddingLeftPx,
  paddingRightPx,
  firstGlobalPage,
  start,
  enter,
  contentRef,
  windowing,
  pullThresholdPx,
  keyboardEnabled,
  nextChapter,
  onOpenNextChapter,
  onPreviousChapter,
  onNextChapter,
  onPageChange,
  onPositionSettled,
  onScrollDirection,
  onEntered,
  onSwipeToPages,
  onSnapStart,
  onLinkActivate,
  onRowsChange,
  chromeVisible = false,
}: ScrollStageProps) {
  const rows = useMemo(() => buildScrollRows(column), [column]);
  const rootRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Where the system lets the page draw under the status bar, the stage runs
  // under it too. The reading area stays where it was: the top padding grows
  // by the same amount, so scroll offsets keep their meaning.
  const [insetTop, setInsetTop] = useState(0);
  const paddingTopPx = readingTopPx + insetTop;
  useLayoutEffect(() => {
    const root = rootRef.current;
    const slot = root?.parentElement;
    if (!root || !slot) return;
    const measure = () => {
      const inset =
        slot.getBoundingClientRect().top - root.getBoundingClientRect().top;
      setInsetTop(Math.max(0, Math.round(inset)));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);
  const ticksRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const snapOffset = useMotionValue(0);
  const pullOffset = useMotionValue(0);
  const swipeX = useMotionValue(0);
  const contentY = useTransform(() => snapOffset.get() - pullOffset.get());
  const [phase, setPhase] = useState<Phase>(() =>
    enter === "pull" ? { kind: "pulling" } : { kind: "mounting" },
  );
  const [pullReady, setPullReady] = useState(false);

  // Programmatic scrolls must not count as reader scrolls for chrome.
  // The offset our own scroll writes aim for. A write that does not move the
  // view fires no scroll event, so the mark is matched by offset, not consumed
  // by whichever event comes next.
  const programmaticScrollRef = useRef<number | null>(null);
  const setScrollTop = (scroller: HTMLElement, top: number) => {
    scroller.scrollTop = top;
    programmaticScrollRef.current = scroller.scrollTop;
  };
  const selectionRangeRef = useRef<RowRange | null>(null);
  const pinnedRangeRef = useRef<RowRange | null>(null);
  const pageIndexRef = useRef(-1);
  const readingLineRef = useRef<{
    /** Column offset of the line's top. */
    y: number;
    /**
     * The line's top relative to the reading line, a third of the way down.
     * A rotation changes the view's height; the line stays at the reading
     * line, not at the same distance from the top.
     */
    fromReadingLine: number;
  } | null>(null);
  const rowsRef = useRef(rows);

  const startPageIndex =
    start.kind === "anchor"
      ? (rows.find((row) => row.slice.blockId === start.anchor.blockId)
          ?.pageIndex ?? 0)
      : start.pageIndex;
  const resolveStartScrollTop = (): number => {
    if (start.kind === "page") return column.pageStarts[start.pageIndex] ?? 0;
    if (start.kind === "offset") return start.offset;
    const offset = findAnchorOffset(rows, start.anchor);
    return offset ?? column.pageStarts[startPageIndex] ?? 0;
  };
  // Pull starts at the page; the offset moves into scrollTop on commit.
  const initialScrollTop =
    enter === "pull"
      ? (column.pageStarts[startPageIndex] ?? 0)
      : resolveStartScrollTop();

  const stageHeightEstimate =
    paddingTopPx + column.pageHeight + SCROLL_EDGE_BLUR_PX + 48;
  const lastPageStart = column.pageStarts[column.pageStarts.length - 1] ?? 0;
  // The last line, and the end card, scroll clear of the blur and the home
  // indicator. The last page can also reach the top of the reading area.
  const bottomClearance = SCROLL_EDGE_BLUR_PX + 48;
  const contentHeight = Math.max(
    paddingTopPx +
      column.height +
      END_CARD_GAP_PX +
      END_CARD_HEIGHT_PX +
      bottomClearance,
    lastPageStart + stageHeightEstimate,
  );

  const computeTargetRange = (scrollTop: number, viewportHeight: number) => {
    if (!windowing) return { start: 0, end: rows.length };
    const viewTop = scrollTop - paddingTopPx;
    const first = findFirstRowEndingAfter(rows, viewTop);
    const last = findLastRowStartingBefore(rows, viewTop + viewportHeight);
    let range = {
      start: Math.max(0, first - OVERSCAN_ROWS),
      end: Math.min(rows.length, last + 1 + OVERSCAN_ROWS),
    };
    range = unionRange(range, selectionRangeRef.current);
    range = unionRange(range, pinnedRangeRef.current);
    return range;
  };

  const [range, setRange] = useState<RowRange>(() =>
    computeTargetRange(initialScrollTop, stageHeightEstimate),
  );
  const rangeRef = useRef(range);

  const notifyRowsChange = useEffectEvent(onRowsChange);
  useLayoutEffect(() => {
    notifyRowsChange(range);
  }, [range]);

  const commitRange = (next: RowRange) => {
    if (sameRange(next, rangeRef.current)) return;
    rangeRef.current = next;
    setRange(next);
  };

  // The reading area starts below the top padding. Its top, in column
  // offsets, equals scrollTop because rows sit at paddingTop + y.
  const readPosition = (
    scrollTop: number,
    viewportHeight: number,
  ): ScrollPosition => {
    const readingLine = readingLineOffset(
      scrollTop,
      paddingTopPx,
      viewportHeight,
    );
    const topLine = findFirstFullyVisibleLine(
      rows,
      column.chapterIndex,
      scrollTop,
    );
    const reading = findLineAtOrAfter(rows, column.chapterIndex, readingLine);
    const scrollable = Math.max(1, column.height - column.pageHeight);
    const viewTop = scrollTop - paddingTopPx;
    return {
      pageIndex: resolveSnapPage({ column, readingLine }),
      topAnchor: topLine?.anchor ?? null,
      readingAnchor: reading?.anchor ?? null,
      progress: Math.min(1, Math.max(0, scrollTop / scrollable)),
      firstVisiblePage: findPageAtOffset(column.pageStarts, viewTop),
      lastVisiblePage: findPageAtOffset(
        column.pageStarts,
        viewTop + viewportHeight,
      ),
    };
  };

  const rememberReadingLine = (scrollTop: number, viewportHeight: number) => {
    const offset = readingLineOffset(scrollTop, paddingTopPx, viewportHeight);
    const line = findLineAtOrAfter(rows, column.chapterIndex, offset);
    readingLineRef.current = line
      ? {
          y: line.y,
          fromReadingLine:
            paddingTopPx +
            line.y -
            scrollTop -
            viewportHeight * READING_LINE_FRACTION,
        }
      : null;
  };

  // Set by scrolls the reader makes; a settle after one is a reading move.
  const userScrolledRef = useRef(false);
  const reportPositionNow = useEffectEvent(
    (cause: "user" | "program" = "program") => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      onPositionSettled(
        readPosition(scroller.scrollTop, scroller.clientHeight),
        cause,
      );
    },
  );

  // Keeps the reading line in place when a relayout republishes the column,
  // for example after a highlight, a font change or a rotation.
  useLayoutEffect(() => {
    const previousRows = rowsRef.current;
    rowsRef.current = rows;
    const scroller = scrollerRef.current;
    const readingLine = readingLineRef.current;
    if (previousRows === rows || !scroller || phase.kind === "snapping") {
      return;
    }
    const position = readingLine
      ? findLineTextPosition(previousRows, readingLine.y)
      : null;
    const offset = position ? findTextPositionOffset(rows, position) : null;
    if (readingLine && offset !== null) {
      const nextTop =
        paddingTopPx +
        offset -
        (scroller.clientHeight * READING_LINE_FRACTION +
          readingLine.fromReadingLine);
      if (Math.abs(nextTop - scroller.scrollTop) >= 0.5) {
        setScrollTop(scroller, nextTop);
      }
    }
    rememberReadingLine(scroller.scrollTop, scroller.clientHeight);
    commitRange(computeTargetRange(scroller.scrollTop, scroller.clientHeight));
    // Page numbers and totals can change with the layout.
    reportPositionNow();
  });

  // Mount only: later positions belong to the reader.
  const openAtInitialPosition = useEffectEvent((scroller: HTMLDivElement) => {
    setScrollTop(scroller, initialScrollTop);
    commitRange(computeTargetRange(initialScrollTop, scroller.clientHeight));
    rememberReadingLine(initialScrollTop, scroller.clientHeight);
  });
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) openAtInitialPosition(scroller);
  }, []);

  // Report the opening position; later positions come from scroll events.
  useEffect(() => {
    reportPositionNow();
  }, []);

  // Reveal once the visible page's images are decoded, then fade in the rest.
  const notifyEntered = useEffectEvent(onEntered);
  const reveal = useEffectEvent(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return () => {};
    let frame = 0;
    let frames = 0;
    let timer = 0;
    const waitForImages = () => {
      const pending = scroller.querySelector(
        enter === "keep-page"
          ? '[data-scroll-row-current="true"] [data-reader-image-pending]'
          : "[data-reader-image-pending]",
      );
      if (pending && frames++ < MAX_IMAGE_WAIT_FRAMES) {
        frame = requestAnimationFrame(waitForImages);
        return;
      }
      setPhase({ kind: "entering" });
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          setPhase({ kind: "settled" });
          timer = window.setTimeout(notifyEntered, FADE_IN_MS);
        });
      });
    };
    waitForImages();
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  });
  useEffect(() => {
    if (enter === "pull") {
      // The first frame matches the page, so the pull can show it at once.
      const frame = requestAnimationFrame(() => setPullReady(true));
      return () => cancelAnimationFrame(frame);
    }
    return reveal();
  }, [enter]);

  const showTicks = useEffectEvent(() => {
    const ticks = ticksRef.current;
    if (!ticks) return;
    ticks.style.transition = "opacity 120ms ease-out";
    ticks.style.opacity = "1";
  });
  const hideTicks = useEffectEvent(() => {
    const ticks = ticksRef.current;
    if (!ticks) return;
    ticks.style.transition = "opacity 420ms ease-in";
    ticks.style.opacity = "0";
  });

  const handleScroll = useEffectEvent((scroller: HTMLDivElement) => {
    const scrollTop = scroller.scrollTop;
    const viewportHeight = scroller.clientHeight;

    if (windowing) {
      const scrollerTop = scrollTop - paddingTopPx;
      const first = findFirstRowEndingAfter(rows, scrollerTop);
      const last = findLastRowStartingBefore(
        rows,
        scrollerTop + viewportHeight,
      );
      const current = rangeRef.current;
      const aheadBelow =
        current.end >= rows.length ? Infinity : current.end - 1 - last;
      const aheadAbove = current.start <= 0 ? Infinity : first - current.start;
      const ahead = Math.min(aheadAbove, aheadBelow);
      if (ahead < URGENT_MOVE_ROWS) {
        flushSync(() => {
          commitRange(computeTargetRange(scrollTop, viewportHeight));
        });
      } else if (ahead < DEFERRED_MOVE_ROWS) {
        scheduleDeferredRange();
      }
    }

    rememberReadingLine(scrollTop, viewportHeight);
    const pageIndex = resolveSnapPage({
      column,
      readingLine: readingLineOffset(scrollTop, paddingTopPx, viewportHeight),
    });
    if (pageIndex !== pageIndexRef.current) {
      pageIndexRef.current = pageIndex;
      onPageChange(readPosition(scrollTop, viewportHeight));
    }
  });

  const deferredRangeRef = useRef<{ frame: number; timer: number } | null>(
    null,
  );
  const scheduleDeferredRange = useEffectEvent(() => {
    if (deferredRangeRef.current) return;
    const pending = { frame: 0, timer: 0 };
    deferredRangeRef.current = pending;
    pending.frame = requestAnimationFrame(() => {
      pending.timer = window.setTimeout(() => {
        deferredRangeRef.current = null;
        const scroller = scrollerRef.current;
        if (!scroller) return;
        commitRange(
          computeTargetRange(scroller.scrollTop, scroller.clientHeight),
        );
      }, 0);
    });
  });

  const settle = useEffectEvent(() => {
    if (phase.kind === "snapping" || phase.kind === "pulling") return;
    const cause = userScrolledRef.current ? "user" : "program";
    userScrolledRef.current = false;
    reportPositionNow(cause);
  });
  const reportDirection = useEffectEvent((direction: "up" | "down") => {
    onScrollDirection(direction);
  });

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;

    let lastTop = scroller.scrollTop;
    let travelDirection: "up" | "down" | null = null;
    let travel = 0;
    let reported = false;
    let settleTimer = 0;
    let ticksTimer = 0;

    const onScroll = () => {
      handleScroll(scroller);

      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(settle, SETTLE_DELAY_MS);

      const top = scroller.scrollTop;
      const delta = top - lastTop;
      lastTop = top;
      const aimed = programmaticScrollRef.current;
      programmaticScrollRef.current = null;
      if (aimed !== null && Math.abs(top - aimed) < 1) return;
      if (delta === 0) return;
      userScrolledRef.current = true;

      showTicks();
      window.clearTimeout(ticksTimer);
      ticksTimer = window.setTimeout(hideTicks, TICKS_HIDE_DELAY_MS);

      const direction = delta > 0 ? "down" : "up";
      if (direction !== travelDirection) {
        travelDirection = direction;
        travel = 0;
        reported = false;
      }
      travel += Math.abs(delta);
      if (!reported && travel >= CHROME_SCROLL_TRAVEL_PX) {
        reported = true;
        reportDirection(direction);
      }
    };
    // A new gesture can hide chrome again after a tap showed it.
    const onGestureStart = () => {
      travel = 0;
      reported = false;
    };

    scroller.addEventListener("scroll", onScroll, { passive: true });
    scroller.addEventListener("pointerdown", onGestureStart, {
      passive: true,
    });
    scroller.addEventListener("touchstart", onGestureStart, { passive: true });
    return () => {
      scroller.removeEventListener("scroll", onScroll);
      scroller.removeEventListener("pointerdown", onGestureStart);
      scroller.removeEventListener("touchstart", onGestureStart);
      window.clearTimeout(settleTimer);
      window.clearTimeout(ticksTimer);
      const deferred = deferredRangeRef.current;
      if (deferred) {
        cancelAnimationFrame(deferred.frame);
        clearTimeout(deferred.timer);
        deferredRangeRef.current = null;
      }
    };
  }, []);

  // A sideways swipe returns to pages. Vertical drags belong to native
  // scrolling, which cancels the pointer; a sideways one stays with us.
  const swipeToPages = useEffectEvent((velocityX: number) => {
    onSwipeToPages(velocityX);
  });
  const canSwipe = useEffectEvent(() => phase.kind === "settled");
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    let press: {
      id: number;
      x: number;
      y: number;
      axis: "pending" | "horizontal" | "none";
      lastX: number;
      lastAt: number;
      velocity: number;
    } | null = null;

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      if (!canSwipe()) return;
      press = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        axis: "pending",
        lastX: event.clientX,
        lastAt: event.timeStamp,
        velocity: 0,
      };
    };
    const onMove = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (press.axis === "pending") {
        if (Math.hypot(dx, dy) < SWIPE_LOCK_PX) return;
        const selection = window.getSelection();
        press.axis =
          Math.abs(dx) > Math.abs(dy) * 1.6 &&
          !(selection && !selection.isCollapsed)
            ? "horizontal"
            : "none";
      }
      if (press.axis !== "horizontal") return;
      const elapsed = Math.max(1, event.timeStamp - press.lastAt);
      press.velocity = (event.clientX - press.lastX) / elapsed;
      press.lastX = event.clientX;
      press.lastAt = event.timeStamp;
      swipeX.set(dx * 0.45);
    };
    const onUp = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      const current = press;
      press = null;
      if (current.axis !== "horizontal") return;
      const dx = event.clientX - current.x;
      const exit =
        Math.abs(dx) >= SWIPE_EXIT_DISTANCE_PX ||
        Math.abs(current.velocity) >= SWIPE_EXIT_VELOCITY;
      if (exit) {
        swipeToPages(current.velocity * 1000 * 0.45);
        return;
      }
      void animate(swipeX, 0, SWIPE_SETTLE_SPRING);
    };
    const onCancel = (event: PointerEvent) => {
      if (!press || press.id !== event.pointerId) return;
      const wasHorizontal = press.axis === "horizontal";
      press = null;
      if (wasHorizontal) void animate(swipeX, 0, SWIPE_SETTLE_SPRING);
    };

    scroller.addEventListener("pointerdown", onDown, { passive: true });
    scroller.addEventListener("pointermove", onMove, { passive: true });
    scroller.addEventListener("pointerup", onUp, { passive: true });
    scroller.addEventListener("pointercancel", onCancel, { passive: true });
    return () => {
      scroller.removeEventListener("pointerdown", onDown);
      scroller.removeEventListener("pointermove", onMove);
      scroller.removeEventListener("pointerup", onUp);
      scroller.removeEventListener("pointercancel", onCancel);
    };
  }, [swipeX]);

  // Desktop keys: a screen less one line, one line, or a chapter.
  const handleKey = useEffectEvent((event: KeyboardEvent) => {
    if (!keyboardEnabled || phase.kind !== "settled") return;
    if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
    if (event.altKey || isEditableTarget(event.target)) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const screen = Math.max(
      bodyLineHeight,
      scroller.clientHeight - SCROLL_EDGE_BLUR_PX - bodyLineHeight,
    );
    let delta = 0;
    switch (event.key) {
      case " ":
        delta = event.shiftKey ? -screen : screen;
        break;
      case "PageDown":
        delta = screen;
        break;
      case "PageUp":
        delta = -screen;
        break;
      case "ArrowDown":
        delta = bodyLineHeight;
        break;
      case "ArrowUp":
        delta = -bodyLineHeight;
        break;
      case "ArrowRight":
        event.preventDefault();
        onNextChapter();
        return;
      case "ArrowLeft":
        event.preventDefault();
        onPreviousChapter();
        return;
      default:
        return;
    }
    event.preventDefault();
    scroller.scrollBy({
      top: delta,
      behavior: prefersReducedMotion ? "auto" : "smooth",
    });
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => handleKey(event);
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A selection keeps every row between its endpoints mounted.
  const syncSelectionRange = useEffectEvent(() => {
    const content = contentRef.current;
    const selection = window.getSelection();
    if (
      !content ||
      !selection ||
      selection.isCollapsed ||
      !selection.anchorNode ||
      !content.contains(selection.anchorNode)
    ) {
      selectionRangeRef.current = null;
      return;
    }
    const anchorRow = rowIndexOf(selection.anchorNode);
    const focusRow = rowIndexOf(selection.focusNode);
    if (anchorRow === null || focusRow === null) return;
    selectionRangeRef.current = {
      start: Math.min(anchorRow, focusRow),
      end: Math.max(anchorRow, focusRow) + 1,
    };
  });
  useEffect(() => {
    const onSelectionChange = () => syncSelectionRange();
    document.addEventListener("selectionchange", onSelectionChange);
    return () =>
      document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  const scrollToTop = (top: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    setScrollTop(scroller, top);
    rememberReadingLine(top, scroller.clientHeight);
    // Jumps arrive from effects, where React cannot flush; a microtask still
    // mounts the rows before the next frame paints.
    queueMicrotask(() => {
      flushSync(() => {
        commitRange(computeTargetRange(top, scroller.clientHeight));
      });
      reportPositionNow();
    });
  };

  // A selection handed over from a page: selected again on the column's
  // first visible frame, then grown across the break once it settles.
  const handoffRef = useRef<{
    handoff: SelectionHandoff;
    restored: boolean;
  } | null>(null);
  const handoffAnimationRef = useRef<{ stop: () => void } | null>(null);
  useEffect(() => () => handoffAnimationRef.current?.stop(), []);

  const runHandoff = useEffectEvent((handoff: SelectionHandoff) => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    const finish = () => {
      pinnedRangeRef.current = null;
      handoff.onDone?.();
    };
    if (!scroller || !content) return finish();
    const { extension } = handoff;
    const reveal = extension?.edge ?? handoff.reveal;
    if (!reveal) return finish();

    // Keep the page and its neighbours mounted while the view moves.
    const around = [startPageIndex - 1, startPageIndex, startPageIndex + 1]
      .map((pageIndex) => rowRangeForPage(rows, pageIndex))
      .reduce<RowRange | null>(
        (union, part) => (part ? unionRange(part, union) : union),
        null,
      );
    pinnedRangeRef.current = around;
    flushSync(() => {
      commitRange(
        computeTargetRange(scroller.scrollTop, scroller.clientHeight),
      );
    });

    const selection = window.getSelection();
    const points = extension
      ? createColumnTextPoints(content, extension.text)
      : null;
    // Growth runs word by word from where the page's selection stopped.
    const steps = (() => {
      if (!extension || !points) return [];
      const fixed =
        extension.edge === "end"
          ? points.start(extension.start)
          : points.end(extension.end);
      if (!fixed) return [];
      const offsets =
        extension.edge === "end"
          ? wordEnds(
              extension.text.fullText,
              extension.grownFrom,
              extension.end,
            )
          : wordStartsBackward(
              extension.text.fullText,
              extension.start,
              extension.grownFrom,
            );
      return offsets.flatMap((offset) => {
        const point =
          extension.edge === "end" ? points.end(offset) : points.start(offset);
        return point ? [{ fixed, point }] : [];
      });
    })();
    const select = (index: number) => {
      const step = steps[index];
      if (!step || !selection) return;
      selection.setBaseAndExtent(
        step.fixed.node,
        step.fixed.offset,
        step.point.node,
        step.point.offset,
      );
    };

    // Where the view comes to rest: the grown end a little above the
    // middle, or the grown start a third of the way down.
    const last = steps.at(-1)?.point;
    const target = (() => {
      const viewTop = scroller.getBoundingClientRect().top;
      const height = scroller.clientHeight;
      if (last) {
        const probe = document.createRange();
        probe.setStart(last.node, last.offset);
        probe.setEnd(last.node, last.offset);
        const rect =
          probe.getClientRects()[0] ??
          (last.node.parentElement ?? content).getBoundingClientRect();
        const y = rect.top - viewTop;
        const delta =
          reveal === "end"
            ? y + bodyLineHeight - height * HANDOFF_END_AT
            : y - height * HANDOFF_START_AT;
        return reveal === "end" ? Math.max(0, delta) : Math.min(0, delta);
      }
      // Reveal only: a few lines past the edge.
      return (reveal === "end" ? 1 : -1) * bodyLineHeight * 4;
    })();
    const from = scroller.scrollTop;
    const to = Math.max(
      0,
      Math.min(scroller.scrollHeight - scroller.clientHeight, from + target),
    );

    if (prefersReducedMotion || (Math.abs(to - from) < 1 && !steps.length)) {
      setScrollTop(scroller, to);
      select(steps.length - 1);
      return finish();
    }
    let shown = -1;
    const animation = animate(from, to, {
      duration: HANDOFF_MS / 1000,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (value) => {
        setScrollTop(scroller, value);
        const progress = to === from ? 1 : (value - from) / (to - from);
        const index = Math.min(
          steps.length - 1,
          Math.floor(progress * steps.length),
        );
        if (index > shown) {
          shown = index;
          select(index);
        }
      },
    });
    handoffAnimationRef.current = animation;
    void animation.then(() => {
      if (handoffAnimationRef.current !== animation) return;
      handoffAnimationRef.current = null;
      select(steps.length - 1);
      rememberReadingLine(scroller.scrollTop, scroller.clientHeight);
      finish();
    });
  });

  const progressHandoff = useEffectEvent((kind: Phase["kind"]) => {
    const pending = handoffRef.current;
    if (!pending) return;
    const content = contentRef.current;
    if (!pending.restored && pending.handoff.locators && content) {
      restoreSelection(content, pending.handoff.locators);
    }
    pending.restored = true;
    if (kind !== "settled") return;
    handoffRef.current = null;
    // After the frame that shows the column, outside React's commit.
    const frame = requestAnimationFrame(() => runHandoff(pending.handoff));
    handoffAnimationRef.current = { stop: () => cancelAnimationFrame(frame) };
  });
  useLayoutEffect(() => {
    if (phase.kind === "entering" || phase.kind === "settled") {
      progressHandoff(phase.kind);
    }
  }, [phase.kind]);

  useImperativeHandle(handleRef, () => ({
    snapToPage: (options = {}) => {
      const scroller = scrollerRef.current;
      if (!scroller) return { pageIndex: 0, finished: Promise.resolve() };
      onSnapStart?.();

      // Stop any fling: hidden overflow ends momentum, and writing the
      // current offset back pins it.
      const scrollTop = scroller.scrollTop;
      scroller.style.overflowY = "hidden";
      scroller.scrollTop = scrollTop;

      const pageIndex =
        options.pageIndex !== undefined &&
        column.pageStarts[options.pageIndex] !== undefined
          ? options.pageIndex
          : resolveSnapPage({
              column,
              readingLine: readingLineOffset(
                scrollTop,
                paddingTopPx,
                scroller.clientHeight,
              ),
            });
      const pageStart = column.pageStarts[pageIndex] ?? 0;
      pinnedRangeRef.current = rowRangeForPage(rows, pageIndex);
      flushSync(() => {
        commitRange(computeTargetRange(scrollTop, scroller.clientHeight));
        setPhase({ kind: "snapping", pageIndex });
      });
      hideTicks();

      // Both geometries are known: on the page, a row sits at
      // paddingTop + (y - pageStart); in the column it sits at
      // paddingTop + y - scrollTop. One translation moves every row.
      const target = scrollTop - pageStart;
      if (prefersReducedMotion) {
        snapOffset.set(target);
        swipeX.set(0);
        return { pageIndex, finished: Promise.resolve() };
      }
      const vertical = animate(snapOffset, target, SWIPE_SETTLE_SPRING);
      const sideways = animate(swipeX, 0, {
        ...SWIPE_SETTLE_SPRING,
        velocity: options.velocityX ?? 0,
      });
      return {
        pageIndex,
        finished: Promise.all([vertical, sideways]).then(() => undefined),
      };
    },
    scrollToPage: (pageIndex) => {
      scrollToTop(column.pageStarts[pageIndex] ?? 0);
    },
    scrollToAnchor: (anchor) => {
      const offset = findAnchorOffset(rows, anchor);
      if (offset === null) return false;
      scrollToTop(offset);
      return true;
    },
    setPullOffset: (offset) => {
      if (phase.kind !== "pulling") return;
      pullOffset.set(Math.max(0, offset));
    },
    finishPull: (commit) => {
      const scroller = scrollerRef.current;
      if (phase.kind !== "pulling" || !scroller) return Promise.resolve();
      if (!commit) {
        if (prefersReducedMotion) {
          pullOffset.set(0);
          return Promise.resolve();
        }
        return animate(pullOffset, 0, SWIPE_SETTLE_SPRING).then(
          () => undefined,
        );
      }
      // The text stays where it is: the pull distance moves into scrollTop.
      const top = scroller.scrollTop + pullOffset.get();
      flushSync(() => {
        setPhase({ kind: "entering" });
      });
      pullOffset.set(0);
      setScrollTop(scroller, top);
      commitRange(computeTargetRange(top, scroller.clientHeight));
      rememberReadingLine(top, scroller.clientHeight);
      requestAnimationFrame(() => {
        setPhase({ kind: "settled" });
        window.setTimeout(notifyEntered, FADE_IN_MS);
        reportPositionNow();
      });
      return Promise.resolve();
    },
    restoreSelection: (locators) => {
      const content = contentRef.current;
      if (!content) return false;
      return restoreSelection(content, locators);
    },
    takeSelection: (handoff) => {
      handoffRef.current = { handoff, restored: false };
      if (phase.kind === "entering" || phase.kind === "settled") {
        progressHandoff(phase.kind);
      }
    },
  }));

  const handleClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!onLinkActivate) return;
    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    const href = anchor?.getAttribute("href")?.trim();
    if (!href || !onLinkActivate(href)) return;
    event.preventDefault();
    event.stopPropagation();
  };

  const isRowDimmed = (row: ScrollRow): boolean => {
    // During and right after a pull, the page and the lines it revealed
    // below stay visible.
    const pulledInto =
      row.pageIndex === startPageIndex || row.pageIndex === startPageIndex + 1;
    switch (phase.kind) {
      case "mounting":
      case "entering":
        if (enter === "fade-all") return true;
        if (enter === "pull") return !pulledInto;
        return row.pageIndex !== startPageIndex;
      case "pulling":
        return !pulledInto;
      case "settled":
        return false;
      case "snapping":
        return row.pageIndex !== phase.pageIndex;
    }
  };
  const chromeOpacity = phase.kind === "settled" ? 1 : 0;
  const fadeMs = phase.kind === "snapping" ? FADE_OUT_MS : FADE_IN_MS;
  const pulling = phase.kind === "pulling";
  // During a pull the reading area ends where the page ends.
  const pullClipBottom = paddingTopPx + column.pageHeight;

  return (
    <div
      ref={rootRef}
      data-reader-scroll-root=""
      className="absolute inset-x-0 z-[3]"
      style={{
        top: "calc(-1 * env(safe-area-inset-top))",
        // The stage runs under the home indicator; the slot stops above it.
        bottom: pulling
          ? 0
          : "calc(-1 * max(env(safe-area-inset-bottom), 0.625rem))",
        visibility: phase.kind === "mounting" ? "hidden" : "visible",
      }}
    >
      <div
        ref={scrollerRef}
        data-reader-scroll-stage={phase.kind}
        onClick={handleClick}
        className="absolute inset-0 overflow-x-hidden overflow-y-auto bg-background"
        style={{
          overflowAnchor: "none",
          overscrollBehavior: "contain",
          touchAction: "pan-y pinch-zoom",
          overflowY: pulling ? "hidden" : undefined,
          clipPath: pulling
            ? `inset(0px 0px calc(100% - ${pullClipBottom}px) 0px)`
            : undefined,
          opacity: pulling && !pullReady ? 0 : 1,
        }}
      >
        <motion.div
          className="relative w-full"
          style={{ height: contentHeight, y: contentY, x: swipeX }}
        >
          <div
            ref={contentRef}
            data-reader-scroll-content=""
            data-reader-chapter-index={column.chapterIndex}
            className="relative h-full"
            style={{
              width: column.width,
              // Centred; on a phone this equals the page's side padding.
              marginLeft: `max(${paddingLeftPx}px, calc((100% - ${column.width}px) / 2))`,
            }}
          >
            {rows.slice(range.start, range.end).map((row, offset) => {
              const index = range.start + offset;
              return (
                <ScrollRowView
                  key={row.key}
                  row={row}
                  index={index}
                  top={paddingTopPx + row.y}
                  width={column.width}
                  baseFontSize={baseFontSize}
                  dimmed={isRowDimmed(row)}
                  current={row.pageIndex === startPageIndex}
                  fadeMs={fadeMs}
                />
              );
            })}

            {/* Page ticks: where each page starts. They show while scrolling. */}
            <div
              ref={ticksRef}
              aria-hidden="true"
              data-reader-page-ticks=""
              className="pointer-events-none absolute inset-y-0 select-none"
              style={{
                left: column.width,
                width: Math.max(14, paddingRightPx),
                opacity: 0,
              }}
            >
              {column.pageStarts.map((pageStart, pageIndex) =>
                pageIndex === 0 ? null : (
                  <div
                    key={`tick-${pageIndex}`}
                    data-reader-page-tick={pageIndex}
                    data-reader-page-start={pageStart}
                    className="absolute right-1 flex flex-col items-end text-muted-foreground"
                    style={{ top: paddingTopPx + pageStart - 13 }}
                  >
                    {firstGlobalPage !== null && (
                      <span className="font-numeric text-[10px] font-medium leading-none tabular-nums">
                        {firstGlobalPage + pageIndex}
                      </span>
                    )}
                    <span className="mt-[2px] block h-[1.5px] w-3 rounded-full bg-foreground/45" />
                  </div>
                ),
              )}
            </div>

            <div
              className="absolute left-0"
              style={{
                top: paddingTopPx + column.height + END_CARD_GAP_PX,
                width: column.width,
                height: END_CARD_HEIGHT_PX,
                opacity: chromeOpacity,
                transition: `opacity ${fadeMs}ms ease-out`,
              }}
            >
              {nextChapter ? (
                <button
                  type="button"
                  data-reader-next-chapter=""
                  onClick={onOpenNextChapter}
                  className="flex w-full flex-col items-start rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3.5 text-left transition-[background-color,scale] duration-150 active:scale-[0.98] hover:bg-secondary/55"
                >
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    End of chapter
                  </span>
                  <span className="mt-1.5 line-clamp-2 text-[15px] leading-snug text-foreground">
                    Next: {nextChapter.title}
                    {nextChapter.readingTime && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {nextChapter.readingTime}
                      </span>
                    )}
                  </span>
                </button>
              ) : (
                <p className="pt-3 text-center text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  End of book
                </p>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      <ProgressiveEdgeBlur
        edge="bottom"
        height={`calc(${SCROLL_EDGE_BLUR_PX}px + max(env(safe-area-inset-bottom), 0.625rem))`}
        visible={phase.kind === "settled"}
        covered={chromeVisible}
      />
      {insetTop > 0 && (
        <ProgressiveEdgeBlur
          edge="top"
          height={`${insetTop}px`}
          visible={phase.kind === "settled"}
          covered={chromeVisible}
        />
      )}

      {pulling && (
        <PullPill offset={pullOffset} thresholdPx={pullThresholdPx} />
      )}
    </div>
  );
}

function PullPill({
  offset,
  thresholdPx,
}: {
  offset: MotionValue<number>;
  thresholdPx: number;
}) {
  const [armed, setArmed] = useState(false);
  const opacity = useTransform(offset, [8, 36], [0, 1]);
  const y = useTransform(offset, [0, thresholdPx], [10, 0]);
  useEffect(
    () =>
      offset.on("change", (value) => {
        setArmed(value >= thresholdPx);
      }),
    [offset, thresholdPx],
  );
  return (
    <motion.div
      aria-live="polite"
      data-reader-pull-pill={armed ? "armed" : "pulling"}
      className="pointer-events-none absolute inset-x-0 z-[4] flex justify-center"
      // The pull stage ends at the page's bottom edge, above the home
      // indicator; the pill sits in the page's bottom margin.
      style={{ bottom: 14, opacity, y }}
    >
      <span
        className={cn(
          "rounded-full border px-3.5 py-1.5 text-[12px] font-medium shadow-sm backdrop-blur-md transition-colors duration-150",
          armed
            ? "border-foreground bg-foreground text-background"
            : "border-border/70 bg-background/85 text-muted-foreground",
        )}
      >
        {armed ? "Release to scroll" : "Keep pulling to scroll"}
      </span>
    </motion.div>
  );
}
