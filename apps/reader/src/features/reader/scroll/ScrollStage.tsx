import type { ChapterColumnLayout, ContentAnchor } from "@/lib/pagination-v2";
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
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
  findPageAtOffset,
  resolveSnapPage,
  type ScrollRow,
} from "./scroll-model";

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

export interface ScrollPosition {
  /** Page that holds the first fully visible line. */
  pageIndex: number;
  /** Anchor of the first fully visible line. */
  anchor: ContentAnchor | null;
  /** 0 at the chapter top, 1 when its last line reaches the view. */
  progress: number;
}

export interface ScrollStageHandle {
  /**
   * Stops any fling and moves the visible page into its paged position.
   * Lines of other pages fade out. `finished` resolves when the spring ends.
   */
  snapToPage: () => { pageIndex: number; finished: Promise<void> };
  /** Puts a page's top at the top of the reading area, without animation. */
  scrollToPage: (pageIndex: number) => void;
}

interface ScrollStageProps {
  handleRef: Ref<ScrollStageHandle>;
  column: ChapterColumnLayout;
  baseFontSize: number;
  bodyLineHeight: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
  /** Book page number of the chapter's first page, once known. */
  firstGlobalPage: number | null;
  /** Page whose top starts at the top of the reading area. */
  initialPageIndex: number;
  /**
   * "keep-page": the initial page is already on screen as a paged spread;
   * only the other lines fade in. "fade-all": a new chapter fades in.
   */
  enter: "keep-page" | "fade-all";
  /** Receives the content element; selections and highlights live in it. */
  contentRef: RefObject<HTMLDivElement | null>;
  /** Render only the rows near the view. Off renders the whole chapter. */
  windowing: boolean;
  nextChapter: { title: string; readingTime: string | null } | null;
  onOpenNextChapter: () => void;
  onPageChange: (pageIndex: number) => void;
  onPositionSettled: (position: ScrollPosition) => void;
  onScrollDirection: (direction: "up" | "down") => void;
  onEntered: () => void;
  onLinkActivate?: (href: string) => boolean;
}

type Phase =
  | { kind: "mounting" }
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

interface ScrollRowViewProps {
  row: ScrollRow;
  index: number;
  top: number;
  left: number;
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
  left,
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
      className="absolute"
      style={{
        top,
        left,
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
 * Prototype scroll mode for one chapter (Debug mode).
 *
 * The chapter column comes from the pagination worker with exact offsets, so
 * this stage virtualizes without estimates: rows are absolutely positioned at
 * their column offsets, a binary search finds the view, and only the rows
 * near the view mount. The range moves in a task after the frame while
 * enough rows remain ahead, and in the scroll event when the view could
 * reach unmounted space first. Rows of an active selection stay mounted.
 *
 * Page boundaries are known in the same coordinates, which makes both mode
 * switches geometric: entering keeps the page's lines in place, and the snap
 * back moves the visible page by `scrollTop - pageStart` with the page-turn
 * spring, without DOM measurement.
 */
export function ScrollStage({
  handleRef,
  column,
  baseFontSize,
  bodyLineHeight,
  paddingTopPx,
  paddingBottomPx,
  paddingLeftPx,
  paddingRightPx,
  firstGlobalPage,
  initialPageIndex,
  enter,
  contentRef,
  windowing,
  nextChapter,
  onOpenNextChapter,
  onPageChange,
  onPositionSettled,
  onScrollDirection,
  onEntered,
  onLinkActivate,
}: ScrollStageProps) {
  const rows = useMemo(() => buildScrollRows(column), [column]);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const snapOffset = useMotionValue(0);
  const [phase, setPhase] = useState<Phase>({ kind: "mounting" });

  // Programmatic scrolls must not count as reader scrolls for chrome.
  const programmaticScrollRef = useRef(false);
  const selectionRangeRef = useRef<RowRange | null>(null);
  const pinnedRangeRef = useRef<RowRange | null>(null);
  const pageIndexRef = useRef(initialPageIndex);
  const topLineRef = useRef<{ anchor: ContentAnchor; viewOffset: number }>(
    null,
  );
  const rowsRef = useRef(rows);

  const initialScrollTop = column.pageStarts[initialPageIndex] ?? 0;
  const stageHeightEstimate =
    paddingTopPx + column.pageHeight + paddingBottomPx;
  const lastPageStart = column.pageStarts[column.pageStarts.length - 1] ?? 0;
  // The last page must be able to reach the top of the reading area.
  const contentHeight = Math.max(
    paddingTopPx +
      column.height +
      END_CARD_GAP_PX +
      END_CARD_HEIGHT_PX +
      paddingBottomPx,
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

  const commitRange = (next: RowRange) => {
    if (sameRange(next, rangeRef.current)) return;
    rangeRef.current = next;
    setRange(next);
  };

  // The reading area starts below the top padding. Its top, in column
  // offsets, equals scrollTop because rows sit at paddingTop + y.
  const readPosition = (scrollTop: number): ScrollPosition => {
    const viewTop = scrollTop;
    const line = findFirstFullyVisibleLine(rows, column.chapterIndex, viewTop);
    const scrollable = Math.max(1, column.height - column.pageHeight);
    return {
      pageIndex:
        line?.pageIndex ?? findPageAtOffset(column.pageStarts, viewTop),
      anchor: line?.anchor ?? null,
      progress: Math.min(1, Math.max(0, viewTop / scrollable)),
    };
  };

  // Keeps the first visible line in place if a relayout changes geometry.
  useLayoutEffect(() => {
    const previousRows = rowsRef.current;
    rowsRef.current = rows;
    const scroller = scrollerRef.current;
    const topLine = topLineRef.current;
    if (previousRows === rows || !scroller || !topLine) return;
    const offset = findAnchorOffset(rows, topLine.anchor);
    if (offset === null) return;
    const nextTop = paddingTopPx + offset - topLine.viewOffset;
    if (Math.abs(nextTop - scroller.scrollTop) < 0.5) return;
    programmaticScrollRef.current = true;
    scroller.scrollTop = nextTop;
    commitRange(computeTargetRange(nextTop, scroller.clientHeight));
  });

  // Mount only: later positions belong to the reader.
  const openAtInitialPosition = useEffectEvent((scroller: HTMLDivElement) => {
    programmaticScrollRef.current = true;
    scroller.scrollTop = initialScrollTop;
    commitRange(computeTargetRange(initialScrollTop, scroller.clientHeight));
  });
  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) openAtInitialPosition(scroller);
  }, []);

  // Report the opening position; later positions come from scroll events.
  const reportInitialPosition = useEffectEvent(() => {
    onPositionSettled(readPosition(initialScrollTop));
  });
  useEffect(() => {
    reportInitialPosition();
  }, []);

  // Reveal once the visible page's images are decoded, then fade in the rest.
  const notifyEntered = useEffectEvent(onEntered);
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
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
  }, [enter]);

  const handleScroll = useEffectEvent((scroller: HTMLDivElement) => {
    const scrollTop = scroller.scrollTop;

    if (windowing) {
      const scrollerTop = scrollTop - paddingTopPx;
      const first = findFirstRowEndingAfter(rows, scrollerTop);
      const last = findLastRowStartingBefore(
        rows,
        scrollerTop + scroller.clientHeight,
      );
      const current = rangeRef.current;
      const aheadBelow =
        current.end >= rows.length ? Infinity : current.end - 1 - last;
      const aheadAbove = current.start <= 0 ? Infinity : first - current.start;
      const ahead = Math.min(aheadAbove, aheadBelow);
      if (ahead < URGENT_MOVE_ROWS) {
        flushSync(() => {
          commitRange(computeTargetRange(scrollTop, scroller.clientHeight));
        });
      } else if (ahead < DEFERRED_MOVE_ROWS) {
        scheduleDeferredRange();
      }
    }

    const line = findFirstFullyVisibleLine(
      rows,
      column.chapterIndex,
      scrollTop,
    );
    if (line) {
      topLineRef.current = {
        anchor: line.anchor,
        viewOffset: paddingTopPx + line.y - scrollTop,
      };
      if (line.pageIndex !== pageIndexRef.current) {
        pageIndexRef.current = line.pageIndex;
        onPageChange(line.pageIndex);
      }
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

  const settle = useEffectEvent((scroller: HTMLDivElement) => {
    onPositionSettled(readPosition(scroller.scrollTop));
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

    const onScroll = () => {
      handleScroll(scroller);

      window.clearTimeout(settleTimer);
      settleTimer = window.setTimeout(() => settle(scroller), SETTLE_DELAY_MS);

      const top = scroller.scrollTop;
      const delta = top - lastTop;
      lastTop = top;
      if (programmaticScrollRef.current) {
        programmaticScrollRef.current = false;
        return;
      }
      if (delta === 0) return;
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
      const deferred = deferredRangeRef.current;
      if (deferred) {
        cancelAnimationFrame(deferred.frame);
        clearTimeout(deferred.timer);
        deferredRangeRef.current = null;
      }
    };
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

  useImperativeHandle(handleRef, () => ({
    snapToPage: () => {
      const scroller = scrollerRef.current;
      if (!scroller) return { pageIndex: 0, finished: Promise.resolve() };

      // Stop any fling: hidden overflow ends momentum, and writing the
      // current offset back pins it.
      const scrollTop = scroller.scrollTop;
      scroller.style.overflowY = "hidden";
      scroller.scrollTop = scrollTop;

      const pageIndex = resolveSnapPage({
        column,
        rows,
        viewTop: scrollTop,
        bodyLineHeight,
      });
      const pageStart = column.pageStarts[pageIndex] ?? 0;
      pinnedRangeRef.current = rowRangeForPage(rows, pageIndex);
      flushSync(() => {
        commitRange(computeTargetRange(scrollTop, scroller.clientHeight));
        setPhase({ kind: "snapping", pageIndex });
      });

      // Both geometries are known: on the page, a row sits at
      // paddingTop + (y - pageStart); in the column it sits at
      // paddingTop + y - scrollTop. One translation moves every row.
      const target = scrollTop - pageStart;
      if (prefersReducedMotion) {
        snapOffset.set(target);
        return { pageIndex, finished: Promise.resolve() };
      }
      const controls = animate(snapOffset, target, SWIPE_SETTLE_SPRING);
      return {
        pageIndex,
        finished: new Promise<void>((resolve) => {
          void controls.then(() => resolve());
        }),
      };
    },
    scrollToPage: (pageIndex) => {
      const scroller = scrollerRef.current;
      if (!scroller) return;
      const top = column.pageStarts[pageIndex] ?? 0;
      programmaticScrollRef.current = true;
      scroller.scrollTop = top;
      flushSync(() => {
        commitRange(computeTargetRange(top, scroller.clientHeight));
      });
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
    switch (phase.kind) {
      case "mounting":
      case "entering":
        return enter === "fade-all" || row.pageIndex !== initialPageIndex;
      case "settled":
        return false;
      case "snapping":
        return row.pageIndex !== phase.pageIndex;
    }
  };
  const chromeOpacity = phase.kind === "settled" ? 1 : 0;
  const fadeMs = phase.kind === "snapping" ? FADE_OUT_MS : FADE_IN_MS;
  const marginLeft = paddingLeftPx + column.width;

  return (
    <div
      ref={scrollerRef}
      data-reader-scroll-stage={phase.kind}
      onClick={handleClick}
      className="absolute inset-0 z-[3] overflow-x-hidden overflow-y-auto bg-background"
      style={{
        overflowAnchor: "none",
        overscrollBehavior: "contain",
        touchAction: "pan-y pinch-zoom",
        visibility: phase.kind === "mounting" ? "hidden" : "visible",
      }}
    >
      <motion.div
        ref={contentRef}
        data-reader-scroll-content=""
        className="relative w-full"
        style={{ height: contentHeight, y: snapOffset }}
      >
        {rows.slice(range.start, range.end).map((row, offset) => {
          const index = range.start + offset;
          return (
            <ScrollRowView
              key={row.key}
              row={row}
              index={index}
              top={paddingTopPx + row.y}
              left={paddingLeftPx}
              width={column.width}
              baseFontSize={baseFontSize}
              dimmed={isRowDimmed(row)}
              current={row.pageIndex === initialPageIndex}
              fadeMs={fadeMs}
            />
          );
        })}

        {/* Page ticks: where each page would start, so the snap is predictable. */}
        {column.pageStarts.map((start, pageIndex) =>
          pageIndex === 0 ? null : (
            <div
              key={`tick-${pageIndex}`}
              aria-hidden="true"
              data-reader-page-tick={pageIndex}
              data-reader-page-start={start}
              className="pointer-events-none absolute select-none text-muted-foreground"
              style={{
                top: paddingTopPx + start,
                left: marginLeft + 6,
                width: Math.max(8, paddingRightPx - 10),
                opacity: chromeOpacity * 0.55,
                transition: `opacity ${fadeMs}ms ease-out`,
              }}
            >
              <div className="h-px w-full bg-current" />
              {firstGlobalPage !== null && (
                <span className="absolute right-0 bottom-0.5 font-numeric text-[8px] leading-none tabular-nums">
                  {firstGlobalPage + pageIndex}
                </span>
              )}
            </div>
          ),
        )}

        <div
          className="absolute"
          style={{
            top: paddingTopPx + column.height + END_CARD_GAP_PX,
            left: paddingLeftPx,
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
      </motion.div>
    </div>
  );
}
