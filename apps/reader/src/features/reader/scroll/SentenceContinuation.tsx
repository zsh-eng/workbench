import { cn } from "@/lib/utils";
import { Check, CornerDownRight, CornerLeftUp } from "lucide-react";
import { SELECTION_TINT } from "./SpillTab";
import type { PageBreakSelection } from "./use-page-break-selection";

/**
 * "Finish the sentence": a quiet line on the highlight tools that quotes
 * the rest of the sentence across the page break. Choosing it includes
 * those words in the highlight without leaving pages; the quote then takes
 * the selection's tint, as if it were selected too.
 */
export function SentenceContinuation({
  pageBreak,
  included,
  onToggle,
  variant,
}: {
  pageBreak: PageBreakSelection;
  included: boolean;
  onToggle: () => void;
  /** A line across the phone's island, or a note under the desktop pill. */
  variant: "island" | "toolbar";
}) {
  const { continuation, otherPageNumber, fontFamily } = pageBreak;
  const foot = continuation.edge === "end";
  const Icon = included ? Check : foot ? CornerDownRight : CornerLeftUp;
  const label = included
    ? `Included from p. ${otherPageNumber}`
    : foot
      ? `Continues on p. ${otherPageNumber}`
      : `Starts on p. ${otherPageNumber}`;
  return (
    <button
      type="button"
      data-reader-sentence-continuation={included ? "included" : "offered"}
      aria-pressed={included}
      aria-label={`${included ? "Included in the highlight" : foot ? "Finish the sentence on" : "Start the sentence on"} page ${otherPageNumber}: “${continuation.beyond}”`}
      // Keep the selection: a press must not collapse it.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
      className={cn(
        "flex items-center gap-2 text-left text-[12px] text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
        variant === "island"
          ? "h-10 w-0 min-w-full px-4 first:border-b last:border-t border-border/60"
          : "h-8 w-full rounded-[10px] px-2.5 hover:bg-muted/60",
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="shrink-0 font-medium">{label}</span>
      <span
        className={cn(
          "min-w-0 truncate rounded-[4px] px-1 text-[13px] text-foreground/80",
          !included && "italic",
        )}
        style={{
          fontFamily,
          background: included ? SELECTION_TINT : undefined,
        }}
      >
        {foot ? "" : "…"}
        {continuation.beyond}
      </span>
    </button>
  );
}
