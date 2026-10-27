import { cn } from "@/lib/utils";
import { PencilLine, Trash2, Palette, X } from "lucide-react";
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { AnnotationColor } from "@/lib/highlight-constants";
import type { Highlight } from "@/types/highlight";
import type { Note } from "@/types/note";
import { useBookNotesQuery } from "@/hooks/use-notes-query";
import { MOTION } from "@/lib/motion";
import { UndoCountdown } from "@/components/UndoToast";
import { CopyFeedbackIcon } from "@/components/ui/copy-feedback-icon";
import { useCopyFeedback } from "@/hooks/use-copy-feedback";
import { flyWords } from "@/lib/feedback-motion";
import { SPRINGS, springTransition } from "@workbench/elements/spring";
import { NotebookCountIcon } from "./shared/NotebookCountIcon";

/**
 * Notes Island: one surface owns note capture on phones. It never floats over
 * plain reading. With the chrome, a capsule rides on the footer. Otherwise the
 * island rises centred at the bottom and changes shape between the colour
 * tools, a note, the composer and short notices.
 */

/** The island's floating material: the reading theme's popover colours. */
export const ISLAND_SURFACE =
  "border border-border/70 bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-xl";

/** The highlights that join the notebook: visible ones without a note. A
 * note on a highlight already shows its passage. */
export function notebookHighlights(notes: Note[], highlights: Highlight[]) {
  const noted = new Set(
    notes.flatMap((note) =>
      note.kind === "note" && note.highlightId ? [note.highlightId] : [],
    ),
  );
  return highlights.filter(
    (highlight) => highlight.color !== "invisible" && !noted.has(highlight.id),
  );
}

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`;

/** Resting state, docked on the footer where Jot a note was. It reads the
 * book's notes itself, so a saved note does not render the Reader. Its count
 * is the notebook's: notes, and highlights without a note. */
export function NotesCapsule({
  bookId,
  highlights,
  draft,
  disabled,
  onOpenNotebook,
  onJot,
}: {
  bookId: string;
  highlights: Highlight[];
  draft: boolean;
  disabled: boolean;
  onOpenNotebook: () => void;
  onJot: () => void;
}) {
  const notes = useBookNotesQuery(bookId).data ?? [];
  const noteCount = notes.filter((note) => note.kind === "note").length;
  const highlightCount = notebookHighlights(notes, highlights).length;
  const count = noteCount + highlightCount;
  const description = `${
    highlightCount === 0
      ? plural(noteCount, "note")
      : noteCount === 0
        ? plural(highlightCount, "highlight")
        : `${plural(noteCount, "note")} and ${plural(highlightCount, "highlight")}`
  } in this book`;
  return (
    <div
      data-notes-capsule=""
      className={cn(
        "pointer-events-auto mr-[10px] flex h-11 items-center gap-0.5 self-end rounded-full px-1",
        ISLAND_SURFACE,
      )}
    >
      <button
        type="button"
        aria-label="Open notebook"
        aria-description={description}
        disabled={disabled}
        onClick={onOpenNotebook}
        className="relative flex h-9 items-center rounded-full px-2 text-foreground before:absolute before:content-[''] before:-inset-y-1 hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
      >
        <NotebookCountIcon count={count} />
      </button>
      <span aria-hidden="true" className="h-4 w-px bg-border" />
      <button
        type="button"
        aria-label={draft ? "Continue draft" : "Jot a note"}
        title={draft ? "Continue draft" : "Jot a note"}
        disabled={disabled}
        onClick={onJot}
        className="relative flex h-9 items-center gap-1.5 rounded-full pr-3.5 pl-3 before:absolute before:content-[''] before:-inset-y-1 text-[13px] font-medium text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
      >
        <PencilLine className="size-4" aria-hidden="true" />
        {draft ? "Draft" : "Jot"}
        {draft && (
          <span
            aria-hidden="true"
            className="absolute top-2 right-2 size-1.5 rounded-full bg-foreground"
          />
        )}
      </button>
    </div>
  );
}

/**
 * A surface that changes shape with its content. Each state is a layer that
 * crossfades; the surface follows the layer's measured size. The first size is
 * applied before the surface paints, so a surface that appears never grows out
 * of an old shape or out of nothing.
 */
export function IslandSurface({
  layerKey,
  radius,
  exit = "fade",
  className,
  children,
}: {
  layerKey: string;
  radius: number;
  /** How the leaving layer goes: it fades, or it dissolves into the next
   * one, as a deleted note does into its Undo. */
  exit?: IslandExit;
  className?: string;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [settled, setSettled] = useState(false);
  // The first layer measures itself before React attaches this surface's
  // ref, which comes after the children's layout effects. That size waits
  // here for the surface's own layout effect.
  const firstSize = useRef<{ width: number; height: number } | null>(null);
  const measure = useCallback((width: number, height: number) => {
    const container = surface.current;
    if (!container) {
      firstSize.current = { width, height };
      return;
    }
    // The surface is border-box sized: include its border, or the
    // bottom-anchored layer sits off centre and loses its top edge.
    const style = getComputedStyle(container);
    const next = {
      width:
        width +
        parseFloat(style.borderLeftWidth) +
        parseFloat(style.borderRightWidth),
      height:
        height +
        parseFloat(style.borderTopWidth) +
        parseFloat(style.borderBottomWidth),
    };
    // Motion applies even an instant size a frame later. Until then the
    // surface, whose layers are absolute, would paint as its bare border and
    // jump to size part way through its entrance.
    if (!container.style.width) {
      container.style.width = `${next.width}px`;
      container.style.height = `${next.height}px`;
    }
    setSize((size) =>
      size?.width === next.width && size.height === next.height ? size : next,
    );
  }, []);
  useLayoutEffect(() => {
    const first = firstSize.current;
    firstSize.current = null;
    if (first) measure(first.width, first.height);
  }, [measure]);
  useEffect(() => {
    if (size && !settled) setSettled(true);
  }, [size, settled]);
  return (
    <motion.div
      ref={surface}
      className={cn(
        "pointer-events-auto relative overflow-hidden",
        ISLAND_SURFACE,
        className,
      )}
      initial={false}
      animate={
        size
          ? { width: size.width, height: size.height, borderRadius: radius }
          : { borderRadius: radius }
      }
      // The island lands with a little give, as the Dynamic Island does.
      transition={
        !settled || reduceMotion
          ? { duration: 0 }
          : springTransition(SPRINGS.morph)
      }
    >
      <AnimatePresence initial={false} custom={reduceMotion ? "fade" : exit}>
        <IslandLayer key={layerKey} onSize={measure}>
          {children}
        </IslandLayer>
      </AnimatePresence>
    </motion.div>
  );
}

export type IslandExit = "fade" | "dissolve";

const LAYER = {
  hidden: { opacity: 0 },
  shown: { opacity: 1, filter: "blur(0px)", scale: 1 },
  gone: (exit: IslandExit) =>
    exit === "dissolve"
      ? {
          opacity: 0,
          filter: "blur(6px)",
          scale: 0.94,
          transition: { duration: 0.26, ease: [0.4, 0, 1, 1] as const },
        }
      : { opacity: 0, transition: MOTION.exit },
};

/** One state of the surface. Only the present layer sizes the surface: a
 * leaving layer shares the space while it fades and must not report. It is
 * inert too, so its buttons take no tap and its status is not read. */
function IslandLayer({
  onSize,
  children,
}: {
  onSize: (width: number, height: number) => void;
  children: ReactNode;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const present = useIsPresent();
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element || !present) return;
    const update = () => onSize(element.offsetWidth, element.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [onSize, present]);
  return (
    <motion.div
      ref={layer}
      inert={!present}
      className="absolute bottom-0 left-1/2 w-max origin-bottom -translate-x-1/2"
      variants={LAYER}
      initial="hidden"
      animate="shown"
      exit="gone"
      transition={{ ...MOTION.enter, delay: 0.04 }}
    >
      {children}
    </motion.div>
  );
}

/** The colour tools for a passage, then Copy and Note. A fresh selection
 * and a saved highlight get the same tools, so each sits in one place. */
export function IslandTools({
  tools,
  copyText,
  actionLabel,
  onNote,
}: {
  tools: ReactNode;
  /** The whole passage, from the chapter text, as Copy writes it. Read at
   * the tap, as a selection can change while the tools show. */
  copyText: () => string;
  actionLabel: "Note" | "Attach";
  onNote: () => void;
}) {
  return (
    <div
      // A press here reads the selection for the action (useReaderAnnotations).
      data-selection-tools=""
      className="flex h-[52px] items-center gap-3 pr-1.5 pl-4 whitespace-nowrap"
    >
      {tools}
      <span aria-hidden="true" className="h-5 w-px bg-border" />
      <div className="-ml-1.5 flex items-center gap-1">
        <CopyPassageButton
          text={copyText}
          className="text-muted-foreground"
          iconClassName="size-[18px]"
        />
        <button
          type="button"
          aria-label={actionLabel === "Attach" ? "Attach to draft" : "Add note"}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onNote}
          className="flex h-10 items-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-medium text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <PencilLine className="size-4" aria-hidden="true" />
          {actionLabel}
        </button>
      </div>
    </div>
  );
}

/** Copies a passage and confirms in place with a check. */
function CopyPassageButton({
  text,
  className,
  iconClassName,
}: {
  text: () => string;
  className?: string;
  iconClassName: string;
}) {
  const { copied, copy } = useCopyFeedback("Could not copy the passage.");
  return (
    <button
      type="button"
      aria-label="Copy text"
      // Keep the page selection and focus where they are.
      onPointerDown={(event) => event.preventDefault()}
      onClick={() => {
        const passage = text();
        if (passage) copy(passage);
      }}
      className={cn(
        "flex size-11 items-center justify-center rounded-full transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
        className,
        copied && "text-foreground",
      )}
    >
      <CopyFeedbackIcon copied={copied} className={iconClassName} />
    </button>
  );
}

/** A saved note for the passage the reader tapped. Copy, like the tools'
 * Copy, writes the passage; the note is on screen to read. */
export function IslandNote({
  width,
  text,
  meta,
  copyText,
  onEdit,
  onDelete,
  onShowTools,
  onClose,
}: {
  width: number;
  text: string;
  meta: string;
  /** The highlighted passage, from the chapter text. */
  copyText: () => string;
  onEdit: () => void;
  onDelete: () => void;
  onShowTools: () => void;
  onClose: () => void;
}) {
  return (
    <section aria-label="Note" style={{ width }} className="px-4 pt-3.5 pb-2">
      <p className="max-h-40 overflow-y-auto text-[15px] leading-relaxed break-words whitespace-pre-wrap text-foreground">
        {text}
      </p>
      <footer className="mt-1 -mr-2.5 flex items-center text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">{meta}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onEdit}
          className="flex h-10 items-center gap-1 rounded-full px-3 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <PencilLine className="size-3.5" aria-hidden="true" />
          Edit
        </button>
        {/* Copy and the colours act on the passage, so they sit together.
            The bigger target keeps the footer's height. */}
        <CopyPassageButton
          text={copyText}
          className="-my-0.5"
          iconClassName="size-3.5"
        />
        <button
          type="button"
          aria-label="Show highlight tools"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onShowTools}
          className="flex size-10 items-center justify-center rounded-full hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Palette className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Delete note"
          onClick={onDelete}
          className="flex size-10 items-center justify-center rounded-full hover:bg-secondary hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Close note"
          onClick={onClose}
          className="flex size-10 items-center justify-center rounded-full hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <X className="size-3.5" aria-hidden="true" />
        </button>
      </footer>
    </section>
  );
}

export interface IslandNoticeState {
  key: number;
  label: string;
  color?: AnnotationColor;
  undo?: () => void;
  /** Where the saved words were on screen. They fly into the notice's mark,
   * and the mark takes them in. */
  from?: { rect: DOMRect; text: string };
}

/** A short confirmation, or a deletion with Undo. A confirmation's mark
 * pops and its check draws itself; after a save, the note's words fly into
 * it first. */
export function IslandNotice({
  notice,
  onUndo,
}: {
  notice: IslandNoticeState;
  onUndo: () => void;
}) {
  const reduceMotion = useReducedMotion() ?? false;
  const mark = useRef<HTMLSpanElement>(null);
  const flies = Boolean(notice.from) && !reduceMotion;
  const [arrived, setArrived] = useState(!flies);
  const from = notice.from;
  useLayoutEffect(() => {
    const target = mark.current;
    if (!flies || !from || !target) return;
    return flyWords(from, target, () => setArrived(true));
  }, [flies, from]);
  return (
    <div
      role="status"
      className="flex h-11 items-center gap-2.5 pr-1.5 pl-2 text-[13px] font-medium whitespace-nowrap"
    >
      {notice.undo ? (
        // The ring holds the place of the done mark, at the same size.
        <span className="flex size-7 items-center justify-center">
          <UndoCountdown key={notice.key} />
        </span>
      ) : (
        <motion.span
          ref={mark}
          aria-hidden="true"
          data-notice-mark=""
          className="flex size-7 items-center justify-center rounded-full"
          style={{
            background:
              !notice.color || notice.color === "invisible"
                ? "var(--secondary)"
                : `var(--${notice.color}-secondary)`,
          }}
          initial={reduceMotion ? false : { scale: 0.5, opacity: 0 }}
          animate={arrived ? { scale: 1, opacity: 1 } : undefined}
          transition={springTransition(SPRINGS.pop)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            className="size-3.5"
          >
            <motion.path
              d="M4.5 12.5 9.5 17.5 19.5 6.5"
              initial={{ pathLength: reduceMotion ? 1 : 0 }}
              animate={arrived ? { pathLength: 1 } : undefined}
              transition={{ ...springTransition(SPRINGS.snappy), delay: 0.08 }}
            />
          </svg>
        </motion.span>
      )}
      {notice.label}
      {notice.undo ? (
        <button
          type="button"
          onClick={onUndo}
          className="relative ml-1 h-8 rounded-full bg-secondary px-3.5 before:absolute before:content-[''] before:-inset-y-1.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring"
        >
          Undo
        </button>
      ) : (
        <span className="w-2.5" />
      )}
    </div>
  );
}
