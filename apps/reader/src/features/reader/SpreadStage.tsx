import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useReducedMotion,
  useTransform,
} from "motion/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type RefObject,
} from "react";
import {
  AnimatedSpread,
  SpreadView,
  type NavDirection,
} from "./AnimatedSpread";
import { useLeafTurn, type LeafView } from "./hooks/use-leaf-turn";
import {
  CURL_SETTLE_SPRING,
  SWIPE_SETTLE_SPRING,
  useSpreadSwipeNavigation,
  type SwipeDirection,
} from "./hooks/use-spread-swipe-navigation";
import { paperGrainStyle, type PaperGrain } from "./paper/paper-grain";
import type { PageTurnStyle, PaperInk } from "./paper/paper-preference";
import { useLeafCurl } from "./paper/use-leaf-curl";
import { isPageCurlSupported, usePageCurl } from "./paper/use-page-curl";
import { usePageFeel } from "./paper/use-page-feel";
import { getSpreadContentKey } from "./spread-identity";

/** Turns the page from rest, as a swipe would; false if it cannot. */
export type PageTurner = (direction: SwipeDirection, holdY?: number) => boolean;

interface SpreadStageProps {
  spread: ResolvedSpread | null;
  previousSpread?: ResolvedSpread | null;
  nextSpread?: ResolvedSpread | null;
  spreadConfig: SpreadConfig;
  columnSpacingPx: number;
  paginationConfig: PaginationConfig;
  stageContentRef?: RefObject<HTMLDivElement | null>;
  onLinkActivate?: (href: string) => boolean;
  showDebugOutlines?: boolean;
  disableAnimations?: boolean;
  renderAdjacentSpreads?: boolean;
  swipeEnabled?: boolean;
  onSwipeStart?: () => void;
  onSwipeNext?: () => void;
  onSwipePrevious?: () => void;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
  /**
   * How a swipe moves the page (Debug): slide, the leaf you can hold
   * (`curl`), or the first curl (`curl-v1`).
   */
  pageTurn?: PageTurnStyle;
  paper?: PaperGrain;
  /** Where the ink sits in the grain (Debug); see paper/paper-preference. */
  ink?: PaperInk;
  showThrough?: boolean;
  haptics?: boolean;
  sound?: boolean;
  /** Set while the curl turns pages, so taps can turn with it. */
  turnRef?: RefObject<PageTurner | null>;
}

function toNavDirection(
  intent: ResolvedSpread["intent"] | undefined,
): NavDirection {
  if (intent?.kind === "linear" && intent.direction === "forward") {
    return "forward";
  }
  if (intent?.kind === "linear" && intent.direction === "backward") {
    return "backward";
  }
  return "instant";
}

export function SpreadStage({
  spread,
  previousSpread = null,
  nextSpread = null,
  spreadConfig,
  columnSpacingPx,
  paginationConfig,
  stageContentRef,
  onLinkActivate,
  showDebugOutlines = false,
  disableAnimations = false,
  renderAdjacentSpreads = false,
  swipeEnabled = false,
  onSwipeStart,
  onSwipeNext = () => {},
  onSwipePrevious = () => {},
  paddingTopPx,
  paddingBottomPx,
  paddingLeftPx,
  paddingRightPx,
  pageTurn = "slide",
  paper = "off",
  ink = "on",
  showThrough = true,
  haptics = false,
  sound = false,
  turnRef,
}: SpreadStageProps) {
  const direction = toNavDirection(spread?.intent);
  const internalStageRef = useRef<HTMLDivElement>(null);
  const curlCanvasRef = useRef<HTMLCanvasElement>(null);
  const previousLayerRef = useRef<HTMLDivElement>(null);
  const currentLayerRef = useRef<HTMLDivElement>(null);
  const nextLayerRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const prefersReducedMotion = useReducedMotion();
  const setStageRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalStageRef.current = node;
      if (stageContentRef) stageContentRef.current = node;
    },
    [stageContentRef],
  );

  // A curl replaces the slide only where it can run as designed: a touch
  // screen, one page at a time, motion allowed and WebGL present.
  const curlAllowed =
    renderAdjacentSpreads &&
    spreadConfig.columns === 1 &&
    !disableAnimations &&
    !prefersReducedMotion &&
    isPageCurlSupported();
  const leaf = pageTurn === "curl" && curlAllowed;
  const curl = pageTurn === "curl-v1" && curlAllowed;
  const curled = leaf || curl;

  const feel = usePageFeel({
    haptics: curled && haptics,
    sound: curled && sound,
  });

  const swipe = useSpreadSwipeNavigation({
    containerRef: internalStageRef,
    enabled: swipeEnabled && !leaf,
    currentSpreadId: spread?.currentSpread ?? null,
    previousSpreadId: previousSpread?.currentSpread ?? null,
    nextSpreadId: nextSpread?.currentSpread ?? null,
    onPrevious: onSwipePrevious,
    onNext: onSwipeNext,
    onSwipeStart: () => {
      feel.start();
      onSwipeStart?.();
    },
    onRelease: feel.release,
    onSettled: feel.settled,
    disableMotion: disableAnimations,
    settleSpring: curl ? CURL_SETTLE_SPRING : SWIPE_SETTLE_SPRING,
  });
  const { dragOffset, dragY, grabY } = swipe;

  const leafPresenter = useRef<(view: LeafView | null) => void>(() => {});
  const leafTurn = useLeafTurn({
    containerRef: internalStageRef,
    enabled: swipeEnabled && leaf,
    currentSpreadId: spread?.currentSpread ?? null,
    previousSpreadId: previousSpread?.currentSpread ?? null,
    nextSpreadId: nextSpread?.currentSpread ?? null,
    onPrevious: onSwipePrevious,
    onNext: onSwipeNext,
    onSwipeStart: () => {
      feel.start();
      onSwipeStart?.();
    },
    onRelease: (turns, speed) => feel.release(turns ? 1 : 0, speed),
    onMove: feel.drag,
    onSettled: feel.settled,
    present: (view) => leafPresenter.current(view),
  });

  const { phase, isInteractionActive, turn } = leaf ? leafTurn : swipe;

  if (turnRef) turnRef.current = curled && swipeEnabled ? turn : null;

  const keys = {
    previous: previousSpread ? getSpreadContentKey(previousSpread) : null,
    current: spread ? getSpreadContentKey(spread) : null,
    next: nextSpread ? getSpreadContentKey(nextSpread) : null,
  };
  const layers = {
    previous: previousLayerRef,
    current: currentLayerRef,
    next: nextLayerRef,
  };

  usePageCurl({
    enabled: curl,
    stageRef: internalStageRef,
    canvasRef: curlCanvasRef,
    layers,
    dragOffset,
    dragY,
    grabY,
    keys,
    idle: phase === "idle",
    grain: paper,
    showThrough,
  });

  useLeafCurl({
    enabled: leaf,
    stageRef: internalStageRef,
    canvasRef: curlCanvasRef,
    layers,
    keys,
    idle: phase === "idle",
    grain: paper,
    showThrough,
    presenterRef: leafPresenter,
  });

  useLayoutEffect(() => {
    if (!curl) return;
    return dragOffset.on("change", feel.drag);
  }, [curl, dragOffset, feel.drag]);

  useLayoutEffect(() => {
    const stage = internalStageRef.current;
    if (!stage) return;

    const updateWidth = () =>
      setStageWidth(stage.getBoundingClientRect().width);
    updateWidth();

    const observer = new ResizeObserver(updateWidth);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  const currentTransform = useTransform(dragOffset, (offset) => {
    const translatedOffset = offset < 0 && nextSpread ? offset / 3 : offset;
    return `translate3d(${translatedOffset}px, 0, 0)`;
  });
  const previousTransform = useTransform(
    dragOffset,
    (offset) =>
      `translate3d(${-stageWidth / 3 + Math.max(0, offset) / 3}px, 0, 0)`,
  );
  const nextTransform = useTransform(
    dragOffset,
    (offset) => `translate3d(${stageWidth + Math.min(0, offset)}px, 0, 0)`,
  );

  const spreadViewProps = {
    spreadConfig,
    columnSpacingPx,
    paginationConfig,
    showDebugOutlines,
    paddingTopPx,
    paddingBottomPx,
    paddingLeftPx,
    paddingRightPx,
    paper,
    ink,
  };

  const handlePageContentClick: MouseEventHandler<HTMLDivElement> = (event) => {
    if (!onLinkActivate) return;

    const target = event.target as HTMLElement | null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor) return;

    const href = anchor.getAttribute("href")?.trim();
    if (!href) return;

    const handled = onLinkActivate(href);
    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
  };

  // In a curl the pages do not move: the adjacent pages wait under the
  // current one and the curl decides what shows (see usePageCurl and
  // useLeafCurl).
  const willChange = isInteractionActive ? "transform" : "auto";
  const layerStyle = (transform: typeof currentTransform) =>
    curled ? { transform: "none", willChange } : { transform, willChange };

  return (
    <MotionConfig reducedMotion="user">
      {/* position:relative + overflow:hidden clips pages as they slide in/out */}
      <div
        ref={setStageRef}
        onClick={handlePageContentClick}
        data-page-turn={leaf ? "curl" : curl ? "curl-v1" : "slide"}
        data-paper={paper}
        data-ink={paper === "off" ? undefined : ink}
        className="relative h-full w-full overflow-hidden"
        style={
          {
            touchAction: swipeEnabled ? "pan-y pinch-zoom" : "auto",
            ...paperGrainStyle(paper),
          } as CSSProperties
        }
      >
        {renderAdjacentSpreads && stageWidth > 0 && previousSpread && (
          <motion.div
            ref={previousLayerRef}
            data-reader-spread-layer="previous"
            aria-hidden="true"
            inert
            className="pointer-events-none absolute inset-0 z-0 h-full w-full select-none overflow-hidden bg-background"
            style={layerStyle(previousTransform)}
          >
            <SpreadView spread={previousSpread} {...spreadViewProps} />
          </motion.div>
        )}

        <motion.div
          ref={currentLayerRef}
          data-reader-spread-layer="current"
          className="absolute inset-0 z-[1] h-full w-full"
          style={layerStyle(currentTransform)}
        >
          <AnimatePresence custom={direction} initial={false} mode="sync">
            {/* Keyed by what the spread shows, so renumbering it as earlier
                chapters are laid out keeps its DOM and any selection. */}
            {spread && (
              <AnimatedSpread
                key={getSpreadContentKey(spread)}
                spread={spread}
                {...spreadViewProps}
                disableAnimations={disableAnimations || isInteractionActive}
              />
            )}
          </AnimatePresence>
        </motion.div>

        {renderAdjacentSpreads && stageWidth > 0 && nextSpread && (
          <motion.div
            ref={nextLayerRef}
            data-reader-spread-layer="next"
            aria-hidden="true"
            inert
            className={
              curled
                ? "pointer-events-none absolute inset-0 z-0 h-full w-full select-none overflow-hidden bg-background"
                : "pointer-events-none absolute inset-0 z-[2] h-full w-full select-none overflow-hidden bg-background"
            }
            style={layerStyle(nextTransform)}
          >
            <SpreadView spread={nextSpread} {...spreadViewProps} />
          </motion.div>
        )}

        {curled && (
          // One canvas per kind of curl: each owns its WebGL context.
          <canvas
            key={leaf ? "leaf" : "curl"}
            ref={curlCanvasRef}
            data-reader-page-curl
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-[3] h-full w-full"
            style={{ visibility: "hidden" }}
          />
        )}
      </div>
    </MotionConfig>
  );
}
