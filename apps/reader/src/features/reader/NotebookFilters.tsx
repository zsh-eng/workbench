import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";

export type NotebookKindFilter = "all" | "notes" | "highlights";

/** Notebook filters: entry type, and any number of highlight colours. No
 * colour selected shows every colour. */
export function NotebookFilters({
  kind,
  colors,
  onKindChange,
  onColorsChange,
}: {
  kind: NotebookKindFilter;
  colors: HighlightColor[];
  onKindChange: (kind: NotebookKindFilter) => void;
  onColorsChange: (colors: HighlightColor[]) => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 pb-2">
      <SegmentedToggleGroup
        aria-label="Show"
        value={kind}
        onValueChange={(value) => {
          if (value) onKindChange(value as NotebookKindFilter);
        }}
        className="h-8 rounded-full bg-secondary/50 p-0.5"
      >
        {(
          [
            ["all", "All"],
            ["notes", "Notes"],
            ["highlights", "Highlights"],
          ] as const
        ).map(([value, label]) => (
          <SegmentedToggleGroupItem
            key={value}
            value={value}
            // Distinct from the sidebar's Notes and Highlights tabs.
            aria-label={`Show ${label.toLowerCase()}`}
            className="h-7 rounded-full px-3 text-xs font-medium text-muted-foreground data-[pressed]:text-foreground"
          >
            {label}
          </SegmentedToggleGroupItem>
        ))}
      </SegmentedToggleGroup>
      <div
        role="group"
        aria-label="Filter by colour"
        className="ml-auto flex items-center gap-3"
      >
        {HIGHLIGHT_COLORS.map(({ name }) => {
          const selected = colors.includes(name);
          return (
            <button
              key={name}
              type="button"
              aria-label={`Only ${name}`}
              aria-pressed={selected}
              onClick={() =>
                onColorsChange(
                  selected
                    ? colors.filter((color) => color !== name)
                    : [...colors, name],
                )
              }
              className={cn(
                // The pseudo element widens the touch target to 30 px.
                "relative size-[18px] shrink-0 rounded-full before:absolute before:-inset-1.5 before:content-[''] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] transition-opacity duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                "after:pointer-events-none after:absolute after:-inset-[3px] after:rounded-full after:border-[1.5px] after:border-foreground/70 after:opacity-0 after:transition-opacity after:duration-150",
                selected && "after:opacity-100",
                colors.length > 0 && !selected && "opacity-40",
              )}
              style={{ backgroundColor: `var(--${name}-secondary)` }}
            />
          );
        })}
      </div>
    </div>
  );
}
