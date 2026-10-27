import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import type { ReaderTablesMode } from "./data/chapter-tables";
import {
  getReaderTablesMode,
  setReaderTablesPreference,
  useReaderTablesPreference,
} from "./tables-preference";

const itemClassName =
  "h-9 flex-1 gap-1.5 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[pressed]:text-foreground";
const labelClassName =
  "text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground";

const MODES: { value: ReaderTablesMode; label: string }[] = [
  { value: "auto", label: "Auto" },
  { value: "grid", label: "Grid" },
  { value: "flat", label: "Paragraph" },
];

/**
 * Appearance → Layout row (Debug mode only): Auto reads tables as grids in
 * chapters up to a cell limit, Grid and Paragraph read every chapter's
 * tables one way. The choice changes how chapters parse, so the Reader
 * opens again with it, without a `?tables=` that would override it.
 */
export function TablesRow() {
  useReaderTablesPreference();
  // What the Reader shows, `?tables=` included.
  const mode = getReaderTablesMode();
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h4 className={labelClassName}>Tables</h4>
        <span className="rounded-full border border-border/70 px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Debug
        </span>
      </div>
      <SegmentedToggleGroup
        aria-label="Tables"
        value={mode}
        onValueChange={(next) => {
          const chosen = MODES.find((option) => option.value === next)?.value;
          if (!chosen || chosen === mode) return;
          setReaderTablesPreference(chosen);
          const url = new URL(window.location.href);
          if (url.searchParams.has("tables")) {
            url.searchParams.delete("tables");
            window.location.replace(url.href);
          } else window.location.reload();
        }}
        className="flex w-full rounded-full bg-secondary/40 p-1"
      >
        {MODES.map((option) => (
          <SegmentedToggleGroupItem
            key={option.value}
            value={option.value}
            className={itemClassName}
          >
            {option.label}
          </SegmentedToggleGroupItem>
        ))}
      </SegmentedToggleGroup>
    </div>
  );
}
