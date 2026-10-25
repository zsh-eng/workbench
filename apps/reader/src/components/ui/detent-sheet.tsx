import { Button } from "@/components/ui/button";
import { MOTION } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import { springSheetScroller } from "@workbench/elements/sheet-motion";
import {
  SPRINGS,
  springTransition,
  type Spring,
} from "@workbench/elements/spring";
import { motion, useReducedMotion } from "motion/react";
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
   * dragged to its full height. Omit them for a sheet that fits its content;
   * its height then follows the content, as when a tab changes.
   *
   * The phone keyboard would cover a lower detent, so a sheet with detents
   * opens at full height when its page names a field to focus
   * (`data-sheet-autofocus`), rises to full height when a field takes focus,
   * and puts the keyboard away when it is dragged lower.
   */
  snapPoints?: DetentSheetSnapPoint[];
  /** "content" fits the content; "tall" takes the screen below the inset. */
  height?: "content" | "tall";
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
 * (`SheetSpringContext`; docs in packages/elements/docs/MOTION.md).
 * Sheets opened over it stack, and it steps back.
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
  stacked = false,
  onBack,
  backLabel = "Back",
  dim = true,
  children,
}: DetentSheetProps) {
  const hasDetents = !!snapPoints?.length;
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
      className="reader-sheet-overlay"
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
              "reader-sheet",
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
                {hasDetents || height === "tall" ? (
                  children
                ) : (
                  <FitHeight>{children}</FitHeight>
                )}
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

  // React Aria opens, closes and changes detents with smooth scrolls. The
  // sheet's spring runs them instead, from the bottom edge of the screen.
  // The body mounts with the sheet, before React Aria's first scroll.
  useLayoutEffect(() => {
    const scroller = ref.current?.closest<HTMLElement>("[data-sheet-scroll]");
    if (!scroller || !spring) return;
    return springSheetScroller(scroller, spring);
  }, [spring]);

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
        // Full height is the end of the sheet's scroll range.
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

/**
 * Moves a sheet that fits its content to the content's new height on the
 * sheet's spring, so the top edge glides instead of jumping. The content keeps its own height; a
 * sheet taller than the screen scrolls its body.
 */
function FitHeight({ children }: { children: ReactNode }) {
  const content = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  const reduceMotion = useReducedMotion();
  const spring = useContext(SheetSpringContext);
  useLayoutEffect(() => {
    const element = content.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.offsetHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <motion.div
      className="shrink-0 overflow-hidden"
      initial={false}
      animate={{ height }}
      transition={
        reduceMotion
          ? { duration: 0 }
          : spring
            ? springTransition(spring)
            : MOTION.shape
      }
    >
      <div ref={content}>{children}</div>
    </motion.div>
  );
}
