import { useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import {
  SheetFitHeight,
  sheetPlacement,
  useSheetBody,
  useSheetForm,
} from "@workbench/elements/sheet-body";
import "@workbench/elements/sheet.css";
import { Heading } from "react-aria-components/Dialog";
import {
  Sheet as AriaSheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
} from "react-aria-components/Sheet";
import "./sheet.css";

export type SheetProps = {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  /** Names the sheet for assistive technology; shown when `heading` is set. */
  title: string;
  heading?: boolean;
  /**
   * Visible heights where the sheet rests, smallest first: pixels, or a
   * percentage of the sheet. It opens at the first and can always be dragged
   * to full height. Omit them for a sheet that fits its content.
   *
   * The phone keyboard would cover a lower detent, so a sheet with detents
   * rises to full height when a field takes focus, and puts the keyboard
   * away when it is dragged lower.
   */
  snapPoints?: (number | string)[];
  /**
   * Holds the sheet's height for its content (fitSheetHeight in
   * @workbench/elements): the height follows the content without chasing
   * its animations. On by default for a sheet without detents; a sheet with
   * detents whose content changes, as Notes does, turns it on.
   */
  fit?: boolean;
  /** Dims the page. A sheet that changes the page, as Text does, leaves it in view. */
  dim?: boolean;
  children: ReactNode;
};

/**
 * A bottom sheet on React Aria's Sheet, after the EPUB Reader's
 * (apps/reader/src/components/ui/detent-sheet.tsx). The browser's own
 * scrolling moves it, so a drag follows the finger, keeps its momentum, and
 * rests on detents. Opening, closing and a new detent run UIKit's sheet
 * spring. Below full height it floats, inset from the screen's edges, and
 * its height follows its content as "Sheet behaviour" in
 * packages/elements/docs/MOTION.md describes. Arctic shows sheets only in a
 * compact window (`useCompact` in surface.tsx), where they are phone sheets;
 * `sheetPlacement` would give a tablet's form layout in a wider one. It is
 * modal: the page turns
 * inert, focus stays inside, and a press outside or Escape closes it.
 */
export function Sheet({
  isOpen,
  onOpenChange,
  title,
  heading = false,
  snapPoints,
  fit,
  dim = true,
  children,
}: SheetProps) {
  const hasDetents = !!snapPoints?.length;
  const fits = fit ?? !hasDetents;
  const form = useSheetForm();
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints}
      {...sheetPlacement(form, hasDetents)}
      className="sheet-overlay wb-sheet-overlay"
    >
      {({ isExpanded, isExiting, isEntering }) => (
        <>
          {dim && (
            <SheetBackdrop
              className="sheet-backdrop"
              swipeAnimation="sheet-backdrop"
              swipeAnimationRange={
                snapPoints?.length
                  ? { start: snapPoints.length - 1 }
                  : undefined
              }
            />
          )}
          <AriaSheet
            className="sheet wb-sheet"
            stackAnimation="sheet-recede"
            overscrollPadding
          >
            <SheetContent className="sheet-content">
              <div className="sheet-handle" aria-hidden="true" />
              <Heading
                slot="title"
                className={heading ? "sheet-title" : "visually-hidden"}
              >
                {title}
              </Heading>
              <SheetBody
                hasDetents={hasDetents}
                isExpanded={isExpanded}
                isExiting={isExiting}
                isEntering={isEntering}
              >
                {fits ? <SheetFitHeight>{children}</SheetFitHeight> : children}
              </SheetBody>
            </SheetContent>
          </AriaSheet>
        </>
      )}
    </SheetOverlay>
  );
}

/**
 * Starts a sheet's entrance at the bottom edge of the screen.
 *
 * React Aria brings a sheet in by scrolling one screen height, whatever the
 * sheet's height. A sheet half the screen tall spends the first half of that
 * scroll below the screen, so a tap seemed to do nothing for a moment
 * (100–300 ms on iPhone). Before that scroll starts, this moves the sheet up
 * until its top edge meets the bottom of the screen; the scroll then covers
 * only the distance that you see.
 *
 * Snapping would pull the sheet back to its closed position, so it is off
 * until the sheet rests. Only touch screens get this: there React Aria waits
 * two frames for a keyboard before it scrolls, so the jump and the scroll are
 * in separate frames. In one task, React Aria notes, the browser can stop the
 * scroll at the jump.
 */
function useEdgeEntrance(
  ref: RefObject<HTMLElement | null>,
  isEntering: boolean,
) {
  const restoreSnap = useRef<() => void>(undefined);
  useLayoutEffect(() => {
    const sheet = ref.current?.closest<HTMLElement>(".sheet");
    const scroller = sheet?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!sheet || !scroller || navigator.maxTouchPoints === 0) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const below = sheet.getBoundingClientRect().top - innerHeight;
    if (below <= 0) return;
    const snap = scroller.style.scrollSnapType;
    scroller.style.scrollSnapType = "none";
    scroller.scrollTop += below;
    restoreSnap.current = () => (scroller.style.scrollSnapType = snap);
  }, [ref]);
  // React Aria marks the sheet as entering from the first frame of its
  // scroll until the scroll ends.
  const started = useRef(false);
  useLayoutEffect(() => {
    if (isEntering) started.current = true;
    else if (started.current) {
      restoreSnap.current?.();
      restoreSnap.current = undefined;
    }
  }, [isEntering]);
}

/**
 * The sheet's content: its moves, its shape, its exit, and the keyboard kept
 * clear of its detents (useSheetBody in @workbench/elements).
 */
function SheetBody({
  hasDetents,
  isExpanded,
  isExiting,
  isEntering,
  children,
}: {
  hasDetents: boolean;
  isExpanded: boolean;
  isExiting: boolean;
  isEntering: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEdgeEntrance(ref, isEntering);
  const focusHandlers = useSheetBody(ref, {
    hasDetents,
    isExpanded,
    isExiting,
  });
  return (
    <div ref={ref} className="sheet-body" {...focusHandlers}>
      {children}
    </div>
  );
}
