import { useState, type ReactNode, type RefObject } from "react";
import type { Book, TOCItem } from "@/lib/db";
import type { ReaderSettings } from "@/types/reader.types";
import { ReaderContentsPanel } from "./ReaderContentsSheet";
import { ReaderBookActionsSheet } from "./ReaderBookActionsSheet";
import {
  ReaderSettingsPanel,
  type ReaderSettingsPanelTab,
} from "./ReaderSettingsSheet";
import { ReaderDetentSheets } from "./ReaderDetentSheets";
import { useDetentSheetsEnabled } from "@/lib/detent-sheets-preference";
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
  /** Book search, for the sidebar or a phone sheet page. */
  searchPanel?: ReactNode;
  /** Pages or Scroll (Debug mode), for the reading settings. */
  layoutControl?: ReactNode;
  onCopyDebugDump?: () => void;
  /** The desktop header control that opens the tools sidebar. */
  toolsTriggerRef: RefObject<HTMLButtonElement | null>;
}

/**
 * Coordinates the reader's peer-level overlays.
 *
 * Mobile pages share one fixed-height sheet, or detent sheets when that
 * trial is on in Settings. Desktop tools share one right-side workspace so
 * contents and appearance stay beside the book.
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
  searchPanel,
  layoutControl,
  toolsTriggerRef,
}: ReaderSheetHostProps) {
  const [settingsTab, setSettingsTab] =
    useState<ReaderSettingsPanelTab>("type");
  const detentSheets = useDetentSheetsEnabled();
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
        searchPanel={searchPanel}
        layoutControl={layoutControl}
        onCopyDebugDump={onCopyDebugDump}
        triggerRef={toolsTriggerRef}
      />
    );
  }

  const renderPage = (page: ReaderSheetId, detents: boolean) => (
    <>
      {page === "tools" && (
        <ReaderControlMenu
          onOpenContents={() => onOpenSheet("contents")}
          onOpenBookActions={() => onOpenSheet("book-actions")}
          onOpenSettings={() => onOpenSheet("settings")}
          onOpenNotes={() => onOpenSheet("notes")}
          onOpenSearch={searchPanel ? () => onOpenSheet("search") : undefined}
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
          className={detents ? "min-h-0 flex-1" : "h-full"}
        />
      )}
      {page === "settings" && (
        <ReaderSettingsPanel
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          activeTab={settingsTab}
          onActiveTabChange={setSettingsTab}
          layoutControl={layoutControl}
          // A detent sheet fits the tab; the shared sheet has a fixed height.
          className={detents ? "mt-0 h-auto" : "mt-0 h-full"}
        />
      )}
      {page === "notes" && notesPanel}
      {page === "search" && searchPanel}
    </>
  );

  if (detentSheets) {
    return (
      <ReaderDetentSheets
        activeSheet={activeSheet}
        onOpenSheet={onOpenSheet}
        onCloseSheet={onCloseSheet}
        renderPage={(page) => renderPage(page, true)}
      />
    );
  }

  const page = activeSheet ?? "tools";
  const titles: Record<string, string> = {
    tools: "Reader tools",
    contents: "Contents",
    settings: "Appearance",
    "book-actions": "Reading status",
    notes: "Notebook",
    search: "Search book",
  };
  return (
    <SlidingSheet
      open={activeSheet !== null}
      onClose={onCloseSheet}
      page={page}
      rootPage="tools"
      title={titles[page] ?? "Reader tools"}
      onBack={() => onOpenSheet("tools")}
      safeAreaBottom={page !== "settings"}
    >
      {renderPage(page, false)}
    </SlidingSheet>
  );
}
