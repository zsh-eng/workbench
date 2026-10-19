import type { PaginationConfig } from "@/lib/pagination-v2";
import type { ResolvedSpread, SpreadConfig } from "@/lib/pagination-v2/types";
import { motion, useIsPresent, usePresenceData } from "motion/react";
import { useState } from "react";
import { PageSliceView } from "./PageSliceView";
import { getPageContentKey } from "./spread-identity";

export type NavDirection = "forward" | "backward" | "instant";

export interface SpreadViewProps {
  spread: ResolvedSpread;
  spreadConfig: SpreadConfig;
  columnSpacingPx: number;
  paginationConfig: PaginationConfig;
  showDebugOutlines?: boolean;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
}

interface AnimatedSpreadProps extends SpreadViewProps {
  disableAnimations?: boolean;
}

const EASE_OUT_QUAD = [0.25, 0.46, 0.45, 0.94] as [
  number,
  number,
  number,
  number,
];

/** Padding added around the text area so text doesn't sit at the edge of the page. */
export const PAGE_PADDING_X = 32;
export const PAGE_PADDING_Y = 48;

export function SpreadView({
  spread,
  spreadConfig,
  columnSpacingPx,
  paginationConfig,
  showDebugOutlines = false,
  paddingTopPx,
  paddingBottomPx,
  paddingLeftPx,
  paddingRightPx,
}: SpreadViewProps) {
  return (
    <div
      className="h-full w-full overflow-hidden"
      style={{
        paddingTop: `${paddingTopPx}px`,
        paddingBottom: `${paddingBottomPx}px`,
        paddingLeft: `${paddingLeftPx}px`,
        paddingRight: `${paddingRightPx}px`,
      }}
    >
      {/* Pages clip only vertically. Glyph ink can extend past the text
          column, such as a line-initial "j" or a line-final italic "f", and
          the page margin must show it. The spread still clips at the stage
          edge above. */}
      <div
        className="grid h-full w-full overflow-x-visible overflow-y-clip"
        style={{
          gridTemplateColumns: `repeat(${spreadConfig.columns}, minmax(0, 1fr))`,
          columnGap: `${columnSpacingPx}px`,
        }}
      >
        {spread.slots.map((slot) => {
          if (slot.kind === "gap") {
            return (
              <div
                key={`gap-${slot.slotIndex}`}
                className={
                  showDebugOutlines
                    ? "h-full w-full bg-transparent reader-container-outline"
                    : "h-full w-full bg-transparent"
                }
              />
            );
          }

          return (
            <div
              key={`page-${slot.slotIndex}-${getPageContentKey(slot.page)}`}
              data-reader-page-slot={slot.slotIndex}
              data-reader-current-page={slot.page.currentPage}
              data-reader-chapter-index={slot.page.chapterIndex}
              className={
                showDebugOutlines
                  ? "relative h-full w-full overflow-x-visible overflow-y-clip reader-container-outline"
                  : "relative h-full w-full overflow-x-visible overflow-y-clip"
              }
            >
              <div
                className="pointer-events-none absolute inset-0"
                aria-hidden="true"
              />
              <div
                className="relative z-10 h-full w-full overflow-x-visible overflow-y-clip"
                data-reader-page-content
              >
                {slot.page.content.map((slice, i) => (
                  <PageSliceView
                    key={`${slice.blockId}-${slot.slotIndex}-${i}`}
                    slice={slice}
                    sliceIndex={i}
                    baseFontSize={paginationConfig.fontConfig.baseSizePx}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const pageVariants = {
  initial: (dir: NavDirection) => ({
    x: dir === "forward" ? "100%" : dir === "backward" ? "-33%" : 0,
  }),
  animate: {
    x: 0,
    transition: { type: "tween" as const, ease: EASE_OUT_QUAD, duration: 0.35 },
  },
  exit: (dir: NavDirection) => ({
    x: dir === "forward" ? "-33%" : dir === "backward" ? "100%" : 0,
    transition: {
      type: "tween" as const,
      ease: EASE_OUT_QUAD,
      // Parallax drift is slower to sell the depth illusion
      duration: dir === "forward" ? 0.45 : 0.35,
    },
  }),
};

export function AnimatedSpread({
  spread,
  spreadConfig,
  columnSpacingPx,
  paginationConfig,
  showDebugOutlines = false,
  disableAnimations = false,
  paddingTopPx,
  paddingBottomPx,
  paddingLeftPx,
  paddingRightPx,
}: AnimatedSpreadProps) {
  const rawDirection =
    (usePresenceData() as NavDirection | undefined) ?? "instant";
  const isPresent = useIsPresent();

  // Freeze the direction the moment a component starts exiting so that rapid
  // navigation (which changes AnimatePresence's `custom` prop) cannot redirect
  // a mid-flight exit animation or flip its z-index.
  //
  // Why this is needed: PresenceChild's useMemo depends on `onExitComplete`,
  // which AnimatePresence recreates on every render. This means usePresenceData()
  // is effectively live — all components (including ones already exiting) see the
  // latest `custom` value after any parent re-render. Without freezing, pressing
  // prev while page 1 is still exiting forward causes it to redirect rightward
  // and pop to z=1, appearing incorrectly on top of the incoming page.
  const [presenceSnapshot, setPresenceSnapshot] = useState(() => ({
    direction: rawDirection,
    isPresent,
  }));
  let direction = presenceSnapshot.direction;

  if (isPresent) {
    direction = rawDirection;
    if (
      !presenceSnapshot.isPresent ||
      presenceSnapshot.direction !== rawDirection
    ) {
      setPresenceSnapshot({ direction: rawDirection, isPresent });
    }
  } else if (presenceSnapshot.isPresent) {
    direction = rawDirection;
    setPresenceSnapshot({ direction: rawDirection, isPresent });
  }

  // While the swipe stage owns movement, AnimatePresence can retain the old
  // spread for one commit even though its exit animation is disabled. Keep that
  // retained spread below the new current spread so it cannot flash over the
  // adjacent page that the swipe already revealed.
  //
  // Tap-navigation z-index rules:
  //   backward exit  → 1 (slides away on top, revealing the incoming page beneath)
  //   forward enter  → 2 (slides in on top; must beat any stale backward-exit at 1)
  //   everything else → 0
  // The forward-enter value is intentionally higher than backward-exit so that an
  // interrupted prev→next sequence doesn't leave a stale exiting page above the
  // new incoming page.
  const zIndex = disableAnimations
    ? isPresent
      ? 1
      : 0
    : isPresent && direction === "forward"
      ? 2
      : !isPresent && direction === "backward"
        ? 1
        : 0;

  return (
    <motion.div
      className="absolute inset-0 h-full w-full overflow-hidden bg-background"
      style={{ zIndex }}
      custom={direction}
      variants={disableAnimations ? undefined : pageVariants}
      initial={disableAnimations ? false : "initial"}
      animate={disableAnimations ? undefined : "animate"}
      exit={disableAnimations ? undefined : "exit"}
    >
      <SpreadView
        spread={spread}
        spreadConfig={spreadConfig}
        columnSpacingPx={columnSpacingPx}
        paginationConfig={paginationConfig}
        showDebugOutlines={showDebugOutlines}
        paddingTopPx={paddingTopPx}
        paddingBottomPx={paddingBottomPx}
        paddingLeftPx={paddingLeftPx}
        paddingRightPx={paddingRightPx}
      />
    </motion.div>
  );
}
