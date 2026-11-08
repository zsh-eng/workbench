import {
  ROW_SEGMENTED_GROUP,
  ROW_SEGMENTED_ITEM,
  SettingsRow,
} from "@/components/appearance/settings-layout";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import { BookOpen, ScrollText } from "lucide-react";
import type { ReadingMode } from "./reading-mode-preference";

/**
 * Appearance row: read in pages or in one scrolling column per chapter,
 * like Apple Books' Scrolling View. It leads the Page settings: it changes
 * how the whole book reads, so it comes before the rest of the page.
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
    <div data-reading-layout-row={value}>
      <SettingsRow label="Reading view">
        <SegmentedToggleGroup
          aria-label="Reading view"
          value={value}
          disabled={disabled}
          onValueChange={(next) => {
            if (next === "pages" || next === "scroll") onChange(next);
          }}
          className={ROW_SEGMENTED_GROUP}
        >
          <SegmentedToggleGroupItem
            value="pages"
            aria-label="Pages"
            className={ROW_SEGMENTED_ITEM}
          >
            <BookOpen className="size-3.5" aria-hidden="true" />
            Pages
          </SegmentedToggleGroupItem>
          <SegmentedToggleGroupItem
            value="scroll"
            aria-label="Scroll"
            className={ROW_SEGMENTED_ITEM}
          >
            <ScrollText className="size-3.5" aria-hidden="true" />
            Scroll
          </SegmentedToggleGroupItem>
        </SegmentedToggleGroup>
      </SettingsRow>
    </div>
  );
}
