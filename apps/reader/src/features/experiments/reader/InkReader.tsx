/**
 * Ink: highlighting as direct manipulation.
 *
 * The text is tokenised into words. A drag paints a word range with the
 * selected ink, so there is no selection-then-toolbar step. Marks render as
 * one inline element per run with `box-decoration-break: slice`, which lets
 * the ink sweep across line breaks in reading order. Margin notes are aligned
 * to each mark's first line and pushed apart when they would overlap.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { Eraser, Trash2 } from "lucide-react";
import {
  Fragment,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { StudioInk } from "../data/sample-library";
import { SELF_RELIANCE_CHAPTER } from "../data/sample-texts";
import {
  SNAPPY_SPRING,
  SOFT_SPRING,
  StageSurface,
  inkColor,
  inkWash,
  useElementSize,
} from "../primitives";

type Tool = StudioInk | "eraser";

interface InkMark {
  id: string;
  start: number;
  end: number;
  color: StudioInk;
  note: string;
  createdAt: number;
}

interface Token {
  kind: "word" | "space";
  text: string;
  /** Global word index; -1 for spaces. */
  index: number;
}

const INKS: StudioInk[] = ["yellow", "green", "blue", "magenta"];
const NOTE_GAP = 12;
const DEFAULT_NOTE_HEIGHT = 96;

/** Splits paragraphs into word and space tokens with global word indices. */
function tokenize(paragraphs: string[]) {
  let index = 0;
  const words: string[] = [];
  const sentenceOf: number[] = [];
  let sentence = 0;
  const tokens = paragraphs.map((paragraph) =>
    paragraph.split(/(\s+)/).filter(Boolean).map((text): Token => {
      if (/^\s+$/.test(text)) return { kind: "space", text, index: -1 };
      const token: Token = { kind: "word", text, index };
      words.push(text);
      sentenceOf.push(sentence);
      if (/[.!?]["”’)]*$/.test(text)) sentence += 1;
      index += 1;
      return token;
    }),
  );
  return { tokens, words, sentenceOf };
}

const TEXT = tokenize(SELF_RELIANCE_CHAPTER.paragraphs);

function findPhrase(phrase: string): [number, number] {
  const target = phrase.split(/\s+/);
  for (let start = 0; start <= TEXT.words.length - target.length; start += 1) {
    if (target.every((word, offset) => TEXT.words[start + offset] === word)) {
      return [start, start + target.length - 1];
    }
  }
  return [0, target.length - 1];
}

function seedMarks(now: number): InkMark[] {
  const trust = findPhrase("Trust thyself: every heart vibrates to that iron string.");
  const great = findPhrase("To be great is to be misunderstood.");
  const genius = findPhrase("To believe your own thought,");
  return [
    { id: "seed-genius", start: genius[0], end: genius[1], color: "blue", note: "", createdAt: now - 1000 * 60 * 60 * 26 },
    { id: "seed-trust", start: trust[0], end: trust[1], color: "yellow", note: "The thesis, in nine words.", createdAt: now - 1000 * 60 * 42 },
    { id: "seed-great", start: great[0], end: great[1], color: "green", note: "", createdAt: now - 1000 * 60 * 8 },
  ];
}

function sentenceRange(wordIndex: number): [number, number] {
  const sentence = TEXT.sentenceOf[wordIndex];
  let start = wordIndex;
  let end = wordIndex;
  while (start > 0 && TEXT.sentenceOf[start - 1] === sentence) start -= 1;
  while (end < TEXT.words.length - 1 && TEXT.sentenceOf[end + 1] === sentence) end += 1;
  return [start, end];
}

function excerpt(start: number, end: number, maxWords = 16): string {
  const words = TEXT.words.slice(start, end + 1);
  return words.length > maxWords ? `${words.slice(0, maxWords).join(" ")}…` : words.join(" ");
}

function relativeTime(createdAt: number, now: number): string {
  const minutes = Math.round((now - createdAt) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

type Owner =
  | { kind: "plain" }
  | { kind: "mark"; mark: InkMark; erasing: boolean }
  | { kind: "draft"; color: StudioInk };

function ownerKey(owner: Owner): string {
  if (owner.kind === "plain") return "plain";
  if (owner.kind === "draft") return "draft";
  return owner.mark.id;
}

export function InkReader() {
  const reducedMotion = useReducedMotion() ?? false;
  const [now] = useState(() => Date.now());
  const [marks, setMarks] = useState<InkMark[]>(() => seedMarks(Date.now()));
  const [tool, setTool] = useState<Tool>("yellow");
  const [draft, setDraft] = useState<{ anchor: number; focus: number } | null>(null);
  const [hoveredMark, setHoveredMark] = useState<string | null>(null);
  const [openMark, setOpenMark] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(reducedMotion);
  const [notePositions, setNotePositions] = useState<Record<string, number>>({});
  const [popover, setPopover] = useState<{ x: number; y: number } | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const asideRef = useRef<HTMLElement>(null);
  const noteRefs = useRef(new Map<string, HTMLDivElement>());
  const pressRef = useRef<{ x: number; y: number; word: number; moved: boolean } | null>(null);
  const [containerRef, containerSize] = useElementSize<HTMLDivElement>();
  const wide = containerSize.width >= 940;

  // Pen cursor follows the pointer with a stiff spring.
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);
  const penX = useSpring(cursorX, { stiffness: 900, damping: 50, mass: 0.3 });
  const penY = useSpring(cursorY, { stiffness: 900, damping: 50, mass: 0.3 });
  const [penVisible, setPenVisible] = useState(false);
  const [pressing, setPressing] = useState(false);

  useEffect(() => {
    if (reducedMotion) return;
    const timeout = window.setTimeout(() => setRevealed(true), 350);
    return () => window.clearTimeout(timeout);
  }, [reducedMotion]);

  const draftRange = draft
    ? ([Math.min(draft.anchor, draft.focus), Math.max(draft.anchor, draft.focus)] as const)
    : null;

  const ownerOf = (index: number): Owner => {
    if (draftRange && tool !== "eraser" && index >= draftRange[0] && index <= draftRange[1]) {
      return { kind: "draft", color: tool };
    }
    const mark = marks.find((candidate) => index >= candidate.start && index <= candidate.end);
    if (!mark) return { kind: "plain" };
    const erasing =
      tool === "eraser" &&
      draftRange !== null &&
      mark.start <= draftRange[1] &&
      mark.end >= draftRange[0];
    return { kind: "mark", mark, erasing };
  };

  /* ---------- Pointer painting ---------- */

  const wordAt = (x: number, y: number): number | null => {
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-w]");
    if (!element || !contentRef.current?.contains(element)) return null;
    return Number(element.dataset.w);
  };

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const word = wordAt(event.clientX, event.clientY);
    setPressing(true);
    setPopover(null);
    setOpenMark(null);
    if (word === null) return;
    event.preventDefault();
    pressRef.current = { x: event.clientX, y: event.clientY, word, moved: false };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointers cannot be captured.
    }
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    cursorX.set(event.clientX - rect.left);
    cursorY.set(event.clientY - rect.top);
    const press = pressRef.current;
    if (!press) return;
    if (!press.moved && Math.hypot(event.clientX - press.x, event.clientY - press.y) < 4) return;
    press.moved = true;
    const word = wordAt(event.clientX, event.clientY);
    if (word === null) return;
    setDraft((current) => ({ anchor: current?.anchor ?? press.word, focus: word }));
  };

  const commit = (start: number, end: number) => {
    if (tool === "eraser") {
      setMarks((current) => current.filter((mark) => mark.end < start || mark.start > end));
      return;
    }
    const id = `mark-${Date.now()}`;
    setMarks((current) => {
      // A new stroke absorbs any mark it touches, keeping their notes.
      const overlapped = current.filter((mark) => mark.start <= end && mark.end >= start);
      const kept = current.filter((mark) => mark.end < start || mark.start > end);
      const note = overlapped.map((mark) => mark.note).filter(Boolean).join(" ");
      return [...kept, { id, start, end, color: tool, note, createdAt: Date.now() }].sort(
        (a, b) => a.start - b.start,
      );
    });
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>) => {
    setPressing(false);
    const press = pressRef.current;
    pressRef.current = null;
    if (!press) return;

    if (draft && press.moved) {
      const [start, end] = [Math.min(draft.anchor, draft.focus), Math.max(draft.anchor, draft.focus)];
      setDraft(null);
      commit(start, end);
      return;
    }
    setDraft(null);

    // A tap on a mark opens its colour menu.
    const mark = marks.find((candidate) => press.word >= candidate.start && press.word <= candidate.end);
    // Pointer capture retargets pointerup, so find the mark from the pressed word.
    const target = contentRef.current
      ?.querySelector(`[data-w="${press.word}"]`)
      ?.closest<HTMLElement>("[data-mark]");
    if (mark && target && contentRef.current) {
      const containerRect = event.currentTarget.getBoundingClientRect();
      const first = target.getClientRects()[0];
      setOpenMark(mark.id);
      setPopover({
        x: first.left - containerRect.left + Math.min(first.width, 220) / 2,
        y: first.top - containerRect.top,
      });
    }
  };

  const handleDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    const word = wordAt(event.clientX, event.clientY);
    if (word === null) return;
    setPopover(null);
    setOpenMark(null);
    const [start, end] = sentenceRange(word);
    commit(start, end);
  };

  /* ---------- Margin note layout ---------- */

  const sortedMarks = useMemo(() => [...marks].sort((a, b) => a.start - b.start), [marks]);

  useLayoutEffect(() => {
    const content = contentRef.current;
    const aside = asideRef.current;
    if (!content || !aside || !wide) return;
    const base = aside.getBoundingClientRect().top;
    let cursor = -Infinity;
    const next: Record<string, number> = {};
    for (const mark of sortedMarks) {
      const element = content.querySelector<HTMLElement>(`[data-mark="${mark.id}"]`);
      const rect = element?.getClientRects()[0];
      if (!rect) continue;
      const desired = rect.top - base - 6;
      const top = Math.max(desired, cursor);
      next[mark.id] = top;
      cursor = top + (noteRefs.current.get(mark.id)?.offsetHeight ?? DEFAULT_NOTE_HEIGHT) + NOTE_GAP;
    }
    setNotePositions((current) => {
      const same =
        Object.keys(next).length === Object.keys(current).length &&
        Object.entries(next).every(([key, value]) => Math.abs((current[key] ?? -1) - value) < 0.5);
      return same ? current : next;
    });
    // Note edits change card heights, so marks (with their notes) are a dependency.
  }, [sortedMarks, wide, containerSize.width]);

  const updateNote = (id: string, note: string) => {
    setMarks((current) => current.map((mark) => (mark.id === id ? { ...mark, note } : mark)));
  };

  const recolor = (id: string, color: StudioInk) => {
    setMarks((current) => current.map((mark) => (mark.id === id ? { ...mark, color } : mark)));
  };

  const removeMark = (id: string) => {
    setMarks((current) => current.filter((mark) => mark.id !== id));
    setOpenMark(null);
    setPopover(null);
  };

  /* ---------- Text rendering ---------- */

  const renderParagraph = (tokens: Token[], paragraphIndex: number) => {
    const runs: { owner: Owner; tokens: Token[] }[] = [];
    let pendingSpace: Token | null = null;

    for (const token of tokens) {
      if (token.kind === "space") {
        pendingSpace = token;
        continue;
      }
      const owner = ownerOf(token.index);
      const last = runs[runs.length - 1];
      if (last && ownerKey(last.owner) === ownerKey(owner) && owner.kind !== "plain") {
        if (pendingSpace) last.tokens.push(pendingSpace);
        last.tokens.push(token);
      } else {
        if (pendingSpace) {
          if (last && last.owner.kind === "plain") last.tokens.push(pendingSpace);
          else runs.push({ owner: { kind: "plain" }, tokens: [pendingSpace] });
        }
        const current = runs[runs.length - 1];
        if (owner.kind === "plain" && current?.owner.kind === "plain") current.tokens.push(token);
        else runs.push({ owner, tokens: [token] });
      }
      pendingSpace = null;
    }

    const renderTokens = (list: Token[]): ReactNode =>
      list.map((token, index) =>
        token.kind === "space" ? (
          <Fragment key={`s${index}`}>{token.text}</Fragment>
        ) : (
          <span key={token.index} data-w={token.index}>
            {token.text}
          </span>
        ),
      );

    return (
      <p key={paragraphIndex} className={paragraphIndex === 0 ? "xp-opening" : "indent-[1.4em]"}>
        {runs.map((run, runIndex) => {
          if (run.owner.kind === "plain") {
            return <Fragment key={runIndex}>{renderTokens(run.tokens)}</Fragment>;
          }
          const color = run.owner.kind === "draft" ? run.owner.color : run.owner.mark.color;
          const markId = run.owner.kind === "mark" ? run.owner.mark.id : "draft";
          const style = {
            "--xp-ink": inkWash(color),
            "--xp-ink-size": run.owner.kind === "draft" || revealed ? "100%" : "0%",
          } as CSSProperties;
          return (
            <mark
              key={`${markId}-${runIndex}`}
              data-mark={markId}
              data-hovered={hoveredMark === markId || openMark === markId}
              data-erasing={run.owner.kind === "mark" && run.owner.erasing}
              onPointerEnter={() => run.owner.kind === "mark" && setHoveredMark(markId)}
              onPointerLeave={() => setHoveredMark(null)}
              className="xp-ink text-inherit"
              style={{ ...style, color: "inherit", transitionDelay: revealed ? undefined : `${runIndex * 0.05}s` }}
            >
              {renderTokens(run.tokens)}
            </mark>
          );
        })}
      </p>
    );
  };

  const openMarkData = marks.find((mark) => mark.id === openMark);
  const noteCount = marks.filter((mark) => mark.note.trim()).length;

  const toolRail = (
    <div
      className={cn(
        "z-20 flex items-center gap-1.5",
        wide ? "sticky top-8 flex-col self-start pt-2" : "sticky top-0 justify-center bg-background/90 py-3 backdrop-blur",
      )}
      role="radiogroup"
      aria-label="Ink"
    >
      {INKS.map((ink) => {
        const active = tool === ink;
        return (
          <button
            key={ink}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${ink} ink`}
            onClick={() => setTool(ink)}
            className="group relative grid h-11 w-11 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* A marker: chisel tip in strong ink over a body in the wash. */}
            <motion.span
              className="flex flex-col items-center"
              animate={
                wide
                  ? { x: active ? 8 : 0, rotate: active ? -14 : 0, scale: active ? 1.1 : 1 }
                  : { y: active ? -5 : 0, rotate: active ? -14 : 0, scale: active ? 1.1 : 1 }
              }
              transition={SNAPPY_SPRING}
            >
              <span
                className="block h-[7px] w-[8px]"
                style={{ background: inkColor(ink), clipPath: "polygon(0 45%, 100% 0, 100% 100%, 0 100%)" }}
              />
              <span
                className="block h-[26px] w-[14px] rounded-[3px_3px_5px_5px] shadow-sm ring-1 ring-black/10"
                style={{ background: `linear-gradient(to right, ${inkWash(ink)}, color-mix(in oklab, ${inkWash(ink)} 80%, var(--foreground)))` }}
              />
            </motion.span>
            {active && (
              <motion.span
                layoutId="ink-active-dot"
                transition={SNAPPY_SPRING}
                className={cn("absolute size-1 rounded-full bg-foreground", wide ? "left-0" : "bottom-0")}
              />
            )}
          </button>
        );
      })}
      <span className={cn("bg-border", wide ? "my-1 h-px w-6" : "mx-1 h-6 w-px")} />
      <button
        type="button"
        role="radio"
        aria-checked={tool === "eraser"}
        aria-label="Eraser"
        onClick={() => setTool("eraser")}
        className={cn(
          "grid size-11 cursor-pointer place-items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
          tool === "eraser" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
        )}
      >
        <Eraser className="size-4" />
      </button>
    </div>
  );

  const notes = (
    <AnimatePresence initial={false}>
      {sortedMarks.map((mark) => {
        const top = notePositions[mark.id];
        const hovered = hoveredMark === mark.id;
        return (
          <motion.div
            key={mark.id}
            ref={(node) => {
              if (node) noteRefs.current.set(mark.id, node);
              else noteRefs.current.delete(mark.id);
            }}
            layout={wide ? false : "position"}
            initial={{ opacity: 0, x: wide ? 18 : 0, y: wide ? (top ?? 0) : 8, filter: "blur(6px)" }}
            animate={{ opacity: top === undefined && wide ? 0 : 1, x: 0, y: wide ? (top ?? 0) : 0, filter: "blur(0px)" }}
            exit={{ opacity: 0, scale: 0.96, filter: "blur(4px)", transition: { duration: 0.18 } }}
            transition={SOFT_SPRING}
            onPointerEnter={() => setHoveredMark(mark.id)}
            onPointerLeave={() => setHoveredMark(null)}
            className={cn(
              "rounded-2xl border bg-card p-3.5 transition-[box-shadow,border-color] duration-200",
              wide ? "absolute inset-x-0 top-0" : "relative",
              hovered ? "border-foreground/20 shadow-lg shadow-black/5" : "shadow-sm",
            )}
          >
            <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="size-2 rounded-full" style={{ background: inkColor(mark.color) }} />
              <span className="capitalize">{mark.color}</span>
              <span className="opacity-40">·</span>
              <span>{relativeTime(mark.createdAt, now)}</span>
            </div>
            <p className="xp-serif line-clamp-3 text-[15px] leading-snug text-foreground/75 italic">
              {excerpt(mark.start, mark.end)}
            </p>
            <textarea
              value={mark.note}
              onChange={(event) => updateNote(mark.id, event.target.value)}
              placeholder="Add a note…"
              rows={1}
              className="xp-serif mt-2 field-sizing-content w-full resize-none bg-transparent text-[15px] leading-snug outline-none placeholder:text-muted-foreground/60"
            />
          </motion.div>
        );
      })}
    </AnimatePresence>
  );

  return (
    <StageSurface tone="paper" className="relative size-full">
      <div
        ref={containerRef}
        className="xp-scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain"
      >
        <div
          className={cn(
            "mx-auto grid gap-x-10 px-5 pb-24",
            wide ? "max-w-[1120px] grid-cols-[3rem_minmax(0,34rem)_17rem] justify-center pt-12" : "max-w-[40rem] grid-cols-1",
          )}
        >
          {toolRail}

          <div
            className="relative"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerEnter={() => setPenVisible(true)}
            onPointerLeave={() => {
              setPenVisible(false);
              setPressing(false);
            }}
            onDoubleClick={handleDoubleClick}
            style={{ cursor: "none" }}
          >
            <header className="mb-10 select-none">
              <p className="xp-smcp text-xs tracking-[0.24em] text-muted-foreground">
                {SELF_RELIANCE_CHAPTER.book}
              </p>
              <h4 className="xp-serif mt-2 text-6xl leading-[0.95] tracking-[-0.025em] italic">
                {SELF_RELIANCE_CHAPTER.title}
              </h4>
              <p className="xp-smcp mt-3 text-xs tracking-[0.2em] text-muted-foreground">
                {SELF_RELIANCE_CHAPTER.author}
              </p>
            </header>
            <div
              ref={contentRef}
              className="xp-book-text space-y-0 text-[20px] leading-[1.62] select-none"
              style={{ textAlign: "left" }}
            >
              {TEXT.tokens.map((tokens, index) => renderParagraph(tokens, index))}
            </div>

            {/* Pen cursor */}
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute top-0 left-0 z-30"
              style={{ x: penX, y: penY }}
              animate={{ opacity: penVisible ? 1 : 0 }}
              transition={{ duration: 0.15 }}
            >
              {tool === "eraser" ? (
                <motion.span
                  className="block size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground/60 bg-background/40"
                  animate={{ scale: pressing ? 0.8 : 1 }}
                  transition={SNAPPY_SPRING}
                />
              ) : (
                <motion.span
                  className="block h-7 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
                  style={{ background: inkColor(tool), transformOrigin: "50% 50%" }}
                  animate={{ scaleX: pressing ? 3.2 : 1, rotate: pressing ? 0 : 12 }}
                  transition={SNAPPY_SPRING}
                />
              )}
            </motion.div>

            {/* Colour menu for a tapped mark */}
            <AnimatePresence>
              {popover && openMarkData && (
                <motion.div
                  key={openMarkData.id}
                  initial={{ opacity: 0, scale: 0.85, y: 6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.9, transition: { duration: 0.12 } }}
                  transition={SNAPPY_SPRING}
                  className="absolute z-40 flex -translate-x-1/2 -translate-y-[calc(100%+10px)] items-center gap-1 rounded-full border bg-popover p-1 text-popover-foreground shadow-xl"
                  style={{ left: popover.x, top: popover.y, cursor: "default" }}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {INKS.map((ink) => (
                    <button
                      key={ink}
                      type="button"
                      aria-label={`Change to ${ink}`}
                      onClick={() => recolor(openMarkData.id, ink)}
                      className="grid size-8 cursor-pointer place-items-center rounded-full outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <motion.span
                        className="block size-4 rounded-full ring-1 ring-black/10"
                        style={{ background: inkWash(ink) }}
                        animate={{ scale: openMarkData.color === ink ? 1.25 : 1 }}
                        transition={SNAPPY_SPRING}
                      />
                    </button>
                  ))}
                  <span className="mx-0.5 h-5 w-px bg-border" />
                  <button
                    type="button"
                    aria-label="Remove mark"
                    onClick={() => removeMark(openMarkData.id)}
                    className="grid size-8 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:bg-muted hover:text-destructive focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <aside ref={asideRef} className={cn("relative", !wide && "mt-10 space-y-3")} aria-label="Margin notes">
            {!wide && (
              <p className="xp-smcp mb-2 text-xs text-muted-foreground">Margin</p>
            )}
            {notes}
          </aside>
        </div>
      </div>

      <div className="pointer-events-none absolute right-5 bottom-4 rounded-full border bg-background/85 px-3 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur">
        <span className="tabular-nums text-foreground">{marks.length}</span> {marks.length === 1 ? "mark" : "marks"}
        <span className="mx-1.5 opacity-40">·</span>
        <span className="tabular-nums text-foreground">{noteCount}</span> {noteCount === 1 ? "note" : "notes"}
      </div>
    </StageSurface>
  );
}
