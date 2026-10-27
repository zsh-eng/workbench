import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import {
  getReaderTablesEnabled,
  setReaderTablesPreference,
  useReaderTablesPreference,
} from "./tables-preference";

const itemClassName =
  "h-9 flex-1 gap-1.5 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[pressed]:text-foreground";
const labelClassName =
  "text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground";

/**
 * Appearance → Layout row (Debug mode only): tables as one paragraph, as
 * before, or as a real grid. The choice changes how chapters parse, so the
 * Reader opens again with it, without a `?tables=` that would override it.
 */
export function TablesRow() {
  useReaderTablesPreference();
  // What the Reader shows, `?tables=` included.
  const grid = getReaderTablesEnabled();
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
        value={grid ? "grid" : "flat"}
        onValueChange={(next) => {
          const enabled = next === "grid";
          if (enabled === grid) return;
          setReaderTablesPreference(enabled);
          const url = new URL(window.location.href);
          if (url.searchParams.has("tables")) {
            url.searchParams.delete("tables");
            window.location.replace(url.href);
          } else window.location.reload();
        }}
        className="flex w-full rounded-full bg-secondary/40 p-1"
      >
        <SegmentedToggleGroupItem value="flat" className={itemClassName}>
          Paragraph
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem value="grid" className={itemClassName}>
          Grid
        </SegmentedToggleGroupItem>
      </SegmentedToggleGroup>
    </div>
  );
}
