import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import { BookOpen, ScrollText } from "lucide-react";
import type { ReadingMode } from "./reading-mode-preference";

const itemClassName =
  "h-9 flex-1 gap-1.5 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[pressed]:text-foreground";

/**
 * Appearance row: read in pages or in one scrolling column per chapter,
 * like Apple Books' Scrolling View. It leads the Layout tab: it changes
 * how the whole book reads, so it comes before spacing and margins.
 */
export function ReadingLayoutRow({
  value,
  onChange,
  disabled = false,
}: {
  value: ReadingMode;
  onChange: (mode: ReadingMode) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2" data-reading-layout-row={value}>
      <h4 className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Reading view
      </h4>
      <SegmentedToggleGroup
        aria-label="Reading view"
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (next === "pages" || next === "scroll") onChange(next);
        }}
        className="flex w-full rounded-full bg-secondary/40 p-1"
      >
        <SegmentedToggleGroupItem
          value="pages"
          aria-label="Pages"
          className={itemClassName}
        >
          <BookOpen className="size-3.5" aria-hidden="true" />
          Pages
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem
          value="scroll"
          aria-label="Scroll"
          className={itemClassName}
        >
          <ScrollText className="size-3.5" aria-hidden="true" />
          Scroll
        </SegmentedToggleGroupItem>
      </SegmentedToggleGroup>
    </div>
  );
}
