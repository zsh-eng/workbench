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
import { useRef, useState } from "react";
import { type HighlightColor } from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { useLabScreen } from "../frames";
import { JournalList, type JournalOrder } from "../JournalList";
import {
  ColorFilter,
  FilterChips,
  filterNotes,
  OrderToggle,
  Ribbon,
  useEntriesInView,
  type NoteFilter,
} from "../NotebookTools";
import {
  BOOK,
  CHAPTERS,
  CURRENT_PAGE,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  EASE,
  EASE_SHEET,
  SPRING_SOFT,
  useLabNotes,
  useLabToast,
  type LabNote,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import { LabToast, ReaderSurface } from "../lab-ui";

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
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [colors, setColors] = useState<HighlightColor[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [journal, setJournal] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const inView = useEntriesInView(list, [journal, phone]);
  const reduced = useReducedMotionConfig();

  const shown = filterNotes(notes, filter, colors);

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
          <ColorFilter value={colors} onChange={setColors} />
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
