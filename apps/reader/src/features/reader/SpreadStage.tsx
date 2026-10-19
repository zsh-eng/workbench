import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import {
  AnimatePresence,
  motion,
  MotionConfig,
  useTransform,
} from "motion/react";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type RefObject,
} from "react";
import {
  AnimatedSpread,
  SpreadView,
  type NavDirection,
} from "./AnimatedSpread";
import { useSpreadSwipeNavigation } from "./hooks/use-spread-swipe-navigation";
import { getSpreadContentKey } from "./spread-identity";

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
}: SpreadStageProps) {
  const direction = toNavDirection(spread?.intent);
  const internalStageRef = useRef<HTMLDivElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const setStageRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalStageRef.current = node;
      if (stageContentRef) stageContentRef.current = node;
    },
    [stageContentRef],
  );

  const { dragOffset, isInteractionActive } = useSpreadSwipeNavigation({
    containerRef: internalStageRef,
    enabled: swipeEnabled,
    currentSpreadId: spread?.currentSpread ?? null,
    previousSpreadId: previousSpread?.currentSpread ?? null,
    nextSpreadId: nextSpread?.currentSpread ?? null,
    onPrevious: onSwipePrevious,
    onNext: onSwipeNext,
    onSwipeStart,
    disableMotion: disableAnimations,
  });

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

  return (
    <MotionConfig reducedMotion="user">
      {/* position:relative + overflow:hidden clips pages as they slide in/out */}
      <div
        ref={setStageRef}
        onClick={handlePageContentClick}
        className="relative h-full w-full overflow-hidden"
        style={{ touchAction: swipeEnabled ? "pan-y pinch-zoom" : "auto" }}
      >
        {renderAdjacentSpreads && stageWidth > 0 && previousSpread && (
          <motion.div
            data-reader-spread-layer="previous"
            aria-hidden="true"
            inert
            className="pointer-events-none absolute inset-0 z-0 h-full w-full select-none overflow-hidden bg-background"
            style={{
              transform: previousTransform,
              willChange: isInteractionActive ? "transform" : "auto",
            }}
          >
            <SpreadView spread={previousSpread} {...spreadViewProps} />
          </motion.div>
        )}

        <motion.div
          data-reader-spread-layer="current"
          className="absolute inset-0 z-[1] h-full w-full"
          style={{
            transform: currentTransform,
            willChange: isInteractionActive ? "transform" : "auto",
          }}
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
            data-reader-spread-layer="next"
            aria-hidden="true"
            inert
            className="pointer-events-none absolute inset-0 z-[2] h-full w-full select-none overflow-hidden bg-background"
            style={{
              transform: nextTransform,
              willChange: isInteractionActive ? "transform" : "auto",
            }}
          >
            <SpreadView spread={nextSpread} {...spreadViewProps} />
          </motion.div>
        )}
      </div>
    </MotionConfig>
  );
}
