import {
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
  type RefObject,
} from "react";
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
  /** Dims the page. A sheet that changes the page, as Text does, leaves it in view. */
  dim?: boolean;
  children: ReactNode;
};

/**
 * A bottom sheet on React Aria's Sheet, after the EPUB Reader's
 * (apps/reader/src/components/ui/detent-sheet.tsx). The browser's own
 * scrolling moves it, so a drag follows the finger, keeps its momentum, and
 * rests on detents. It is modal: the page turns inert, focus stays inside,
 * and a press outside or Escape closes it.
 */
export function Sheet({
  isOpen,
  onOpenChange,
  title,
  heading = false,
  snapPoints,
  dim = true,
  children,
}: SheetProps) {
  const hasDetents = !!snapPoints?.length;
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints}
      className="sheet-overlay"
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
            className="sheet"
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
                {children}
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

  useEdgeEntrance(ref, isEntering);

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
        scroller.scrollTo({
          top: scroller.scrollHeight - scroller.clientHeight,
          behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
        });
      }}
    >
      {children}
    </div>
  );
}
