import { cn } from "@/lib/utils";
import { ArrowDown, ArrowUp } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useRef, useState, type PointerEvent } from "react";
import type { PageBreakSelection } from "./use-page-break-selection";

/** Room left for iOS's selection handle, whose knob sits at the cut. */
const HANDLE_CLEARANCE_PX = 14;
const MIN_WIDTH_PX = 112;
const MAX_WIDTH_PX = 236;
const HEIGHT_PX = 30;
/** Downward pull that continues the selection on release. */
const PULL_COMMIT_PX = 26;

/**
 * The selection's tint: the colour the browser paints selections in, mixed
 * into the page so it stays a tint on every theme.
 */
export const SELECTION_TINT =
  "color-mix(in oklab, Highlight 62%, var(--background))";

/**
 * The spill tab: when a page break cuts a selection, a small tab of the
 * selection's own tint hangs off the page edge under the cut and previews
 * the words on the other page. It reads as the selection running on, not
 * as another action on the highlight. A tap, or a pull away from the page,
 * carries the selection across the break.
 */
export function SpillTab({
  pageBreak,
  onContinue,
}: {
  pageBreak: PageBreakSelection;
  onContinue: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const { cut, page, continuation, otherPageNumber, fontFamily } = pageBreak;
  const foot = continuation.edge === "end";
  const [pull, setPull] = useState(0);
  const press = useRef<{ id: number; y: number; moved: boolean } | null>(null);

  // Under the cut and clear of the handle's knob, as wide as its words:
  // a tab, not a bar. At the foot it hangs from the cut leftwards, at the
  // head it stands on the cut and runs right.
  const anchor = foot
    ? cut.right - HANDLE_CLEARANCE_PX
    : cut.left + HANDLE_CLEARANCE_PX;
  const maxWidth = Math.min(
    MAX_WIDTH_PX,
    foot ? anchor - page.left : page.right - anchor,
  );
  const minWidth = Math.min(
    maxWidth,
    Math.max(MIN_WIDTH_PX, cut.right - cut.left - HANDLE_CLEARANCE_PX),
  );
  const viewportWidth = document.documentElement.clientWidth;
  const top = foot ? cut.bottom + 2 : cut.top - 2 - HEIGHT_PX;

  const words = `${foot ? "" : continuation.previewTruncated ? "…" : ""}${continuation.preview}${foot && continuation.previewTruncated ? "…" : ""}`;
  const label = foot
    ? `Continue selection onto page ${otherPageNumber}: “${continuation.beyond}”`
    : `Extend selection back to page ${otherPageNumber}: “${continuation.beyond}”`;
  const Arrow = foot ? ArrowDown : ArrowUp;

  // A pull away from the page carries the selection across.
  const away = (event: PointerEvent) =>
    foot ? event.clientY - press.current!.y : press.current!.y - event.clientY;
  const resist = (distance: number) =>
    distance <= 0 ? 0 : 40 * (1 - 1 / (1 + distance / 60));

  return (
    <motion.button
      type="button"
      data-reader-spill-tab={continuation.edge}
      aria-label={label}
      title={label}
      initial={
        reduceMotion
          ? { opacity: 0 }
          : {
              opacity: 0,
              clipPath: foot ? "inset(0 0 100% 0)" : "inset(100% 0 0 0)",
            }
      }
      animate={{ opacity: 1, clipPath: "inset(0 0 0% 0)" }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      // Keep the selection: a press must not collapse it.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        event.preventDefault();
        press.current = { id: event.pointerId, y: event.clientY, moved: false };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (press.current?.id !== event.pointerId) return;
        const distance = away(event);
        if (Math.abs(distance) > 6) press.current.moved = true;
        setPull(resist(distance));
      }}
      onPointerUp={(event) => {
        if (press.current?.id !== event.pointerId) return;
        const distance = away(event);
        const { moved } = press.current;
        press.current = null;
        setPull(0);
        // A tap, or a pull that went far enough.
        if (!moved || distance >= PULL_COMMIT_PX) onContinue();
      }}
      onPointerCancel={() => {
        press.current = null;
        setPull(0);
      }}
      onClick={(event) => {
        // Keyboard and assistive activation; pointers act on release.
        if (event.detail === 0) onContinue();
      }}
      className={cn(
        "fixed z-30 flex items-center gap-1.5 overflow-hidden px-2.5 text-[14px] leading-none text-foreground/75 outline-none select-none focus-visible:ring-2 focus-visible:ring-ring",
        foot
          ? "rounded-t-[3px] rounded-b-[11px]"
          : "flex-row-reverse rounded-t-[11px] rounded-b-[3px]",
      )}
      style={{
        ...(foot ? { right: viewportWidth - anchor } : { left: anchor }),
        top,
        width: "max-content",
        minWidth,
        maxWidth,
        height: HEIGHT_PX,
        background: SELECTION_TINT,
        fontFamily,
        touchAction: "none",
        transform: `translateY(${foot ? pull : -pull}px)`,
        transformOrigin: foot ? "top" : "bottom",
      }}
    >
      <span
        className={cn(
          "min-w-0 flex-1 truncate whitespace-nowrap",
          foot ? "text-left" : "text-right",
        )}
        style={
          continuation.previewTruncated
            ? {
                // The words fade where they run on.
                maskImage: `linear-gradient(${foot ? "to right" : "to left"}, black 72%, transparent)`,
                WebkitMaskImage: `linear-gradient(${foot ? "to right" : "to left"}, black 72%, transparent)`,
              }
            : undefined
        }
      >
        {words}
      </span>
      <Arrow
        aria-hidden="true"
        className="size-3.5 shrink-0"
        strokeWidth={pull >= resist(PULL_COMMIT_PX) - 1 ? 2.6 : 2}
      />
    </motion.button>
  );
}
