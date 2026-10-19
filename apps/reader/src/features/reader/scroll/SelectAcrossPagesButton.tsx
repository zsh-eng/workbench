import { cn } from "@/lib/utils";
import { ScrollText } from "lucide-react";

/**
 * "Select across pages in Scroll", among the highlight tools while a
 * selection reaches a page's first or last line. It lives in the tools
 * rather than beside the selection, so it never covers them, the
 * selection's handles or the phone's own selection menu.
 */
export function SelectAcrossPagesButton({
  variant,
  onSelect,
}: {
  /** A labelled pill in the phone's island; an icon in the desktop pill. */
  variant: "island" | "toolbar";
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      data-reader-select-across-pages=""
      aria-label="Select across pages in Scroll"
      title="Select across pages in Scroll"
      // Keep the selection: a press must not collapse it.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onSelect}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring",
        variant === "island"
          ? "h-10 gap-1.5 bg-secondary px-3.5 text-[13px] font-medium text-foreground"
          : "size-7 text-muted-foreground hover:bg-muted",
      )}
    >
      <ScrollText
        className={variant === "island" ? "size-4" : "size-[19px]"}
        aria-hidden="true"
      />
      {variant === "island" && "Scroll"}
    </button>
  );
}
