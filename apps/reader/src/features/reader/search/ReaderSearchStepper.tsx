import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight, X } from "lucide-react";

/**
 * Steps through search results from the page. It sits where the Reader's
 * other prompts sit: floating at the top edge on a phone, in the header on
 * a larger screen. The count opens the results again.
 */
export function ReaderSearchStepper({
  floating,
  index,
  total,
  truncated,
  onPrevious,
  onNext,
  onShowResults,
  onClose,
}: {
  floating: boolean;
  index: number;
  total: number;
  truncated: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onShowResults: () => void;
  onClose: () => void;
}) {
  const buttonSize = floating
    ? "size-8 rounded-full"
    : "size-7 rounded-[calc(var(--radius-xl)-3px)]";
  return (
    <div
      data-reader-header-accessory={floating ? undefined : ""}
      data-reader-top-prompt={floating ? "" : undefined}
      data-testid="search-stepper"
      className={cn("relative shrink-0", !floating && "mr-2")}
    >
      <div
        role="toolbar"
        aria-label="Search results"
        className={cn(
          "flex items-center gap-0.5 border",
          floating
            ? "h-10 rounded-full border-border/80 bg-background p-1 shadow-lg"
            : "h-9 rounded-xl border-transparent bg-secondary/70 p-0.5",
        )}
      >
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Previous result"
          title="Previous result"
          disabled={index <= 0}
          onClick={onPrevious}
          className={cn("text-foreground hover:bg-muted", buttonSize)}
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-label={`Result ${index + 1} of ${total}. Show all results`}
          onClick={onShowResults}
          className={cn(
            "min-w-0 px-2 font-numeric text-xs tabular-nums hover:bg-muted",
            floating
              ? "h-8 rounded-full"
              : "h-7 rounded-[calc(var(--radius-xl)-3px)]",
          )}
        >
          {index + 1} of {total.toLocaleString()}
          {truncated ? "+" : ""}
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Next result"
          title="Next result"
          disabled={index >= total - 1}
          onClick={onNext}
          className={cn("text-foreground hover:bg-muted", buttonSize)}
        >
          <ChevronRight className="size-4" />
        </Button>
        <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden="true" />
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Close search"
          title="Close search"
          onClick={onClose}
          className={cn(
            "text-muted-foreground hover:bg-muted hover:text-foreground",
            buttonSize,
          )}
        >
          <X className="size-3.5" />
        </Button>
      </div>
    </div>
  );
}
