/**
 * Threads: marginalia tied to the text.
 *
 * Every kept passage has a note in the margin, joined to it by a fine thread.
 * Notes follow their passages on springs, so a fast scroll stretches the
 * threads and they settle when you stop. Select words to start a new thread:
 * choose an ink, the passage is marked, the thread draws itself, and the note
 * waits for you to write.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import type { StudioInk } from "../data/sample-library";
import { WALDEN_CHAPTER } from "../data/sample-texts";
import { EASE_OUT, inkColor, inkWash, Kbd, SNAPPY_SPRING, useElementSize } from "../primitives";
import { CHAPTERS, EDGE_HIGHLIGHTS, TEXT_CHAPTER, type InkFlash } from "../data/walden-book";

const INKS: StudioInk[] = ["yellow", "green", "blue", "magenta"];
const INK_LABEL: Record<StudioInk, string> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  magenta: "Magenta",
};

interface Thread {
  id: string;
  paragraph: number;
  start: number;
  end: number;
  color: StudioInk;
  note: string;
  daysAgo: number;
  /** Drawn on arrival instead of with the opening sequence. */
  fresh: boolean;
}

interface Draft {
  paragraph: number;
  start: number;
  end: number;
  anchor: number;
}

function initialThreads(): Thread[] {
  return EDGE_HIGHLIGHTS.filter((highlight) => highlight.chapter === TEXT_CHAPTER).flatMap((highlight) => {
    const paragraph = WALDEN_CHAPTER.paragraphs.findIndex((text) => text.includes(highlight.text));
    if (paragraph < 0) return [];
    const start = WALDEN_CHAPTER.paragraphs[paragraph].indexOf(highlight.text);
    return [
      {
        id: highlight.id,
        paragraph,
        start,
        end: start + highlight.text.length,
        color: highlight.color,
        note: highlight.note ?? "",
        daysAgo: highlight.daysAgo,
        fresh: false,
      },
    ];
  });
}

function threadText(thread: Pick<Thread, "paragraph" | "start" | "end">): string {
  return WALDEN_CHAPTER.paragraphs[thread.paragraph].slice(thread.start, thread.end);
}

/** Grows a selection to whole words, with closing punctuation. */
function snapToWords(text: string, start: number, end: number): [number, number] {
  let from = start;
  let to = end;
  while (from > 0 && /\S/.test(text[from - 1])) from -= 1;
  while (to < text.length && /[\p{L}\p{N}’'-]/u.test(text[to])) to += 1;
  if (to < text.length && /[.,;:!?”]/.test(text[to])) to += 1;
  while (to > from && /\s/.test(text[to - 1])) to -= 1;
  while (from < to && /\s/.test(text[from])) from += 1;
  return [from, to];
}

function offsetWithin(root: Node, node: Node, offset: number): number {
  const range = document.createRange();
  range.selectNodeContents(root);
  range.setEnd(node, offset);
  return range.toString().length;
}

function dayLabel(daysAgo: number): string {
  if (daysAgo <= 0) return "today";
  if (daysAgo === 1) return "yesterday";
  return `${daysAgo} days ago`;
}

const KNOT_OFFSET = 12;
const CARD_GAP = 14;

export function Threads() {
  const reducedMotion = useReducedMotion() ?? false;
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [threads, setThreads] = useState<Thread[]>(initialThreads);
  const [anchors, setAnchors] = useState<Record<string, number>>({});
  const [heights, setHeights] = useState<Record<string, number>>({});
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [hiddenInks, setHiddenInks] = useState<StudioInk[]>([]);
  const [flash, setFlash] = useState<InkFlash | null>(null);
  const [sheetId, setSheetId] = useState<string | null>(null);
  const scrollY = useMotionValue(0);

  const wide = stage.width >= 860;
  const headerHeight = 56;
  const bodyHeight = Math.max(0, stage.height - headerHeight);
  const marginWidth = 252;
  const gutter = 76;
  const textWidth = wide ? Math.min(600, Math.round(stage.width * 0.48)) : Math.max(0, stage.width - 40);
  const textLeft = wide
    ? Math.max(48, Math.round((stage.width - (textWidth + gutter + marginWidth)) / 2) - 16)
    : 20;
  const textRight = textLeft + textWidth;
  const knotX = textRight + 16;
  const marginX = textRight + gutter;

  const visibleThreads = threads.filter((thread) => !hiddenInks.includes(thread.color));
  const ordered = [...visibleThreads].sort(
    (a, b) => (anchors[a.id] ?? 0) - (anchors[b.id] ?? 0) || a.paragraph - b.paragraph || a.start - b.start,
  );

  // Notes stack in reading order and never overlap.
  const layoutY: Record<string, number> = {};
  let floor = -Infinity;
  for (const thread of ordered) {
    const anchor = anchors[thread.id];
    if (anchor === undefined) continue;
    const top = Math.max(anchor - KNOT_OFFSET, floor);
    layoutY[thread.id] = top;
    floor = top + (heights[thread.id] ?? 64) + CARD_GAP;
  }

  const measureAnchors = useCallback(() => {
    const scroller = scrollerRef.current;
    const content = contentRef.current;
    if (!scroller || !content) return;
    const scrollerTop = scroller.getBoundingClientRect().top;
    const next: Record<string, number> = {};
    content.querySelectorAll<HTMLElement>("[data-thread]").forEach((mark) => {
      const rect = mark.getClientRects()[0];
      const id = mark.dataset.thread;
      if (!rect || !id) return;
      next[id] = rect.top - scrollerTop + scroller.scrollTop + rect.height / 2;
    });
    setAnchors((current) => {
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.keys(next).every((id) => Math.abs((current[id] ?? -1) - next[id]) < 0.5);
      return same ? current : next;
    });
  }, []);

  useLayoutEffect(() => {
    measureAnchors();
    const content = contentRef.current;
    if (!content) return;
    const observer = new ResizeObserver(measureAnchors);
    observer.observe(content);
    void document.fonts?.ready.then(measureAnchors);
    return () => observer.disconnect();
  }, [measureAnchors, threads, textWidth]);

  const reportHeight = useCallback((id: string, height: number) => {
    setHeights((current) => (Math.abs((current[id] ?? 0) - height) < 0.5 ? current : { ...current, [id]: height }));
  }, []);

  const scrollToThread = (thread: Thread) => {
    const scroller = scrollerRef.current;
    const anchor = anchors[thread.id];
    if (!scroller || anchor === undefined) return;
    scroller.scrollTo({
      top: Math.max(0, anchor - bodyHeight * 0.36),
      behavior: reducedMotion ? "auto" : "smooth",
    });
    setFlash({ id: thread.id, key: Date.now() });
  };

  const readSelection = () => {
    const selection = window.getSelection();
    const content = contentRef.current;
    const scroller = scrollerRef.current;
    if (!selection || selection.isCollapsed || !content || !scroller || selection.rangeCount === 0) {
      return;
    }
    const range = selection.getRangeAt(0);
    const startPara = (range.startContainer.parentElement ?? null)?.closest<HTMLElement>("[data-para]");
    const endPara = (range.endContainer.parentElement ?? null)?.closest<HTMLElement>("[data-para]");
    if (!startPara || startPara !== endPara || !content.contains(startPara)) return;
    const paragraph = Number(startPara.dataset.para);
    const text = WALDEN_CHAPTER.paragraphs[paragraph];
    const rawStart = offsetWithin(startPara, range.startContainer, range.startOffset);
    const rawEnd = offsetWithin(startPara, range.endContainer, range.endOffset);
    const [start, end] = snapToWords(text, Math.min(rawStart, rawEnd), Math.max(rawStart, rawEnd));
    if (end - start < 2) return;
    const overlaps = threads.some(
      (thread) => thread.paragraph === paragraph && thread.start < end && start < thread.end,
    );
    if (overlaps) return;
    const rect = range.getClientRects()[0] ?? range.getBoundingClientRect();
    const anchor = rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop + rect.height / 2;
    setDraft({ paragraph, start, end, anchor });
    setEditingId(null);
  };

  const commitDraft = (color: StudioInk) => {
    if (!draft) return;
    const id = `t${Date.now()}`;
    setThreads((current) => [
      ...current,
      { id, paragraph: draft.paragraph, start: draft.start, end: draft.end, color, note: "", daysAgo: 0, fresh: true },
    ]);
    setHiddenInks((current) => current.filter((ink) => ink !== color));
    setDraft(null);
    window.getSelection()?.removeAllRanges();
    setFlash({ id, key: Date.now() });
    if (wide) setEditingId(id);
    else setSheetId(id);
  };

  const updateNote = (id: string, note: string) => {
    setThreads((current) => current.map((thread) => (thread.id === id ? { ...thread, note } : thread)));
  };

  const removeThread = (id: string) => {
    setThreads((current) => current.filter((thread) => thread.id !== id));
    setHoveredId(null);
    setEditingId(null);
    setSheetId(null);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLTextAreaElement) return;
    if (draft && ["1", "2", "3", "4"].includes(event.key)) {
      event.preventDefault();
      commitDraft(INKS[Number(event.key) - 1]);
    } else if (event.key === "Escape") {
      setDraft(null);
      setSheetId(null);
      window.getSelection()?.removeAllRanges();
    }
  };

  const counts = Object.fromEntries(
    INKS.map((ink) => [ink, threads.filter((thread) => thread.color === ink).length]),
  ) as Record<StudioInk, number>;
  const sheetThread = threads.find((thread) => thread.id === sheetId) ?? null;
  const ready = stage.width > 0;
  let threadIndex = 0;

  return (
    <div
      ref={stageRef}
      className="relative size-full overflow-hidden bg-background text-foreground outline-none"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <header
        className="absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-4 border-b border-foreground/[0.06] bg-background/85 px-5 backdrop-blur-md md:px-7"
        style={{ height: headerHeight }}
      >
        <div className="flex min-w-0 items-baseline gap-3">
          <p className="xp-serif text-lg italic">Walden</p>
          <p className="xp-smcp truncate text-xs text-muted-foreground max-sm:hidden">
            Chapter {CHAPTERS[TEXT_CHAPTER].numeral} · {threads.length} threads
          </p>
        </div>
        <div className="flex items-center gap-4">
        <p className="text-xs text-muted-foreground max-lg:hidden">
          Select words to tie a thread · <Kbd>1</Kbd>–<Kbd>4</Kbd> for ink
        </p>
        <div role="group" aria-label="Show inks" className="flex items-center gap-1">
          {INKS.map((ink) => {
            const hidden = hiddenInks.includes(ink);
            return (
              <button
                key={ink}
                type="button"
                aria-pressed={!hidden}
                aria-label={`${INK_LABEL[ink]} threads`}
                onClick={() =>
                  setHiddenInks((current) =>
                    hidden ? current.filter((value) => value !== ink) : [...current, ink],
                  )
                }
                className={cn(
                  "flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-xs outline-none transition-[opacity,background-color] hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
                  hidden && "opacity-40",
                )}
              >
                <span
                  className="size-2.5 rounded-full transition-transform"
                  style={{ background: inkColor(ink), transform: hidden ? "scale(0.6)" : undefined }}
                />
                <span className="xp-lnum text-muted-foreground">{counts[ink]}</span>
              </button>
            );
          })}
        </div>
        </div>
      </header>

      <div
        ref={scrollerRef}
        className="xp-scroll-quiet absolute inset-x-0 bottom-0 overflow-y-auto overscroll-contain"
        style={{ top: headerHeight }}
        onScroll={(event) => scrollY.set(event.currentTarget.scrollTop)}
      >
        <div
          ref={contentRef}
          className="relative"
          style={{ marginLeft: textLeft, width: textWidth, paddingTop: 56, paddingBottom: bodyHeight * 0.6 }}
          onPointerUp={() => window.setTimeout(readSelection, 0)}
        >
          <div className="mb-10 md:mb-14">
            <p className="xp-serif text-[5.5rem] leading-[0.8] text-muted-foreground/40 md:text-[8rem]">
              {CHAPTERS[TEXT_CHAPTER].numeral}
            </p>
            <h2 className="xp-serif mt-4 text-[2rem] leading-[1.05] tracking-[-0.015em] text-balance italic md:text-[2.75rem]">
              {WALDEN_CHAPTER.title}
            </h2>
            <p className="xp-smcp mt-4 text-xs text-muted-foreground">Walden · Henry David Thoreau</p>
          </div>
          <div className="xp-book-text text-[18px] leading-[1.7] md:text-[20px]">
            {WALDEN_CHAPTER.paragraphs.map((text, paragraph) => (
              <p key={paragraph} data-para={paragraph} className={paragraph === 0 ? "xp-opening" : undefined}>
                <ThreadedParagraph
                  text={text}
                  threads={visibleThreads.filter((thread) => thread.paragraph === paragraph)}
                  draft={draft?.paragraph === paragraph ? draft : null}
                  hoveredId={hoveredId}
                  flash={flash}
                  onHover={setHoveredId}
                  onOpen={(id) => {
                    if (wide) {
                      setEditingId(null);
                      return;
                    }
                    setSheetId(id);
                    // Keep the passage in view above the sheet.
                    const anchor = anchors[id];
                    if (anchor !== undefined) {
                      scrollerRef.current?.scrollTo({
                        top: Math.max(0, anchor - bodyHeight * 0.28),
                        behavior: reducedMotion ? "auto" : "smooth",
                      });
                    }
                  }}
                />
              </p>
            ))}
          </div>
        </div>
      </div>

      {ready && wide && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 overflow-hidden" style={{ top: headerHeight }}>
          <div
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-foreground/[0.07]"
            style={{ left: marginX - 10 }}
          />
          <AnimatePresence>
            {ordered.map((thread) => {
              const top = layoutY[thread.id];
              const anchor = anchors[thread.id];
              if (top === undefined || anchor === undefined) return null;
              const index = threadIndex;
              threadIndex += 1;
              return (
                <ThreadNote
                  key={thread.id}
                  thread={thread}
                  index={index}
                  anchor={anchor}
                  top={top}
                  scrollY={scrollY}
                  knotX={knotX}
                  marginX={marginX}
                  width={marginWidth}
                  height={bodyHeight}
                  hoveredId={hoveredId}
                  editing={editingId === thread.id}
                  reducedMotion={reducedMotion}
                  onHover={setHoveredId}
                  onHeight={reportHeight}
                  onOpen={() => scrollToThread(thread)}
                  onEdit={() => setEditingId(thread.id)}
                  onNote={(note) => updateNote(thread.id, note)}
                  onDone={() => setEditingId(null)}
                  onRemove={() => removeThread(thread.id)}
                  onWheel={(deltaY) => scrollerRef.current?.scrollBy({ top: deltaY })}
                />
              );
            })}
          </AnimatePresence>
          <AnimatePresence>
            {draft && (
              <DraftNote
                key={`${draft.paragraph}-${draft.start}`}
                draft={draft}
                scrollY={scrollY}
                knotX={knotX}
                marginX={marginX}
                width={marginWidth}
                height={bodyHeight}
                onChoose={commitDraft}
                onCancel={() => setDraft(null)}
              />
            )}
          </AnimatePresence>
        </div>
      )}

      {ready && !wide && (
        <AnimatePresence>
          {(sheetThread || draft) && (
            <motion.div
              key="sheet"
              initial={{ y: "110%" }}
              animate={{ y: 0 }}
              exit={{ y: "110%" }}
              transition={SNAPPY_SPRING}
              className="absolute inset-x-3 bottom-3 z-40 rounded-2xl border bg-background/95 p-4 shadow-[0_20px_50px_-20px_rgb(0_0_0/0.4)] backdrop-blur-xl"
            >
              {draft ? (
                <InkChooser draft={draft} onChoose={commitDraft} onCancel={() => setDraft(null)} />
              ) : sheetThread ? (
                <SheetNote
                  thread={sheetThread}
                  onNote={(note) => updateNote(sheetThread.id, note)}
                  onClose={() => setSheetId(null)}
                  onRemove={() => removeThread(sheetThread.id)}
                />
              ) : null}
            </motion.div>
          )}
        </AnimatePresence>
      )}

    </div>
  );
}

function ThreadedParagraph({
  text,
  threads,
  draft,
  hoveredId,
  flash,
  onHover,
  onOpen,
}: {
  text: string;
  threads: Thread[];
  draft: Draft | null;
  hoveredId: string | null;
  flash: InkFlash | null;
  onHover: (id: string | null) => void;
  onOpen: (id: string) => void;
}) {
  type Span = { start: number; end: number; thread: Thread | null };
  const spans: Span[] = threads.map((thread) => ({ start: thread.start, end: thread.end, thread }));
  if (draft) spans.push({ start: draft.start, end: draft.end, thread: null });
  spans.sort((a, b) => a.start - b.start);

  const pieces: ReactNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start < cursor) continue;
    pieces.push(text.slice(cursor, span.start));
    const content = text.slice(span.start, span.end);
    if (span.thread) {
      const thread = span.thread;
      const flashing = flash?.id === thread.id;
      pieces.push(
        <mark
          key={`${thread.id}-${flashing ? flash.key : 0}`}
          data-thread={thread.id}
          data-flash={flashing ? "true" : undefined}
          data-hovered={hoveredId === thread.id ? "true" : undefined}
          onPointerEnter={() => onHover(thread.id)}
          onPointerLeave={() => onHover(null)}
          onClick={() => onOpen(thread.id)}
          className="xp-ink cursor-pointer"
          style={{
            "--xp-ink": inkWash(thread.color),
            opacity: hoveredId && hoveredId !== thread.id ? 0.55 : 1,
            transition: "opacity 0.25s ease, background-size 0.75s cubic-bezier(0.65,0,0.35,1), background-position 0.25s ease",
          } as CSSProperties}
        >
          {content}
        </mark>,
      );
    } else {
      pieces.push(
        <span
          key="draft"
          className="rounded-[2px] bg-foreground/[0.08] outline-1 outline-foreground/25 outline-dashed"
        >
          {content}
        </span>,
      );
    }
    cursor = span.end;
  }
  pieces.push(text.slice(cursor));
  return <>{pieces}</>;
}

function threadPath(x0: number, y0: number, x1: number, y1: number): string {
  const reach = (x1 - x0) * 0.55;
  return `M ${x0} ${y0} C ${x0 + reach} ${y0}, ${x1 - reach} ${y1}, ${x1} ${y1}`;
}

function ThreadNote({
  thread,
  index,
  anchor,
  top,
  scrollY,
  knotX,
  marginX,
  width,
  height,
  hoveredId,
  editing,
  reducedMotion,
  onHover,
  onHeight,
  onOpen,
  onEdit,
  onNote,
  onDone,
  onRemove,
  onWheel,
}: {
  thread: Thread;
  index: number;
  anchor: number;
  top: number;
  scrollY: MotionValue<number>;
  knotX: number;
  marginX: number;
  width: number;
  height: number;
  hoveredId: string | null;
  editing: boolean;
  reducedMotion: boolean;
  onHover: (id: string | null) => void;
  onHeight: (id: string, height: number) => void;
  onOpen: () => void;
  onEdit: () => void;
  onNote: (note: string) => void;
  onDone: () => void;
  onRemove: () => void;
  onWheel: (deltaY: number) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const target = useTransform(scrollY, (value) => top - value);
  // Lower notes follow a little more loosely, so a scroll ripples down the margin.
  const y = useSpring(target, {
    stiffness: reducedMotion ? 2000 : 230 - Math.min(index, 6) * 16,
    damping: reducedMotion ? 120 : 26,
    mass: 0.9,
  });
  const anchorY = useTransform(scrollY, (value) => anchor - value);
  const d = useTransform([anchorY, y], ([from, to]: number[]) =>
    threadPath(knotX, from, marginX - 10, to + KNOT_OFFSET),
  );
  const knotY = useTransform(y, (value) => value + KNOT_OFFSET);
  const active = hoveredId === thread.id;
  const dimmed = hoveredId !== null && !active;
  const text = threadText(thread);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const observer = new ResizeObserver(() => onHeight(thread.id, card.offsetHeight));
    observer.observe(card);
    onHeight(thread.id, card.offsetHeight);
    return () => observer.disconnect();
  }, [onHeight, thread.id]);

  return (
    <>
      <svg
        aria-hidden="true"
        className="absolute inset-0 overflow-visible"
        width="100%"
        height={height}
        style={{ opacity: dimmed ? 0.18 : 1, transition: "opacity 0.3s ease" }}
      >
        <motion.path
          d={d}
          fill="none"
          stroke={inkColor(thread.color)}
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: active ? 1 : 0.55, strokeWidth: active ? 1.6 : 1 }}
          exit={{ pathLength: 0, opacity: 0, transition: { duration: 0.35, ease: EASE_OUT } }}
          transition={{
            pathLength: { duration: 0.8, delay: thread.fresh ? 0.15 : 0.35 + index * 0.08, ease: EASE_OUT },
            opacity: { duration: 0.3 },
            strokeWidth: { duration: 0.2 },
          }}
        />
        {active && !reducedMotion && (
          <motion.path
            d={d}
            fill="none"
            stroke={inkColor(thread.color)}
            strokeWidth={3}
            strokeLinecap="round"
            initial={{ pathLength: 0.07, pathOffset: 0, opacity: 0 }}
            animate={{ pathOffset: [0, 0.93], opacity: [0, 1, 1, 0] }}
            transition={{ duration: 1.1, ease: "easeInOut", repeat: Infinity, repeatDelay: 0.25 }}
          />
        )}
        <motion.circle
          cx={knotX}
          cy={anchorY}
          fill={inkColor(thread.color)}
          initial={{ r: 0 }}
          animate={{ r: active ? 3.5 : 2.25 }}
          exit={{ r: 0 }}
          transition={SNAPPY_SPRING}
        />
        <motion.circle
          cx={marginX - 10}
          cy={knotY}
          fill="var(--background)"
          stroke={inkColor(thread.color)}
          strokeWidth={1.25}
          initial={{ r: 0 }}
          animate={{ r: active ? 4 : 3 }}
          exit={{ r: 0 }}
          transition={{ ...SNAPPY_SPRING, delay: thread.fresh ? 0.5 : 0.6 + index * 0.08 }}
        />
      </svg>

      <motion.div
        ref={cardRef}
        className="pointer-events-auto absolute top-0"
        style={{ left: marginX, width, y }}
        initial={{ opacity: 0, x: 10 }}
        animate={{ opacity: dimmed ? 0.35 : 1, x: active ? -3 : 0 }}
        exit={{ opacity: 0, x: 12, transition: { duration: 0.25 } }}
        transition={{
          opacity: { duration: 0.35, delay: thread.fresh ? 0 : 0.5 + index * 0.08 },
          x: SNAPPY_SPRING,
        }}
        onPointerEnter={() => onHover(thread.id)}
        onPointerLeave={() => onHover(null)}
        onWheel={(event) => onWheel(event.deltaY)}
      >
        <div
          className={cn(
            "group relative -mx-3 -my-2 rounded-xl px-3 py-2 transition-colors duration-200",
            active && !editing && "bg-foreground/[0.04]",
            editing && "bg-card shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] ring-1 ring-foreground/10",
          )}
        >
          {editing ? (
            <NoteEditor
              initial={thread.note}
              placeholder="Write a note…"
              onSave={(note) => {
                onNote(note);
                onDone();
              }}
            />
          ) : (
            <button
              type="button"
              onClick={onOpen}
              onDoubleClick={onEdit}
              className="block w-full cursor-pointer text-left outline-none"
            >
              {thread.note ? (
                <span className="xp-serif block text-[15.5px] leading-[1.45] text-foreground/85 italic">
                  {thread.note}
                </span>
              ) : (
                <span className="xp-serif line-clamp-2 block text-[14.5px] leading-[1.4] text-muted-foreground">
                  “{text}”
                </span>
              )}
            </button>
          )}
          <div className="mt-1.5 flex h-4 items-center gap-2 text-[11px] text-muted-foreground">
            <span className="xp-smcp">{dayLabel(thread.daysAgo)}</span>
            {!editing && (
              <span className="flex gap-2 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                <span aria-hidden="true">·</span>
                <button type="button" onClick={onEdit} className="xp-smcp cursor-pointer hover:text-foreground">
                  {thread.note ? "Edit" : "Add note"}
                </button>
                <button type="button" onClick={onRemove} className="xp-smcp cursor-pointer hover:text-foreground">
                  Cut
                </button>
              </span>
            )}
          </div>
        </div>
      </motion.div>
    </>
  );
}

function NoteEditor({
  initial,
  placeholder,
  onSave,
  autoFocus = true,
}: {
  initial: string;
  placeholder: string;
  onSave: (note: string) => void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const field = ref.current;
    if (!field || !autoFocus) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(field.value.length, field.value.length);
  }, [autoFocus]);

  return (
    <textarea
      ref={ref}
      value={value}
      rows={2}
      placeholder={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => onSave(value.trim())}
      onKeyDown={(event) => {
        if ((event.key === "Enter" && !event.shiftKey) || event.key === "Escape") {
          event.preventDefault();
          onSave(value.trim());
        }
      }}
      className="xp-serif block w-full resize-none bg-transparent text-[15.5px] leading-[1.45] italic outline-none placeholder:text-muted-foreground [field-sizing:content]"
    />
  );
}

function DraftNote({
  draft,
  scrollY,
  knotX,
  marginX,
  width,
  height,
  onChoose,
  onCancel,
}: {
  draft: Draft;
  scrollY: MotionValue<number>;
  knotX: number;
  marginX: number;
  width: number;
  height: number;
  onChoose: (color: StudioInk) => void;
  onCancel: () => void;
}) {
  const y = useTransform(scrollY, (value) => draft.anchor - value - KNOT_OFFSET);
  const d = useTransform(scrollY, (value) =>
    threadPath(knotX, draft.anchor - value, marginX - 10, draft.anchor - value),
  );

  return (
    <>
      <svg aria-hidden="true" className="absolute inset-0 overflow-visible" width="100%" height={height}>
        <motion.path
          d={d}
          fill="none"
          stroke="var(--foreground)"
          strokeOpacity={0.35}
          strokeDasharray="3 4"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: EASE_OUT }}
        />
      </svg>
      <motion.div
        className="pointer-events-auto absolute top-0"
        style={{ left: marginX, width, y }}
        initial={{ opacity: 0, x: 12, filter: "blur(4px)" }}
        animate={{ opacity: 1, x: 0, filter: "blur(0px)" }}
        exit={{ opacity: 0, x: 8, transition: { duration: 0.15 } }}
        transition={{ duration: 0.35, ease: EASE_OUT }}
      >
        <div className="-mx-3 -my-2 rounded-xl bg-card px-3 py-2.5 shadow-[0_12px_32px_-16px_rgb(0_0_0/0.35)] ring-1 ring-foreground/10">
          <InkChooser draft={draft} onChoose={onChoose} onCancel={onCancel} compact />
        </div>
      </motion.div>
    </>
  );
}

function InkChooser({
  draft,
  onChoose,
  onCancel,
  compact = false,
}: {
  draft: Draft;
  onChoose: (color: StudioInk) => void;
  onCancel: () => void;
  compact?: boolean;
}) {
  return (
    <div>
      <p className={cn("xp-serif line-clamp-2 text-muted-foreground italic", compact ? "text-[14px] leading-[1.35]" : "text-base")}>
        “{threadText(draft)}”
      </p>
      <div className="mt-2.5 flex items-center justify-between">
        <div role="group" aria-label="Choose an ink" className="flex gap-1.5">
          {INKS.map((ink, index) => (
            <motion.button
              key={ink}
              type="button"
              aria-label={`${INK_LABEL[ink]} (${index + 1})`}
              onClick={() => onChoose(ink)}
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              whileHover={{ scale: 1.18 }}
              whileTap={{ scale: 0.9 }}
              transition={{ ...SNAPPY_SPRING, delay: 0.05 + index * 0.04 }}
              className="size-6 cursor-pointer rounded-full ring-2 ring-background outline-none focus-visible:ring-foreground"
              style={{ background: inkColor(ink) }}
            />
          ))}
        </div>
        <button type="button" onClick={onCancel} className="xp-smcp cursor-pointer text-[11px] text-muted-foreground hover:text-foreground">
          Cancel
        </button>
      </div>
    </div>
  );
}

function SheetNote({
  thread,
  onNote,
  onClose,
  onRemove,
}: {
  thread: Thread;
  onNote: (note: string) => void;
  onClose: () => void;
  onRemove: () => void;
}) {
  return (
    <div>
      <div className="flex items-start gap-3">
        <span className="mt-1.5 size-2.5 shrink-0 rounded-full" style={{ background: inkColor(thread.color) }} />
        <p className="xp-serif text-[15px] leading-snug text-muted-foreground">“{threadText(thread)}”</p>
      </div>
      <div className="mt-3 border-t border-foreground/10 pt-3">
        <NoteEditor
          key={thread.id}
          initial={thread.note}
          placeholder="Write a note…"
          onSave={onNote}
          autoFocus={thread.fresh && !thread.note}
        />
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-muted-foreground">
        <button type="button" onClick={onRemove} className="xp-smcp cursor-pointer">
          Cut thread
        </button>
        <button type="button" onClick={onClose} className="xp-smcp cursor-pointer text-foreground">
          Done
        </button>
      </div>
    </div>
  );
}
