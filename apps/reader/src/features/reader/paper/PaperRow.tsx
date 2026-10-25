import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import { Switch } from "@/components/ui/switch";
import { useId } from "react";
import { isPaperGrain } from "./paper-grain";
import {
  isPageTurnStyle,
  isPaperInk,
  setPaperPreference,
  usePaperPreference,
  type PaperPreference,
} from "./paper-preference";

const itemClassName =
  "h-9 flex-1 gap-1.5 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[pressed]:text-foreground";
const labelClassName =
  "text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground";

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <label
        htmlFor={id}
        className="cursor-pointer text-sm font-medium text-foreground"
      >
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

/**
 * Appearance row: the page turn, the paper's grain and the turn's feel.
 * Debug mode only while the curl is a prototype; it follows the Reading
 * view row in the Layout tab.
 */
export function PaperRow() {
  const paper = usePaperPreference();
  const update = (change: Partial<PaperPreference>) =>
    setPaperPreference(change);
  return (
    <div className="space-y-3" data-paper-row={paper.pageTurn}>
      <div className="flex items-center gap-2">
        <h4 className={labelClassName}>Page turn</h4>
        <span className="rounded-full border border-border/70 px-1.5 py-px text-[9px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Debug
        </span>
      </div>
      <SegmentedToggleGroup
        aria-label="Page turn"
        value={paper.pageTurn}
        onValueChange={(next) => {
          if (isPageTurnStyle(next)) update({ pageTurn: next });
        }}
        className="flex w-full rounded-full bg-secondary/40 p-1"
      >
        <SegmentedToggleGroupItem value="slide" className={itemClassName}>
          Slide
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem value="curl" className={itemClassName}>
          Curl
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem value="curl-v1" className={itemClassName}>
          First curl
        </SegmentedToggleGroupItem>
      </SegmentedToggleGroup>
      <h4 className={labelClassName}>Paper</h4>
      <SegmentedToggleGroup
        aria-label="Paper"
        value={paper.grain}
        onValueChange={(next) => {
          if (isPaperGrain(next)) update({ grain: next });
        }}
        className="flex w-full rounded-full bg-secondary/40 p-1"
      >
        <SegmentedToggleGroupItem value="off" className={itemClassName}>
          Plain
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem value="fine" className={itemClassName}>
          Fine
        </SegmentedToggleGroupItem>
        <SegmentedToggleGroupItem value="rich" className={itemClassName}>
          Laid
        </SegmentedToggleGroupItem>
      </SegmentedToggleGroup>
      {paper.grain !== "off" && (
        <>
          <h4 className={labelClassName}>Ink</h4>
          <SegmentedToggleGroup
            aria-label="Ink"
            value={paper.ink}
            onValueChange={(next) => {
              if (isPaperInk(next)) update({ ink: next });
            }}
            className="flex w-full rounded-full bg-secondary/40 p-1"
          >
            <SegmentedToggleGroupItem value="on" className={itemClassName}>
              On paper
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem value="in" className={itemClassName}>
              In paper
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem value="gl" className={itemClassName}>
              WebGL
            </SegmentedToggleGroupItem>
          </SegmentedToggleGroup>
        </>
      )}
      {paper.pageTurn !== "slide" && (
        <div className="space-y-3 rounded-[1.25rem] border border-border/50 bg-secondary/20 px-3 py-3">
          <Toggle
            label="Ink shows through"
            checked={paper.showThrough}
            onChange={(showThrough) => update({ showThrough })}
          />
          <Toggle
            label="Haptics"
            checked={paper.haptics}
            onChange={(haptics) => update({ haptics })}
          />
          <Toggle
            label="Paper sound"
            checked={paper.sound}
            onChange={(sound) => update({ sound })}
          />
        </div>
      )}
    </div>
  );
}
