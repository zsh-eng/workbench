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

const itemClassName =
  "h-9 flex-1 gap-1.5 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[pressed]:text-foreground";

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
 * Appearance → Layout row, in paginated mode: Auto shows two pages where
 * each has room (a landscape tablet, a wide window), One and Two choose.
 * Two falls back to one page where two cannot fit, and says why.
 */
export function PagesRow({ twoPages }: { twoPages: TwoPagesFit }) {
  const value = usePagesPreference();
  return (
    <div className="space-y-2" data-pages-row={value}>
      <h4 className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Pages
      </h4>
      <SegmentedToggleGroup
        aria-label="Pages"
        value={value}
        onValueChange={(next) => {
          const chosen = OPTIONS.find((option) => option.value === next);
          if (chosen) setPagesPreference(chosen.value);
        }}
        className="flex w-full rounded-full bg-secondary/40 p-1"
      >
        {OPTIONS.map((option) => (
          <SegmentedToggleGroupItem
            key={option.value}
            value={option.value}
            className={itemClassName}
          >
            {option.label}
          </SegmentedToggleGroupItem>
        ))}
      </SegmentedToggleGroup>
      {value === "two" && twoPages !== "fits" && (
        <p className="text-xs text-muted-foreground">
          {FALLBACK_REASON[twoPages]}
        </p>
      )}
    </div>
  );
}
