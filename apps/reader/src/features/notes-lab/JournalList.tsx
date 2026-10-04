import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRight, Trash2, X } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { CHAPTERS, chapterOf } from "./lab-content";
import {
  colorVar,
  EASE,
  EASE_SHEET,
  relativeDay,
  SPRING_SNAP,
  SPRING_SOFT,
  type LabNote,
} from "./lab-model";

export type JournalOrder = "book" | "recent";

interface Group {
  key: string;
  label: ReactNode;
  notes: LabNote[];
}

function groupNotes(notes: LabNote[], order: JournalOrder): Group[] {
  if (order === "book") {
    return CHAPTERS.flatMap((chapter) => {
      const inChapter = notes
        .filter((note) => note.chapter === chapter.id)
        .sort(
          (a, b) =>
            a.page - b.page ||
            (a.range?.paragraph ?? 0) - (b.range?.paragraph ?? 0) ||
            (a.range?.start ?? 0) - (b.range?.start ?? 0) ||
            a.createdAt - b.createdAt,
        );
      if (!inChapter.length) return [];
      return [
        {
          key: `chapter:${chapter.id}`,
          label: (
            <>
              <span className="font-numeric text-[10px] tracking-[0.18em] text-muted-foreground/80">
                {chapter.numeral}
              </span>
              <span className="truncate">{chapter.title}</span>
            </>
          ),
          notes: inChapter,
        },
      ];
    });
  }
  const sorted = [...notes].sort((a, b) => b.createdAt - a.createdAt);
  const groups: Group[] = [];
  for (const note of sorted) {
    const days = (Date.now() - note.createdAt) / (24 * 60 * 60 * 1000);
    const label =
      relativeDay(note.createdAt) === "Today"
        ? "Today"
        : days < 7
          ? "This week"
          : days < 31
            ? "This month"
            : "Earlier";
    const last = groups[groups.length - 1];
    if (last?.key === `time:${label}`) last.notes.push(note);
    else groups.push({ key: `time:${label}`, label, notes: [note] });
  }
  return groups;
}

/** Strips one leading quotation mark so it can hang in the margin. */
export function splitQuote(quote: string) {
  return quote.startsWith("“")
    ? { mark: "“", body: quote.slice(1) }
    : { mark: "“", body: quote };
}

/** A quote set like marked print: a low highlighter stroke under the words. */
export function QuoteText({
  quote,
  color,
  className,
}: {
  quote: string;
  color: LabNote["color"];
  className?: string;
}) {
  const { mark, body } = splitQuote(quote);
  return (
    <blockquote
      className={cn("relative pl-[0.9em]", className)}
      style={{ fontFamily: "Lora, serif" }}
    >
      <span
        aria-hidden
        className="absolute top-[-0.08em] left-[-0.05em] text-[1.35em] leading-none"
        style={{
          color:
            color === "invisible"
              ? "var(--muted-foreground)"
              : `color-mix(in srgb, ${colorVar(color)} 70%, var(--foreground))`,
        }}
      >
        {mark}
      </span>
      <span
        className={cn(
          "[box-decoration-break:clone] [-webkit-box-decoration-break:clone]",
          color === "invisible" &&
            "underline decoration-muted-foreground/60 decoration-dotted decoration-[1.5px] underline-offset-[4px]",
        )}
        style={
          color === "invisible"
            ? undefined
            : {
                backgroundImage: `linear-gradient(transparent 58%, color-mix(in srgb, ${colorVar(color)} 80%, transparent) 58%, color-mix(in srgb, ${colorVar(color)} 80%, transparent) 94%, transparent 94%)`,
              }
        }
      >
        {body}
      </span>
    </blockquote>
  );
}

/**
 * Typeset notebook list. Entries are flat siblings of their headings, so a
 * change of order animates each entry to its new place.
 */
export function JournalList({
  notes,
  order,
  activeId,
  onSelect,
  onOpen,
  onDelete,
  expanded,
  renderExpanded,
  dense = false,
}: {
  notes: LabNote[];
  order: JournalOrder;
  activeId?: string | null;
  onSelect?: (id: string) => void;
  onOpen?: (note: LabNote) => void;
  onDelete?: (id: string) => void;
  expanded?: string | null;
  renderExpanded?: (note: LabNote) => ReactNode;
  dense?: boolean;
}) {
  const groups = groupNotes(notes, order);
  return (
    <div className="relative">
      <AnimatePresence initial={false}>
        {groups.flatMap((group) => [
          <motion.h3
            layout="position"
            key={group.key}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ ...SPRING_SOFT, opacity: { duration: 0.18 } }}
            className={cn(
              "sticky top-0 z-10 flex items-baseline gap-2 bg-gradient-to-b from-background via-background/95 to-background/0 pb-2 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground",
              dense ? "px-4 pt-3" : "px-5 pt-5",
            )}
          >
            {group.label}
          </motion.h3>,
          ...group.notes.map((note) => (
            <JournalEntry
              key={note.id}
              note={note}
              showChapter={order === "recent"}
              active={activeId === note.id}
              onSelect={onSelect}
              onOpen={onOpen}
              onDelete={onDelete}
              dense={dense}
              expanded={expanded === note.id}
              renderExpanded={renderExpanded}
            />
          )),
        ])}
      </AnimatePresence>
    </div>
  );
}

function JournalEntry({
  note,
  showChapter,
  active,
  onSelect,
  onOpen,
  onDelete,
  dense,
  expanded,
  renderExpanded,
}: {
  note: LabNote;
  showChapter: boolean;
  active: boolean;
  onSelect?: (id: string) => void;
  onOpen?: (note: LabNote) => void;
  onDelete?: (id: string) => void;
  dense: boolean;
  expanded: boolean;
  renderExpanded?: (note: LabNote) => ReactNode;
}) {
  return (
    <motion.article
      layout="position"
      data-journal-id={note.id}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.16 } }}
      transition={SPRING_SOFT}
      onClick={() => onSelect?.(note.id)}
      className={cn(
        "group relative cursor-default rounded-2xl transition-colors duration-200",
        dense ? "mx-2 px-3 py-2.5" : "mx-2.5 px-3.5 py-3",
        onSelect && "cursor-pointer hover:bg-secondary/55",
        active && "bg-secondary/70",
      )}
    >
      {note.quote ? (
        <QuoteText
          quote={note.quote}
          color={note.color}
          className={cn(
            "text-foreground",
            dense ? "text-[14px] leading-[1.5]" : "text-[15px] leading-[1.55]",
          )}
        />
      ) : null}
      {note.text && (
        <p
          className={cn(
            "pl-[0.9em] text-[13.5px] leading-relaxed whitespace-pre-wrap text-foreground/80",
            note.quote && "mt-1.5",
          )}
        >
          {note.text}
        </p>
      )}
      <footer className="mt-1.5 flex h-6 items-center gap-1.5 pl-[0.9em] text-[11px] text-muted-foreground">
        <span className="font-numeric tabular-nums">p. {note.page}</span>
        <span aria-hidden>·</span>
        <span className="truncate">
          {showChapter
            ? chapterOf(note.chapter).title
            : relativeDay(note.createdAt)}
        </span>
        <span className="ml-auto flex items-center gap-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
          {onOpen && (
            <button
              type="button"
              aria-label="Open in book"
              title="Open in book"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(note);
              }}
              className="flex size-6 items-center justify-center rounded-full hover:bg-background hover:text-foreground"
            >
              <ArrowUpRight className="size-3.5" />
            </button>
          )}
          {onDelete && (
            <button
              type="button"
              aria-label="Delete"
              title="Delete"
              onClick={(event) => {
                event.stopPropagation();
                onDelete(note.id);
              }}
              className="flex size-6 items-center justify-center rounded-full hover:bg-background hover:text-destructive"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </span>
      </footer>
      <AnimatePresence initial={false}>
        {expanded && renderExpanded && (
          <motion.div
            key="expanded"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.32, ease: EASE }}
            className="overflow-hidden"
          >
            {renderExpanded(note)}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}

/** Notebook sheet on phones and floating panel on desktop. */
export function NotebookPanel({
  open,
  phone,
  order,
  onOrder,
  notes,
  onClose,
  onOpenEntry,
}: {
  open: boolean;
  phone: boolean;
  order: JournalOrder;
  onOrder: (order: JournalOrder) => void;
  notes: LabNote[];
  onClose: () => void;
  onOpenEntry: (page: number) => void;
}) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            key="scrim"
            type="button"
            aria-label="Close notebook"
            className="absolute inset-0 z-40 bg-foreground/10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.section
            key="panel"
            aria-label="Notebook"
            className={cn(
              "absolute z-50 flex flex-col overflow-hidden border border-border/70 bg-background shadow-[0_30px_60px_-20px_color-mix(in_srgb,var(--foreground)_35%,transparent)]",
              phone
                ? "inset-x-0 bottom-0 h-[78%] rounded-t-[30px]"
                : "top-3 right-3 bottom-3 w-[400px] origin-top-right rounded-[28px]",
            )}
            initial={
              phone ? { y: "100%" } : { opacity: 0, scale: 0.6, x: 20, y: -20 }
            }
            animate={phone ? { y: 0 } : { opacity: 1, scale: 1, x: 0, y: 0 }}
            exit={
              phone
                ? { y: "100%", transition: { duration: 0.3, ease: EASE_SHEET } }
                : {
                    opacity: 0,
                    scale: 0.85,
                    x: 10,
                    y: -10,
                    transition: { duration: 0.18 },
                  }
            }
            transition={
              phone ? { duration: 0.46, ease: EASE_SHEET } : SPRING_SOFT
            }
          >
            {phone && (
              <span className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-border" />
            )}
            <header className="flex items-center gap-2 px-5 pt-3 pb-1">
              <h2 className="flex flex-1 items-baseline gap-2 text-[15px] font-semibold">
                Notebook
                <span className="font-numeric text-xs font-normal text-muted-foreground tabular-nums">
                  {notes.length}
                </span>
              </h2>
              <div className="flex h-7 items-center rounded-full bg-secondary p-0.5 text-[11px]">
                {(["book", "recent"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={order === value}
                    onClick={() => onOrder(value)}
                    className="relative h-full rounded-full px-2.5 font-medium text-muted-foreground aria-pressed:text-foreground"
                  >
                    {order === value && (
                      <motion.span
                        layoutId="notebook-order"
                        transition={SPRING_SNAP}
                        className="absolute inset-0 rounded-full bg-background shadow-sm"
                      />
                    )}
                    <span className="relative">
                      {value === "book" ? "In order" : "Recent"}
                    </span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label="Close notebook"
                onClick={onClose}
                className="flex size-8 items-center justify-center rounded-full hover:bg-secondary"
              >
                <X className="size-4" />
              </button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-8">
              <JournalList
                notes={notes}
                order={order}
                dense={phone}
                onSelect={(id) => {
                  const note = notes.find((entry) => entry.id === id);
                  if (note) onOpenEntry(note.page);
                }}
              />
            </div>
          </motion.section>
        </>
      )}
    </AnimatePresence>
  );
}
