/**
 * A static Reader page and a Walden outline for the sidebar prototypes.
 *
 * Only chapter II has sample text. Other chapters render as a chapter title
 * page, which books commonly have, so navigation in the prototypes stays
 * honest without inventing text.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import { createSampleLibrary, type StudioHighlight } from "../data/sample-library";
import { WALDEN_CHAPTER } from "../data/sample-texts";
import { QUIET_EASE } from "../quiet";

export interface OutlineChapter {
  number: number;
  title: string;
  page: number;
}

export const WALDEN_PAGES = 336;
export const WALDEN_TEXT_CHAPTER = 1;

export const WALDEN_OUTLINE: OutlineChapter[] = [
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
].map(([title, page], index) => ({ number: index + 1, title: title as string, page: page as number }));

export function chapterForPage(page: number): number {
  let index = 0;
  WALDEN_OUTLINE.forEach((chapter, chapterIndex) => {
    if (chapter.page <= page) index = chapterIndex;
  });
  return index;
}

export function chapterEndPage(index: number): number {
  return (WALDEN_OUTLINE[index + 1]?.page ?? WALDEN_PAGES + 1) - 1;
}

/** Walden highlights from the sample library, in book order. */
export function useWaldenHighlights(): StudioHighlight[] {
  const [highlights] = useState(() =>
    createSampleLibrary()
      .highlights.filter((highlight) => highlight.bookId === "walden")
      .sort((a, b) => a.locator - b.locator),
  );
  return highlights;
}

export interface MockTypography {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  /** Horizontal page padding as a fraction of page width. */
  margin: number;
  justify: boolean;
}

export const DEFAULT_TYPOGRAPHY: MockTypography = {
  fontFamily: '"EB Garamond", "Garamond", serif',
  fontSize: 19,
  lineHeight: 1.55,
  margin: 0.1,
  justify: true,
};

/**
 * One Reader page. Chapter II shows its opening text; other chapters show a
 * title page. Page changes crossfade.
 */
export function ReaderPage({
  page,
  typography = DEFAULT_TYPOGRAPHY,
  themeClass,
  className,
  highlightTexts = [],
}: {
  page: number;
  typography?: MockTypography;
  themeClass?: string;
  className?: string;
  highlightTexts?: { text: string; color: StudioHighlight["color"] }[];
}) {
  const chapterIndex = chapterForPage(page);
  const chapter = WALDEN_OUTLINE[chapterIndex];
  const isTextChapter = chapterIndex === WALDEN_TEXT_CHAPTER;
  const style: CSSProperties = {
    fontFamily: typography.fontFamily,
    fontSize: typography.fontSize,
    lineHeight: typography.lineHeight,
    paddingInline: `${typography.margin * 100}%`,
    textAlign: typography.justify ? "justify" : "left",
    transition: "font-size 0.25s ease, line-height 0.25s ease, padding 0.3s cubic-bezier(0.2,0,0,1), background-color 0.3s ease, color 0.3s ease",
  };

  const renderParagraph = (text: string) => {
    const match = highlightTexts.find((highlight) => text.includes(highlight.text));
    if (!match) return text;
    const index = text.indexOf(match.text);
    return (
      <>
        {text.slice(0, index)}
        <mark
          className="text-inherit"
          style={{ background: `color-mix(in oklab, var(--${match.color}-secondary) 70%, transparent)`, color: "inherit", borderRadius: 2 }}
        >
          {match.text}
        </mark>
        {text.slice(index + match.text.length)}
      </>
    );
  };

  return (
    <div className={cn("relative size-full overflow-hidden bg-background text-foreground", themeClass, className)} style={{ transition: style.transition }}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={isTextChapter ? "text" : `opener-${chapterIndex}`}
          className="absolute inset-0 flex flex-col py-10"
          style={style}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: QUIET_EASE }}
        >
          <p className="mb-7 shrink-0 text-center font-sans text-[11px] tracking-wide text-muted-foreground">
            {isTextChapter ? chapter.title : "Walden"}
          </p>
          {isTextChapter ? (
            <div
              className="xp-book-text min-h-0 flex-1 overflow-hidden"
              style={{
                // .xp-book-text sets its own family; the chosen typeface must win.
                fontFamily: typography.fontFamily,
                textAlign: style.textAlign,
                // The mock page shows an excerpt; fade the cut instead of clipping a line.
                maskImage: "linear-gradient(to bottom, #000 calc(100% - 3.5em), transparent)",
                WebkitMaskImage: "linear-gradient(to bottom, #000 calc(100% - 3.5em), transparent)",
              }}
            >
              {WALDEN_CHAPTER.paragraphs.slice(1, 6).map((paragraph, index) => (
                <p key={index} className={index === 0 ? "indent-0" : undefined}>
                  {renderParagraph(paragraph)}
                </p>
              ))}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-center">
              <p className="font-sans text-[11px] tracking-[0.2em] text-muted-foreground uppercase">Chapter {chapter.number}</p>
              <p className="mt-3 max-w-[14em] text-[1.9em] leading-tight text-balance italic">{chapter.title}</p>
              <span aria-hidden="true" className="mt-6 h-px w-10 bg-foreground/25" />
            </div>
          )}
          <p className="mt-6 shrink-0 text-center font-sans text-[11px] text-muted-foreground tabular-nums">
            {page} <span className="opacity-50">/ {WALDEN_PAGES}</span>
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
