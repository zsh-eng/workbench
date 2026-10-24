import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { READING_FONTS } from "@/lib/reading-fonts";
import type {
  ContentWidth,
  ReaderSettings,
  TextAlign,
} from "@/types/reader.types";
import {
  isJustifiedTextAlign,
  READER_FONT_SIZE_MAX_PX,
  READER_FONT_SIZE_MIN_PX,
} from "@/types/reader.types";
import {
  Check,
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Plus,
} from "lucide-react";
import { useId } from "react";

interface TypographyPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  section: "type" | "layout";
  showContentWidthControl?: boolean;
}

export function TypographyPanel({
  settings,
  onUpdateSettings,
  section,
  showContentWidthControl = true,
}: TypographyPanelProps) {
  const alignmentValue = isJustifiedTextAlign(settings.textAlign)
    ? "justify"
    : settings.textAlign;
  const sectionLabelClassName =
    "text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground";
  const segmentedGroupClassName = "w-full rounded-full bg-secondary/40 p-1";
  const segmentedItemClassName =
    "h-9 rounded-full text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[state=on]:text-foreground";
  const lineHeights = [1.2, 1.5, 1.8, 2.0];
  const contentWidths: { value: ContentWidth; label: string }[] = [
    { value: "compact", label: "Compact" },
    { value: "narrow", label: "Narrow" },
    { value: "medium", label: "Medium" },
    { value: "wide", label: "Wide" },
    { value: "full", label: "Full" },
  ];
  const publisherStylingSwitchId = useId();
  const publisherBodySizeSwitchId = useId();
  const pageAnimationsSwitchId = useId();
  const pageNumbersSwitchId = useId();

  return (
    <div className="space-y-6 pb-2">
      {section === "layout" && (
        <div className="space-y-3 rounded-[1.25rem] border border-border/50 bg-secondary/20 px-3 py-3">
          <h4 className={sectionLabelClassName}>Reading</h4>
          <div className="flex items-center justify-between gap-4">
            <label
              htmlFor={pageAnimationsSwitchId}
              className="cursor-pointer text-sm font-medium text-foreground"
            >
              Page animations
            </label>
            <Switch
              id={pageAnimationsSwitchId}
              checked={settings.pageAnimationsEnabled}
              onCheckedChange={(pageAnimationsEnabled) =>
                onUpdateSettings({ pageAnimationsEnabled })
              }
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <label
              htmlFor={pageNumbersSwitchId}
              className="cursor-pointer text-sm font-medium text-foreground"
            >
              Page numbers
            </label>
            <Switch
              id={pageNumbersSwitchId}
              checked={settings.showPageNumbers}
              onCheckedChange={(showPageNumbers) =>
                onUpdateSettings({ showPageNumbers })
              }
            />
          </div>
        </div>
      )}

      {section === "type" && (
        <div className="space-y-2.5">
          <h4 className={sectionLabelClassName}>Font family</h4>
          {/* Every face shows at once: serifs and Mono, then the sans. */}
          <div className="grid grid-cols-4 gap-1.5">
            {READING_FONTS.map((font) => {
              const isSelected = settings.fontFamily === font.id;
              return (
                <button
                  key={font.id}
                  type="button"
                  aria-label={font.label}
                  aria-pressed={isSelected}
                  title={font.description}
                  onClick={() => onUpdateSettings({ fontFamily: font.id })}
                  className={cn(
                    "relative flex h-[4.5rem] min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-[1rem] border px-1 transition-[background-color,border-color,opacity,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] active:scale-[0.98] motion-reduce:active:scale-100 motion-reduce:active:opacity-80",
                    isSelected
                      ? "border-border bg-background ring-1 ring-border/70"
                      : "border-border/40 bg-secondary/20 hover:bg-secondary/35",
                  )}
                >
                  {isSelected && (
                    <Check
                      className="absolute right-2 top-2 size-3 text-foreground"
                      aria-hidden="true"
                    />
                  )}
                  <span
                    className="text-[1.625rem] leading-none text-foreground"
                    style={{ fontFamily: font.stack }}
                    aria-hidden="true"
                  >
                    Aa
                  </span>
                  <span
                    className={cn(
                      "max-w-full truncate text-[11px] font-medium",
                      isSelected ? "text-foreground" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  >
                    {font.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {section === "layout" && (
        <div className="space-y-2">
          <h4 className={sectionLabelClassName}>Line height</h4>
          <div className="flex items-center gap-2">
            <MoveVertical className="h-4 w-4 text-muted-foreground" />
            <SegmentedToggleGroup
              value={settings.lineHeight.toString()}
              onValueChange={(value) =>
                value && onUpdateSettings({ lineHeight: parseFloat(value) })
              }
              className={cn("flex-1", segmentedGroupClassName)}
            >
              {lineHeights.map((lh) => (
                <SegmentedToggleGroupItem
                  key={lh}
                  value={lh.toString()}
                  className={cn("flex-1 text-xs", segmentedItemClassName)}
                >
                  {lh}
                </SegmentedToggleGroupItem>
              ))}
            </SegmentedToggleGroup>
          </div>
        </div>
      )}

      {section === "layout" && showContentWidthControl && (
        <div className="space-y-2 hidden sm:block">
          <h4 className={sectionLabelClassName}>Content width</h4>
          {/* Paginated mode keeps measure automatic; this stays available for scroll layouts. */}
          <div className="flex items-center gap-2">
            <MoveHorizontal className="h-4 w-4 text-muted-foreground" />
            <SegmentedToggleGroup
              value={settings.contentWidth}
              onValueChange={(value) =>
                value &&
                onUpdateSettings({ contentWidth: value as ContentWidth })
              }
              className={cn("flex-1", segmentedGroupClassName)}
            >
              {contentWidths.map((width) => (
                <SegmentedToggleGroupItem
                  key={width.value}
                  value={width.value}
                  className={cn("flex-1 text-[10px]", segmentedItemClassName)}
                >
                  {width.label}
                </SegmentedToggleGroupItem>
              ))}
            </SegmentedToggleGroup>
          </div>
        </div>
      )}

      {section === "layout" && (
        <div className="space-y-2">
          <h4 className={sectionLabelClassName}>Alignment</h4>
          <SegmentedToggleGroup
            value={alignmentValue}
            onValueChange={(value) =>
              value &&
              onUpdateSettings({
                textAlign:
                  value === "justify"
                    ? "justify-knuth-plass"
                    : (value as Exclude<TextAlign, "justify-knuth-plass">),
              })
            }
            className={segmentedGroupClassName}
          >
            <SegmentedToggleGroupItem
              aria-label="Left"
              value="left"
              className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
            >
              <AlignLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Left</span>
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem
              aria-label="Center"
              value="center"
              className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
            >
              <AlignCenter className="h-4 w-4" />
              <span className="hidden sm:inline">Center</span>
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem
              aria-label="Right"
              value="right"
              className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
            >
              <AlignRight className="h-4 w-4" />
              <span className="hidden sm:inline">Right</span>
            </SegmentedToggleGroupItem>
            <SegmentedToggleGroupItem
              aria-label="Justify"
              value="justify"
              className={cn("flex-1 gap-1 text-[10px]", segmentedItemClassName)}
            >
              <AlignJustify className="h-4 w-4" />
              <span className="hidden sm:inline">Justify</span>
            </SegmentedToggleGroupItem>
          </SegmentedToggleGroup>
        </div>
      )}

      {section === "type" && (
        <div className="space-y-3 rounded-[1.25rem] border border-border/50 bg-secondary/20 px-3 py-3">
          <h4 className={sectionLabelClassName}>Publisher styling</h4>
          <label
            htmlFor={publisherStylingSwitchId}
            className="flex cursor-pointer items-center justify-between gap-4"
          >
            <span className="text-sm font-medium text-foreground">
              Book styles
            </span>
            <Switch
              id={publisherStylingSwitchId}
              checked={settings.publisherBookStylingEnabled}
              onCheckedChange={(publisherBookStylingEnabled) =>
                onUpdateSettings({ publisherBookStylingEnabled })
              }
              aria-label="Toggle publisher book styling"
            />
          </label>
          <label
            htmlFor={publisherBodySizeSwitchId}
            className={cn(
              "flex items-center justify-between gap-4",
              settings.publisherBookStylingEnabled
                ? "cursor-pointer"
                : "cursor-not-allowed opacity-50",
            )}
          >
            <span className="text-sm font-medium text-foreground">
              Match body text size
            </span>
            <Switch
              id={publisherBodySizeSwitchId}
              checked={settings.matchPublisherBodyTextSize}
              onCheckedChange={(matchPublisherBodyTextSize) =>
                onUpdateSettings({ matchPublisherBodyTextSize })
              }
              disabled={!settings.publisherBookStylingEnabled}
              aria-label="Toggle matched publisher body text size"
            />
          </label>
        </div>
      )}

      {section === "type" && (
        <div className="space-y-2">
          <h4 className={sectionLabelClassName}>Font size</h4>
          <div className="flex items-center justify-between rounded-[1.25rem] border border-border/50 bg-secondary/20 px-3 py-3">
            <Button
              variant="outline"
              size="icon"
              className="rounded-full border-border/60 bg-background/80 hover:bg-background"
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.max(
                    READER_FONT_SIZE_MIN_PX,
                    settings.fontSize - 1,
                  ),
                })
              }
              disabled={settings.fontSize <= READER_FONT_SIZE_MIN_PX}
            >
              <Minus className="h-4 w-4" />
              <span className="sr-only">Decrease font size</span>
            </Button>
            <span className="inline-flex min-w-[4rem] items-baseline justify-center text-sm font-medium uppercase tracking-[0.12em] text-foreground font-numeric tabular-nums">
              <span className="inline-flex w-[2ch] justify-center">
                <AnimatedNumber value={settings.fontSize} variant="pop" />
              </span>
              <span className="ml-0.5 shrink-0">px</span>
            </span>
            <Button
              variant="outline"
              size="icon"
              className="rounded-full border-border/60 bg-background/80 hover:bg-background"
              onClick={() =>
                onUpdateSettings({
                  fontSize: Math.min(
                    READER_FONT_SIZE_MAX_PX,
                    settings.fontSize + 1,
                  ),
                })
              }
              disabled={settings.fontSize >= READER_FONT_SIZE_MAX_PX}
            >
              <Plus className="h-4 w-4" />
              <span className="sr-only">Increase font size</span>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
