import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import {
  ArrowUpRight,
  Copy,
  Highlighter,
  List,
  Maximize2,
  Minimize2,
  NotebookPen,
  Palette,
  Search,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { useLabScreen } from "../frames";
import { JournalList, type JournalOrder } from "../JournalList";
import {
  BOOK,
  CHAPTERS,
  CURRENT_PAGE,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  colorVar,
  EASE,
  EASE_SHEET,
  SPRING_SNAP,
  SPRING_SOFT,
  useLabNotes,
  useLabToast,
  type LabNote,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import { LabToast, ReaderSurface } from "../lab-ui";

type Filter = "all" | "thoughts" | "highlights";

/**
 * Commonplace: the notebook as a typeset reading journal. A ribbon maps every
 * entry onto the whole book and tracks what the list is showing.
 */
export function Commonplace() {
  const { device } = useLabScreen();
  const phone = device === "phone";
  const { notes, remove } = useLabNotes(seedNotes);
  const toast = useLabToast(3000);
  const [order, setOrder] = useState<JournalOrder>("book");
  const [filter, setFilter] = useState<Filter>("all");
  const [colors, setColors] = useState<HighlightColor[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [journal, setJournal] = useState(false);
  const [inView, setInView] = useState<string[]>([]);
  const list = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig();

  const shown = notes.filter(
    (note) =>
      (filter === "all" ||
        (filter === "thoughts" ? Boolean(note.text) : !note.text)) &&
      (!colors.length || colors.includes(note.color as HighlightColor)),
  );

  // Track which entries the list shows, for the ribbon's window.
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
    const timer = setInterval(update, 400);
    return () => {
      container.removeEventListener("scroll", update);
      observer.disconnect();
      clearInterval(timer);
    };
  }, [journal, phone]);

  function jump(id: string) {
    const container = list.current;
    const element = container?.querySelector<HTMLElement>(
      `[data-journal-id="${CSS.escape(id)}"]`,
    );
    if (!container || !element) return;
    setActive(id);
    container.scrollTo({ top: element.offsetTop - 64, behavior: "smooth" });
  }

  function deleteNote(id: string) {
    const undo = remove(id);
    toast.show("Removed from notebook", {
      label: "Undo",
      run: () => {
        undo();
        toast.dismiss();
      },
    });
  }

  const marks: PageMark[] = notes
    .filter((note) => note.range && note.range.end > note.range.start)
    .map((note) => ({
      id: note.id,
      ...note.range!,
      color: note.color,
      tone: active === note.id ? "focus" : undefined,
    }));

  const content = (
    <>
      <div
        className={cn("shrink-0", phone ? "px-5" : journal ? "px-10" : "px-5")}
      >
        <Ribbon notes={shown} inView={inView} active={active} onJump={jump} />
        <div className="mt-3 flex items-center gap-1.5">
          <FilterChips value={filter} onChange={setFilter} />
          <span className="mx-1 h-4 w-px bg-border" />
          {HIGHLIGHT_COLORS.map(({ name }) => {
            const on = colors.includes(name);
            return (
              <motion.button
                key={name}
                type="button"
                aria-label={`Only ${name}`}
                aria-pressed={on}
                whileTap={{ scale: 0.9 }}
                onClick={() =>
                  setColors((current) =>
                    on
                      ? current.filter((color) => color !== name)
                      : [...current, name],
                  )
                }
                className={cn(
                  "relative size-[18px] shrink-0 rounded-full transition-[box-shadow,opacity]",
                  colors.length && !on && "opacity-35",
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
          <div className="ml-auto">
            <OrderToggle value={order} onChange={setOrder} />
          </div>
        </div>
      </div>
      <div
        ref={list}
        className="relative mt-2 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-10"
      >
        <div className={cn(journal && "mx-auto max-w-[620px]")}>
          <JournalList
            notes={shown}
            order={order}
            activeId={active}
            dense={phone}
            expanded={expanded}
            onSelect={(id) => {
              setActive(id);
              setExpanded((current) => (current === id ? null : id));
            }}
            onOpen={(note) =>
              toast.show(
                note.page === CURRENT_PAGE
                  ? "Back to page 16"
                  : `Opens page ${note.page}`,
              )
            }
            onDelete={deleteNote}
            renderExpanded={(note) => (
              <Context
                note={note}
                onCopy={() => toast.show("Copied with citation")}
              />
            )}
          />
          <AnimatePresence>
            {!shown.length && (
              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="px-8 py-16 text-center text-[15px] text-muted-foreground italic"
                style={{ fontFamily: "Lora, serif" }}
              >
                Nothing matches these filters.
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );

  if (phone)
    return (
      <div className="absolute inset-0">
        <ReaderSurface>
          {(pageStyle) => (
            <LabPage paragraphs={PARAGRAPHS} marks={marks} style={pageStyle} />
          )}
        </ReaderSurface>
        <motion.div
          className="absolute inset-0 z-30 bg-foreground/15"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        />
        <motion.section
          aria-label="Notebook"
          className="absolute inset-x-0 bottom-0 z-40 flex flex-col overflow-hidden rounded-t-[30px] border-t border-border/60 bg-background shadow-[0_-20px_50px_-20px_color-mix(in_srgb,var(--foreground)_30%,transparent)]"
          style={{ top: "calc(var(--safe-top) + 10px)" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          transition={{ duration: 0.5, ease: EASE_SHEET, delay: 0.1 }}
        >
          <span className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />
          <header className="flex items-end justify-between px-5 pt-3 pb-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                {BOOK.title}
              </p>
              <h2
                className="mt-0.5 text-[24px] leading-none"
                style={{ fontFamily: "Lora, serif" }}
              >
                Commonplace
              </h2>
            </div>
            <span className="font-numeric text-xs text-muted-foreground tabular-nums">
              {shown.length} of {notes.length}
            </span>
          </header>
          {content}
        </motion.section>
        <LabToast toast={toast.toast} bottom={20} />
      </div>
    );

  return (
    <div className="absolute inset-0">
      <motion.div
        className="absolute inset-0"
        animate={{
          opacity: journal ? 0.25 : 1,
          filter: journal ? "blur(2px)" : "blur(0px)",
        }}
        transition={{ duration: 0.4, ease: EASE }}
      >
        <ReaderSurface>
          {(pageStyle) => (
            <LabPage paragraphs={PARAGRAPHS} marks={marks} style={pageStyle} />
          )}
        </ReaderSurface>
      </motion.div>
      <motion.section
        aria-label="Notebook"
        className="absolute z-40 flex flex-col overflow-hidden rounded-[28px] border border-border/70 bg-background/95 shadow-[-24px_0_64px_color-mix(in_srgb,var(--foreground)_12%,transparent)] backdrop-blur-2xl"
        initial={false}
        animate={
          journal
            ? { top: 28, bottom: 28, right: 150, width: 980 }
            : { top: 12, bottom: 12, right: 12, width: 400 }
        }
        transition={reduced ? { duration: 0 } : SPRING_SOFT}
      >
        <nav className="flex h-14 shrink-0 items-center gap-1.5 pr-2 pl-3">
          {[List, Search, Palette, Highlighter].map((Icon, index) => (
            <span
              key={index}
              className="flex size-9 items-center justify-center rounded-xl text-muted-foreground"
            >
              <Icon className="size-[1.15rem]" />
            </span>
          ))}
          <span className="flex size-9 items-center justify-center rounded-xl bg-secondary/70 text-foreground shadow-sm">
            <NotebookPen className="size-[1.15rem]" />
          </span>
          <span className="flex-1" />
          <button
            type="button"
            aria-label={journal ? "Back to sidebar" : "Open as journal"}
            title={journal ? "Back to sidebar" : "Open as journal"}
            onClick={() => setJournal((value) => !value)}
            className="flex size-9 items-center justify-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            {journal ? (
              <Minimize2 className="size-4" />
            ) : (
              <Maximize2 className="size-4" />
            )}
          </button>
        </nav>
        <header
          className={cn(
            "flex items-end justify-between pb-3",
            journal ? "px-10 pt-2" : "px-5",
          )}
        >
          <div>
            <p className="text-[10px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
              {BOOK.title}
            </p>
            <motion.h2
              layout="position"
              className="mt-1 leading-none"
              animate={{ fontSize: journal ? 34 : 24 }}
              transition={SPRING_SOFT}
              style={{ fontFamily: "Lora, serif" }}
            >
              Commonplace
            </motion.h2>
          </div>
          <span className="font-numeric text-xs text-muted-foreground tabular-nums">
            {shown.length} of {notes.length}
          </span>
        </header>
        {content}
      </motion.section>
      <LabToast toast={toast.toast} />
    </div>
  );
}

/**
 * The whole book as one line. Chapters are segments, entries are ticks, and a
 * soft window shows the part of the notebook currently in view.
 */
function Ribbon({
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

function Context({ note, onCopy }: { note: LabNote; onCopy: () => void }) {
  const paragraph = note.range ? PARAGRAPHS[note.range.paragraph] : null;
  return (
    <div className="mt-3 border-t border-border/70 pt-3 pl-[0.9em]">
      {paragraph && note.range && (
        <p
          className="text-[13px] leading-relaxed text-muted-foreground"
          style={{ fontFamily: "Lora, serif" }}
        >
          …
          {paragraph.slice(
            Math.max(0, note.range.start - 120),
            note.range.start,
          )}
          <span className="text-foreground">
            {paragraph.slice(note.range.start, note.range.end)}
          </span>
          {paragraph.slice(note.range.end, note.range.end + 120)}…
        </p>
      )}
      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onCopy();
          }}
          className="flex h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[11.5px] text-muted-foreground hover:text-foreground"
        >
          <Copy className="size-3" />
          Copy with citation
        </button>
        <span className="flex h-7 items-center gap-1 rounded-full px-2 text-[11.5px] text-muted-foreground">
          <ArrowUpRight className="size-3" />
          {CHAPTERS.find((chapter) => chapter.id === note.chapter)?.title}
        </span>
      </div>
    </div>
  );
}

function FilterChips({
  value,
  onChange,
}: {
  value: Filter;
  onChange: (value: Filter) => void;
}) {
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
              layoutId="commonplace-filter"
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

function OrderToggle({
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
