import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
import { fitSheetHeight, trackSheetShape } from "@workbench/elements/sheet-fit";
import {
  sheetSnaps,
  springSheetScroller,
  springSheetTo,
} from "@workbench/elements/sheet-motion";
import { SPRINGS } from "@workbench/elements/spring";
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
 * packages/elements/docs/MOTION.md describes. It is modal: the page turns
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
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints}
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
                {fits ? <FitHeight>{children}</FitHeight> : children}
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

/** Fields that open the phone keyboard. */
const TEXT_FIELD =
  "input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=file],[type=color]), textarea, [contenteditable]:not([contenteditable=false])";

function isTextField(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.matches(TEXT_FIELD);
}

/**
 * The sheet's content. With detents, it keeps the keyboard and the detents
 * apart: the keyboard covers the lower screen without resizing the page, so
 * a field below full height would sit under it.
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
  /** Where a field took the sheet from, to return there when it lets go. */
  const raisedFrom = useRef<number | null>(null);

  useEdgeEntrance(ref, isEntering);

  // The sheet floats below full height and meets the screen's edges at
  // the large detent (@workbench/elements/sheet.css).
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    const overlay = scroller?.closest<HTMLElement>(".wb-sheet-overlay");
    const sheet = ref.current?.closest<HTMLElement>(".wb-sheet");
    if (!scroller || !overlay || !sheet) return;
    return trackSheetShape(overlay, scroller, sheet);
  }, []);

  // React Aria opens, closes and changes detents with smooth scrolls; UIKit's
  // sheet spring runs them instead (packages/elements/docs/MOTION.md). The
  // body mounts with the sheet, before React Aria's first scroll.
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (scroller) return springSheetScroller(scroller);
  }, []);

  // A closing sheet scrolls out of view, and React Aria unmounts it once it
  // is gone. React puts back scroll offsets when a commit moves focus, which
  // can stop that scroll; scroll it out again.
  useEffect(() => {
    if (!isExiting) return;
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller) return;
    const leave = () => {
      if (scroller.scrollTop > 0)
        scroller.scrollTo({ top: 0, behavior: "smooth" });
    };
    scroller.addEventListener("scrollend", leave);
    return () => scroller.removeEventListener("scrollend", leave);
  }, [isExiting]);

  // Dragged below full height, the sheet puts the keyboard away.
  const wasExpanded = useRef(isExpanded);
  useEffect(() => {
    const collapsed = wasExpanded.current && !isExpanded;
    wasExpanded.current = isExpanded;
    if (collapsed) raisedFrom.current = null;
    const field = document.activeElement;
    if (
      collapsed &&
      hasDetents &&
      isTextField(field) &&
      ref.current?.contains(field)
    )
      field.blur();
  }, [hasDetents, isExpanded]);

  return (
    <div
      ref={ref}
      className="sheet-body"
      onFocus={(event) => {
        if (!hasDetents || isExpanded || !isTextField(event.target)) return;
        const sheet = event.currentTarget.closest<HTMLElement>(".sheet");
        const scroller = event.currentTarget.closest<HTMLElement>(
          "[data-sheet-scroll]",
        );
        // A sheet still below the screen is entering; it settles itself.
        if (
          !sheet ||
          !scroller ||
          sheet.getBoundingClientRect().top >= innerHeight
        )
          return;
        // The sheet rises with the keyboard, on the keyboard's spring, as
        // UIKit's does.
        raisedFrom.current = scroller.scrollTop;
        springSheetTo(
          scroller,
          scroller.scrollHeight - scroller.clientHeight,
          SPRINGS.snappy,
        );
      }}
      onBlur={(event) => {
        const from = raisedFrom.current;
        if (from === null || !isTextField(event.target)) return;
        // Focus that moves to another field keeps the keyboard up.
        if (
          isTextField(event.relatedTarget as Element | null) &&
          event.currentTarget.contains(event.relatedTarget as Node)
        )
          return;
        raisedFrom.current = null;
        const scroller = event.currentTarget.closest<HTMLElement>(
          "[data-sheet-scroll]",
        );
        if (!scroller || isExiting) return;
        // The keyboard goes, and the sheet goes back to the detent nearest
        // where the field took it from, never the closed place.
        const rests = sheetSnaps(scroller).filter(
          (snap) => snap.full || snap.marker.hasAttribute("data-sheet-detent"),
        );
        if (!rests.length) return;
        const home = rests.reduce((best, snap) =>
          Math.abs(snap.position - from) < Math.abs(best.position - from)
            ? snap
            : best,
        ).position;
        springSheetTo(scroller, home, SPRINGS.snappy);
      }}
    >
      {children}
    </div>
  );
}

/**
 * Holds a sheet's height for its content (fitSheetHeight): a change in one
 * frame moves the sheet at once on its spring, rows that collapse leave
 * their space at `[data-sheet-slack]` until the content is still, and then
 * the sheet settles once. `[data-sheet-fit-state]` names what the height is
 * doing: `rest`, `held` or `settling`.
 */
function FitHeight({ children }: { children: ReactNode }) {
  const fit = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = fit.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!fit.current || !content.current || !scroller) return;
    return fitSheetHeight({
      fit: fit.current,
      content: content.current,
      scroller,
    });
  }, []);
  return (
    <div ref={fit} data-sheet-fit="">
      <div ref={content} data-sheet-fit-content="">
        {children}
        <div data-sheet-slack="end" aria-hidden="true" />
      </div>
    </div>
  );
}
