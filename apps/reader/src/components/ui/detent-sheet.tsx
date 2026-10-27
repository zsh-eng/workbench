import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import {
  SheetFitHeight,
  sheetPlacement,
  useSheetBody,
  useSheetForm,
} from "@workbench/elements/sheet-body";
import { SPRINGS, type Spring } from "@workbench/elements/spring";
import "@workbench/elements/sheet.css";
import {
  createContext,
  useContext,
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
 * On an iPad it takes UIKit's form layout (`sheetPlacement`): centred
 * without detents, on the bottom edge at a form sheet's width with them.
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
  const form = useSheetForm();
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      snapPoints={detents}
      {...sheetPlacement(form, hasDetents)}
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

/**
 * The sheet's content: its moves, its shape, and the keyboard kept clear
 * of its detents (useSheetBody). A sheet with detents whose page names a
 * field to focus opens at full height.
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
  const focusHandlers = useSheetBody(ref, {
    hasDetents,
    isExpanded,
    isExiting,
    spring,
  });

  // The body mounts each time the sheet opens, before React Aria scrolls the
  // sheet to its first detent, so this runs once per opening.
  useLayoutEffect(() => {
    if (hasDetents && ref.current?.querySelector("[data-sheet-autofocus]"))
      setOpensFull(true);
  }, [hasDetents, setOpensFull]);

  return (
    <div ref={ref} className="reader-sheet-body" {...focusHandlers}>
      {children}
    </div>
  );
}

/** The sheet's height follows its content, on the sheet's spring. */
function FitHeight({ children }: { children: ReactNode }) {
  const spring = useContext(SheetSpringContext);
  return (
    <SheetFitHeight spring={spring ?? SPRINGS.sheet}>{children}</SheetFitHeight>
  );
}
