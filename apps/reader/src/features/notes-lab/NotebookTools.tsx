import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useState, type RefObject } from "react";
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import type { JournalOrder } from "./JournalList";
import { BOOK, CHAPTERS, CURRENT_PAGE } from "./lab-content";
import {
  colorVar,
  EASE,
  SPRING_SNAP,
  SPRING_SOFT,
  type LabNote,
} from "./lab-model";

/** Notebook filters, order and book map shared by the notebook prototypes. */
export type NoteFilter = "all" | "thoughts" | "highlights";

export function filterNotes(
  notes: LabNote[],
  filter: NoteFilter,
  colors: HighlightColor[],
) {
  return notes.filter(
    (note) =>
      (filter === "all" ||
        (filter === "thoughts" ? Boolean(note.text) : !note.text)) &&
      (!colors.length || colors.includes(note.color as HighlightColor)),
  );
}

/** Tracks which journal entries are visible in a scrolling list. */
export function useEntriesInView(
  list: RefObject<HTMLElement | null>,
  dependencies: unknown[],
) {
  const [inView, setInView] = useState<string[]>([]);
  const key = JSON.stringify(dependencies);
  useEffect(() => {
    const container = list.current;
    if (!container) return;
    const update = () => {
      const top = container.scrollTop;
      const bottom = top + container.clientHeight;
      const ids = [
        ...container.querySelectorAll<HTMLElement>("[data-journal-id]"),
      ]
        .filter((element) => {
          const start = element.offsetTop;
          return start + element.offsetHeight > top + 24 && start < bottom - 24;
        })
        .map((element) => element.dataset.journalId!);
      setInView((current) => (current.join() === ids.join() ? current : ids));
    };
    update();
    container.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(container);
    // Entries also move when filters change without a resize.
    const timer = setInterval(update, 400);
    return () => {
      container.removeEventListener("scroll", update);
      observer.disconnect();
      clearInterval(timer);
    };
  }, [list, key]);
  return inView;
}

/** Multi-select highlight colour filter. No selection shows every colour. */
export function ColorFilter({
  value,
  onChange,
}: {
  value: HighlightColor[];
  onChange: (value: HighlightColor[]) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Filter by colour"
      className="flex items-center gap-1.5"
    >
      {HIGHLIGHT_COLORS.map(({ name }) => {
        const on = value.includes(name);
        return (
          <motion.button
            key={name}
            type="button"
            aria-label={`Only ${name}`}
            aria-pressed={on}
            whileTap={{ scale: 0.9 }}
            onClick={() =>
              onChange(
                on ? value.filter((color) => color !== name) : [...value, name],
              )
            }
            className={cn(
              "relative size-[18px] shrink-0 rounded-full transition-[box-shadow,opacity]",
              value.length && !on && "opacity-35",
            )}
            style={{
              background: colorVar(name),
              boxShadow: on
                ? "0 0 0 2px var(--background), 0 0 0 3.5px var(--foreground)"
                : "inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent)",
            }}
          />
        );
      })}
    </div>
  );
}

/**
 * The whole book as one line. Chapters are segments, entries are ticks, and a
 * soft window shows the part of the notebook currently in view.
 */
export function Ribbon({
  notes,
  inView,
  active,
  onJump,
}: {
  notes: LabNote[];
  inView: string[];
  active: string | null;
  onJump: (id: string) => void;
}) {
  const [hover, setHover] = useState<LabNote | null>(null);
  const total = BOOK.pages;
  const at = (page: number) => `${((page - 1) / total) * 100}%`;
  const visiblePages = notes
    .filter((note) => inView.includes(note.id))
    .map((note) => note.page);
  const windowStart = visiblePages.length ? Math.min(...visiblePages) : null;
  const windowEnd = visiblePages.length ? Math.max(...visiblePages) : null;
  const stacks = new Map<number, number>();

  return (
    <div className="relative pt-5 pb-5 select-none">
      <div className="relative h-[22px]">
        <div className="absolute inset-x-0 top-[9px] flex h-1 gap-[2px]">
          {CHAPTERS.map((chapter, index) => {
            const end = CHAPTERS[index + 1]?.start ?? total;
            return (
              <span
                key={chapter.id}
                title={`${chapter.numeral}. ${chapter.title}`}
                className="h-full rounded-full bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]"
                style={{ flexGrow: end - chapter.start }}
              />
            );
          })}
        </div>
        {windowStart !== null && windowEnd !== null && (
          <motion.span
            aria-hidden
            className="absolute top-0 h-[22px] rounded-md border border-foreground/15 bg-foreground/[0.04]"
            initial={false}
            animate={{
              left: `calc(${at(windowStart)} - 6px)`,
              width: `calc(${at(windowEnd)} - ${at(windowStart)} + 12px)`,
            }}
            transition={SPRING_SOFT}
          />
        )}
        {notes.map((note) => {
          const level = stacks.get(note.page) ?? 0;
          stacks.set(note.page, level + 1);
          const on = active === note.id || hover?.id === note.id;
          return (
            <motion.button
              key={note.id}
              type="button"
              aria-label={`Entry on page ${note.page}`}
              className="absolute top-[3px] -ml-[5px] flex h-4 w-[10px] justify-center"
              style={{ left: at(note.page) }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: -level * 3 }}
              exit={{ opacity: 0 }}
              transition={SPRING_SNAP}
              onPointerEnter={() => setHover(note)}
              onPointerLeave={() => setHover(null)}
              onClick={() => onJump(note.id)}
            >
              <motion.span
                className="block w-[3px] rounded-full"
                animate={{ height: on ? 16 : 12, width: on ? 4 : 3 }}
                transition={SPRING_SNAP}
                style={{
                  background:
                    note.color === "invisible"
                      ? "color-mix(in srgb, var(--foreground) 55%, transparent)"
                      : `color-mix(in srgb, ${colorVar(note.color)} 85%, var(--foreground))`,
                }}
              />
            </motion.button>
          );
        })}
        <span
          aria-hidden
          className="absolute -top-[7px] -ml-[4px] size-0 border-x-[4px] border-t-[5px] border-x-transparent border-t-foreground"
          style={{ left: at(CURRENT_PAGE) }}
        />
      </div>
      <div className="mt-1.5 flex justify-between font-numeric text-[10px] text-muted-foreground tabular-nums">
        <span>1</span>
        <span>You are on p. {CURRENT_PAGE}</span>
        <span>{total}</span>
      </div>
      <AnimatePresence>
        {hover && (
          <motion.div
            key={hover.id}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15, ease: EASE }}
            className="pointer-events-none absolute -top-9 z-20 max-w-[240px] -translate-x-1/2 truncate rounded-lg bg-primary px-2.5 py-1 text-[11px] text-primary-foreground shadow-lg"
            style={{
              left: `clamp(120px, ${at(hover.page)}, calc(100% - 120px))`,
            }}
          >
            p. {hover.page} · {hover.quote ?? hover.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function FilterChips({
  value,
  onChange,
}: {
  value: NoteFilter;
  onChange: (value: NoteFilter) => void;
}) {
  // Each filter instance animates its own selection pill.
  const id = useId();
  return (
    <div className="flex h-7 items-center rounded-full bg-secondary/70 p-0.5 text-[11px]">
      {(["all", "thoughts", "highlights"] as const).map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className="relative h-full rounded-full px-2.5 font-medium text-muted-foreground capitalize aria-pressed:text-foreground"
        >
          {value === option && (
            <motion.span
              layoutId={`note-filter-${id}`}
              transition={SPRING_SNAP}
              className="absolute inset-0 rounded-full bg-background shadow-sm"
            />
          )}
          <span className="relative">{option}</span>
        </button>
      ))}
    </div>
  );
}

export function OrderToggle({
  value,
  onChange,
}: {
  value: JournalOrder;
  onChange: (value: JournalOrder) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(value === "book" ? "recent" : "book")}
      className="flex h-7 items-center gap-1 rounded-full px-2.5 text-[11px] font-medium whitespace-nowrap text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={value}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.18, ease: EASE }}
        >
          {value === "book" ? "Book order" : "Recent"}
        </motion.span>
      </AnimatePresence>
    </button>
  );
}
