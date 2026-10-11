import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Heading } from "react-aria-components/Dialog";
import {
  Sheet,
  SheetBackdrop,
  SheetContent,
  SheetOverlay,
} from "react-aria-components/Sheet";
import "./detent-sheet.css";

export type DetentSheetSnapPoint = number | string;

export interface DetentSheetProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  title: string;
  /**
   * Visible heights where the sheet rests, smallest first: pixels, or a
   * percentage of the sheet. The sheet opens at the first and can always be
   * dragged to its full height. Omit them for a sheet that fits its content.
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
 * Sheets opened over it stack, and it steps back.
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
  return (
    <SheetOverlay
      isOpen={isOpen}
      onOpenChange={onOpenChange}
      snapPoints={snapPoints}
      className="reader-sheet-overlay"
      // The lower sheet hides each new node outside it. A sheet marks itself
      // visible in an effect, which runs too late when a timer or an async
      // result opens it, and the sheet stays inert. React Aria never hides
      // its top layer, so a stacked sheet joins it.
      data-react-aria-top-layer={stacked || undefined}
    >
      {dim && (
        <SheetBackdrop
          className="reader-sheet-backdrop"
          swipeAnimation="reader-sheet-backdrop"
          swipeAnimationRange={
            snapPoints?.length ? { start: snapPoints.length - 1 } : undefined
          }
        />
      )}
      <Sheet
        className={cn("reader-sheet", height === "tall" && "reader-sheet-tall")}
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
          <div className="reader-sheet-body">{children}</div>
        </SheetContent>
      </Sheet>
    </SheetOverlay>
  );
}
