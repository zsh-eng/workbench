/**
 * Books the reading prototypes can open: Walden, Moby-Dick and Emerson's
 * Essays, each with an outline, passages kept across the book, and a page
 * renderer that paginates its one sample chapter.
 *
 * Other chapters render as a chapter title page, and a kept passage outside
 * the sample chapter renders alone on its page. Navigation steps through the
 * pages that exist.
 */
import { cn } from "@/lib/utils";
import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { StudioInk } from "./sample-library";
import { MOBY_DICK_CHAPTER, SELF_RELIANCE_CHAPTER, WALDEN_CHAPTER, type SampleChapter } from "./sample-texts";
import { inkWash, useElementSize } from "../primitives";

export interface EdgeChapter {
  index: number;
  numeral: string;
  title: string;
  page: number;
}

export interface EdgeHighlight {
  id: string;
  chapter: number;
  text: string;
  color: StudioInk;
  note: string | null;
  /** Fixed page outside the sample chapter. Sample pages come from pagination. */
  page: number | null;
  daysAgo: number;
}

/**
 * A book the prototypes can open. Only one chapter has sample text; the
 * outline and the passages kept elsewhere make the rest navigable.
 */
export interface BookModel {
  id: string;
  title: string;
  author: string;
  pages: number;
  chapters: EdgeChapter[];
  textChapter: number;
  textStart: number;
  text: SampleChapter;
  highlights: EdgeHighlight[];
  readingPage: number;
}

const ROMAN: [number, string][] = [
  [10, "X"],
  [9, "IX"],
  [5, "V"],
  [4, "IV"],
  [1, "I"],
];

export function roman(value: number): string {
  let rest = value;
  let result = "";
  for (const [amount, glyph] of ROMAN) {
    while (rest >= amount) {
      result += glyph;
      rest -= amount;
    }
  }
  return result;
}

function outline(entries: readonly (readonly [string, number])[], numerals: "roman" | "arabic"): EdgeChapter[] {
  return entries.map(([title, page], index) => ({
    index,
    numeral: numerals === "roman" ? roman(index + 1) : String(index + 1),
    title,
    page,
  }));
}

type HighlightSeed = Omit<EdgeHighlight, "id" | "note" | "page"> & {
  note?: string;
  page?: number;
};

function seedHighlights(prefix: string, seeds: HighlightSeed[]): EdgeHighlight[] {
  return seeds.map((seed, index) => ({
    ...seed,
    id: `${prefix}${index + 1}`,
    note: seed.note ?? null,
    page: seed.page ?? null,
  }));
}

export const WALDEN: BookModel = {
  id: "walden",
  title: "Walden",
  author: "Henry David Thoreau",
  pages: 336,
  textChapter: 1,
  textStart: 81,
  text: WALDEN_CHAPTER,
  readingPage: 83,
  chapters: outline(
    [
      ["Economy", 1],
      ["Where I Lived, and What I Lived For", 81],
      ["Reading", 99],
      ["Sounds", 108],
      ["Solitude", 127],
      ["Visitors", 138],
      ["The Bean-Field", 151],
      ["The Village", 163],
      ["The Ponds", 168],
      ["Baker Farm", 194],
      ["Higher Laws", 201],
      ["Brute Neighbors", 212],
      ["House-Warming", 225],
      ["Former Inhabitants; and Winter Visitors", 240],
      ["Winter Animals", 254],
      ["The Pond in Winter", 262],
      ["Spring", 278],
      ["Conclusion", 318],
    ],
    "roman",
  ),
  highlights: seedHighlights("w", [
    { chapter: 0, page: 8, color: "magenta", daysAgo: 410, text: "The mass of men lead lives of quiet desperation." },
    { chapter: 0, page: 12, color: "yellow", daysAgo: 409, text: "Most of the luxuries, and many of the so-called comforts of life, are not only not indispensable, but positive hindrances to the elevation of mankind." },
    { chapter: 0, page: 23, color: "green", daysAgo: 404, text: "I say, beware of all enterprises that require new clothes, and not rather a new wearer of clothes.", note: "Still true of software." },
    { chapter: 1, color: "yellow", daysAgo: 2, text: "Renew thyself completely each day; do it again, and again, and forever again.", note: "Tching-thang’s bathing tub. Pin it above the desk." },
    { chapter: 1, color: "green", daysAgo: 2, text: "To be awake is to be alive." },
    { chapter: 1, color: "yellow", daysAgo: 2, text: "To affect the quality of the day, that is the highest of arts.", note: "The whole book in one line." },
    { chapter: 1, color: "blue", daysAgo: 1, text: "I went to the woods because I wished to live deliberately,", note: "Everyone quotes this sentence. The rest of the paragraph is better." },
    { chapter: 1, color: "magenta", daysAgo: 1, text: "Our life is frittered away by detail." },
    { chapter: 1, color: "green", daysAgo: 1, text: "Simplicity, simplicity, simplicity!" },
    { chapter: 1, color: "blue", daysAgo: 0, text: "Time is but the stream I go a-fishing in.", note: "Compare Heraclitus, and the river you cannot step in twice." },
    { chapter: 1, color: "magenta", daysAgo: 0, text: "The intellect is a cleaver; it discerns and rifts its way into the secret of things." },
    { chapter: 2, page: 101, color: "blue", daysAgo: 380, text: "How many a man has dated a new era in his life from the reading of a book." },
    { chapter: 2, page: 103, color: "yellow", daysAgo: 380, text: "A written word is the choicest of relics." },
    { chapter: 3, page: 111, color: "blue", daysAgo: 372, text: "I love a broad margin to my life.", note: "The best argument for slow mornings." },
    { chapter: 4, page: 135, color: "magenta", daysAgo: 366, text: "I never found the companion that was so companionable as solitude." },
    { chapter: 5, page: 140, color: "green", daysAgo: 360, text: "I had three chairs in my house; one for solitude, two for friendship, three for society." },
    { chapter: 8, page: 186, color: "blue", daysAgo: 341, text: "A lake is the landscape’s most beautiful and expressive feature. It is earth’s eye; looking into which the beholder measures the depth of his own nature." },
    { chapter: 10, page: 209, color: "yellow", daysAgo: 333, text: "Every man is the builder of a temple, called his body, to the god he worships, after a style purely his own." },
    { chapter: 15, page: 269, color: "green", daysAgo: 312, text: "Heaven is under our feet as well as over our heads." },
    { chapter: 16, page: 298, color: "green", daysAgo: 305, text: "We need the tonic of wildness.", note: "Read in March. Went for a walk straight after." },
    { chapter: 17, page: 323, color: "yellow", daysAgo: 300, text: "If one advances confidently in the direction of his dreams, and endeavors to live the life which he has imagined, he will meet with a success unexpected in common hours." },
    { chapter: 17, page: 326, color: "magenta", daysAgo: 300, text: "If a man does not keep pace with his companions, perhaps it is because he hears a different drummer." },
    { chapter: 17, page: 333, color: "yellow", daysAgo: 299, text: "The sun is but a morning star.", note: "The last line. Read it last." },
  ]),
};

export const MOBY_DICK: BookModel = {
  id: "moby-dick",
  title: "Moby-Dick",
  author: "Herman Melville",
  pages: 124,
  textChapter: 0,
  textStart: 1,
  text: MOBY_DICK_CHAPTER,
  readingPage: 3,
  chapters: outline(
    [
      ["Loomings", 1],
      ["The Carpet-Bag", 9],
      ["The Spouter-Inn", 15],
      ["The Counterpane", 29],
      ["Breakfast", 34],
      ["The Street", 37],
      ["The Chapel", 40],
      ["The Pulpit", 44],
      ["The Sermon", 47],
      ["A Bosom Friend", 57],
      ["Nightgown", 62],
      ["Biographical", 65],
      ["Wheelbarrow", 68],
      ["Nantucket", 74],
      ["Chowder", 77],
      ["The Ship", 81],
      ["The Ramadan", 97],
      ["His Mark", 104],
      ["The Prophet", 109],
      ["All Astir", 115],
    ],
    "arabic",
  ),
  highlights: seedHighlights("m", [
    { chapter: 0, color: "yellow", daysAgo: 50, text: "It is a way I have of driving off the spleen and regulating the circulation." },
    { chapter: 0, color: "green", daysAgo: 49, text: "whenever it is a damp, drizzly November in my soul;", note: "The best description of a bad week." },
    { chapter: 0, color: "blue", daysAgo: 48, text: "meditation and water are wedded for ever." },
    { chapter: 0, color: "magenta", daysAgo: 47, text: "It is the image of the ungraspable phantom of life; and this is the key to it all." },
    { chapter: 2, page: 24, color: "yellow", daysAgo: 44, text: "Better sleep with a sober cannibal than a drunken Christian." },
  ]),
};

export const ESSAYS: BookModel = {
  id: "essays",
  title: "Essays: First Series",
  author: "Ralph Waldo Emerson",
  pages: 285,
  textChapter: 1,
  textStart: 37,
  text: SELF_RELIANCE_CHAPTER,
  readingPage: 38,
  chapters: outline(
    [
      ["History", 1],
      ["Self-Reliance", 37],
      ["Compensation", 73],
      ["Spiritual Laws", 103],
      ["Love", 131],
      ["Friendship", 147],
      ["Prudence", 171],
      ["Heroism", 189],
      ["The Over-Soul", 205],
      ["Circles", 229],
      ["Intellect", 247],
      ["Art", 265],
    ],
    "roman",
  ),
  highlights: seedHighlights("e", [
    { chapter: 1, color: "green", daysAgo: 13, text: "To believe your own thought, to believe that what is true for you in your private heart is true for all men,—that is genius." },
    { chapter: 1, color: "magenta", daysAgo: 13, text: "imitation is suicide" },
    { chapter: 1, color: "yellow", daysAgo: 12, text: "Trust thyself: every heart vibrates to that iron string.", note: "Pinned on the fridge." },
    { chapter: 1, color: "blue", daysAgo: 12, text: "A foolish consistency is the hobgoblin of little minds," },
    { chapter: 1, color: "green", daysAgo: 11, text: "To be great is to be misunderstood." },
  ]),
};

export const BOOK_MODELS: BookModel[] = [WALDEN, MOBY_DICK, ESSAYS];

// Walden-bound names for the earlier plates.
export const BOOK_PAGES = WALDEN.pages;
export const TEXT_CHAPTER = WALDEN.textChapter;
export const TEXT_START = WALDEN.textStart;
export const CHAPTERS = WALDEN.chapters;
export const EDGE_HIGHLIGHTS = WALDEN.highlights;
/** Where the reader is on this second reading of Walden. */
export const READING_PAGE = WALDEN.readingPage;

export function chapterEnd(index: number, book: BookModel = WALDEN): number {
  return (book.chapters[index + 1]?.page ?? book.pages + 1) - 1;
}

export function chapterOfPage(page: number, book: BookModel = WALDEN): number {
  let found = 0;
  for (const chapter of book.chapters) if (chapter.page <= page) found = chapter.index;
  return found;
}

export interface BookLayout {
  textPages: number;
  /** Absolute page for each passage in the sample chapter. */
  highlightPages: Record<string, number>;
  /** Absolute page where each paragraph of the sample chapter starts. */
  paragraphPages: number[];
}

export function initialLayout(book: BookModel = WALDEN): BookLayout {
  return {
    textPages: Math.max(1, Math.ceil(book.text.paragraphs.length / 1.4)),
    highlightPages: Object.fromEntries(
      book.highlights
        .filter((highlight) => highlight.page === null)
        .map((highlight, index) => [highlight.id, book.textStart + Math.floor(index / 2)]),
    ),
    paragraphPages: book.text.paragraphs.map((_, index) => book.textStart + Math.floor(index / 1.4)),
  };
}

export const INITIAL_LAYOUT: BookLayout = initialLayout(WALDEN);

export function sameLayout(a: BookLayout, b: BookLayout): boolean {
  return (
    a.textPages === b.textPages &&
    Object.keys(b.highlightPages).every((id) => a.highlightPages[id] === b.highlightPages[id]) &&
    a.paragraphPages.length === b.paragraphPages.length &&
    a.paragraphPages.every((page, index) => b.paragraphPages[index] === page)
  );
}

export function pageOfHighlight(highlight: EdgeHighlight, layout: BookLayout, book: BookModel = WALDEN): number {
  return highlight.page ?? layout.highlightPages[highlight.id] ?? book.textStart;
}

/** Pages that have something to show, in order. */
export function availablePages(layout: BookLayout, book: BookModel = WALDEN): number[] {
  const pages = new Set<number>();
  for (const chapter of book.chapters) if (chapter.index !== book.textChapter) pages.add(chapter.page);
  for (let index = 0; index < layout.textPages; index += 1) pages.add(book.textStart + index);
  for (const highlight of book.highlights) if (highlight.page !== null) pages.add(highlight.page);
  return [...pages].sort((a, b) => a - b);
}

export function stepPage(page: number, direction: 1 | -1, layout: BookLayout, book: BookModel = WALDEN): number {
  const pages = availablePages(layout, book);
  if (direction > 0) return pages.find((candidate) => candidate > page) ?? page;
  return [...pages].reverse().find((candidate) => candidate < page) ?? page;
}

/** Keeps a page valid after the text reflows to fewer or more pages. */
export function clampTextPage(page: number, layout: BookLayout, book: BookModel = WALDEN): number {
  const lastTextPage = book.textStart + layout.textPages - 1;
  const nextChapter = book.chapters[book.textChapter + 1]?.page ?? book.pages + 1;
  if (page > lastTextPage && page < nextChapter) return lastTextPage;
  return page;
}

/** Keeps the same place in the sample chapter when its text reflows. */
export function remapTextPage(page: number, previous: BookLayout, next: BookLayout, book: BookModel = WALDEN): number {
  if (chapterOfPage(page, book) !== book.textChapter) return page;
  const column = page - book.textStart;
  if (previous.textPages <= 1) return book.textStart + Math.min(column, next.textPages - 1);
  const fraction = Math.min(1, column / (previous.textPages - 1));
  return book.textStart + Math.round(fraction * (next.textPages - 1));
}

export type PageKind =
  | { kind: "text"; column: number }
  | { kind: "opener"; chapter: EdgeChapter }
  | { kind: "passage"; highlight: EdgeHighlight; chapter: EdgeChapter };

export function describePage(page: number, layout: BookLayout, book: BookModel = WALDEN): PageKind {
  const chapterIndex = chapterOfPage(page, book);
  const chapter = book.chapters[chapterIndex];
  if (chapterIndex === book.textChapter) {
    return {
      kind: "text",
      column: Math.min(Math.max(page - book.textStart, 0), layout.textPages - 1),
    };
  }
  const highlight = book.highlights.find((candidate) => candidate.page === page);
  if (highlight && page !== chapter.page) return { kind: "passage", highlight, chapter };
  return { kind: "opener", chapter };
}

export interface BookTypography {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  justify: boolean;
  /** Inline page margin as a fraction of page width. */
  margin: number;
}

export const BOOK_TYPOGRAPHY: BookTypography = {
  fontFamily: '"EB Garamond", "Garamond", serif',
  fontSize: 18,
  lineHeight: 1.5,
  justify: true,
  margin: 0.12,
};

export interface InkFlash {
  id: string;
  key: number;
}

interface MarkSpan {
  start: number;
  end: number;
  highlight: EdgeHighlight;
}

function findMarks(text: string, highlights: EdgeHighlight[]): MarkSpan[] {
  const spans: MarkSpan[] = [];
  for (const highlight of highlights) {
    const start = text.indexOf(highlight.text);
    if (start >= 0) spans.push({ start, end: start + highlight.text.length, highlight });
  }
  return spans.sort((a, b) => a.start - b.start);
}

export function InkMark({
  highlight,
  flash,
  hovered,
  children,
}: {
  highlight: EdgeHighlight;
  flash: InkFlash | null;
  hovered: boolean;
  children: ReactNode;
}) {
  const flashing = flash?.id === highlight.id;
  return (
    <mark
      data-hl={highlight.id}
      data-flash={flashing ? "true" : undefined}
      data-hovered={hovered ? "true" : undefined}
      className="xp-ink"
      style={{ "--xp-ink": inkWash(highlight.color) } as CSSProperties}
    >
      {children}
    </mark>
  );
}

function MarkedParagraph({
  text,
  highlights,
  flash,
  hoveredId,
}: {
  text: string;
  highlights: EdgeHighlight[];
  flash: InkFlash | null;
  hoveredId: string | null;
}) {
  const spans = findMarks(text, highlights);
  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    pieces.push(text.slice(cursor, span.start));
    pieces.push(
      <InkMark
        key={`${span.highlight.id}-${flash?.id === span.highlight.id ? flash.key : 0}`}
        highlight={span.highlight}
        flash={flash}
        hovered={hoveredId === span.highlight.id}
      >
        {text.slice(span.start, span.end)}
      </InkMark>,
    );
    cursor = span.end;
  }
  pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}

const COLUMN_GAP = 48;

/**
 * One page of the book at the size of its container. Chapter II is set in
 * CSS columns, one column per page; other pages are composed directly.
 */
export function BookPage({
  page,
  book = WALDEN,
  typography = BOOK_TYPOGRAPHY,
  highlights,
  flash = null,
  hoveredId = null,
  onLayout,
  className,
  style,
  showFolio = true,
  showRunningHead = true,
  topMargin = 0.1,
}: {
  page: number;
  book?: BookModel;
  typography?: BookTypography;
  /** Passages to mark. Defaults to the book's own. */
  highlights?: EdgeHighlight[];
  flash?: InkFlash | null;
  hoveredId?: string | null;
  onLayout?: (layout: BookLayout) => void;
  className?: string;
  style?: CSSProperties;
  showFolio?: boolean;
  showRunningHead?: boolean;
  /** Top page margin as a fraction of page height. */
  topMargin?: number;
}) {
  const [pageRef, size] = useElementSize<HTMLDivElement>();
  const columnsRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<BookLayout>(() => initialLayout(book));
  const marked = highlights ?? book.highlights;

  const padTop = Math.round(size.height * topMargin);
  const padBottom = Math.round(size.height * 0.1);
  const padInline = Math.round(size.width * typography.margin);
  const textWidth = Math.max(0, size.width - padInline * 2);
  const textHeight = Math.max(0, size.height - padTop - padBottom);
  const step = textWidth + COLUMN_GAP;

  useLayoutEffect(() => {
    const columns = columnsRef.current;
    if (!columns || textWidth <= 0 || textHeight <= 0) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const textPages = Math.max(1, Math.round((columns.scrollWidth + COLUMN_GAP) / step));
      const highlightPages: Record<string, number> = {};
      columns.querySelectorAll<HTMLElement>("[data-hl]").forEach((mark) => {
        const id = mark.dataset.hl;
        if (id) highlightPages[id] = book.textStart + Math.floor((mark.offsetLeft + 1) / step);
      });
      const paragraphPages = [...columns.querySelectorAll<HTMLElement>("[data-para]")].map(
        (paragraph) => book.textStart + Math.floor((paragraph.offsetLeft + 1) / step),
      );
      const next = { textPages, highlightPages, paragraphPages };
      setLayout((previous) => (sameLayout(previous, next) ? previous : next));
      onLayout?.(next);
    };
    measure();
    void document.fonts?.ready.then(measure);
    return () => {
      cancelled = true;
    };
  }, [book, marked, onLayout, step, textHeight, textWidth, typography]);

  const described = describePage(page, layout, book);
  const chapter = book.chapters[chapterOfPage(page, book)];
  const isChapterStart = described.kind === "text" && described.column === 0;
  const runningHead =
    !showRunningHead || described.kind === "opener" || isChapterStart ? null : chapter.title;
  const textHighlights = marked.filter((highlight) => highlight.chapter === book.textChapter);

  return (
    <div
      ref={pageRef}
      className={cn("relative size-full overflow-hidden bg-background text-foreground", className)}
      style={{ fontFamily: typography.fontFamily, fontSize: typography.fontSize, ...style }}
    >
      {runningHead && (
        <p
          className="xp-smcp absolute inset-x-0 truncate px-[12%] text-center text-[0.62em] text-muted-foreground"
          style={{ top: Math.min(padTop * 0.42, size.height * 0.045) }}
        >
          {runningHead}
        </p>
      )}

      <div
        className="absolute overflow-hidden"
        style={{ top: padTop, left: padInline, width: textWidth, height: textHeight }}
      >
        <div
          ref={columnsRef}
          aria-hidden={described.kind !== "text"}
          className="xp-book-text relative"
          style={{
            fontFamily: typography.fontFamily,
            lineHeight: typography.lineHeight,
            textAlign: typography.justify ? "justify" : "left",
            height: textHeight,
            columnWidth: textWidth || undefined,
            columnGap: COLUMN_GAP,
            columnFill: "auto",
            transform: `translateX(${-(described.kind === "text" ? described.column : 0) * step}px)`,
            visibility: described.kind === "text" ? "visible" : "hidden",
          }}
        >
          <div className="mb-[1.6em] pt-[0.6em] text-center" style={{ textIndent: 0 }}>
            <p className="xp-smcp text-[0.66em] tracking-[0.24em] text-muted-foreground">
              Chapter {book.chapters[book.textChapter].numeral}
            </p>
            <h2 className="mt-[0.35em] text-[1.42em] leading-[1.12] font-normal text-balance italic">
              {book.text.title}
            </h2>
          </div>
          {book.text.paragraphs.map((paragraph, index) => (
            <p key={index} data-para={index} className={index === 0 ? "xp-opening" : undefined}>
              <MarkedParagraph
                text={paragraph}
                highlights={textHighlights}
                flash={flash}
                hoveredId={hoveredId}
              />
            </p>
          ))}
        </div>

        {described.kind === "opener" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="xp-smcp text-[0.66em] tracking-[0.26em] text-muted-foreground">
              Chapter {described.chapter.numeral}
            </p>
            <p className="mt-[0.5em] max-w-[11em] text-[1.85em] leading-[1.1] text-balance italic">
              {described.chapter.title}
            </p>
            <span aria-hidden="true" className="mt-[1.3em] h-px w-[2.4em] bg-foreground/25" />
          </div>
        )}

        {described.kind === "passage" && (
          <div
            className="xp-book-text absolute inset-0 flex flex-col justify-center"
            style={{ fontFamily: typography.fontFamily, lineHeight: typography.lineHeight }}
          >
            <p className="mb-[0.5em] text-center text-muted-foreground" style={{ textIndent: 0 }}>
              …
            </p>
            <p style={{ textIndent: 0, textAlign: typography.justify ? "justify" : "left" }}>
              <InkMark
                key={`${described.highlight.id}-${flash?.id === described.highlight.id ? flash.key : 0}`}
                highlight={described.highlight}
                flash={flash}
                hovered={hoveredId === described.highlight.id}
              >
                {described.highlight.text}
              </InkMark>
            </p>
            <p className="mt-[0.5em] text-center text-muted-foreground" style={{ textIndent: 0 }}>
              …
            </p>
          </div>
        )}
      </div>

      {showFolio && (
        <p
          className="xp-onum absolute inset-x-0 text-center text-[0.68em] text-muted-foreground"
          style={{ bottom: padBottom * 0.42 }}
        >
          {page}
        </p>
      )}
    </div>
  );
}
