import {
  PaperChoices,
  PaperModeTiles,
} from "@/components/appearance/Paper";
import {
  BookStylesRows,
  JustifyRow,
  LineSpacingRow,
  PageSwitchRows,
  ReadingFontChoices,
  TextSizeRow,
} from "@/components/appearance/ReadingControls";
import {
  SettingsGroup,
  SettingsSection,
} from "@/components/appearance/settings-layout";
import { TypeSample } from "@/components/appearance/TypeSample";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SegmentedTabs,
  SegmentedTabsContent,
  SegmentedTabsList,
  SegmentedTabsTrigger,
} from "@/components/ui/segmented-controls";
import type { ReaderSettings } from "@/types/reader.types";
import { cn } from "@/lib/utils";
import { AlignLeft, Palette, Type } from "lucide-react";
import type { ReactNode } from "react";

export type ReaderSettingsPanelTab = "type" | "layout" | "theme";

interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  activeTab: ReaderSettingsPanelTab;
  onActiveTabChange: (tab: ReaderSettingsPanelTab) => void;
  /** Pages or Scroll (Debug mode); shown first in the Layout tab. */
  layoutControl?: ReactNode;
  className?: string;
}

interface ReaderSettingsListProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  /** Pages or Scroll (Debug mode); shown first in the layout section. */
  layoutControl?: ReactNode;
  className?: string;
}

const TAB =
  "h-10 gap-1.5 rounded-full text-[13px] font-medium text-muted-foreground data-[state=active]:text-foreground";

export function ReaderSettingsPanel({
  settings,
  onUpdateSettings,
  activeTab,
  onActiveTabChange,
  layoutControl,
  className,
}: ReaderSettingsPanelProps) {
  return (
    <SegmentedTabs
      value={activeTab}
      onValueChange={(value) =>
        onActiveTabChange(value as ReaderSettingsPanelTab)
      }
      className={cn(
        "mt-3 flex h-[30rem] min-h-0 w-full max-w-full flex-col overflow-x-hidden",
        className,
      )}
    >
      <SegmentedTabsList className="mx-4 mt-1 mb-4 grid h-auto w-auto shrink-0 grid-cols-3 rounded-full bg-secondary/50 p-1">
        <SegmentedTabsTrigger
          value="type"
          className={TAB}
        >
          <Type className="size-4" />
          Type
        </SegmentedTabsTrigger>
        <SegmentedTabsTrigger
          value="layout"
          className={TAB}
        >
          <AlignLeft className="size-4" />
          Page
        </SegmentedTabsTrigger>
        <SegmentedTabsTrigger
          value="theme"
          className={TAB}
        >
          <Palette className="size-4" />
          Paper
        </SegmentedTabsTrigger>
      </SegmentedTabsList>

      {/* This region stays content-sized until the sheet reaches its viewport
          cap, then becomes the scroll container instead of truncating the
          active settings panel at a fixed intermediate height. Controls run
          to the sheet's edge: no fade and no home indicator inset, which
          made the sheet look cramped. */}
      <ScrollArea
        className="min-h-0 w-full max-w-full flex-1 px-4"
        viewportClassName="overflow-x-hidden [mask-image:none] [-webkit-mask-image:none]"
        contentClassName="min-w-0 max-w-full overflow-x-hidden pb-4"
      >
        {/* Type stays short, so the page shows above the sheet while the
            face and size change; the book's own styles go with the page. */}
        <SegmentedTabsContent value="type" className="mt-0">
          <TypeGroup settings={settings} onUpdateSettings={onUpdateSettings} />
        </SegmentedTabsContent>
        <SegmentedTabsContent value="layout" className="mt-0 space-y-5">
          <PageGroup
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            layoutControl={layoutControl}
          />
          <BookStylesGroup
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
        </SegmentedTabsContent>
        <SegmentedTabsContent value="theme" className="mt-0">
          <PaperGroup />
        </SegmentedTabsContent>
      </ScrollArea>
    </SegmentedTabs>
  );
}

interface GroupProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

function PaperGroup() {
  return (
    <SettingsSection compact title="Paper">
      <SettingsGroup compact>
        <div className="py-3">
          <PaperModeTiles compact />
        </div>
        <PaperChoices compact />
      </SettingsGroup>
    </SettingsSection>
  );
}

function TypeGroup({ settings, onUpdateSettings }: GroupProps) {
  return (
    <SettingsSection compact title="Type">
      <SettingsGroup compact>
        <ReadingFontChoices
          compact
          value={settings.fontFamily}
          onChange={(fontFamily) => onUpdateSettings({ fontFamily })}
        />
        <TextSizeRow settings={settings} onUpdateSettings={onUpdateSettings} />
        <LineSpacingRow
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
        <JustifyRow
          compact
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

function PageGroup({
  settings,
  onUpdateSettings,
  layoutControl,
}: GroupProps & { layoutControl?: ReactNode }) {
  return (
    <SettingsSection compact title="Page">
      <SettingsGroup compact>
        {layoutControl}
        <PageSwitchRows
          compact
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

function BookStylesGroup({ settings, onUpdateSettings }: GroupProps) {
  return (
    <SettingsSection compact title="The book's own styles">
      <SettingsGroup compact>
        <BookStylesRows
          compact
          settings={settings}
          onUpdateSettings={onUpdateSettings}
        />
      </SettingsGroup>
    </SettingsSection>
  );
}

/**
 * Desktop settings: a sample page pinned under the tabs, set as the books
 * are, and every setting in one list that scrolls beneath it.
 */
export function ReaderSettingsList({
  settings,
  onUpdateSettings,
  layoutControl,
  className,
}: ReaderSettingsListProps) {
  return (
    <div
      className={cn(
        "flex h-full min-h-0 w-full max-w-full flex-col overflow-x-hidden",
        className,
      )}
    >
      <div className="relative z-10 shrink-0 px-3 pt-1">
        <TypeSample settings={settings} variant="panel" className="h-52" />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-full h-4 bg-gradient-to-b from-background/90 to-transparent"
        />
      </div>
      <ScrollArea
        className="min-h-0 w-full max-w-full flex-1"
        viewportClassName="overflow-x-hidden [mask-image:none] [-webkit-mask-image:none]"
        contentClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        <div className="space-y-5 px-3 pt-4 pb-4">
          <PaperGroup />
          <TypeGroup settings={settings} onUpdateSettings={onUpdateSettings} />
          <PageGroup
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            layoutControl={layoutControl}
          />
          <BookStylesGroup
            settings={settings}
            onUpdateSettings={onUpdateSettings}
          />
        </div>
      </ScrollArea>
    </div>
  );
}
