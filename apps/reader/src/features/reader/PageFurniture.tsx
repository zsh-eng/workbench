import type { Book } from "@/lib/db";
import type { ResolvedSpread } from "@/lib/pagination-v2/types";
import { getContentsLabelFromSpine } from "@/lib/toc-utils";
import { cn } from "@/lib/utils";
import {
  createContext,
  useContext,
  useMemo,
  type CSSProperties,
  type ReactNode,
} from "react";
import { getFurnitureGap, planPageFurniture } from "./page-furniture-layout";

/** What a page's running title and number say, and where they go. */
interface PageFurnitureContent {
  bookTitle: string;
  /** The contents' label for each chapter; never one made up from a file. */
  chapterTitles: readonly (string | undefined)[];
  isTablet: boolean;
  showTitles: boolean;
  showNumbers: boolean;
  /** Numbers wait for every chapter to be counted, as they change till then. */
  numbersReady: boolean;
}

const PageFurnitureContext = createContext<PageFurnitureContent | null>(null);

/** Spreads inside this have running titles and numbers; a preview has none. */
export function PageFurnitureProvider({
  book,
  isTablet,
  showTitles,
  showNumbers,
  numbersReady,
  children,
}: {
  book: Book;
  isTablet: boolean;
  showTitles: boolean;
  showNumbers: boolean;
  numbersReady: boolean;
  children: ReactNode;
}) {
  const content = useMemo(
    () => ({
      bookTitle: book.title,
      chapterTitles: book.spine.map((_, index) =>
        getContentsLabelFromSpine(book, index),
      ),
      isTablet,
      showTitles,
      showNumbers,
      numbersReady,
    }),
    [book, isTablet, showTitles, showNumbers, numbersReady],
  );
  return (
    <PageFurnitureContext.Provider value={content}>
      {children}
    </PageFurnitureContext.Provider>
  );
}

type SpreadSlot = ResolvedSpread["slots"][number];
type SpreadPage = Extract<SpreadSlot, { kind: "page" }>["page"];

/** Text or a table on the page: a cover or a full-page plate stays bare. */
function hasReadingText(page: SpreadPage): boolean {
  return page.content.some(
    (slice) => slice.type === "text" || slice.type === "table",
  );
}

/**
 * As in a printed book: the book's title over the left-hand page, the
 * chapter's over the right-hand page, and nothing over a chapter's opening,
 * which has its own title.
 */
function getRunningTitle(
  page: SpreadPage,
  slotIndex: number,
  content: PageFurnitureContent,
): string | null {
  if (page.currentPageInChapter === 1) return null;
  if (slotIndex === 0) return content.bookTitle;
  return content.chapterTitles[page.chapterIndex] || content.bookTitle;
}

const ROW_CLASS =
  "pointer-events-none absolute inset-x-0 grid select-none text-foreground transition-opacity duration-150 ease-out motion-reduce:transition-none";

interface PageFurnitureProps {
  spread: ResolvedSpread;
  columns: number;
  columnGapPx: number;
  paddingTopPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
  /** Where the page's text ends, below `paddingTopPx`. */
  textHeightPx: number;
  fontFamily: string;
  fontSizePx: number;
  lineHeightPx: number;
}

/**
 * The running titles and page numbers of a spread, placed by
 * `planPageFurniture` half a line clear of the text. They are set in the
 * book's own type, size and ink, as the printed books Reader learns from set
 * them: titles in italic, numbers in old-style figures where the face has
 * them (Iowan; Reader's bundled faces fall back to lining figures). They
 * belong to the spread, so they turn with the page. The reader's bars
 * cover these rows, so each row hides while its bar shows
 * (`data-reader-bar-shown`, App.css) with no re-render.
 */
export function PageFurniture({
  spread,
  columns,
  columnGapPx,
  paddingTopPx,
  paddingLeftPx,
  paddingRightPx,
  textHeightPx,
  fontFamily,
  fontSizePx,
  lineHeightPx,
}: PageFurnitureProps) {
  const content = useContext(PageFurnitureContext);
  if (!content) return null;

  const plan = planPageFurniture({
    columns,
    isTablet: content.isTablet,
    showTitles: content.showTitles,
    showNumbers: content.showNumbers,
  });
  const gap = getFurnitureGap(lineHeightPx);
  const rowStyle: CSSProperties = {
    gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
    columnGap: `${columnGapPx}px`,
    paddingLeft: `${paddingLeftPx}px`,
    paddingRight: `${paddingRightPx}px`,
    height: `${lineHeightPx}px`,
    lineHeight: `${lineHeightPx}px`,
    fontFamily,
    fontSize: `${fontSizePx}px`,
  };
  const figureStyle: CSSProperties = {
    fontVariantNumeric: "oldstyle-nums proportional-nums",
  };
  const numberOf = (slot: SpreadSlot) =>
    content.showNumbers &&
    content.numbersReady &&
    slot.kind === "page" &&
    hasReadingText(slot.page)
      ? slot.page.currentPage
      : null;
  const figure = (number: number | null, className: string) => (
    <span
      data-reader-folio={number ?? undefined}
      className={className}
      style={figureStyle}
    >
      {number}
    </span>
  );

  return (
    <div aria-hidden="true" data-reader-page-furniture>
      {plan.headRow && (
        <div
          className={cn(ROW_CLASS, "reader-running-heads")}
          style={{ ...rowStyle, top: `${paddingTopPx - gap - lineHeightPx}px` }}
        >
          {spread.slots.map((slot) => {
            const title =
              plan.titles && slot.kind === "page" && hasReadingText(slot.page)
                ? getRunningTitle(slot.page, slot.slotIndex, content)
                : null;
            const number = plan.numbersAtHead ? numberOf(slot) : null;
            const outerLeft = slot.slotIndex === 0;
            // Equal sides keep the title centred over its page.
            return (
              <div
                key={slot.slotIndex}
                className="flex min-w-0 items-baseline"
              >
                {figure(
                  outerLeft ? number : null,
                  "w-[3em] shrink-0 text-left",
                )}
                <p className="m-0 min-w-0 flex-1 truncate text-center italic">
                  {title}
                </p>
                {figure(
                  outerLeft ? null : number,
                  "w-[3em] shrink-0 text-right",
                )}
              </div>
            );
          })}
        </div>
      )}
      {plan.footRow && (
        <div
          className={cn(ROW_CLASS, "reader-folios")}
          style={{ ...rowStyle, top: `${paddingTopPx + textHeightPx + gap}px` }}
        >
          {spread.slots.map((slot) => (
            <p key={slot.slotIndex} className="m-0 text-center">
              {figure(numberOf(slot), "")}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
