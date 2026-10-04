/**
 * Rail: the book's outline lives in a hairline at the left edge.
 *
 * Collapsed, the rail is a minimap: chapter ticks, highlight dots and a mark
 * for the current page. Pointing at it opens one outline that merges the
 * contents with the reader's highlights, so navigation and annotation share a
 * single list. The minimap stays beside the list and shows which part of the
 * book the list is scrolled to.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { NotebookPen, Pin, PinOff } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { StageSurface, inkColor } from "../primitives";
import { QUIET_EASE, QUIET_SPRING, QuietKbd, percent } from "../quiet";
import {
  ReaderPage,
  WALDEN_OUTLINE,
  WALDEN_PAGES,
  chapterForPage,
  useWaldenHighlights,
} from "./reader-mock";

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 380;

function Minimap({
  page,
  highlights,
  hoveredChapter,
  window: visibleWindow,
  expanded,
}: {
  page: number;
  highlights: ReturnType<typeof useWaldenHighlights>;
  hoveredChapter: number | null;
  window: [number, number] | null;
  expanded: boolean;
}) {
  const at = (value: number) => `${(value / WALDEN_PAGES) * 100}%`;
  return (
    <div className="relative h-full w-7" aria-hidden="true">
      <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-foreground/15" />
      {visibleWindow && (
        <motion.span
          className="absolute left-1/2 w-3 -translate-x-1/2 rounded-full bg-foreground/[0.07]"
          animate={{ top: at(visibleWindow[0]), height: at(visibleWindow[1] - visibleWindow[0]) }}
          transition={{ type: "spring", stiffness: 600, damping: 50 }}
        />
      )}
      {WALDEN_OUTLINE.map((chapter, index) => (
        <motion.span
          key={chapter.number}
          className="absolute left-1/2 h-px -translate-x-1/2 bg-foreground"
          style={{ top: at(chapter.page) }}
          animate={{ width: hoveredChapter === index ? 14 : 6, opacity: hoveredChapter === index ? 0.9 : 0.3 }}
          transition={QUIET_SPRING}
        />
      ))}
      {highlights.map((highlight) => (
        <span
          key={highlight.id}
          className="absolute left-[calc(50%+5px)] size-[5px] -translate-y-1/2 rounded-full"
          style={{ top: at(highlight.locator), background: inkColor(highlight.color), opacity: expanded ? 1 : 0.8 }}
        />
      ))}
      <motion.span
        className="absolute left-1/2 h-[2px] w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground"
        animate={{ top: at(page) }}
        transition={{ type: "spring", stiffness: 260, damping: 32 }}
      />
    </div>
  );
}

export function OutlineRail() {
  const reducedMotion = useReducedMotion() ?? false;
  const highlights = useWaldenHighlights();
  const [page, setPage] = useState(90);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [hoveredChapter, setHoveredChapter] = useState<number | null>(null);
  const [visibleWindow, setVisibleWindow] = useState<[number, number] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<number, HTMLElement>());
  const currentChapter = chapterForPage(page);
  const expanded = open || pinned;

  useEffect(() => () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
  }, []);

  const schedule = (next: boolean) => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => setOpen(next), next ? OPEN_DELAY_MS : CLOSE_DELAY_MS);
  };

  // Map the list's visible rows back to a page range for the minimap.
  const updateWindow = () => {
    const list = listRef.current;
    if (!list) return;
    const top = list.scrollTop;
    const bottom = top + list.clientHeight;
    let first: number | null = null;
    let last: number | null = null;
    rowRefs.current.forEach((element, index) => {
      const rowTop = element.offsetTop;
      if (rowTop + element.offsetHeight > top && rowTop < bottom) {
        first = first === null ? index : Math.min(first, index);
        last = last === null ? index : Math.max(last, index);
      }
    });
    if (first === null || last === null) return;
    const end = WALDEN_OUTLINE[(last as number) + 1]?.page ?? WALDEN_PAGES;
    setVisibleWindow([WALDEN_OUTLINE[first as number].page, end]);
  };

  useEffect(() => {
    if (!expanded) return;
    const frame = requestAnimationFrame(() => {
      // Scroll only the list; scrollIntoView would also move the page.
      const list = listRef.current;
      const row = rowRefs.current.get(currentChapter);
      if (list && row) list.scrollTop = row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2;
      updateWindow();
    });
    return () => cancelAnimationFrame(frame);
    // Centre the current chapter each time the outline opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expanded]);

  const goTo = (target: number, label: string) => {
    setPage(target);
    setToast(label);
    window.setTimeout(() => setToast((current) => (current === label ? null : current)), 1600);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "[") {
      event.preventDefault();
      setPinned((value) => !value);
    } else if (event.key === "Escape") {
      setPinned(false);
      setOpen(false);
    }
  };

  const progress = page / WALDEN_PAGES;
  const minutesLeft = Math.round((WALDEN_PAGES - page) * 1.6);

  return (
    <StageSurface tone="inherit" className="relative size-full overflow-hidden" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Page */}
      <div className="absolute inset-y-0 left-1/2 w-[min(40rem,calc(100%-6rem))] -translate-x-1/2">
        <ReaderPage page={page} highlightTexts={highlights.filter((highlight) => highlight.locator >= 81 && highlight.locator < 99)} />
      </div>

      {/* Collapsed rail */}
      <div
        className="absolute inset-y-0 left-0 z-10 flex w-14 items-center justify-center"
        onPointerEnter={() => schedule(true)}
        onPointerLeave={() => !pinned && schedule(false)}
      >
        <motion.button
          type="button"
          aria-label="Open outline"
          aria-expanded={expanded}
          onClick={() => setPinned(true)}
          onFocus={() => setOpen(true)}
          className="h-[68%] cursor-pointer rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          animate={{ opacity: expanded ? 0 : 0.6 }}
          whileHover={{ opacity: 1 }}
          transition={{ duration: 0.2 }}
        >
          <Minimap page={page} highlights={highlights} hoveredChapter={null} window={null} expanded={false} />
        </motion.button>
      </div>

      {/* Outline */}
      <AnimatePresence>
        {expanded && (
          <motion.aside
            aria-label="Outline"
            className="absolute inset-y-3 left-3 z-20 flex w-[min(21rem,calc(100%-1.5rem))] overflow-hidden rounded-2xl border bg-background/92 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.35)] backdrop-blur-xl"
            initial={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { opacity: 0, x: -8, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: QUIET_EASE }}
            onPointerEnter={() => schedule(true)}
            onPointerLeave={() => !pinned && schedule(false)}
          >
            <div className="flex shrink-0 items-center py-[12%] pl-2.5">
              <Minimap page={page} highlights={highlights} hoveredChapter={hoveredChapter} window={visibleWindow} expanded />
            </div>
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="flex items-start gap-2 border-b border-border/60 py-3.5 pr-3 pl-2">
                <div className="min-w-0 flex-1">
                  <p className="xp-serif truncate text-[17px] leading-tight">Walden</p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    <span className="tabular-nums">{percent(progress)}</span> · about {Math.floor(minutesLeft / 60)} h {minutesLeft % 60} min left
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={pinned ? "Unpin outline" : "Pin outline"}
                  aria-pressed={pinned}
                  onClick={() => setPinned((value) => !value)}
                  className={cn(
                    "grid size-7 shrink-0 cursor-pointer place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    pinned ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
                </button>
              </div>

              <div ref={listRef} className="xp-scroll-quiet relative min-h-0 flex-1 overflow-y-auto py-2 pr-2" onScroll={updateWindow}>
                {WALDEN_OUTLINE.map((chapter, index) => {
                  const isCurrent = index === currentChapter;
                  const notes = highlights.filter((highlight) => chapterForPage(highlight.locator) === index);
                  return (
                    <div
                      key={chapter.number}
                      ref={(node) => {
                        if (node) rowRefs.current.set(index, node);
                        else rowRefs.current.delete(index);
                      }}
                      onPointerEnter={() => setHoveredChapter(index)}
                      onPointerLeave={() => setHoveredChapter(null)}
                    >
                      <button
                        type="button"
                        aria-current={isCurrent ? "location" : undefined}
                        onClick={() => goTo(chapter.page, `${chapter.title} · p. ${chapter.page}`)}
                        className="relative flex w-full cursor-pointer items-baseline gap-2 rounded-lg py-1.5 pr-2 pl-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {isCurrent && (
                          <motion.span layoutId="rail-current" transition={QUIET_SPRING} className="absolute inset-0 rounded-lg bg-muted" />
                        )}
                        <span className="relative w-5 shrink-0 text-right text-[11px] text-muted-foreground tabular-nums">{chapter.number}</span>
                        <span className={cn("relative min-w-0 flex-1 truncate text-[13px]", isCurrent ? "font-medium text-foreground" : "text-foreground/80")}>
                          {chapter.title}
                        </span>
                        <span className="relative text-[11px] text-muted-foreground tabular-nums">{chapter.page}</span>
                      </button>
                      {notes.map((highlight) => (
                        <button
                          key={highlight.id}
                          type="button"
                          onClick={() => goTo(highlight.locator, `Highlight · p. ${highlight.locator}`)}
                          className="group flex w-full cursor-pointer items-center gap-2 rounded-md py-1 pr-2 pl-9 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <span className="size-[5px] shrink-0 rounded-full" style={{ background: inkColor(highlight.color) }} />
                          <span className="xp-serif min-w-0 flex-1 truncate text-[13px] text-muted-foreground transition-colors group-hover:text-foreground">
                            {highlight.text}
                          </span>
                          {highlight.note && <NotebookPen className="size-3 shrink-0 text-muted-foreground" aria-label="Has a note" />}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>

              <div className="flex items-center gap-1.5 border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
                <QuietKbd>[</QuietKbd> pin
                <span className="ml-auto tabular-nums">{highlights.length} highlights</span>
              </div>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.p
            key={toast}
            role="status"
            className="absolute bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full bg-foreground px-3.5 py-1.5 text-xs text-background shadow-lg"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.2, ease: QUIET_EASE }}
          >
            {toast}
          </motion.p>
        )}
      </AnimatePresence>
    </StageSurface>
  );
}
