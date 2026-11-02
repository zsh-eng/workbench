import type { Book } from "@/lib/db";
import type { ResolvedSpread } from "@/lib/pagination-v2/types";
import { getContentsLabelFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import { createContext, useContext, useMemo, type ReactNode } from "react";

/** What a page's running head and folio say. */
interface PageFurnitureContent {
  bookTitle: string;
  /** The contents' label for each chapter; never one made up from a file. */
  chapterTitles: readonly (string | undefined)[];
  showFolios: boolean;
}

const PageFurnitureContext = createContext<PageFurnitureContent | null>(null);

/** Spreads inside this have a running head and folio; a preview has neither. */
export function PageFurnitureProvider({
  book,
  showFolios,
  children,
}: {
  book: Book;
  showFolios: boolean;
  children: ReactNode;
}) {
  const content = useMemo(
    () => ({
      bookTitle: book.title,
      chapterTitles: book.spine.map((_, index) =>
        getContentsLabelFromSpine(book, index),
      ),
      showFolios,
    }),
    [book, showFolios],
  );
  return (
    <PageFurnitureContext.Provider value={content}>
      {children}
    </PageFurnitureContext.Provider>
  );
}

type SpreadPage = Extract<
  ResolvedSpread["slots"][number],
  { kind: "page" }
>["page"];

/** Text or a table on the page: a cover or a full-page plate stays bare. */
function hasReadingText(page: SpreadPage): boolean {
  return page.content.some(
    (slice) => slice.type === "text" || slice.type === "table",
  );
}

/**
 * As in a printed book: the book's title over a left-hand page, the chapter's
 * over a right-hand page or a single page, and nothing over a chapter's
 * opening, which has its own title.
 */
function getRunningHead(
  page: SpreadPage,
  slotIndex: number,
  columns: number,
  content: PageFurnitureContent,
): string | null {
  if (page.currentPageInChapter === 1) return null;
  const chapterTitle = content.chapterTitles[page.chapterIndex];
  if (columns > 1 && slotIndex === 0) return content.bookTitle;
  return chapterTitle || content.bookTitle;
}

/** Sits against the text, so the head and folio read as part of the page. */
const TEXT_DISTANCE_PX = 10;

const RAIL_CLASS =
  "pointer-events-none absolute inset-x-0 grid select-none text-[11px] leading-[14px] text-muted-foreground/80 transition-opacity duration-150 ease-out motion-reduce:transition-none";

interface PageFurnitureProps {
  spread: ResolvedSpread;
  columns: number;
  columnGapPx: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
  fontFamily: string;
}

/**
 * The running head and folio of each page in a spread, in its margins. They
 * belong to the spread, so they turn with the page, and take no room from
 * the text. The reader's own bars cover these margins, so each row hides
 * while its bar shows (`data-reader-bar-shown`, App.css) with no re-render.
 */
export function PageFurniture({
  spread,
  columns,
  columnGapPx,
  paddingTopPx,
  paddingBottomPx,
  paddingLeftPx,
  paddingRightPx,
  fontFamily,
}: PageFurnitureProps) {
  const content = useContext(PageFurnitureContext);
  if (!content) return null;

  const rowStyle = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    columnGap: `${columnGapPx}px`,
    paddingLeft: `${paddingLeftPx}px`,
    paddingRight: `${paddingRightPx}px`,
    fontFamily,
  };

  return (
    <div aria-hidden="true" data-reader-page-furniture>
      <div
        className={cn(RAIL_CLASS, "reader-running-heads tracking-[0.08em]")}
        style={{
          ...rowStyle,
          top: 0,
          height: `${paddingTopPx}px`,
          paddingBottom: `${TEXT_DISTANCE_PX}px`,
          alignItems: "end",
        }}
      >
        {spread.slots.map((slot) => {
          const head =
            slot.kind === "page" && hasReadingText(slot.page)
              ? getRunningHead(slot.page, slot.slotIndex, columns, content)
              : null;
          return (
            <p
              key={slot.slotIndex}
              className="m-0 truncate text-center [font-variant-caps:all-small-caps]"
            >
              {head}
            </p>
          );
        })}
      </div>
      <div
        className={cn(RAIL_CLASS, "reader-folios tabular-nums")}
        style={{
          ...rowStyle,
          bottom: 0,
          height: `${paddingBottomPx}px`,
          paddingTop: `${TEXT_DISTANCE_PX}px`,
          alignItems: "start",
        }}
      >
        {spread.slots.map((slot) => (
          <p
            key={slot.slotIndex}
            data-reader-folio={
              slot.kind === "page" ? slot.page.currentPage : undefined
            }
            className={cn(
              "m-0",
              columns === 1
                ? "text-center"
                : slot.slotIndex === 0
                  ? "text-left"
                  : "text-right",
            )}
          >
            {content.showFolios &&
            slot.kind === "page" &&
            hasReadingText(slot.page)
              ? slot.page.currentPage
              : null}
          </p>
        ))}
      </div>
    </div>
  );
}
