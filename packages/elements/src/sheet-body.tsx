import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { fitSheetHeight, trackSheetShape } from "./sheet-fit";
import {
  holdRestOnResize,
  sheetInView,
  sheetSnaps,
  springSheetScroller,
  springSheetTo,
} from "./sheet-motion";
import { SPRINGS, type Spring } from "./spring";

/** Fields that open the phone keyboard. */
const TEXT_FIELD =
  "input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=file],[type=color]), textarea, [contenteditable]:not([contenteditable=false])";

export function isTextField(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.matches(TEXT_FIELD);
}

/**
 * A touch screen with room for an iPad's form sheet: regular width and
 * regular height in UIKit's terms ("iPad" in docs/MOTION.md). A phone in
 * either orientation, and a narrow window beside another app, stay below it;
 * so does a desktop without touch. A laptop with a touch screen matches.
 */
export const SHEET_FORM_QUERY =
  "(any-pointer: coarse) and (min-width: 640px) and (min-height: 600px)";

let formQuery: MediaQueryList | undefined;
const sheetFormQuery = () => (formQuery ??= matchMedia(SHEET_FORM_QUERY));
const subscribeSheetForm = (listener: () => void) => {
  const query = sheetFormQuery();
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
};

/**
 * Whether sheets take an iPad's form layout now. It changes when the
 * window turns or is resized, and an open sheet changes with it.
 */
export function useSheetForm(): boolean {
  return useSyncExternalStore(
    subscribeSheetForm,
    () => sheetFormQuery().matches,
    () => false,
  );
}

/**
 * Where a React Aria `SheetOverlay` puts its sheet, as UIKit does in each
 * size class (`.wb-sheet-overlay` in sheet.css draws it):
 *
 * - On a phone, or in a narrow window, a sheet rises from the bottom edge.
 * - In the form layout, a sheet without detents is a form sheet: centred,
 *   at most 580 px wide, over a dimmed page. A sheet with detents stays on
 *   the bottom edge, as wide as a form sheet and lifted 20 px from it, so
 *   the page above stays in view.
 *
 * Every sheet leaves by a swipe down. Spread the result on the overlay.
 */
export function sheetPlacement(form: boolean, hasDetents: boolean) {
  return {
    position: form && !hasDetents ? "center" : "bottom",
    swipeDirection: "bottom",
    "data-sheet-layout": form ? "form" : "phone",
  } as const;
}

export interface SheetBodyOptions {
  /** The sheet rests on detents below full height. */
  hasDetents: boolean;
  /** React Aria's `isExpanded` and `isExiting` for the sheet. */
  isExpanded: boolean;
  isExiting: boolean;
  /**
   * The spring for the sheet's own moves (`springSheetScroller`). `null`
   * leaves them to the browser's smooth scrolling.
   */
  spring?: Spring | null;
}

/**
 * The behaviour of a React Aria sheet's body, an element inside its
 * `SheetContent` that mounts with the sheet ("Sheet behaviour" in
 * docs/MOTION.md):
 *
 * - The sheet's own moves run on its spring, and it floats below full
 *   height (`trackSheetShape`; `.wb-sheet-overlay` and `.wb-sheet`).
 * - Turning or resizing the window keeps it on its detent
 *   (`holdRestOnResize`).
 * - A closing sheet that a React commit stopped scrolls out again.
 * - With detents, the phone keyboard and the detents stay apart: the
 *   keyboard covers the lower screen without resizing the page. A field
 *   that takes focus raises the sheet to full height on the keyboard's
 *   spring, and when focus leaves the fields the sheet goes back to the
 *   detent nearest where it was. Dragged below full height, the sheet puts
 *   the keyboard away.
 *
 * Returns the focus handlers for the body.
 */
export function useSheetBody(
  ref: RefObject<HTMLElement | null>,
  {
    hasDetents,
    isExpanded,
    isExiting,
    spring = SPRINGS.sheet,
  }: SheetBodyOptions,
) {
  /** Where a field took the sheet from, to return there when it lets go. */
  const raisedFrom = useRef<number | null>(null);

  // React Aria opens, closes and changes detents with smooth scrolls. The
  // sheet's spring runs them instead, from the bottom edge of the screen.
  // The body mounts with the sheet, before React Aria's first scroll.
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller || !spring) return;
    return springSheetScroller(scroller, spring);
  }, [ref, spring]);

  // Turning the window keeps the sheet on its detent or in full view.
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller) return;
    return holdRestOnResize(scroller);
  }, [ref]);

  // The sheet floats below full height and meets the screen's edges at
  // the large detent (sheet.css).
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    const overlay = scroller?.closest<HTMLElement>(".wb-sheet-overlay");
    const sheet = ref.current?.closest<HTMLElement>(".wb-sheet");
    if (!scroller || !overlay || !sheet) return;
    return trackSheetShape(overlay, scroller, sheet);
  }, [ref]);

  // A closing sheet scrolls out of view, and React Aria unmounts it once it
  // is gone. Writing the sheet's scroll offset stops that scroll, and React
  // does write it: when a commit takes focus from a control, as when the
  // control becomes disabled, React focuses it again and puts back every
  // ancestor's scroll offset. The sheet then stays on screen, closed.
  // Scroll it out again.
  useEffect(() => {
    if (!isExiting) return;
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller) return;
    // Only while some of it shows: on the spring a leaving sheet stops just
    // below the screen, short of the start of its scroll range. Asked to
    // leave from there, it is where it would go, and its move ends at once.
    const leave = () => {
      if (sheetInView(scroller))
        scroller.scrollTo({ top: 0, behavior: "smooth" });
    };
    scroller.addEventListener("scrollend", leave);
    return () => scroller.removeEventListener("scrollend", leave);
  }, [ref, isExiting]);

  // Dragged below full height, the sheet puts the keyboard away instead of
  // leaving the field under it.
  const wasExpanded = useRef(isExpanded);
  useEffect(() => {
    const collapsed = wasExpanded.current && !isExpanded;
    wasExpanded.current = isExpanded;
    if (!collapsed) return;
    raisedFrom.current = null;
    const field = document.activeElement;
    if (hasDetents && isTextField(field) && ref.current?.contains(field))
      field.blur();
  }, [ref, hasDetents, isExpanded]);

  return {
    onFocus(event: FocusEvent<HTMLElement>) {
      if (!hasDetents || isExpanded || !isTextField(event.target)) return;
      const sheet = event.currentTarget.closest<HTMLElement>(".wb-sheet");
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
      // Full height is the end of the sheet's scroll range. The sheet rises
      // with the keyboard, on its spring, as UIKit's does.
      raisedFrom.current = scroller.scrollTop;
      springSheetTo(
        scroller,
        scroller.scrollHeight - scroller.clientHeight,
        SPRINGS.snappy,
      );
    },
    onBlur(event: FocusEvent<HTMLElement>) {
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
      // The keyboard goes, and the sheet goes back to its detent with it:
      // the one nearest where the field took it from, which may have been
      // mid-move. Never the closed place.
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
    },
  };
}

/**
 * Holds a sheet's height for its content (`fitSheetHeight`): a change in
 * one frame moves the sheet at once on its spring, rows that collapse leave
 * their space at `[data-sheet-slack]` until the content is still, and then
 * the sheet settles once. `[data-sheet-fit-state]` names what the height is
 * doing: `rest`, `held` or `settling`.
 */
export function SheetFitHeight({
  spring = SPRINGS.sheet,
  children,
}: {
  spring?: Spring;
  children: ReactNode;
}) {
  const fit = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const scroller = fit.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!fit.current || !content.current || !scroller) return;
    return fitSheetHeight({
      fit: fit.current,
      content: content.current,
      scroller,
      spring,
    });
  }, [spring]);
  return (
    <div ref={fit} data-sheet-fit="">
      <div ref={content} data-sheet-fit-content="">
        {children}
        <div data-sheet-slack="end" aria-hidden="true" />
      </div>
    </div>
  );
}
