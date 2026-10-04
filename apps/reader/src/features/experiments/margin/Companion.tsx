/**
 * Companion: a margin that follows the reading position.
 *
 * The chapter is paginated with CSS columns and pages slide inside a window.
 * After layout, each highlight's page is read from its column offset. The
 * margin then shows only what belongs to the current page, with earlier and
 * later passages summarised, so the column stays short and relevant.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { StudioHighlight } from "../data/sample-library";
import { WALDEN_CHAPTER } from "../data/sample-texts";
import { StageSurface, inkColor, useElementSize } from "../primitives";
import { QUIET_EASE, QUIET_SPRING, QuietKbd } from "../quiet";
import { WALDEN_OUTLINE, chapterForPage, useWaldenHighlights } from "./reader-mock";

const GAP = 56;
const FONT_SIZE = 19;
const LINE_HEIGHT = 30;
const FIRST_FOLIO = 81;
const MINUTES_PER_PAGE = 1.6;

/** Splits a paragraph around any highlight text it contains. */
function renderWithMarks(
  paragraph: string,
  highlights: StudioHighlight[],
  hovered: string | null,
  onHover: (id: string | null) => void,
): ReactNode {
  const parts: ReactNode[] = [];
  let rest = paragraph;
  let key = 0;
  for (;;) {
    const next = highlights
      .map((highlight) => ({ highlight, index: rest.indexOf(highlight.text) }))
      .filter((candidate) => candidate.index >= 0)
      .sort((a, b) => a.index - b.index)[0];
    if (!next) break;
    parts.push(rest.slice(0, next.index));
    const active = hovered === next.highlight.id;
    parts.push(
      <mark
        key={key++}
        data-highlight={next.highlight.id}
        onPointerEnter={() => onHover(next.highlight.id)}
        onPointerLeave={() => onHover(null)}
        className="rounded-[2px] text-inherit transition-[background-color,box-shadow] duration-200"
        style={{
          color: "inherit",
          background: `color-mix(in oklab, var(--${next.highlight.color}-secondary) ${active ? 95 : 60}%, transparent)`,
          boxShadow: active ? `0 2px 0 0 ${inkColor(next.highlight.color)}` : "none",
        }}
      >
        {next.highlight.text}
      </mark>,
    );
    rest = rest.slice(next.index + next.highlight.text.length);
  }
  parts.push(rest);
  return parts;
}

function SectionLabel({ children, count }: { children: ReactNode; count?: number }) {
  return (
    <p className="mb-2.5 flex items-baseline gap-1.5 text-[11px] font-medium text-muted-foreground">
      {children}
      {count !== undefined && <span className="font-normal tabular-nums opacity-70">{count}</span>}
    </p>
  );
}

export function Companion() {
  const reducedMotion = useReducedMotion() ?? false;
  const allHighlights = useWaldenHighlights();
  const highlights = allHighlights.filter(
    (highlight) => chapterForPage(highlight.locator) === 1 && WALDEN_CHAPTER.paragraphs.some((paragraph) => paragraph.includes(highlight.text)),
  );
  const [pageIndex, setPageIndex] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [markPages, setMarkPages] = useState<Record<string, number>>({});
  const [hovered, setHovered] = useState<string | null>(null);
  const [turned, setTurned] = useState(0);
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [fontsReady, setFontsReady] = useState(false);
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const [windowRef, windowSize] = useElementSize<HTMLDivElement>();
  const flowRef = useRef<HTMLDivElement>(null);
  const wide = stage.width >= 780;
  const textW = Math.round(windowSize.width);
  const textH = Math.floor(windowSize.height / LINE_HEIGHT) * LINE_HEIGHT;

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => !cancelled && setFontsReady(true));
    const interval = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  // Count columns and read each highlight's page from its column offset.
  useLayoutEffect(() => {
    const flow = flowRef.current;
    if (!flow || textW < 100) return;
    const stride = textW + GAP;
    setPageCount(Math.max(1, Math.round((flow.scrollWidth + GAP) / stride)));
    const pages: Record<string, number> = {};
    flow.querySelectorAll<HTMLElement>("mark[data-highlight]").forEach((mark) => {
      pages[mark.dataset.highlight ?? ""] = Math.floor((mark.offsetLeft + 1) / stride);
    });
    setMarkPages(pages);
  }, [textW, textH, fontsReady]);

  const safePage = Math.min(pageIndex, pageCount - 1);
  const go = (delta: number) => {
    const next = Math.min(pageCount - 1, Math.max(0, safePage + delta));
    if (next === safePage) return;
    setPageIndex(next);
    setTurned((value) => value + 1);
  };
  const goTo = (target: number) => {
    if (target === safePage) return;
    setPageIndex(target);
    setTurned((value) => value + 1);
  };

  const onPage = highlights.filter((highlight) => markPages[highlight.id] === safePage);
  const earlier = highlights.filter((highlight) => (markPages[highlight.id] ?? 0) < safePage);
  const later = highlights.filter((highlight) => (markPages[highlight.id] ?? 0) > safePage);
  const pagesLeft = pageCount - 1 - safePage;
  const nextChapter = WALDEN_OUTLINE[2];
  const sittingMinutes = Math.floor((now - startedAt) / 60000);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  };

  const flowStyle: CSSProperties = {
    width: textW,
    height: textH,
    columnWidth: textW,
    columnGap: GAP,
    columnFill: "auto",
    fontSize: FONT_SIZE,
    lineHeight: `${LINE_HEIGHT}px`,
  };

  return (
    <StageSurface tone="inherit" className="relative size-full">
      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn("absolute inset-0 grid outline-none", wide ? "grid-cols-[minmax(0,1fr)_20rem]" : "grid-rows-[minmax(0,1fr)_auto]")}
      >
        {/* Page */}
        <div className="relative flex min-h-0 flex-col px-6 pt-9 pb-6 md:px-10">
          <p className="mb-6 shrink-0 text-center text-[11px] text-muted-foreground">{WALDEN_CHAPTER.title}</p>
          {/* Keep a comfortable measure of about 65 characters. */}
          <div ref={windowRef} className="relative mx-auto min-h-0 w-full max-w-[34rem] flex-1 overflow-hidden">
            {textW > 100 && (
              <motion.div
                ref={flowRef}
                className="xp-book-text relative"
                style={flowStyle}
                initial={false}
                animate={{ x: -safePage * (textW + GAP) }}
                transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 260, damping: 34 }}
              >
                {WALDEN_CHAPTER.paragraphs.map((paragraph, index) => (
                  <p key={index} className={index === 0 ? "indent-0" : undefined}>
                    {renderWithMarks(paragraph, highlights, hovered, setHovered)}
                  </p>
                ))}
              </motion.div>
            )}
            {/* Tap zones */}
            <button type="button" tabIndex={-1} aria-label="Previous page" onClick={() => go(-1)} className="absolute inset-y-0 left-0 w-[16%] cursor-w-resize" />
            <button type="button" tabIndex={-1} aria-label="Next page" onClick={() => go(1)} className="absolute inset-y-0 right-0 w-[16%] cursor-e-resize" />
          </div>
          <div className="mt-5 flex shrink-0 items-center justify-center gap-3 text-[11px] text-muted-foreground">
            <button type="button" aria-label="Previous page" disabled={safePage === 0} onClick={() => go(-1)} className="grid size-7 cursor-pointer place-items-center rounded-full outline-none hover:bg-muted hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronLeft className="size-4" />
            </button>
            <span className="min-w-14 text-center tabular-nums">p. {FIRST_FOLIO + 8 + safePage}</span>
            <button type="button" aria-label="Next page" disabled={safePage === pageCount - 1} onClick={() => go(1)} className="grid size-7 cursor-pointer place-items-center rounded-full outline-none hover:bg-muted hover:text-foreground disabled:opacity-30 focus-visible:ring-2 focus-visible:ring-ring">
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        {/* Companion margin */}
        <aside
          aria-label="Companion"
          className={cn("xp-scroll-quiet min-h-0 overflow-y-auto", wide ? "border-l border-border/60 px-6 py-9" : "max-h-[46%] border-t border-border/60 px-5 py-5")}
        >
          <div>
            <p className="text-[13px] leading-snug font-medium">{WALDEN_CHAPTER.title}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Chapter 2 · {pagesLeft === 0 ? "last page" : `${pagesLeft} ${pagesLeft === 1 ? "page" : "pages"} left`}
            </p>
            <div className="mt-3 flex gap-[3px]" aria-hidden="true">
              {Array.from({ length: pageCount }, (_, index) => (
                <motion.button
                  key={index}
                  type="button"
                  tabIndex={-1}
                  onClick={() => goTo(index)}
                  className="h-[3px] flex-1 cursor-pointer rounded-full"
                  animate={{
                    backgroundColor:
                      index === safePage
                        ? "var(--foreground)"
                        : index < safePage
                          ? "color-mix(in oklab, var(--foreground) 40%, transparent)"
                          : "color-mix(in oklab, var(--foreground) 12%, transparent)",
                  }}
                  transition={{ duration: 0.25 }}
                />
              ))}
            </div>
          </div>

          <div className="mt-8">
            <SectionLabel count={onPage.length}>On this page</SectionLabel>
            <div className="relative">
              <AnimatePresence mode="popLayout" initial={false}>
                {onPage.length === 0 ? (
                  <motion.p
                    key={`empty-${safePage}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.18 }}
                    className="text-[13px] leading-relaxed text-muted-foreground"
                  >
                    Nothing marked here. Select a passage to keep it.
                  </motion.p>
                ) : (
                  onPage.map((highlight, index) => (
                    <motion.div
                      key={highlight.id}
                      layout="position"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
                      transition={{ duration: 0.26, ease: QUIET_EASE, delay: index * 0.04 }}
                      onPointerEnter={() => setHovered(highlight.id)}
                      onPointerLeave={() => setHovered(null)}
                      className={cn(
                        "mb-3 rounded-xl border px-3.5 py-3 transition-[border-color,background-color] duration-200",
                        hovered === highlight.id ? "border-foreground/15 bg-muted/50" : "border-border/60",
                      )}
                    >
                      <blockquote className="xp-serif border-l-2 pl-3 text-[14.5px] leading-snug" style={{ borderColor: inkColor(highlight.color) }}>
                        <span className="line-clamp-4">{highlight.text}</span>
                      </blockquote>
                      {highlight.note && <p className="mt-2 pl-3.5 text-[12.5px] leading-snug text-foreground/75">{highlight.note}</p>}
                    </motion.div>
                  ))
                )}
              </AnimatePresence>
            </div>
          </div>

          {(earlier.length > 0 || later.length > 0) && (
            <motion.div layout="position" transition={QUIET_SPRING} className="mt-6 space-y-5">
              {earlier.length > 0 && (
                <div>
                  <SectionLabel count={earlier.length}>Earlier in this chapter</SectionLabel>
                  <div className="flex flex-col gap-1">
                    {earlier.map((highlight) => (
                      <button
                        key={highlight.id}
                        type="button"
                        onClick={() => goTo(markPages[highlight.id] ?? 0)}
                        className="flex cursor-pointer items-center gap-2 rounded-lg py-1 text-left text-[12.5px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <span className="size-[5px] shrink-0 rounded-full" style={{ background: inkColor(highlight.color) }} />
                        <span className="xp-serif truncate text-[13.5px]">{highlight.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {later.length > 0 && (
                <p className="text-[12.5px] text-muted-foreground">
                  {later.length} more {later.length === 1 ? "highlight" : "highlights"} later in this chapter.
                </p>
              )}
            </motion.div>
          )}

          <motion.div layout="position" transition={QUIET_SPRING} className="mt-8 border-t border-border/60 pt-5">
            <SectionLabel>Up next</SectionLabel>
            <p className="text-[13px]">
              {nextChapter.title} <span className="text-muted-foreground tabular-nums">· p. {nextChapter.page}</span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              In {pagesLeft + 1} {pagesLeft === 0 ? "page" : "pages"}, about {Math.max(1, Math.round((pagesLeft + 1) * MINUTES_PER_PAGE))} min
            </p>
          </motion.div>

          <motion.div layout="position" transition={QUIET_SPRING} className="mt-6 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              This sitting · {sittingMinutes < 1 ? "under a minute" : `${sittingMinutes} min`} · {turned} {turned === 1 ? "page" : "pages"}
            </span>
            <span className="flex gap-1 max-md:hidden">
              <QuietKbd>←</QuietKbd>
              <QuietKbd>→</QuietKbd>
            </span>
          </motion.div>
        </aside>
      </div>
    </StageSurface>
  );
}
