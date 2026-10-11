import {
  BookStatusPanel,
  READING_STATUS_LABELS,
} from "@/components/BookStatusSheet";
import { SlidingSheet } from "@/components/SlidingSheet";
import { NotebookNote } from "@/features/reader/NotebookNote";
import { ReaderContentsPanel } from "@/features/reader/ReaderContentsSheet";
import { ReaderControlMenu } from "@/features/reader/ReaderControlMenu";
import {
  READER_SHEET_PAGES,
  ReaderDetentSheets,
} from "@/features/reader/ReaderDetentSheets";
import { ReaderHeader } from "@/features/reader/ReaderHeader";
import {
  ReaderSettingsList,
  ReaderSettingsPanel,
  type ReaderSettingsPanelTab,
} from "@/features/reader/ReaderSettingsSheet";
import type { ReaderSheetId } from "@/features/reader/types";
import type { ReadingStatus } from "@/lib/db";
import { FONT_STACKS, type ReaderSettings } from "@/types/reader.types";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  SAMPLE_CHAPTER_ENTRIES,
  SAMPLE_CHAPTER_START_PAGES,
  SAMPLE_HIGHLIGHTS,
  SAMPLE_TOC,
} from "./sample-book-fixture";
import { SAMPLE_BOOK_TITLE, SamplePage } from "./SamplePage";

export const SHEET_STATES = [
  { id: "tools", label: "Reader tools" },
  { id: "contents", label: "Contents" },
  { id: "settings", label: "Appearance" },
  { id: "book-actions", label: "Reading status" },
  { id: "notes", label: "Notebook" },
] as const;

export type SheetVariant = "now" | "detents";

const SAMPLE_SETTINGS: ReaderSettings = {
  fontSize: 17,
  lineHeight: 1.6,
  fontFamily: "lora",
  theme: "light",
  textAlign: "left",
  contentWidth: "narrow",
  publisherBookStylingEnabled: false,
  matchPublisherBodyTextSize: false,
  pageAnimationsEnabled: true,
  showPageNumbers: true,
};

/** Time for a sheet to close, then for the tools to settle before a page. */
const CLOSE_MS = 350;
const STACK_MS = 900;

function variantFromUrl(): SheetVariant {
  return new URLSearchParams(location.search).get("variant") === "now"
    ? "now"
    : "detents";
}

/**
 * The phone Reader's sheets on a still page, with the real panels on a
 * sample book. "now" is the shipped fixed-height sheet; "detents" is React
 * Aria's Sheet. Each choice opens Reader tools, then the page, as a reader
 * would. Settings change the sample page; nothing is saved.
 */
export function SheetsSpecimen({
  state,
  nonce,
}: {
  state: string;
  nonce: number;
}) {
  const [variant] = useState(variantFromUrl);
  const [active, setActive] = useState<ReaderSheetId | null>(null);
  const [settings, setSettings] = useState(SAMPLE_SETTINGS);
  const [settingsTab, setSettingsTab] =
    useState<ReaderSettingsPanelTab>("type");
  const [status, setStatus] = useState<ReadingStatus | null>("reading");
  const [chapterHref, setChapterHref] = useState(
    SAMPLE_CHAPTER_ENTRIES[1].href,
  );

  useEffect(() => {
    setActive(null);
    const page = state as ReaderSheetId;
    const timers = [window.setTimeout(() => setActive("tools"), CLOSE_MS)];
    if (page !== "tools")
      timers.push(
        window.setTimeout(() => setActive(page), CLOSE_MS + STACK_MS),
      );
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [state, nonce]);

  const update = (next: Partial<ReaderSettings>) =>
    setSettings((value) => ({ ...value, ...next }));

  const renderPage = (page: ReaderSheetId) => {
    switch (page) {
      case "tools":
        return (
          <ReaderControlMenu
            onOpenContents={() => setActive("contents")}
            onOpenBookActions={() => setActive("book-actions")}
            onOpenSettings={() => setActive("settings")}
            onOpenNotes={() => setActive("notes")}
          />
        );
      case "contents":
        return (
          <ReaderContentsPanel
            isOpen={active === "contents"}
            toc={SAMPLE_TOC}
            chapterEntries={SAMPLE_CHAPTER_ENTRIES}
            chapterStartPages={SAMPLE_CHAPTER_START_PAGES}
            currentChapterHref={chapterHref}
            onNavigateToHref={(href) => {
              setChapterHref(href);
              setActive(null);
              return true;
            }}
            className="min-h-0 flex-1"
          />
        );
      case "settings":
        return variant === "detents" ? (
          <ReaderSettingsList
            settings={settings}
            onUpdateSettings={update}
            className="min-h-0 flex-1"
          />
        ) : (
          <ReaderSettingsPanel
            settings={settings}
            onUpdateSettings={update}
            activeTab={settingsTab}
            onActiveTabChange={setSettingsTab}
            className="mt-0 h-full"
          />
        );
      case "book-actions":
        return (
          <BookStatusPanel
            bookTitle={SAMPLE_BOOK_TITLE}
            bookAuthor="Lewis Carroll"
            coverUrl={undefined}
            status={status}
            isUpdating={false}
            onSelectStatus={(next) => {
              setStatus(next);
              toast.success(`Marked as ${READING_STATUS_LABELS[next]}`);
            }}
            onRemove={() => false}
            onOpenChange={(open) => {
              if (!open) setActive(null);
            }}
          />
        );
      case "notes":
        return <SampleNotebook />;
    }
  };

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-background">
      <SamplePage
        typography={{
          fontSize: settings.fontSize,
          lineHeight: settings.lineHeight,
          fontFamily: FONT_STACKS[settings.fontFamily],
        }}
      />
      <ReaderHeader
        chromeVisible
        bookTitle={SAMPLE_BOOK_TITLE}
        isMobile
        onBackToLibrary={() => {}}
        isMenuOpen={active !== null}
        onOpenMenu={() => setActive("tools")}
      />
      {variant === "detents" ? (
        <ReaderDetentSheets
          activeSheet={active}
          onOpenSheet={setActive}
          onCloseSheet={() => setActive(null)}
          renderPage={renderPage}
        />
      ) : (
        <SlidingSheet
          open={active !== null}
          onClose={() => setActive(null)}
          page={active ?? "tools"}
          rootPage="tools"
          title={READER_SHEET_PAGES[active ?? "tools"].title}
          onBack={() => setActive("tools")}
        >
          {renderPage(active ?? "tools")}
        </SlidingSheet>
      )}
    </div>
  );
}

/** A long Notebook on sample highlights, for scrolling at each detent. */
function SampleNotebook() {
  return (
    <div className="flex flex-col gap-3 px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      {[...SAMPLE_HIGHLIGHTS, ...SAMPLE_HIGHLIGHTS].map((highlight, index) => (
        <NotebookNote
          key={`${highlight.id}-${index}`}
          kind="highlight"
          text={highlight.text}
          canEdit={false}
          disabled={false}
          editing={false}
          onEdit={() => {}}
          onDelete={async () => false}
        >
          <div className="rounded-[1.25rem] border border-border/60 bg-secondary/25 px-4 py-3">
            <p className="font-serif text-[15px] leading-relaxed text-foreground">
              {highlight.text}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {highlight.chapter}
            </p>
          </div>
        </NotebookNote>
      ))}
    </div>
  );
}
