import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ReaderChromeAccessory } from "@/features/reader/ReaderChromeAccessory";
import { ReaderHeader } from "@/features/reader/ReaderHeader";
import { ReaderFooter } from "@/features/reader/footer";
import { getReaderStatusPrompt } from "@/features/reader/hooks/use-reader-status-prompt";
import { NotesCapsule } from "@/features/reader/NotesIsland";
import type { ChapterEntry } from "@/features/reader/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { SAMPLE_BOOK_TITLE, SamplePage } from "./SamplePage";

export const CHROME_STATES = [
  { id: "start", label: "Start reading" },
  { id: "finish", label: "Last page" },
  { id: "again", label: "Set aside" },
  { id: "error", label: "Save error" },
  { id: "handoff", label: "Newer position" },
  { id: "none", label: "No prompt" },
] as const;

const CHAPTERS = [
  "Down the Rabbit-Hole",
  "The Pool of Tears",
  "A Caucus-Race and a Long Tale",
  "The Rabbit Sends in a Little Bill",
  "Advice from a Caterpillar",
  "Pig and Pepper",
  "A Mad Tea-Party",
  "The Queen’s Croquet-Ground",
];
const CHAPTER_ENTRIES: ChapterEntry[] = CHAPTERS.map((title, index) => ({
  index,
  spineItemId: `chapter-${index + 1}`,
  href: `chapter-${index + 1}.xhtml`,
  title: `Chapter ${index + 1}. ${title}`,
}));
const CHAPTER_START_PAGES = [1, 14, 27, 38, 52, 66, 80, 94];
const TOTAL_PAGES = 120;
const SAVE_DELAY_MS = 700;

function chapterOfPage(page: number) {
  let chapter = 0;
  for (const [index, start] of CHAPTER_START_PAGES.entries())
    if (page >= start) chapter = index;
  return chapter;
}

/**
 * The Reader's chrome on a still page: header, footer, the Notes capsule and
 * the reading prompts. Tap the page to show or hide the chrome. Saving and
 * jumping act only on this frame.
 */
export function ChromeSpecimen({
  state,
  nonce,
}: {
  state: string;
  nonce: number;
}) {
  const isMobile = useIsMobile() ?? false;
  const [chromeVisible, setChromeVisible] = useState(true);
  const [bookmarked, setBookmarked] = useState(false);
  const [page, setPage] = useState(17);
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [replay, setReplay] = useState({ state, nonce });
  // A new state, or the same one again, brings the prompt back.
  if (replay.state !== state || replay.nonce !== nonce) {
    setReplay({ state, nonce });
    setDismissed(false);
    setPending(false);
  }
  useEffect(() => {
    if (!pending) return;
    const timer = window.setTimeout(() => {
      setPending(false);
      if (state === "error") return;
      setDismissed(true);
      toast.success(
        <ReadingStatusChangeMessage
          previousStatus={state === "again" ? "dnf" : null}
          status={state === "finish" ? "finished" : "reading"}
        />,
      );
    }, SAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [pending, state]);

  const status = getReaderStatusPrompt(
    state === "again" ? "dnf" : state === "finish" ? "reading" : null,
    state === "finish",
  );
  const dismiss = () => setDismissed(true);
  const accessory = dismissed ? null : state === "handoff" ? (
    <ReaderChromeAccessory
      kind="handoff"
      floating={isMobile}
      currentPage={page}
      prompt={{
        sourceLabel: "iPad",
        targetPage: 86,
        onJump: () => {
          setPage(86);
          dismiss();
        },
        onDismiss: dismiss,
      }}
    />
  ) : (
    state !== "none" &&
    status && (
      <ReaderChromeAccessory
        kind="reading"
        floating={isMobile}
        prompt={{
          ...status,
          isPending: pending,
          error:
            state === "error" && !pending
              ? "Could not update reading status. Please try again."
              : "",
          onConfirm: () => setPending(true),
          onDismiss: dismiss,
        }}
      />
    )
  );
  const chapter = chapterOfPage(page);

  return (
    <SidebarProvider className="block min-h-0">
      <div className="relative h-dvh w-full overflow-hidden bg-background">
        <SamplePage onTap={() => setChromeVisible((visible) => !visible)} />
        <ReaderHeader
          chromeVisible={chromeVisible}
          accessory={accessory}
          bookTitle={SAMPLE_BOOK_TITLE}
          isMobile={isMobile}
          onBackToLibrary={() => {}}
          isBookmarked={bookmarked}
          onToggleBookmark={() => setBookmarked((value) => !value)}
          isMenuOpen={false}
          onOpenMenu={() => {}}
        />
        <ReaderFooter
          chromeVisible={chromeVisible}
          isMobile={isMobile}
          currentPage={page}
          totalPages={TOTAL_PAGES}
          currentChapterIndex={chapter}
          currentChapterEndIndex={chapter}
          displayChapterIndex={chapter}
          isContentsOpen={false}
          chapterEntries={CHAPTER_ENTRIES}
          chapterStartPages={CHAPTER_START_PAGES}
          onScrubPreview={() => {}}
          onScrubCommit={setPage}
          onGoToChapter={(index) => setPage(CHAPTER_START_PAGES[index])}
          onPrevChapter={() =>
            setPage(CHAPTER_START_PAGES[Math.max(0, chapter - 1)])
          }
          onOpenContents={() => {}}
          noteAccessory={
            isMobile && (
              <NotesCapsule
                bookId="elements-sample"
                highlights={[]}
                draft={false}
                disabled={false}
                onJot={() => {}}
                onOpenNotebook={() => {}}
              />
            )
          }
        />
      </div>
    </SidebarProvider>
  );
}
