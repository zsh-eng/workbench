import { ThemePanel } from "@/features/reader/shared/ReaderSettings/ThemePanel";
import { TypographyPanel } from "@/features/reader/shared/ReaderSettings/TypographyPanel";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  SegmentedTabs,
  SegmentedTabsContent,
  SegmentedTabsList,
  SegmentedTabsTrigger,
} from "@/components/ui/segmented-controls";
import type { ReaderSettings } from "@/types/reader.types";
import { cn } from "@/lib/utils";
import { AlignLeft, ChevronLeft, Palette, Type } from "lucide-react";
import { useState, type ReactNode } from "react";
import { ReaderSheet } from "./shared/ReaderSheet";

export type ReaderSettingsPanelTab = "type" | "layout" | "theme";

interface ReaderSettingsPanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  activeTab: ReaderSettingsPanelTab;
  onActiveTabChange: (tab: ReaderSettingsPanelTab) => void;
  /** Pages or Scroll (Debug mode); shown above every tab. */
  layoutControl?: ReactNode;
  className?: string;
}

interface ReaderSettingsListProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  /** Pages or Scroll (Debug mode); shown first. */
  layoutControl?: ReactNode;
  className?: string;
}

interface ReaderSettingsSheetProps {
  isOpen: boolean;
  onClose: () => void;
  onBack: () => void;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

export function ReaderSettingsSheet({
  isOpen,
  onClose,
  onBack,
  settings,
  onUpdateSettings,
}: ReaderSettingsSheetProps) {
  const [activeTab, setActiveTab] = useState<ReaderSettingsPanelTab>("type");

  return (
    <ReaderSheet
      open={isOpen}
      onOpenChange={(open) => {
        if (open) {
          return;
        }

        onClose();
      }}
      title="Reading settings"
      panelClassName="max-w-md"
      bodyClassName="w-full max-w-full overflow-hidden"
      header={
        <div className="flex h-8 items-center">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onBack}
            aria-label="Back to reader tools"
            className="size-8 rounded-full border border-border/60 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          >
            <ChevronLeft className="size-4" />
          </Button>
        </div>
      }
    >
      <ReaderSettingsPanel
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        activeTab={activeTab}
        onActiveTabChange={setActiveTab}
      />
    </ReaderSheet>
  );
}

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
      {layoutControl && <div className="mx-4 mb-4">{layoutControl}</div>}
      <SegmentedTabsList className="mx-4 mb-3 grid h-auto grid-cols-3 rounded-full bg-secondary/50 p-1 self-center">
        <SegmentedTabsTrigger
          value="type"
          className="h-10 gap-1.5 rounded-full text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[state=active]:text-foreground"
        >
          <Type className="size-4" />
          Type
        </SegmentedTabsTrigger>
        <SegmentedTabsTrigger
          value="layout"
          className="h-10 gap-1.5 rounded-full text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[state=active]:text-foreground"
        >
          <AlignLeft className="size-4" />
          Layout
        </SegmentedTabsTrigger>
        <SegmentedTabsTrigger
          value="theme"
          className="h-10 gap-1.5 rounded-full text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground data-[state=active]:text-foreground"
        >
          <Palette className="size-4" />
          Theme
        </SegmentedTabsTrigger>
      </SegmentedTabsList>

      {/* This region stays content-sized until the sheet reaches its viewport
          cap, then becomes the scroll container instead of truncating the
          active settings panel at a fixed intermediate height. */}
      <ScrollArea
        className="min-h-0 w-full max-w-full flex-1 px-4 pb-3"
        viewportClassName="overflow-x-hidden"
        contentClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        <SegmentedTabsContent value="type" className="mt-0">
          <TypographyPanel
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            section="type"
            showContentWidthControl={false}
          />
        </SegmentedTabsContent>
        <SegmentedTabsContent value="layout" className="mt-0">
          <TypographyPanel
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            section="layout"
            showContentWidthControl={false}
          />
        </SegmentedTabsContent>
        <SegmentedTabsContent value="theme" className="mt-0">
          <ThemePanel settings={settings} onUpdateSettings={onUpdateSettings} />
        </SegmentedTabsContent>
      </ScrollArea>
    </SegmentedTabs>
  );
}

/** Desktop settings use one continuous list because the sidebar has height. */
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
      <ScrollArea
        className="min-h-0 w-full max-w-full flex-1"
        viewportClassName="overflow-x-hidden [mask-image:none] [-webkit-mask-image:none]"
        contentClassName="min-w-0 max-w-full overflow-x-hidden"
      >
        <div className="space-y-7 px-4 py-3">
          {layoutControl}
          <TypographyPanel
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            section="type"
            showContentWidthControl={false}
          />
          <div className="h-px bg-border/60" aria-hidden="true" />
          <TypographyPanel
            settings={settings}
            onUpdateSettings={onUpdateSettings}
            section="layout"
            showContentWidthControl={false}
          />
          <div className="h-px bg-border/60" aria-hidden="true" />
          <ThemePanel settings={settings} onUpdateSettings={onUpdateSettings} />
        </div>
      </ScrollArea>
    </div>
  );
}
