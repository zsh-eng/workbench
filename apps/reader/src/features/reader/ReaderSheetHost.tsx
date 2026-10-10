import { useState, type ReactNode, type RefObject } from "react";
import type { Book, TOCItem } from "@/lib/db";
import type { ReaderSettings } from "@/types/reader.types";
import { ReaderContentsPanel } from "./ReaderContentsSheet";
import { ReaderBookActionsSheet } from "./ReaderBookActionsSheet";
import {
  ReaderSettingsPanel,
  type ReaderSettingsPanelTab,
} from "./ReaderSettingsSheet";
import { ReaderControlMenu } from "./ReaderControlMenu";
import { SlidingSheet } from "@/components/SlidingSheet";
import { ReaderToolsSidebar } from "./ReaderToolsSidebar";
import type { ChapterEntry, ReaderSheetId } from "./types";

interface ReaderSheetHostProps {
  isMobile: boolean;
  activeSheet: ReaderSheetId | null;
  onOpenSheet: (sheet: ReaderSheetId) => void;
  onCloseSheet: () => void;
  book: Book;
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
  toc: TOCItem[];
  chapterEntries: ChapterEntry[];
  chapterStartPages: (number | null)[];
  currentChapterHref: string;
  onNavigateToHref: (href: string) => boolean;
  notesPanel?: ReactNode;
  highlightsPanel?: ReactNode;
  onCopyDebugDump?: () => void;
  /** The desktop header control that opens the tools sidebar. */
  toolsTriggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Coordinates the reader's peer-level overlays.
 *
 * Mobile pages share one fixed-height sheet. Desktop tools share one
 * right-side workspace so contents and appearance stay beside the book.
 */
export function ReaderSheetHost({
  isMobile,
  activeSheet,
  onOpenSheet,
  onCloseSheet,
  book,
  settings,
  onUpdateSettings,
  toc,
  chapterEntries,
  chapterStartPages,
  currentChapterHref,
  onNavigateToHref,
  onCopyDebugDump,
  notesPanel,
  highlightsPanel,
  toolsTriggerRef,
}: ReaderSheetHostProps) {
  const [settingsTab, setSettingsTab] =
    useState<ReaderSettingsPanelTab>("theme");
  if (!isMobile) {
    return (
      <ReaderToolsSidebar
        activeSheet={activeSheet}
        onOpenPanel={onOpenSheet}
        onClose={onCloseSheet}
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        toc={toc}
        chapterEntries={chapterEntries}
        chapterStartPages={chapterStartPages}
        currentChapterHref={currentChapterHref}
        onNavigateToHref={onNavigateToHref}
        notesPanel={notesPanel}
        highlightsPanel={highlightsPanel}
        onCopyDebugDump={onCopyDebugDump}
        triggerRef={toolsTriggerRef}
      />
    );
  }

  const page = activeSheet ?? "tools";
  const titles: Record<string, string> = {
    tools: "Reader tools",
    contents: "Contents",
    settings: "Reading settings",
    "book-actions": "Reading status",
    notes: "Notebook",
  };
  return (
    <SlidingSheet
      open={activeSheet !== null}
      onClose={onCloseSheet}
      page={page}
      rootPage="tools"
      title={titles[page] ?? "Reader tools"}
      onBack={() => onOpenSheet("tools")}
    >
      {page === "tools" && (
        <ReaderControlMenu
          onOpenContents={() => onOpenSheet("contents")}
          onOpenBookActions={() => onOpenSheet("book-actions")}
          onOpenSettings={() => onOpenSheet("settings")}
          onOpenNotes={() => onOpenSheet("notes")}
          onCopyDebugDump={onCopyDebugDump}
        />
      )}
      {page === "book-actions" && (
        <ReaderBookActionsSheet
          embedded
          isOpen
          onClose={onCloseSheet}
          onBack={() => onOpenSheet("tools")}
          book={book}
        />
      )}
      {page === "contents" && (
        <ReaderContentsPanel
          isOpen
          toc={toc}
          chapterEntries={chapterEntries}
          chapterStartPages={chapterStartPages}
          currentChapterHref={currentChapterHref}
          onNavigateToHref={onNavigateToHref}
          className="h-full"
        />
      )}
      {page === "settings" && (
        <ReaderSettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          activeTab={settingsTab}
          onActiveTabChange={setSettingsTab}
          className="mt-0 h-full"
        />
      )}
      {page === "notes" && notesPanel}
    </SlidingSheet>
  );
}
