import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { CopyFeedbackIcon } from "@/components/ui/copy-feedback-icon";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AppHeader } from "@/components/AppNavigation";
import { APP_PAGE_FRAME } from "@/components/app-header-styles";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import { useFileUrl } from "@/hooks/use-file-url";
import { useIsMobile } from "@/hooks/use-mobile";
import { useReadingSessionsQuery } from "@/hooks/use-reading-sessions-query";
import { useSearchStickyState } from "@/hooks/use-search-sticky-state";
import {
  useAllHighlightsQuery,
  type BookHighlightGroup,
} from "./use-all-highlights-query";
import { formatHighlightTime } from "@/lib/date-utils";
import { getBookCoverFileId } from "@/lib/book-file-references";
import type { Highlight } from "@/lib/db";
import {
  COMPACT_HIGHLIGHT_CARD_HEIGHT,
  SHORT_HIGHLIGHT_CARD_HEIGHT,
  getHighlightCardPresentation,
  type HighlightCardPresentation,
} from "./highlight-card-presentation";
import {
  ALL_HIGHLIGHT_COLORS,
  toggleHighlightColorSelection,
} from "./highlight-filter-selection";
import {
  BOOK_COVER_TILE_ID,
  BOOK_DETAILS_TILE_ID,
  computeHighlightsBentoLayout,
  doesMosaicPlacementIntersectViewport,
  getHighlightsMosaicGeometry,
  type HighlightsMosaicLayout,
  type MosaicPlacement,
  type MosaicViewportRange,
} from "./highlights-masonry-layout";
import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { formatReadingDuration } from "@/lib/reading-session-stats";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import { getChapterTitleFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import { Tooltip } from "@base-ui/react/tooltip";
import { layout, prepare, type PreparedText } from "@chenglou/pretext";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import {
  LayoutGroup,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  BookOpen,
  BookOpenText,
  Copy,
  Check,
  Ellipsis,
  Highlighter,
  Pin,
  PinOff,
  Search,
  X,
} from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";

const MOSAIC_GAP = 8;
const MOSAIC_MAX_COLUMNS = 4;
const MOSAIC_MIN_CARD_WIDTH = 220;
const QUOTE_FONT = '400 18px "EB Garamond"';
const QUOTE_LINE_HEIGHT = 24;
const QUOTE_CARD_CHROME_HEIGHT = 80;
const QUOTE_CARD_MIN_HEIGHT = 96;
const WIDE_QUOTE_MIN_LINES = 7;
const BOOK_TITLE_MAX_FONT = '500 44px "EB Garamond"';
const TILE_OVERSCAN_VIEWPORTS = 1;
const BOOK_INDEX_PIN_STORAGE_KEY = "highlights-masonry-book-index-pinned-v2";
const BOOK_INDEX_ACTIVE_LAYOUT_ID = "highlights-book-index-active";
const MOBILE_BOOK_COVER_MIN_WIDTH = 84;
const MOBILE_BOOK_COVER_MAX_WIDTH = 104;
// The sticky search surface occupies this much vertical space on mobile.
const MOBILE_BOOK_NAV_SCROLL_OFFSET_PX = 80;
// Leave a small buffer so fractional layout values do not keep the previous
// book active when a selected section lands exactly on the scroll margin.
const MOBILE_BOOK_ACTIVE_OFFSET_PX = MOBILE_BOOK_NAV_SCROLL_OFFSET_PX + 8;
const BOOK_INDEX_ACTIVE_TRANSITION = {
  type: "spring" as const,
  stiffness: 390,
  damping: 36,
  mass: 0.9,
};
const BOOK_PROGRESS_NAVIGATION_TRANSITION = {
  duration: 0.25,
  ease: [0.77, 0, 0.175, 1] as const,
};
const TILE_ENTRANCE_SETTLE_MS = 450;
const SEARCH_DEBOUNCE_MS = 100;

const highlightAccentValues: Record<AnnotationColor, string> = {
  yellow: "var(--yellow-primary, var(--yellow-secondary))",
  green: "var(--green-primary, var(--green-secondary))",
  blue: "var(--blue-primary, var(--blue-secondary))",
  magenta: "var(--magenta-primary, var(--magenta-secondary))",
  invisible: "var(--muted-foreground)",
};

type HighlightAccentStyle = CSSProperties & {
  "--highlight-accent": string;
};

type TileEntranceStyle = CSSProperties & {
  "--tile-entrance-delay": string;
  "--tile-entrance-x": string;
  "--tile-entrance-y": string;
};

type TileEntrancePhase = "waiting" | "running" | "complete";

interface HighlightsTooltipPayload {
  label: string;
}

function getHighlightAccentStyle(color: AnnotationColor): HighlightAccentStyle {
  return { "--highlight-accent": highlightAccentValues[color] };
}

function SharedHighlightsTooltip({
  handle,
}: {
  handle: Tooltip.Handle<HighlightsTooltipPayload>;
}) {
  return (
    <Tooltip.Root handle={handle} disableHoverablePopup>
      {({ payload }) => (
        <Tooltip.Portal>
          <Tooltip.Positioner
            sideOffset={8}
            collisionPadding={8}
            className="z-50"
          >
            <Tooltip.Popup className="origin-[var(--transform-origin)] rounded-lg bg-foreground px-2.5 py-1.5 text-xs font-medium text-background shadow-lg transition-[opacity,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] data-[ending-style]:scale-[0.96] data-[ending-style]:opacity-0 data-[instant]:transition-none data-[starting-style]:scale-[0.96] data-[starting-style]:opacity-0 motion-reduce:transition-opacity motion-reduce:data-[ending-style]:scale-100 motion-reduce:data-[starting-style]:scale-100">
              {payload?.label}
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      )}
    </Tooltip.Root>
  );
}

function getStableNumber(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function getTileEntrance(key: string) {
  const hash = getStableNumber(key);
  const offsets = [
    { x: -14, y: 10 },
    { x: 12, y: 14 },
    { x: -8, y: 16 },
    { x: 14, y: -6 },
  ];

  return {
    ...offsets[hash % offsets.length],
    delay: (hash % 6) * 0.035,
  };
}

/**
 * Holds the initial tiles still for one paint, then starts their compositor
 * entrance. The captured scroll offset keeps later virtualized tiles settled.
 */
function useInitialTileEntrance(
  isLayoutReady: boolean,
  currentScrollOffset: number,
) {
  const initialScrollOffsetRef = useRef<number | null>(null);
  if (isLayoutReady && initialScrollOffsetRef.current === null) {
    initialScrollOffsetRef.current = currentScrollOffset;
  }

  const initialScrollOffset = initialScrollOffsetRef.current;
  const [phase, setPhase] = useState<TileEntrancePhase>("waiting");
  useEffect(() => {
    if (initialScrollOffset === null) return;

    let secondFrame = 0;
    let settleTimer = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        setPhase("running");
        settleTimer = window.setTimeout(() => {
          setPhase("complete");
        }, TILE_ENTRANCE_SETTLE_MS);
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
    };
  }, [initialScrollOffset]);

  return { initialScrollOffset, phase };
}

function useElementWidth() {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    if (!element) return;

    const updateWidth = (nextWidth: number) => {
      setWidth(Math.floor(nextWidth));
    };

    updateWidth(element.getBoundingClientRect().width);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [element]);

  return { element, elementRef: setElement, width };
}

/**
 * Prepares quote text only after the display fonts are available. Pretext can
 * then recalculate card heights on resize without reading layout from the DOM.
 */
function usePreparedHighlights(highlights: Highlight[]) {
  const [fontReady, setFontReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.all([
      document.fonts.load(QUOTE_FONT),
      document.fonts.load(BOOK_TITLE_MAX_FONT),
    ]).then(() => {
      if (!cancelled) setFontReady(true);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const preparedById = useMemo(() => {
    const prepared = new Map<string, PreparedText>();
    if (!fontReady) return prepared;

    for (const highlight of highlights) {
      prepared.set(
        highlight.id,
        prepare(`“ ${highlight.selectedText}`, QUOTE_FONT),
      );
    }
    return prepared;
  }, [fontReady, highlights]);

  return { fontReady, preparedById };
}

function getBookTitleFontSize(containerWidth: number) {
  return Math.max(30, Math.min(44, containerWidth * 0.03));
}

function getBookDetailsHeight({
  group,
  columnWidth,
  fontSize,
}: {
  group: BookHighlightGroup;
  columnWidth: number;
  fontSize: number;
}) {
  const lineHeight = fontSize * 0.96;
  const preparedTitle = prepare(
    group.book.title,
    `500 ${fontSize}px "EB Garamond"`,
  );
  const titleHeight = layout(
    preparedTitle,
    Math.max(1, columnWidth - 20),
    lineHeight,
  ).height;

  return Math.ceil(titleHeight + (group.book.author ? 180 : 144));
}

function getSingleColumnBookCoverWidth(columnWidth: number) {
  return Math.min(
    MOBILE_BOOK_COVER_MAX_WIDTH,
    Math.max(MOBILE_BOOK_COVER_MIN_WIDTH, Math.round(columnWidth * 0.28)),
  );
}

function getSingleColumnBookDetailsHeight({
  group,
  columnWidth,
  titleFontSize,
}: {
  group: BookHighlightGroup;
  columnWidth: number;
  titleFontSize: number;
}) {
  const coverWidth = getSingleColumnBookCoverWidth(columnWidth);
  const compactTitleFontSize = Math.min(titleFontSize, 32);
  const titleLineHeight = compactTitleFontSize * 0.96;
  const titleWidth = Math.max(1, columnWidth - coverWidth - 36);
  const preparedTitle = prepare(
    group.book.title,
    `500 ${compactTitleFontSize}px "EB Garamond"`,
  );
  const titleHeight = layout(preparedTitle, titleWidth, titleLineHeight).height;
  const detailsHeight = titleHeight + (group.book.author ? 99 : 59);
  const coverHeight = coverWidth * 1.5;

  return Math.ceil(Math.max(detailsHeight, coverHeight) + 32);
}

interface HighlightsMosaicModel {
  mosaic: HighlightsMosaicLayout;
  presentationByHighlightId: Map<string, HighlightCardPresentation>;
  titleFontSize: number;
  isSingleColumn: boolean;
  compactCoverWidth: number;
}

/** Calculates stable mosaic geometry without constructing highlight cards. */
function createHighlightsMosaicModel({
  group,
  highlights,
  width,
  fontReady,
  preparedById,
}: {
  group: BookHighlightGroup;
  highlights: Highlight[];
  width: number;
  fontReady: boolean;
  preparedById: Map<string, PreparedText>;
}): HighlightsMosaicModel {
  const geometry = getHighlightsMosaicGeometry(width, {
    gap: MOSAIC_GAP,
    maxColumnCount: MOSAIC_MAX_COLUMNS,
    minColumnWidth: MOSAIC_MIN_CARD_WIDTH,
  });
  const titleFontSize = getBookTitleFontSize(width);
  const isSingleColumn = geometry.columnCount === 1;
  const compactCoverWidth = isSingleColumn
    ? getSingleColumnBookCoverWidth(geometry.columnWidth)
    : 0;
  const presentationByHighlightId = new Map<
    string,
    HighlightCardPresentation
  >();
  const isReady =
    width > 0 &&
    fontReady &&
    highlights.every((highlight) => preparedById.has(highlight.id));

  if (!isReady) {
    return {
      mosaic: computeHighlightsBentoLayout(0, []),
      presentationByHighlightId,
      titleFontSize,
      isSingleColumn,
      compactCoverWidth,
    };
  }

  const detailsHeight = isSingleColumn
    ? getSingleColumnBookDetailsHeight({
        group,
        columnWidth: geometry.columnWidth,
        titleFontSize,
      })
    : getBookDetailsHeight({
        group,
        columnWidth: geometry.columnWidth,
        fontSize: titleFontSize,
      });
  const textWidth = Math.max(1, geometry.columnWidth - 40);
  const compactTextWidth = Math.max(1, geometry.columnWidth - 72);
  const wideTextWidth = Math.max(1, geometry.columnWidth * 2 + MOSAIC_GAP - 40);
  const measurements = highlights.flatMap((highlight) => {
    const prepared = preparedById.get(highlight.id);
    if (!prepared) return [];

    const compactTextHeight = layout(
      prepared,
      compactTextWidth,
      QUOTE_LINE_HEIGHT,
    ).height;
    const renderedLineCount = Math.max(
      1,
      Math.ceil(compactTextHeight / QUOTE_LINE_HEIGHT),
    );
    const presentation = getHighlightCardPresentation(
      highlight.selectedText,
      renderedLineCount,
    );
    presentationByHighlightId.set(highlight.id, presentation);

    if (presentation === "word-cloud") {
      return [
        {
          id: highlight.id,
          height: SHORT_HIGHLIGHT_CARD_HEIGHT,
          wideHeight: SHORT_HIGHLIGHT_CARD_HEIGHT,
          preferredColumnSpan: 1 as const,
        },
      ];
    }

    if (presentation === "compact-quote") {
      return [
        {
          id: highlight.id,
          height: COMPACT_HIGHLIGHT_CARD_HEIGHT,
          wideHeight: COMPACT_HIGHLIGHT_CARD_HEIGHT,
          preferredColumnSpan: 1 as const,
        },
      ];
    }

    const textHeight = layout(prepared, textWidth, QUOTE_LINE_HEIGHT).height;
    const shouldUseWideCard =
      geometry.columnCount > 1 &&
      textHeight >= QUOTE_LINE_HEIGHT * WIDE_QUOTE_MIN_LINES;
    const wideTextHeight = shouldUseWideCard
      ? layout(prepared, wideTextWidth, QUOTE_LINE_HEIGHT).height
      : textHeight;

    return [
      {
        id: highlight.id,
        height: Math.max(
          QUOTE_CARD_MIN_HEIGHT,
          textHeight + QUOTE_CARD_CHROME_HEIGHT,
        ),
        wideHeight: Math.max(
          QUOTE_CARD_MIN_HEIGHT,
          wideTextHeight + QUOTE_CARD_CHROME_HEIGHT,
        ),
        preferredColumnSpan: shouldUseWideCard ? (2 as const) : (1 as const),
      },
    ];
  });

  return {
    mosaic: computeHighlightsBentoLayout(width, measurements, {
      gap: MOSAIC_GAP,
      maxColumnCount: MOSAIC_MAX_COLUMNS,
      minColumnWidth: MOSAIC_MIN_CARD_WIDTH,
      detailsHeight,
      layoutSeed: getStableNumber(group.book.id),
    }),
    presentationByHighlightId,
    titleFontSize,
    isSingleColumn,
    compactCoverWidth,
  };
}

function TileEntrance({
  entranceKey,
  phase,
  children,
}: {
  entranceKey: string;
  phase: TileEntrancePhase;
  children: React.ReactNode;
}) {
  const entrance = useMemo(() => getTileEntrance(entranceKey), [entranceKey]);
  const style: TileEntranceStyle = {
    "--tile-entrance-delay": `${entrance.delay}s`,
    "--tile-entrance-x": `${entrance.x}px`,
    "--tile-entrance-y": `${entrance.y}px`,
  };

  return (
    <div
      data-highlight-entrance=""
      className={cn(
        "h-full",
        phase === "waiting" && "highlight-tile-entrance-pending",
        phase === "running" && "highlight-tile-entrance-running",
      )}
      style={style}
    >
      {children}
    </div>
  );
}

function PositionedTile({
  placement,
  entranceKey,
  animateEntrance,
  entrancePhase,
  children,
}: {
  placement: MosaicPlacement;
  entranceKey: string;
  animateEntrance: boolean;
  entrancePhase: TileEntrancePhase;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute top-0 left-0"
      style={{
        height: placement.height,
        width: placement.width,
        transform: `translate3d(${placement.left}px, ${placement.top}px, 0)`,
      }}
    >
      {animateEntrance ? (
        <TileEntrance entranceKey={entranceKey} phase={entrancePhase}>
          {children}
        </TileEntrance>
      ) : (
        <div className="h-full">{children}</div>
      )}
    </div>
  );
}

function getBookSectionId(bookId: string) {
  return `highlights-book-${bookId}`;
}

function getBookHeadingId(bookId: string) {
  return `highlights-book-heading-${bookId}`;
}

/**
 * Tracks manual scrolling without latency. An instant anchor jump temporarily
 * takes control and interpolates the visible rail to the new document progress.
 */
function useBookNavigationProgress(scrollProgress: MotionValue<number>) {
  const reducedMotion = useReducedMotion() ?? false;
  const displayedProgress = useMotionValue(scrollProgress.get());
  const navigationPendingRef = useRef(false);
  const navigationFrameRef = useRef(0);
  const animationRef = useRef<ReturnType<typeof animate> | null>(null);

  useEffect(() => {
    const unsubscribe = scrollProgress.on("change", (latestProgress) => {
      if (navigationPendingRef.current || animationRef.current) return;
      displayedProgress.set(latestProgress);
    });

    return () => {
      unsubscribe();
      window.cancelAnimationFrame(navigationFrameRef.current);
      animationRef.current?.stop();
    };
  }, [displayedProgress, scrollProgress]);

  const animateAfterInstantNavigation = useCallback(() => {
    window.cancelAnimationFrame(navigationFrameRef.current);
    animationRef.current?.stop();
    animationRef.current = null;
    navigationPendingRef.current = true;

    navigationFrameRef.current = window.requestAnimationFrame(() => {
      const targetProgress = scrollProgress.get();
      if (reducedMotion) {
        displayedProgress.set(targetProgress);
        navigationPendingRef.current = false;
        return;
      }

      const animation = animate(
        displayedProgress,
        targetProgress,
        BOOK_PROGRESS_NAVIGATION_TRANSITION,
      );
      animationRef.current = animation;
      navigationPendingRef.current = false;
      void animation.then(() => {
        if (animationRef.current !== animation) return;
        animationRef.current = null;
        displayedProgress.set(scrollProgress.get());
      });
    });
  }, [displayedProgress, reducedMotion, scrollProgress]);

  return { displayedProgress, animateAfterInstantNavigation };
}

function BookIndexItem({
  className,
  compact = false,
  group,
  isActive,
  layoutId,
  onNavigate,
  reducedMotion,
}: {
  className?: string;
  compact?: boolean;
  group: BookHighlightGroup;
  isActive: boolean;
  layoutId?: string;
  onNavigate: (event: MouseEvent<HTMLAnchorElement>) => void;
  reducedMotion: boolean;
}) {
  const coverFileId = getBookCoverFileId(group.book);
  const { url: coverUrl } = useFileUrl(coverFileId, {
    skip: !coverFileId,
  });
  const highlightCount = group.highlights.length;
  const springPress = useSpringPressAnimation();

  // Keep rows in the nav's shared stacking context. Otherwise the target row's
  // DOM order can lift the moving selection marker above rows that it crosses.
  return (
    <motion.a
      href={`#${getBookSectionId(group.book.id)}`}
      onClick={(event) => {
        event.preventDefault();
        onNavigate(event);
      }}
      aria-current={isActive ? "location" : undefined}
      className={cn(
        "relative flex min-w-0 items-center gap-2.5 rounded-xl p-2 text-left outline-none transition-colors duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-ring",
        compact && "gap-2 rounded-lg p-1.5",
        layoutId && "active:bg-secondary/70",
        !layoutId && isActive && "bg-secondary",
        className,
      )}
      initial={layoutId ? undefined : springPress.initial}
      animate={layoutId ? undefined : springPress.animate}
      onTap={layoutId ? undefined : springPress.onTap}
    >
      {isActive && layoutId ? (
        <motion.span
          layoutId={layoutId}
          aria-hidden="true"
          initial={false}
          transition={
            reducedMotion ? { duration: 0 } : BOOK_INDEX_ACTIVE_TRANSITION
          }
          className="pointer-events-none absolute inset-0 z-0 rounded-xl bg-secondary"
        >
          <span className="absolute top-3 bottom-3 left-0 w-0.5 rounded-full bg-foreground/70" />
        </motion.span>
      ) : (
        isActive && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-foreground/70 transition-opacity duration-150 ease-[cubic-bezier(0.23,1,0.32,1)]"
          />
        )
      )}
      <span
        className={cn(
          "relative z-10 aspect-2/3 w-11 shrink-0 overflow-hidden rounded-r-md rounded-l-xs shadow-md",
          compact && "w-9",
        )}
      >
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            className="image-outline h-full w-full object-cover"
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center border bg-secondary">
            <BookOpenText
              className="size-5 text-muted-foreground"
              aria-hidden="true"
            />
          </span>
        )}
      </span>
      <span className="relative z-10 min-w-0 flex-1">
        <span
          className={cn(
            "line-clamp-2 font-serif text-base font-medium leading-[1.05]",
            compact && "text-sm",
          )}
        >
          {group.book.title}
        </span>
        {group.book.author && (
          <span
            className={cn(
              "mt-1 block truncate text-[11px] text-muted-foreground",
              compact && "mt-0.5 text-[10px]",
            )}
          >
            {group.book.author}
          </span>
        )}
        <span
          className={cn(
            "mt-1.5 block text-[11px] text-muted-foreground",
            compact && "mt-1 text-[10px]",
          )}
        >
          {highlightCount} {highlightCount === 1 ? "highlight" : "highlights"}
        </span>
      </span>
    </motion.a>
  );
}

function BookIndexPanel({
  className,
  style,
  groups,
  activeBookId,
  isPinned,
  onNavigate,
  onPinChange,
}: {
  className?: string;
  style?: CSSProperties;
  groups: BookHighlightGroup[];
  activeBookId: string;
  isPinned: boolean;
  onNavigate: (bookId: string) => void;
  onPinChange: (isPinned: boolean) => void;
}) {
  const layoutGroupId = useId();
  const reducedMotion = useReducedMotion() ?? false;

  return (
    <aside
      style={style}
      className={cn(
        "max-h-[calc(100svh-7rem)] flex-col overflow-hidden rounded-[calc(var(--radius-xl)+9px)] border bg-card p-2 shadow-xl",
        className,
      )}
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-2 pt-1 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h2 className="truncate font-serif text-lg font-medium">
            In this page
          </h2>
          <span className="text-[11px] text-muted-foreground">
            {groups.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => onPinChange(!isPinned)}
          aria-label={isPinned ? "Unpin book index" : "Pin book index"}
          aria-pressed={isPinned}
          title={isPinned ? "Unpin book index" : "Pin book index"}
          className={cn(
            "grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none transition-[background-color,color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96]",
            isPinned && "bg-secondary text-foreground",
          )}
        >
          {isPinned ? (
            <PinOff className="size-3.5" aria-hidden="true" />
          ) : (
            <Pin className="size-3.5" aria-hidden="true" />
          )}
        </button>
      </div>
      <LayoutGroup id={layoutGroupId}>
        <nav
          aria-label="Books on this highlights page"
          className="relative isolate min-h-0 overflow-y-auto pr-1 pb-1"
        >
          {groups.map((group) => (
            <BookIndexItem
              key={group.book.id}
              group={group}
              isActive={group.book.id === activeBookId}
              layoutId={BOOK_INDEX_ACTIVE_LAYOUT_ID}
              onNavigate={() => onNavigate(group.book.id)}
              reducedMotion={reducedMotion}
            />
          ))}
        </nav>
      </LayoutGroup>
    </aside>
  );
}

function MobileBookIndex({
  groups,
  activeBookId,
  isOpen,
  onNavigate,
  onOpenChange,
}: {
  groups: BookHighlightGroup[];
  activeBookId: string;
  isOpen: boolean;
  onNavigate: (bookId: string) => void;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Choose a book on this page"
        title="Books on this page"
        aria-expanded={isOpen}
        aria-controls="mobile-highlights-book-index"
        onClick={() => onOpenChange(true)}
        className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 grid size-12 place-items-center rounded-full border bg-card text-foreground shadow-xl outline-none transition-[background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] lg:hidden"
      >
        <span className="grid size-6 content-center gap-0.5" aria-hidden="true">
          <span className="ml-auto h-0.5 w-5 rounded-full bg-current" />
          <span className="ml-auto h-0.5 w-3.5 rounded-full bg-current" />
          <span className="ml-auto h-0.5 w-2 rounded-full bg-current" />
        </span>
      </button>

      <BottomSheet
        open={isOpen}
        onOpenChange={onOpenChange}
        title="Books on this page"
        modal="trap-focus"
        panelClassName="max-w-md"
        bodyClassName="overflow-y-auto overscroll-contain"
      >
        <div className="px-4 pb-4 pt-2">
          <nav
            id="mobile-highlights-book-index"
            aria-label="Books on this highlights page"
            className="space-y-1"
          >
            {groups.map((group) => (
              <BookIndexItem
                key={group.book.id}
                group={group}
                isActive={group.book.id === activeBookId}
                onNavigate={() => onNavigate(group.book.id)}
                reducedMotion={false}
                compact
              />
            ))}
          </nav>
        </div>
      </BottomSheet>
    </>
  );
}

function FloatingBookIndex({
  groups,
  activeBookId,
  onNavigate,
  onPin,
  scrollProgress,
}: {
  groups: BookHighlightGroup[];
  activeBookId: string;
  onNavigate: (bookId: string) => void;
  onPin: () => void;
  scrollProgress: MotionValue<number>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const closeTimerRef = useRef(0);
  const progressTransform = useTransform(
    scrollProgress,
    (value) => `translate3d(0, 0, 0) scaleY(${value})`,
  );

  useEffect(() => {
    return () => window.clearTimeout(closeTimerRef.current);
  }, []);

  const showPanel = () => {
    window.clearTimeout(closeTimerRef.current);
    setIsOpen(true);
  };

  const schedulePanelClose = () => {
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 100);
  };

  return (
    <div
      onMouseEnter={showPanel}
      onMouseLeave={schedulePanelClose}
      className={cn(
        "fixed top-[calc((100svh-min(64svh,560px))/2)] right-0 z-40 hidden h-[min(64svh,560px)] w-[292px] lg:pointer-fine:block",
        isOpen ? "pointer-events-auto" : "pointer-events-none",
      )}
    >
      <div
        onMouseEnter={showPanel}
        title="Books on this page"
        className="pointer-events-auto absolute inset-y-0 right-0 w-24 cursor-default"
      >
        <div className="absolute inset-y-3 right-3 w-1 overflow-hidden rounded-full bg-border">
          <motion.div
            className="h-full origin-top rounded-full bg-foreground/55"
            style={{ transform: progressTransform }}
          />
        </div>
      </div>

      <BookIndexPanel
        groups={groups}
        activeBookId={activeBookId}
        isPinned={false}
        onNavigate={onNavigate}
        onPinChange={onPin}
        className={cn(
          "absolute inset-y-0 right-6 flex w-64 origin-right will-change-[transform,opacity]",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        style={{
          transform:
            isOpen || prefersReducedMotion
              ? "translate3d(0, 0, 0)"
              : "translate3d(16px, 0, 0)",
          transitionDuration: isOpen ? "180ms" : "150ms",
          transitionProperty: prefersReducedMotion
            ? "opacity"
            : "transform, opacity",
          transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
        }}
      />
    </div>
  );
}

function BookDetailsTile({
  group,
  headingId,
  visibleCount,
  titleFontSize,
  compactCover,
}: {
  group: BookHighlightGroup;
  headingId: string;
  visibleCount: number;
  titleFontSize: number;
  compactCover?: React.ReactNode;
}) {
  const totalCount = group.highlights.length;
  const countLabel =
    visibleCount === totalCount
      ? `${totalCount} ${totalCount === 1 ? "highlight" : "highlights"}`
      : `${visibleCount} of ${totalCount} highlights`;

  return (
    <div
      className={cn(
        "flex h-full justify-start py-4 pr-4 pl-1",
        compactCover ? "items-start gap-4" : "flex-col",
      )}
    >
      {compactCover}
      <div className={cn("min-w-0", compactCover && "flex-1 pt-1")}>
        <span className="mb-3 text-[11px] font-medium tracking-[0.16em] text-muted-foreground uppercase">
          Book
        </span>
        <h2
          id={headingId}
          className="font-serif font-medium tracking-[-0.035em] text-balance"
          style={{
            fontSize: compactCover
              ? Math.min(titleFontSize, 32)
              : titleFontSize,
            lineHeight: 0.96,
          }}
        >
          {group.book.title}
        </h2>
        {group.book.author && (
          <p className="mt-4 font-serif text-base text-muted-foreground italic md:text-lg">
            {group.book.author}
          </p>
        )}
        <div className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-green-primary" />
          <span>{countLabel}</span>
        </div>
      </div>
    </div>
  );
}

function BookCoverTile({
  group,
  readingTimeMs,
  tooltipHandle,
}: {
  group: BookHighlightGroup;
  readingTimeMs: number;
  tooltipHandle: Tooltip.Handle<HighlightsTooltipPayload>;
}) {
  const coverFileId = getBookCoverFileId(group.book);
  const { url: coverUrl } = useFileUrl(coverFileId, {
    skip: !coverFileId,
  });
  const cover = (
    <Link
      to={`/reader/${group.book.id}`}
      aria-label={`Open ${group.book.title}`}
      className="group relative block h-full overflow-hidden rounded-2xl border border-border/50 bg-secondary/25 outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
    >
      {coverUrl ? (
        <img
          src={coverUrl}
          alt={`Cover of ${group.book.title}`}
          className="image-outline size-full object-cover transition-transform duration-200 ease-[cubic-bezier(0.23,1,0.32,1)] [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-[1.015]"
        />
      ) : (
        <div className="flex size-full items-center justify-center bg-secondary">
          <BookOpenText
            className="size-10 text-muted-foreground"
            aria-hidden="true"
          />
          <span className="sr-only">
            No cover available for {group.book.title}
          </span>
        </div>
      )}
      <span className="absolute right-3 bottom-3 grid size-9 place-items-center rounded-full border border-border/60 bg-background/90 text-foreground shadow-md backdrop-blur-md transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] [@media(hover:hover)_and_(pointer:fine)]:group-hover:scale-105">
        <BookOpen className="size-4" aria-hidden="true" />
      </span>
    </Link>
  );

  return (
    <Tooltip.Trigger
      handle={tooltipHandle}
      payload={{
        label:
          readingTimeMs > 0
            ? `Reading time: ${formatReadingDuration(readingTimeMs)}`
            : "No reading time yet",
      }}
      delay={300}
      closeDelay={80}
      render={cover}
    />
  );
}

function HighlightQuoteCard({
  highlight,
  presentation,
  isMobile,
  chapterTitle,
  tooltipHandle,
  onCopy,
  onOpenActions,
  onOpenBook,
  isCopied,
}: {
  highlight: Highlight;
  presentation: HighlightCardPresentation;
  isMobile: boolean;
  chapterTitle: string;
  tooltipHandle: Tooltip.Handle<HighlightsTooltipPayload>;
  onCopy: (highlight: Highlight) => void;
  onOpenActions: (highlight: Highlight) => void;
  onOpenBook: (highlight: Highlight) => void;
  isCopied: boolean;
}) {
  const usesWordCloud = presentation === "word-cloud";
  const usesCompactQuote = presentation === "compact-quote";
  const showsMetadata = presentation === "quote";
  const card = (
    <article
      className={cn(
        "group relative h-full overflow-hidden rounded-xl border text-card-foreground",
        usesWordCloud
          ? "bg-secondary/35"
          : usesCompactQuote
            ? "bg-secondary/20"
            : "bg-card",
      )}
      style={getHighlightAccentStyle(highlight.color)}
    >
      {showsMetadata && (
        <div
          className="absolute inset-y-3 left-0 w-1 rounded-r-full bg-[var(--highlight-accent)]"
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        onClick={() =>
          isMobile ? onOpenActions(highlight) : onCopy(highlight)
        }
        aria-label={
          isMobile ? "Show highlight actions" : "Copy highlight to clipboard"
        }
        className={cn(
          "group flex h-full w-full cursor-pointer flex-col px-5 pt-4 pb-5 text-left outline-none transition-[background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent/35 group-data-[popup-open]:bg-accent/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset active:scale-[0.99] md:cursor-copy",
          !showsMetadata && "text-center",
        )}
      >
        {usesWordCloud ? (
          <blockquote className="m-0 flex min-h-0 flex-1 items-center justify-center px-2 py-5 font-serif text-[clamp(2rem,7vw,3.5rem)] leading-[0.94] tracking-[-0.035em] md:text-[clamp(2rem,3vw,3.25rem)]">
            <span className="relative inline-block max-w-full">
              <span className="relative z-10 break-words">
                {highlight.selectedText}
              </span>
              <span
                className="absolute -bottom-2 left-1/2 h-1.5 w-[72%] -translate-x-1/2 rounded-full bg-[var(--highlight-accent)] opacity-35"
                aria-hidden="true"
              />
            </span>
          </blockquote>
        ) : usesCompactQuote ? (
          <blockquote className="m-0 flex min-h-0 flex-1 items-center justify-center px-1 py-3 font-serif text-[19px] leading-6">
            <span className="inline text-balance">
              <span
                className="mr-1 text-[24px] leading-0 text-[var(--highlight-accent)]"
                aria-hidden="true"
              >
                “
              </span>
              {highlight.selectedText}
              <span
                className="ml-1 text-[24px] leading-0 text-[var(--highlight-accent)]"
                aria-hidden="true"
              >
                ”
              </span>
            </span>
          </blockquote>
        ) : (
          <blockquote className="m-0 break-words font-serif text-[18px] leading-6">
            <span
              className="mr-1 text-[25px] leading-0 text-[var(--highlight-accent)]"
              aria-hidden="true"
            >
              “
            </span>
            {highlight.selectedText}
          </blockquote>
        )}
        {showsMetadata && (
          <footer className="mt-auto flex min-h-8 shrink-0 items-center justify-end gap-1.5 pt-3 text-[11px] leading-none text-muted-foreground">
            <span
              className="size-1.5 shrink-0 rounded-full bg-[var(--highlight-accent)]"
              aria-hidden="true"
            />
            <time
              className="whitespace-nowrap"
              dateTime={new Date(highlight.createdAt).toISOString()}
            >
              {formatHighlightTime(highlight.createdAt)}
            </time>
            {isMobile ? (
              <Ellipsis
                className="ml-1 size-3.5 opacity-60"
                aria-hidden="true"
              />
            ) : (
              <CopyFeedbackIcon
                copied={isCopied}
                className={cn(
                  "ml-1 size-3.5 transition-opacity duration-150",
                  isCopied
                    ? "text-foreground opacity-100"
                    : "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70",
                )}
              />
            )}
            <span className="sr-only">
              {isMobile ? "Show actions" : "Copy highlight"}
            </span>
          </footer>
        )}
      </button>
    </article>
  );

  if (isMobile) {
    return (
      <Tooltip.Trigger
        handle={tooltipHandle}
        payload={{ label: chapterTitle }}
        delay={380}
        closeDelay={80}
        render={card}
      />
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger render={card} />
      <ContextMenuContent className="w-52">
        <ContextMenuItem onClick={() => onCopy(highlight)}>
          <Copy className="size-4" aria-hidden="true" />
          Copy highlight
        </ContextMenuItem>
        <ContextMenuItem onClick={() => onOpenBook(highlight)}>
          <BookOpen className="size-4" aria-hidden="true" />
          Open in book
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function HighlightActionsSheet({
  highlight,
  onClose,
  onCopy,
  onOpenBook,
}: {
  highlight: Highlight | null;
  onClose: () => void;
  onCopy: (highlight: Highlight) => Promise<boolean>;
  onOpenBook: (highlight: Highlight) => void;
}) {
  const copyPress = useSpringPressAnimation();
  const openBookPress = useSpringPressAnimation();
  const [isCopied, setIsCopied] = useState(false);
  const resetTimerRef = useRef(0);

  useEffect(() => {
    setIsCopied(false);
    window.clearTimeout(resetTimerRef.current);
  }, [highlight]);

  useEffect(() => {
    return () => window.clearTimeout(resetTimerRef.current);
  }, []);

  const handleCopy = async () => {
    if (!highlight) return;

    const didCopy = await onCopy(highlight);
    if (!didCopy) return;

    setIsCopied(true);
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => setIsCopied(false), 1600);
  };

  return (
    <BottomSheet
      open={highlight !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      title="Highlight actions"
      panelClassName="max-w-md"
    >
      <div
        className="px-4 pt-2"
        style={{
          paddingBottom: "calc(1rem + env(safe-area-inset-bottom))",
        }}
      >
        {highlight && (
          <blockquote
            className="mb-3 line-clamp-4 rounded-2xl border bg-secondary/25 px-4 py-3 font-serif text-base leading-6"
            style={getHighlightAccentStyle(highlight.color)}
          >
            <span
              className="mr-1 text-xl text-[var(--highlight-accent)]"
              aria-hidden="true"
            >
              “
            </span>
            {highlight.selectedText}
          </blockquote>
        )}

        <div className="grid gap-2">
          <motion.button
            type="button"
            onClick={() => void handleCopy()}
            className="flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 text-left font-medium outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            {...copyPress}
          >
            <span className="grid size-8 place-items-center rounded-full bg-secondary">
              <CopyFeedbackIcon copied={isCopied} className="size-4" />
            </span>
            <span aria-live="polite">
              {isCopied ? "Copied" : "Copy highlight"}
            </span>
          </motion.button>
          <motion.button
            type="button"
            onClick={() => {
              if (highlight) onOpenBook(highlight);
            }}
            className="flex h-14 items-center gap-3 rounded-2xl border bg-card px-4 text-left font-medium outline-none transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring"
            {...openBookPress}
          >
            <span className="grid size-8 place-items-center rounded-full bg-secondary">
              <BookOpen className="size-4" aria-hidden="true" />
            </span>
            Open in book
          </motion.button>
        </div>
      </div>
    </BottomSheet>
  );
}

function HighlightsMosaic({
  group,
  headingId,
  highlights,
  model,
  renderRange,
  entranceRange,
  entrancePhase,
  isMobile,
  readingTimeMs,
  tooltipHandle,
  onCopy,
  onOpenActions,
  onOpenBook,
  copiedHighlightId,
}: {
  group: BookHighlightGroup;
  headingId: string;
  highlights: Highlight[];
  model: HighlightsMosaicModel;
  renderRange: MosaicViewportRange;
  entranceRange: MosaicViewportRange;
  entrancePhase: TileEntrancePhase;
  isMobile: boolean;
  readingTimeMs: number;
  tooltipHandle: Tooltip.Handle<HighlightsTooltipPayload>;
  onCopy: (highlight: Highlight) => void;
  onOpenActions: (highlight: Highlight) => void;
  onOpenBook: (highlight: Highlight) => void;
  copiedHighlightId: string | null;
}) {
  const {
    compactCoverWidth,
    isSingleColumn,
    mosaic,
    presentationByHighlightId,
    titleFontSize,
  } = model;
  const placementById = useMemo(
    () =>
      new Map(mosaic.placements.map((placement) => [placement.id, placement])),
    [mosaic.placements],
  );
  const detailsPlacement = placementById.get(BOOK_DETAILS_TILE_ID);
  const coverPlacement = placementById.get(BOOK_COVER_TILE_ID);
  const fillerPlacements = useMemo(
    () =>
      mosaic.placements.filter(
        (placement) =>
          placement.kind === "filler" &&
          doesMosaicPlacementIntersectViewport(placement, renderRange),
      ),
    [mosaic.placements, renderRange],
  );
  const renderedHighlights = useMemo(
    () =>
      highlights.filter((highlight) => {
        const placement = placementById.get(highlight.id);
        return (
          placement !== undefined &&
          doesMosaicPlacementIntersectViewport(placement, renderRange)
        );
      }),
    [highlights, placementById, renderRange],
  );
  const chapterTitleByHighlightId = useMemo(() => {
    return new Map(
      renderedHighlights.map((highlight) => {
        const spineIndex = group.book.spine.findIndex(
          ({ idref }) => idref === highlight.spineItemId,
        );
        const chapterTitle =
          spineIndex >= 0
            ? getChapterTitleFromSpine(group.book, spineIndex)
            : "Chapter unavailable";
        return [highlight.id, chapterTitle] as const;
      }),
    );
  }, [group.book, renderedHighlights]);

  return (
    <div className="relative" style={{ height: mosaic.height || 520 }}>
      {fillerPlacements.map((placement) => (
        <PositionedTile
          key={placement.id}
          placement={placement}
          entranceKey={`${group.book.id}-${placement.id}`}
          animateEntrance={doesMosaicPlacementIntersectViewport(
            placement,
            entranceRange,
          )}
          entrancePhase={entrancePhase}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none h-full rounded-2xl border border-border/35 bg-secondary/20"
          />
        </PositionedTile>
      ))}

      {detailsPlacement &&
        doesMosaicPlacementIntersectViewport(detailsPlacement, renderRange) && (
          <PositionedTile
            placement={detailsPlacement}
            entranceKey={`${group.book.id}-${BOOK_DETAILS_TILE_ID}`}
            animateEntrance={doesMosaicPlacementIntersectViewport(
              detailsPlacement,
              entranceRange,
            )}
            entrancePhase={entrancePhase}
          >
            <BookDetailsTile
              group={group}
              headingId={headingId}
              visibleCount={highlights.length}
              titleFontSize={titleFontSize}
              compactCover={
                isSingleColumn ? (
                  <div
                    className="shrink-0"
                    style={{
                      width: compactCoverWidth,
                      height: compactCoverWidth * 1.5,
                    }}
                  >
                    <BookCoverTile
                      group={group}
                      readingTimeMs={readingTimeMs}
                      tooltipHandle={tooltipHandle}
                    />
                  </div>
                ) : undefined
              }
            />
          </PositionedTile>
        )}

      {coverPlacement &&
        doesMosaicPlacementIntersectViewport(coverPlacement, renderRange) && (
          <PositionedTile
            placement={coverPlacement}
            entranceKey={`${group.book.id}-${BOOK_COVER_TILE_ID}`}
            animateEntrance={doesMosaicPlacementIntersectViewport(
              coverPlacement,
              entranceRange,
            )}
            entrancePhase={entrancePhase}
          >
            <BookCoverTile
              group={group}
              readingTimeMs={readingTimeMs}
              tooltipHandle={tooltipHandle}
            />
          </PositionedTile>
        )}

      {renderedHighlights.map((highlight) => {
        const placement = placementById.get(highlight.id);
        if (!placement) return null;

        return (
          <PositionedTile
            key={highlight.id}
            placement={placement}
            entranceKey={highlight.id}
            animateEntrance={doesMosaicPlacementIntersectViewport(
              placement,
              entranceRange,
            )}
            entrancePhase={entrancePhase}
          >
            <HighlightQuoteCard
              highlight={highlight}
              presentation={
                presentationByHighlightId.get(highlight.id) ?? "quote"
              }
              isMobile={isMobile}
              chapterTitle={
                chapterTitleByHighlightId.get(highlight.id) ??
                "Chapter unavailable"
              }
              tooltipHandle={tooltipHandle}
              onCopy={onCopy}
              onOpenActions={onOpenActions}
              onOpenBook={onOpenBook}
              isCopied={copiedHighlightId === highlight.id}
            />
          </PositionedTile>
        );
      })}
    </div>
  );
}

const MemoizedHighlightsMosaic = memo(HighlightsMosaic);

function ColorFilters({
  selectedColors,
  onToggle,
}: {
  selectedColors: HighlightColor[];
  onToggle: (color: HighlightColor) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by highlight color"
      className="flex items-center gap-1 md:gap-1.5"
    >
      {HIGHLIGHT_COLORS.map(({ name }) => {
        const isSelected = selectedColors.includes(name);
        const allColorsSelected =
          selectedColors.length === ALL_HIGHLIGHT_COLORS.length;
        const actionLabel = allColorsSelected
          ? `Show only ${name} highlights`
          : isSelected && selectedColors.length === 1
            ? "Show all highlight colors"
            : `${isSelected ? "Hide" : "Show"} ${name} highlights`;

        return (
          <button
            key={name}
            type="button"
            onClick={() => onToggle(name)}
            aria-label={actionLabel}
            aria-pressed={isSelected}
            title={actionLabel}
            className={cn(
              "relative grid place-items-center size-8 rounded-full border-2 border-background bg-[var(--highlight-accent)] shadow-[0_0_0_1px_var(--muted-foreground)] transition-[transform,opacity,box-shadow,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94] md:size-6",
              !isSelected && "opacity-25 shadow-none",
            )}
            style={getHighlightAccentStyle(name)}
          >
            {isSelected && (
              <span className="grid size-4 place-items-center rounded-full bg-background text-foreground">
                <Check className="size-3" aria-hidden="true" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function HighlightsSearch({
  value,
  onChange,
  isCompact,
  selectedColors,
  onToggleColor,
}: {
  value: string;
  onChange: (value: string) => void;
  isCompact: boolean;
  selectedColors: HighlightColor[];
  onToggleColor: (color: HighlightColor) => void;
}) {
  const reducedMotion = useReducedMotion() ?? false;
  const clearSearch = () => onChange("");

  return (
    <motion.div
      className="relative mx-auto w-full max-w-2xl origin-top"
      initial={false}
      animate={{
        transform:
          isCompact && !reducedMotion
            ? "translate3d(0, 0, 0) scale(0.94)"
            : "translate3d(0, 0, 0) scale(1)",
      }}
      transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
    >
      <div className="relative">
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 z-10 size-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          type="search"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          id="highlight-search"
          placeholder="Search all highlights…"
          aria-label="Search all highlights"
          className={cn(
            "h-14 appearance-none bg-background/75 pl-10 text-base shadow-md backdrop-blur-xl [@media(prefers-reduced-transparency:reduce)]:bg-background [@media(prefers-reduced-transparency:reduce)]:backdrop-blur-none dark:bg-background/80 md:text-base [&::-webkit-search-cancel-button]:hidden",
            value ? "pr-48" : "pr-40",
          )}
        />
        <div className="absolute top-1/2 right-3 flex -translate-y-1/2 items-center gap-1 md:right-4 md:gap-2.5">
          {value && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear highlight search"
              title="Clear search"
              className="grid size-8 place-items-center rounded-full text-muted-foreground outline-none transition-[color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.94] md:size-7"
            >
              <X className="size-4 md:size-3.5" aria-hidden="true" />
            </button>
          )}
          <ColorFilters
            selectedColors={selectedColors}
            onToggle={onToggleColor}
          />
        </div>
      </div>
    </motion.div>
  );
}

export function HighlightsMasonry() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const tooltipHandle = useMemo(
    () => Tooltip.createHandle<HighlightsTooltipPayload>(),
    [],
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(
      () => setSearchQuery(searchInput),
      SEARCH_DEBOUNCE_MS,
    );
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  const [selectedHighlight, setSelectedHighlight] = useState<Highlight | null>(
    null,
  );
  const [copiedHighlightId, setCopiedHighlightId] = useState<string | null>(
    null,
  );
  const copiedHighlightTimerRef = useRef(0);
  const [isMobileBookIndexOpen, setIsMobileBookIndexOpen] = useState(false);
  const [isBookIndexPinned, setIsBookIndexPinned] = useState(
    () => getRuntimeStorage().getItem(BOOK_INDEX_PIN_STORAGE_KEY) !== "false",
  );
  const [selectedColors, setSelectedColors] = useState<HighlightColor[]>(() => [
    ...ALL_HIGHLIGHT_COLORS,
  ]);
  const { scrollYProgress } = useScroll();
  const { anchorRef: searchAnchorRef, isCompact: isSearchCompact } =
    useSearchStickyState();
  const { displayedProgress, animateAfterInstantNavigation } =
    useBookNavigationProgress(scrollYProgress);
  const { data: groups = [], isLoading } = useAllHighlightsQuery();
  const { data: readingSessionsData } = useReadingSessionsQuery();
  const readingTimeByBookId = useMemo(() => {
    const totals = new Map<string, number>();
    if (!readingSessionsData) return totals;

    const now = Date.now();
    for (const session of readingSessionsData.sessions) {
      if (session.activeMs <= 0 || session.startedAt > now) continue;
      totals.set(
        session.bookId,
        (totals.get(session.bookId) ?? 0) + session.activeMs,
      );
    }

    return totals;
  }, [readingSessionsData]);
  const visibleGroups = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase();
    return groups.flatMap((group) => {
      const bookMatches =
        normalizedQuery.length > 0 &&
        (group.book.title.toLowerCase().includes(normalizedQuery) ||
          group.book.author.toLowerCase().includes(normalizedQuery));
      const highlights = group.highlights.filter((highlight) => {
        const matchesColor =
          highlight.color === "invisible"
            ? selectedColors.length === ALL_HIGHLIGHT_COLORS.length
            : selectedColors.includes(highlight.color);
        const matchesQuery =
          normalizedQuery.length === 0 ||
          bookMatches ||
          highlight.selectedText.toLowerCase().includes(normalizedQuery);
        return matchesColor && matchesQuery;
      });

      return highlights.length > 0 ? [{ group, highlights }] : [];
    });
  }, [groups, searchQuery, selectedColors]);
  const visibleHighlights = useMemo(
    () => visibleGroups.flatMap(({ highlights }) => highlights),
    [visibleGroups],
  );
  const {
    element: mosaicsElement,
    elementRef: mosaicsElementRef,
    width: mosaicsWidth,
  } = useElementWidth();
  const { fontReady, preparedById } = usePreparedHighlights(visibleHighlights);
  const mosaicModelsByBookId = useMemo(() => {
    return new Map(
      visibleGroups.map(({ group, highlights }) => [
        group.book.id,
        createHighlightsMosaicModel({
          group,
          highlights,
          width: mosaicsWidth,
          fontReady,
          preparedById,
        }),
      ]),
    );
  }, [fontReady, mosaicsWidth, preparedById, visibleGroups]);
  const [mosaicsScrollMargin, setMosaicsScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const element = mosaicsElement;
    if (!element) return;
    setMosaicsScrollMargin(element.offsetTop);
  }, [mosaicsElement, mosaicsWidth]);
  const estimateMosaicSectionSize = useCallback(
    (index: number) => {
      const entry = visibleGroups[index];
      if (!entry) return 520;

      const model = mosaicModelsByBookId.get(entry.group.book.id);
      const contentHeight = model?.mosaic.height || 520;
      if (index !== visibleGroups.length - 1) return contentHeight;

      const lastSectionMinimumHeight = Math.max(
        0,
        window.innerHeight - (isMobile ? 80 : 112),
      );
      return Math.max(contentHeight, lastSectionMinimumHeight);
    },
    [isMobile, mosaicModelsByBookId, visibleGroups],
  );
  const getMosaicSectionKey = useCallback(
    (index: number) => visibleGroups[index]?.group.book.id ?? index,
    [visibleGroups],
  );
  const mosaicVirtualizer = useWindowVirtualizer({
    count: visibleGroups.length,
    estimateSize: estimateMosaicSectionSize,
    getItemKey: getMosaicSectionKey,
    gap: MOSAIC_GAP,
    overscan: 1,
    scrollPaddingStart: isMobile ? 80 : 112,
    scrollMargin: mosaicsScrollMargin,
  });
  const virtualMosaicSections = mosaicVirtualizer.getVirtualItems();
  const isMosaicLayoutReady =
    fontReady &&
    mosaicsWidth > 0 &&
    visibleGroups.every(({ group }) => {
      const model = mosaicModelsByBookId.get(group.book.id);
      return model !== undefined && model.mosaic.height > 0;
    });
  const mosaicSectionSizesKey = isMosaicLayoutReady
    ? visibleGroups
        .map(
          ({ group }, index) =>
            `${group.book.id}:${estimateMosaicSectionSize(index)}`,
        )
        .join("|")
    : "";
  const measuredMosaicSizesKeyRef = useRef("");
  useLayoutEffect(() => {
    if (
      !mosaicSectionSizesKey ||
      measuredMosaicSizesKeyRef.current === mosaicSectionSizesKey
    ) {
      return;
    }

    // The virtualizer first mounts with fallback heights while fonts and text
    // geometry load. Reset its cache once for each set of exact section sizes.
    measuredMosaicSizesKeyRef.current = mosaicSectionSizesKey;
    mosaicVirtualizer.measure();
  }, [mosaicSectionSizesKey, mosaicVirtualizer]);
  const {
    initialScrollOffset: initialEntranceScrollOffset,
    phase: entrancePhase,
  } = useInitialTileEntrance(
    isMosaicLayoutReady,
    mosaicVirtualizer.scrollOffset ?? window.scrollY,
  );
  const visibleBookIds = useMemo(
    () => visibleGroups.map(({ group }) => group.book.id),
    [visibleGroups],
  );
  const bookIndexGroups = useMemo(
    () =>
      visibleGroups.map(({ group, highlights }) => ({
        ...group,
        highlights,
      })),
    [visibleGroups],
  );
  const activeOffset = isMobile ? MOBILE_BOOK_ACTIVE_OFFSET_PX : 96;
  const activeBookIndex = virtualMosaicSections.reduce((current, item) => {
    const scrollOffset = mosaicVirtualizer.scrollOffset ?? 0;
    return item.start <= scrollOffset + activeOffset ? item.index : current;
  }, virtualMosaicSections[0]?.index ?? 0);
  const activeBookId =
    visibleBookIds[activeBookIndex] ?? visibleBookIds[0] ?? "";
  const totalHighlightCount = useMemo(
    () => groups.reduce((total, group) => total + group.highlights.length, 0),
    [groups],
  );
  const hasNoMatches =
    !isLoading && groups.length > 0 && visibleGroups.length === 0;

  useEffect(() => {
    getRuntimeStorage().setItem(
      BOOK_INDEX_PIN_STORAGE_KEY,
      isBookIndexPinned ? "true" : "false",
    );
  }, [isBookIndexPinned]);

  useEffect(() => {
    if (!isMobile) setSelectedHighlight(null);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile) setIsMobileBookIndexOpen(false);
  }, [isMobile]);

  useEffect(() => {
    return () => window.clearTimeout(copiedHighlightTimerRef.current);
  }, []);

  const handleToggleColor = (color: HighlightColor) => {
    setSelectedColors((current) =>
      toggleHighlightColorSelection(current, color),
    );
  };

  const handleBookNavigate = useCallback(
    (bookId: string) => {
      const bookIndex = visibleBookIds.indexOf(bookId);
      if (bookIndex < 0) return;

      mosaicVirtualizer.scrollToIndex(bookIndex, {
        align: "start",
        behavior: "auto",
      });
      animateAfterInstantNavigation();
    },
    [animateAfterInstantNavigation, mosaicVirtualizer, visibleBookIds],
  );

  const copyHighlight = useCallback(async (highlight: Highlight) => {
    try {
      await navigator.clipboard.writeText(highlight.selectedText);
      return true;
    } catch {
      toast.error("Could not copy highlight.", {
        id: "highlight-copy-error",
      });
      return false;
    }
  }, []);

  const handleDesktopCopy = useCallback(
    (highlight: Highlight) => {
      void copyHighlight(highlight).then((didCopy) => {
        if (!didCopy) return;

        setCopiedHighlightId(highlight.id);
        window.clearTimeout(copiedHighlightTimerRef.current);
        copiedHighlightTimerRef.current = window.setTimeout(
          () => setCopiedHighlightId(null),
          1500,
        );
      });
    },
    [copyHighlight],
  );

  const handleMobileCopy = useCallback(
    (highlight: Highlight) => copyHighlight(highlight),
    [copyHighlight],
  );

  const handleOpenBook = useCallback(
    (highlight: Highlight) => {
      setSelectedHighlight(null);
      beginReaderTrace({
        bookId: highlight.bookId,
        bookTitle: groups.find((group) => group.book.id === highlight.bookId)
          ?.book.title,
        source: "highlight",
      });
      navigate(`/reader/${highlight.bookId}`, {
        state: {
          scrollToHighlight: {
            spineItemId: highlight.spineItemId,
            highlightId: highlight.id,
          },
        },
      });
    },
    [groups, navigate],
  );

  return (
    <Tooltip.Provider delay={380} closeDelay={80} timeout={480}>
      <div
        className={cn(
          "flex min-h-svh flex-col bg-background text-foreground",
          hasNoMatches && "h-svh overflow-hidden",
        )}
      >
        <h1 className="sr-only">Highlights</h1>
        <AppHeader current="highlights" />
        <p
          className={cn(
            APP_PAGE_FRAME,
            "mt-3 pb-5 text-[13px] text-muted-foreground md:pb-7",
            (isLoading || groups.length === 0) && "invisible",
          )}
        >
          {totalHighlightCount}{" "}
          {totalHighlightCount === 1 ? "highlight" : "highlights"} across{" "}
          {groups.length} {groups.length === 1 ? "book" : "books"}
        </p>

        <div
          ref={searchAnchorRef}
          className="h-px shrink-0"
          aria-hidden="true"
        />
        <div className="sticky top-0 z-30 isolate w-full pt-3">
          <div className="mx-auto w-full max-w-2xl px-4">
            <HighlightsSearch
              value={searchInput}
              onChange={setSearchInput}
              isCompact={isSearchCompact}
              selectedColors={selectedColors}
              onToggleColor={handleToggleColor}
            />
          </div>
        </div>
        <div className="mx-auto min-h-0 w-full max-w-[1600px] flex-1 px-4 pt-4 pb-4 md:px-6 md:pb-6 xl:px-8">
          {isLoading ? (
            <div
              role="status"
              className="flex min-h-80 items-center justify-center text-sm text-muted-foreground"
            >
              Loading highlights…
            </div>
          ) : groups.length === 0 ? (
            <div className="flex min-h-80 flex-col items-center justify-center text-center">
              <div className="mb-5 rounded-full bg-secondary p-5">
                <Highlighter
                  className="size-9 text-muted-foreground"
                  aria-hidden="true"
                />
              </div>
              <h2 className="text-balance font-serif text-3xl font-medium">
                No highlights yet
              </h2>
              <p className="mt-2 text-pretty text-sm text-muted-foreground">
                Select text in a book to save your first highlight here.
              </p>
              <Button className="mt-4" render={<Link to="/" />}>
                Open library
              </Button>
            </div>
          ) : (
            <div
              className={cn(
                "grid lg:items-start",
                hasNoMatches && "h-full",
                isBookIndexPinned &&
                  visibleGroups.length > 0 &&
                  "gap-8 lg:grid-cols-[minmax(0,1fr)_248px] xl:gap-10",
              )}
            >
              <div
                ref={mosaicsElementRef}
                className={cn("relative min-w-0", hasNoMatches && "h-full")}
                style={
                  hasNoMatches
                    ? undefined
                    : { height: mosaicVirtualizer.getTotalSize() }
                }
              >
                {visibleGroups.length > 0 ? (
                  virtualMosaicSections.map((virtualSection) => {
                    const entry = visibleGroups[virtualSection.index];
                    if (!entry) return null;
                    const { group, highlights } = entry;
                    const sectionId = getBookSectionId(group.book.id);
                    const headingId = getBookHeadingId(group.book.id);
                    const model = mosaicModelsByBookId.get(group.book.id);
                    if (!model) return null;
                    const localViewportTop =
                      (mosaicVirtualizer.scrollOffset ?? 0) -
                      virtualSection.start;
                    const tileOverscan =
                      window.innerHeight * TILE_OVERSCAN_VIEWPORTS;
                    const renderRange: MosaicViewportRange = {
                      top: Math.max(0, localViewportTop - tileOverscan),
                      bottom:
                        localViewportTop + window.innerHeight + tileOverscan,
                    };
                    const initialLocalViewportTop =
                      initialEntranceScrollOffset === null
                        ? Number.POSITIVE_INFINITY
                        : initialEntranceScrollOffset - virtualSection.start;
                    const entranceRange: MosaicViewportRange = {
                      top: Math.max(0, initialLocalViewportTop),
                      bottom: initialLocalViewportTop + window.innerHeight,
                    };

                    return (
                      <section
                        key={group.book.id}
                        id={sectionId}
                        aria-labelledby={headingId}
                        className="absolute top-0 left-0 w-full scroll-mt-20 lg:scroll-mt-28"
                        style={{
                          height: virtualSection.size,
                          transform: `translate3d(0, ${virtualSection.start - mosaicsScrollMargin}px, 0)`,
                        }}
                      >
                        <MemoizedHighlightsMosaic
                          group={group}
                          headingId={headingId}
                          highlights={highlights}
                          model={model}
                          renderRange={renderRange}
                          entranceRange={entranceRange}
                          entrancePhase={entrancePhase}
                          isMobile={isMobile}
                          readingTimeMs={
                            readingTimeByBookId.get(group.book.id) ?? 0
                          }
                          tooltipHandle={tooltipHandle}
                          onCopy={handleDesktopCopy}
                          onOpenActions={setSelectedHighlight}
                          onOpenBook={handleOpenBook}
                          copiedHighlightId={copiedHighlightId}
                        />
                      </section>
                    );
                  })
                ) : (
                  <div
                    role="status"
                    className="flex min-h-80 w-full flex-col items-center justify-center rounded-2xl border border-dashed text-center"
                  >
                    <Search
                      className="mb-4 size-7 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <h2 className="font-serif text-2xl font-medium">
                      No matching highlights
                    </h2>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Change the search text or color filters.
                    </p>
                    <Button
                      className="mt-4"
                      variant="outline"
                      onClick={() => {
                        setSearchInput("");
                        setSearchQuery("");
                        setSelectedColors([...ALL_HIGHLIGHT_COLORS]);
                        document.getElementById("highlight-search")?.focus();
                      }}
                    >
                      Clear filters
                    </Button>
                  </div>
                )}
              </div>
              {visibleGroups.length > 0 && isBookIndexPinned && (
                <BookIndexPanel
                  groups={bookIndexGroups}
                  activeBookId={activeBookId}
                  isPinned
                  onNavigate={handleBookNavigate}
                  onPinChange={setIsBookIndexPinned}
                  className="sticky top-[calc((100svh-min(64svh,560px))/2)] hidden h-[min(64svh,560px)] self-start lg:flex"
                />
              )}
            </div>
          )}
        </div>
        {isMobile && bookIndexGroups.length > 0 && (
          <MobileBookIndex
            groups={bookIndexGroups}
            activeBookId={activeBookId}
            isOpen={isMobileBookIndexOpen}
            onNavigate={handleBookNavigate}
            onOpenChange={setIsMobileBookIndexOpen}
          />
        )}
        {!isLoading && !isBookIndexPinned && bookIndexGroups.length > 0 && (
          <FloatingBookIndex
            groups={bookIndexGroups}
            activeBookId={activeBookId}
            onNavigate={handleBookNavigate}
            onPin={() => setIsBookIndexPinned(true)}
            scrollProgress={displayedProgress}
          />
        )}
        {isMobile && (
          <HighlightActionsSheet
            highlight={selectedHighlight}
            onClose={() => setSelectedHighlight(null)}
            onCopy={handleMobileCopy}
            onOpenBook={handleOpenBook}
          />
        )}
      </div>
      <SharedHighlightsTooltip handle={tooltipHandle} />
    </Tooltip.Provider>
  );
}
