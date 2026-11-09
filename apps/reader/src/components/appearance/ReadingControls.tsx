import { Ribbon } from "@/components/appearance/Ribbon";
import {
  ROW_SEGMENTED_GROUP,
  ROW_SEGMENTED_ITEM,
  SettingsRow,
} from "@/components/appearance/settings-layout";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { Button } from "@/components/ui/button";
import {
  SegmentedToggleGroup,
  SegmentedToggleGroupItem,
} from "@/components/ui/segmented-controls";
import { Switch } from "@/components/ui/switch";
import { READING_FONTS, type FontFamily } from "@/lib/reading-fonts";
import { cn } from "@/lib/utils";
import {
  isJustifiedTextAlign,
  READER_FONT_SIZE_MAX_PX,
  READER_FONT_SIZE_MIN_PX,
  type ReaderSettings,
} from "@/types/reader.types";
import { Minus, Plus } from "lucide-react";
import { useId } from "react";

interface ControlProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

/**
 * Every reading face by name, each set in itself, two to a row. The ribbon
 * marks the one the books are set in. `compact` drops the descriptions.
 */
export function ReadingFontChoices({
  value,
  onChange,
  compact = false,
}: {
  value: FontFamily;
  onChange: (font: FontFamily) => void;
  compact?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Typeface"
      className={cn(
        "grid grid-cols-2",
        compact ? "-mx-2 gap-x-1.5 gap-y-0.5 py-2" : "-mx-2.5 gap-x-3 gap-y-1 py-2.5",
      )}
    >
      {READING_FONTS.map((font) => {
        const selected = value === font.id;
        return (
          <button
            key={font.id}
            type="button"
            aria-label={font.label}
            aria-pressed={selected}
            title={font.description}
            onClick={() => onChange(font.id)}
            className={cn(
              "relative flex min-w-0 cursor-pointer flex-col items-start justify-center rounded-[10px] text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
              compact ? "h-10 pr-2 pl-6" : "py-2 pr-2 pl-[1.625rem]",
              selected ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]",
            )}
          >
            {selected && (
              <Ribbon
                className={
                  compact
                    ? "top-0 left-2 h-[1.375rem] w-2.5"
                    : "top-0 left-2 h-6 w-2.5"
                }
              />
            )}
            <span
              className={cn(
                "max-w-full truncate leading-6",
                compact ? "text-[17px]" : "text-[19px]",
                selected ? "text-foreground" : "text-foreground/80",
              )}
              style={{ fontFamily: font.stack }}
            >
              {font.label}
            </span>
            {!compact && (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {font.description}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TextSizeRow({ settings, onUpdateSettings }: ControlProps) {
  const step = (by: number) =>
    onUpdateSettings({
      fontSize: Math.min(
        READER_FONT_SIZE_MAX_PX,
        Math.max(READER_FONT_SIZE_MIN_PX, settings.fontSize + by),
      ),
    });
  return (
    <SettingsRow label="Text size">
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg bg-foreground/[0.07] hover:bg-foreground/[0.11]"
          onClick={() => step(-1)}
          disabled={settings.fontSize <= READER_FONT_SIZE_MIN_PX}
        >
          <Minus className="size-4" />
          <span className="sr-only">Decrease font size</span>
        </Button>
        <span className="inline-flex w-14 items-baseline justify-center text-sm font-medium text-foreground tabular-nums">
          <span className="inline-flex w-[2ch] justify-center">
            <AnimatedNumber value={settings.fontSize} variant="pop" />
          </span>
          <span className="ml-1">px</span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 rounded-lg bg-foreground/[0.07] hover:bg-foreground/[0.11]"
          onClick={() => step(1)}
          disabled={settings.fontSize >= READER_FONT_SIZE_MAX_PX}
        >
          <Plus className="size-4" />
          <span className="sr-only">Increase font size</span>
        </Button>
      </div>
    </SettingsRow>
  );
}

const LINE_SPACINGS = [1.2, 1.5, 1.8, 2.0];

export function LineSpacingRow({ settings, onUpdateSettings }: ControlProps) {
  return (
    <SettingsRow label="Line spacing">
      <SegmentedToggleGroup
        aria-label="Line spacing"
        value={settings.lineHeight.toString()}
        onValueChange={(value) =>
          value && onUpdateSettings({ lineHeight: parseFloat(value) })
        }
        className={ROW_SEGMENTED_GROUP}
      >
        {LINE_SPACINGS.map((spacing) => (
          <SegmentedToggleGroupItem
            key={spacing}
            value={spacing.toString()}
            className={cn(ROW_SEGMENTED_ITEM, "px-2.5 tabular-nums")}
          >
            {spacing.toFixed(1)}
          </SegmentedToggleGroupItem>
        ))}
      </SegmentedToggleGroup>
    </SettingsRow>
  );
}

function SwitchRow({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <SettingsRow
      label={label}
      description={description}
      htmlFor={id}
      className={disabled ? "opacity-50" : undefined}
    >
      <Switch
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
      />
    </SettingsRow>
  );
}

export function JustifyRow({
  settings,
  onUpdateSettings,
  compact = false,
}: ControlProps & { compact?: boolean }) {
  return (
    <SwitchRow
      label="Justify"
      description={
        compact ? undefined : "Even right edges, with hyphens where a word breaks."
      }
      checked={isJustifiedTextAlign(settings.textAlign)}
      onCheckedChange={(justify) =>
        onUpdateSettings({
          textAlign: justify ? "justify-knuth-plass" : "left",
        })
      }
    />
  );
}

/** Page numbers, running titles and the page-turn animation. */
export function PageSwitchRows({
  settings,
  onUpdateSettings,
  compact = false,
}: ControlProps & { compact?: boolean }) {
  return (
    <>
      <SwitchRow
        label="Page numbers"
        checked={settings.showPageNumbers}
        onCheckedChange={(showPageNumbers) =>
          onUpdateSettings({ showPageNumbers })
        }
      />
      <SwitchRow
        label="Titles on two pages"
        description={
          compact
            ? undefined
            : "The book above the left page, the chapter above the right."
        }
        checked={settings.showRunningTitles}
        onCheckedChange={(showRunningTitles) =>
          onUpdateSettings({ showRunningTitles })
        }
      />
      <SwitchRow
        label="Page animations"
        checked={settings.pageAnimationsEnabled}
        onCheckedChange={(pageAnimationsEnabled) =>
          onUpdateSettings({ pageAnimationsEnabled })
        }
      />
    </>
  );
}

/** The publisher's own styles, and whether they keep the book's text size. */
export function BookStylesRows({
  settings,
  onUpdateSettings,
  compact = false,
}: ControlProps & { compact?: boolean }) {
  return (
    <>
      <SwitchRow
        label="Book styles"
        description={
          compact
            ? "The book's fonts, indents and spacing"
            : "The book's own fonts, indents and spacing, where it sets them."
        }
        checked={settings.publisherBookStylingEnabled}
        onCheckedChange={(publisherBookStylingEnabled) =>
          onUpdateSettings({ publisherBookStylingEnabled })
        }
      />
      <SwitchRow
        label="Match body text size"
        checked={settings.matchPublisherBodyTextSize}
        onCheckedChange={(matchPublisherBodyTextSize) =>
          onUpdateSettings({ matchPublisherBodyTextSize })
        }
        disabled={!settings.publisherBookStylingEnabled}
      />
    </>
  );
}
