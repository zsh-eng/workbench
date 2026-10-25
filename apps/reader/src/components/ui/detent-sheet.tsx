import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { fitSheetHeight, trackSheetShape } from "@workbench/elements/sheet-fit";
import {
  sheetSnaps,
  springSheetScroller,
  springSheetTo,
} from "@workbench/elements/sheet-motion";
import { SPRINGS, type Spring } from "@workbench/elements/spring";
import "@workbench/elements/sheet.css";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Heading } from "react-aria-components/Dialog";
import {
  Sheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
} from "react-aria-components/Sheet";
import "./detent-sheet.css";

export type DetentSheetSnapPoint = number | string;

/**
 * The spring that opens, closes and changes the detent of every sheet below
 * it: UIKit's sheet spring by default. `null` leaves those moves to the
 * browser's smooth scrolling, for comparison in Design ideas.
 */
export const SheetSpringContext = createContext<Spring | null>(SPRINGS.sheet);

export interface DetentSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  /**
   * Visible heights where the sheet rests, smallest first: pixels, or a
   * percentage of the sheet. The sheet opens at the first and can always be
   * dragged to its full height. Omit them for a sheet that fits its content.
   *
   * The phone keyboard would cover a lower detent, so a sheet with detents
   * opens at full height when its page names a field to focus
   * (`data-sheet-autofocus`), rises to full height when a field takes focus,
   * returns to its detent when the field lets go, and puts the keyboard
   * away when it is dragged lower.
   */
  snapPoints?: DetentSheetSnapPoint[];
  /** "content" fits the content; "tall" takes the screen below the inset. */
  height?: "content" | "tall";
  /**
   * Holds the sheet's height for its content (fitSheetHeight): the height
   * follows the content without chasing its animations, and space the
   * content frees shows at its `[data-sheet-slack]`. On by default for a
   * sheet without detents. A sheet with detents whose content changes, as
   * the Notebook's does, turns it on; a sheet that fills with its own
   * scrolling list, as Contents does, leaves it off.
   */
  fit?: boolean;
  /** Opens over another sheet: the lower sheet steps back and stays. */
  stacked?: boolean;
  /** Shows a back button that closes this sheet. */
  onBack?: () => void;
  backLabel?: string;
  /** Dims the page under the sheet. Detent sheets dim only at full height. */
  dim?: boolean;
  children: ReactNode;
}

/**
 * A bottom sheet on React Aria's Sheet. The browser's own scrolling moves
 * it, so a drag follows the finger, rests on detents, and keeps momentum.
 * Opening, closing and a new detent run UIKit's sheet spring
 * (`SheetSpringContext`). Below full height it floats, inset from the
 * screen's edges, and it meets them at full height; its height follows its
 * content as "Sheet behaviour" in packages/elements/docs/MOTION.md
 * describes. Sheets opened over it stack, and it steps back.
 *
 * The sheet is modal: the rest of the page turns inert, focus stays inside,
 * and a press outside closes it. Menus, dialogs and toasts render elsewhere
 * in the document, so they mark themselves as React Aria's top layer
 * (`data-react-aria-top-layer`), which the sheet leaves usable.
 */
export function DetentSheet({
  isOpen,
  onOpenChange,
  title,
  snapPoints,
  height = "content",
  fit,
  stacked = false,
  onBack,
  backLabel = "Back",
  dim = true,
  children,
}: DetentSheetProps) {
  const hasDetents = !!snapPoints?.length;
  const fits = height === "content" && (fit ?? !hasDetents);
  // React Aria opens a sheet at its first detent. Full height goes first
  // when the page will focus a field, and the others stay below it.
  const [opensFull, setOpensFull] = useState(false);
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) setOpensFull(false);
  }
  const detents =
    hasDetents && opensFull ? ["100%", ...snapPoints] : snapPoints;
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      snapPoints={detents}
      className="reader-sheet-overlay wb-sheet-overlay"
      // The lower sheet hides each new node outside it. A sheet marks itself
      // visible in an effect, which runs too late when a timer or an async
      // result opens it, and the sheet stays inert. React Aria never hides
      // its top layer, so a stacked sheet joins it.
      data-react-aria-top-layer={stacked || undefined}
    >
      {({ isExpanded, isExiting }) => (
        <>
          {dim && (
            <SheetBackdrop
              className="reader-sheet-backdrop"
              swipeAnimation="reader-sheet-backdrop"
              // The page dims above the highest detent below full height.
              swipeAnimationRange={
                detents?.length ? { start: detents.length - 1 } : undefined
              }
            />
          )}
          <Sheet
            className={cn(
              "reader-sheet wb-sheet",
              height === "tall" && "reader-sheet-tall",
            )}
            stackAnimation="reader-sheet-recede"
            overscrollPadding
          >
            <SheetContent className="reader-sheet-content">
              <div className="reader-sheet-handle" aria-hidden="true" />
              <div className="grid h-10 shrink-0 grid-cols-[2rem_1fr_2rem] items-center gap-3 px-4">
                {onBack ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={onBack}
                    aria-label={backLabel}
                    className="size-8 rounded-full border border-border/60 bg-secondary/20"
                  >
                    <ChevronLeft className="size-4" />
                  </Button>
                ) : (
                  <div />
                )}
                <Heading
                  slot="title"
                  className="truncate text-center text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground"
                >
                  {title}
                </Heading>
                <div />
              </div>
              <SheetBody
                hasDetents={hasDetents}
                isExpanded={isExpanded}
                isExiting={isExiting}
                setOpensFull={setOpensFull}
              >
                {fits ? <FitHeight>{children}</FitHeight> : children}
              </SheetBody>
            </SheetContent>
          </Sheet>
        </>
      )}
    </SheetOverlay>
  );
}

/** Fields that open the phone keyboard. */
const TEXT_FIELD =
  "input:not([type=button],[type=checkbox],[type=radio],[type=range],[type=submit],[type=reset],[type=file],[type=color]), textarea, [contenteditable]:not([contenteditable=false])";

function isTextField(element: Element | null): element is HTMLElement {
  return element instanceof HTMLElement && element.matches(TEXT_FIELD);
}

function reducedMotion() {
  return matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * The sheet's content. In a sheet with detents it keeps the keyboard and
 * the detents apart: the keyboard covers the lower part of the screen
 * without resizing the page, so a field below full height would sit under
 * it.
 */
function SheetBody({
  hasDetents,
  isExpanded,
  isExiting,
  setOpensFull,
  children,
}: {
  hasDetents: boolean;
  isExpanded: boolean;
  isExiting: boolean;
  setOpensFull: (opensFull: boolean) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const spring = useContext(SheetSpringContext);
  /** Where a field took the sheet from, to return there when it lets go. */
  const raisedFrom = useRef<number | null>(null);

  // React Aria opens, closes and changes detents with smooth scrolls. The
  // sheet's spring runs them instead, from the bottom edge of the screen.
  // The body mounts with the sheet, before React Aria's first scroll.
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller || !spring) return;
    return springSheetScroller(scroller, spring);
  }, [spring]);

  // The sheet floats below full height and meets the screen's edges at
  // the large detent (sheet.css).
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    const overlay = scroller?.closest<HTMLElement>(".wb-sheet-overlay");
    const sheet = ref.current?.closest<HTMLElement>(".wb-sheet");
    if (!scroller || !overlay || !sheet) return;
    return trackSheetShape(overlay, scroller, sheet);
  }, []);

  // A closing sheet scrolls out of view, and React Aria unmounts it once it
  // is gone. Writing the sheet's scroll offset stops that scroll, and React
  // does write it: when a commit takes focus from a control, as when the
  // control becomes disabled, React focuses it again and puts back every
  // ancestor's scroll offset. Appearance's Pages or Scroll does this. The
  // sheet then stays on screen, closed. Scroll it out again.
  useEffect(() => {
    if (!isExiting) return;
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller) return;
    // A bottom sheet is out of view at the start of its scroll range.
    const leave = () => {
      if (scroller.scrollTop > 0)
        scroller.scrollTo({ top: 0, behavior: "smooth" });
    };
    scroller.addEventListener("scrollend", leave);
    return () => scroller.removeEventListener("scrollend", leave);
  }, [isExiting]);

  // The body mounts each time the sheet opens, before React Aria scrolls the
  // sheet to its first detent, so this runs once per opening.
  useLayoutEffect(() => {
    if (hasDetents && ref.current?.querySelector("[data-sheet-autofocus]"))
      setOpensFull(true);
  }, [hasDetents, setOpensFull]);

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
  }, [hasDetents, isExpanded]);

  return (
    <div
      ref={ref}
      className="reader-sheet-body"
      onFocus={(event) => {
        if (!hasDetents || isExpanded || !isTextField(event.target)) return;
        const sheet = event.currentTarget.closest<HTMLElement>(".reader-sheet");
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
        // Full height is the end of the sheet's scroll range. The sheet
        // rises with the keyboard, on its spring, as UIKit's does.
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
        if (reducedMotion()) scroller.scrollTo({ top: home });
        else springSheetTo(scroller, home, SPRINGS.snappy);
      }}
    >
      {children}
    </div>
  );
}

/**
 * Holds a sheet's height for its content (fitSheetHeight): a new tab
 * moves the sheet at once on its spring, rows that collapse leave their
 * space at `[data-sheet-slack]` until the content is still, and then the
 * sheet settles once. `[data-sheet-fit-state]` names what the height is
 * doing: `rest`, `held` or `settling`.
 */
function FitHeight({ children }: { children: ReactNode }) {
  const fit = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const spring = useContext(SheetSpringContext);
  useLayoutEffect(() => {
    const scroller = fit.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!fit.current || !content.current || !scroller) return;
    return fitSheetHeight({
      fit: fit.current,
      content: content.current,
      scroller,
      spring: spring ?? SPRINGS.sheet,
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
