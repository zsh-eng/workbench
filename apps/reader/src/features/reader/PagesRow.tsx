import {
  ROW_SEGMENTED_GROUP,
  ROW_SEGMENTED_ITEM,
  SettingsRow,
} from "@/components/appearance/settings-layout";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import type { TwoPagesFit } from "./hooks/use-paginated-reader-layout";
import {
  setPagesPreference,
  usePagesPreference,
  type PagesPreference,
} from "./pages-preference";

const OPTIONS: { value: PagesPreference; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "one", label: "One" },
  { value: "two", label: "Two" },
];

const FALLBACK_REASON: Record<Exclude<TwoPagesFit, "fits">, string> = {
  "too-narrow": "One page for now: the window is too narrow for two.",
  "too-short": "One page for now: the window is too short for two.",
};

/**
 * Appearance → Page row, in paginated mode: Auto shows two pages where
 * each has room (a landscape tablet, a wide window), One and Two choose.
 * In the Reader, Two falls back to one page where two cannot fit, and says
 * why; Settings, away from a book, says what Auto does.
 */
export function PagesRow({
  twoPages,
  description,
}: {
  twoPages?: TwoPagesFit;
  description?: string;
}) {
  const value = usePagesPreference();
  const fallback =
    value === "two" && twoPages && twoPages !== "fits"
      ? FALLBACK_REASON[twoPages]
      : undefined;
  return (
    <div data-pages-row={value}>
      <SettingsRow label="Pages" description={fallback ?? description}>
        <SegmentedToggleGroup
          aria-label="Pages"
          value={value}
          onValueChange={(next) => {
            const chosen = OPTIONS.find((option) => option.value === next);
            if (chosen) setPagesPreference(chosen.value);
          }}
          className={ROW_SEGMENTED_GROUP}
        >
          {OPTIONS.map((option) => (
            <SegmentedToggleGroupItem
              key={option.value}
              value={option.value}
              className={ROW_SEGMENTED_ITEM}
            >
              {option.label}
            </SegmentedToggleGroupItem>
          ))}
        </SegmentedToggleGroup>
      </SettingsRow>
    </div>
  );
}
