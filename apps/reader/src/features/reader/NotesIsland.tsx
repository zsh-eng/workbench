import { cn } from "@/lib/utils";
import { PencilLine, Trash2, Palette, X, Check } from "lucide-react";
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
import { useBookNotesQuery } from "@/hooks/use-notes-query";
import { MOTION } from "@/lib/motion";
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

/** Resting state, docked on the footer where Jot a note was. It reads the
 * book's notes itself, so a saved note does not render the Reader. */
export function NotesCapsule({
  bookId,
  draft,
  disabled,
  onOpenNotebook,
  onJot,
}: {
  bookId: string;
  draft: boolean;
  disabled: boolean;
  onOpenNotebook: () => void;
  onJot: () => void;
}) {
  const notes = useBookNotesQuery(bookId).data;
  const count = notes?.filter((note) => note.kind === "note").length ?? 0;
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
        aria-description={`${count} ${count === 1 ? "note" : "notes"} in this book`}
        disabled={disabled}
        onClick={onOpenNotebook}
        className="flex h-9 items-center rounded-full px-2 text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
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
        className="relative flex h-9 items-center gap-1.5 rounded-full pr-3.5 pl-3 text-[13px] font-medium text-foreground hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40"
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
 * applied at once, so a surface that appears never grows out of an old shape.
 */
export function IslandSurface({
  layerKey,
  radius,
  className,
  children,
}: {
  layerKey: string;
  radius: number;
  className?: string;
  children: ReactNode;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [settled, setSettled] = useState(false);
  const measure = useCallback((width: number, height: number) => {
    const container = surface.current;
    if (!container) return;
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
    setSize((size) =>
      size?.width === next.width && size.height === next.height ? size : next,
    );
  }, []);
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
      transition={!settled || reduceMotion ? { duration: 0 } : MOTION.shape}
    >
      <AnimatePresence initial={false}>
        <IslandLayer key={layerKey} onSize={measure}>
          {children}
        </IslandLayer>
      </AnimatePresence>
    </motion.div>
  );
}

/** One state of the surface. Only the present layer sizes the surface: a
 * leaving layer shares the space while it fades and must not report. */
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
      className="absolute bottom-0 left-1/2 w-max -translate-x-1/2"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: MOTION.exit }}
      transition={{ ...MOTION.enter, delay: 0.04 }}
    >
      {children}
    </motion.div>
  );
}

/** The colour tools for a passage, followed by Note. */
export function IslandTools({
  tools,
  actionLabel,
  onNote,
}: {
  tools: ReactNode;
  actionLabel: "Note" | "Attach";
  onNote: () => void;
}) {
  return (
    <div className="flex h-[52px] items-center gap-3 pr-1.5 pl-4 whitespace-nowrap">
      {tools}
      <span aria-hidden="true" className="h-5 w-px bg-border" />
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
  );
}

/** A saved note for the passage the reader tapped. */
export function IslandNote({
  width,
  text,
  meta,
  onEdit,
  onDelete,
  onShowTools,
  onClose,
}: {
  width: number;
  text: string;
  meta: string;
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
      <footer className="mt-2 -mr-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <span className="min-w-0 truncate">{meta}</span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onEdit}
          className="flex h-8 items-center gap-1 rounded-full px-2.5 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <PencilLine className="size-3.5" aria-hidden="true" />
          Edit
        </button>
        <button
          type="button"
          aria-label="Show highlight tools"
          onPointerDown={(event) => event.preventDefault()}
          onClick={onShowTools}
          className="flex size-8 items-center justify-center rounded-full hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Palette className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Delete note"
          onClick={onDelete}
          className="flex size-8 items-center justify-center rounded-full hover:bg-secondary hover:text-destructive focus-visible:outline-2 focus-visible:outline-ring"
        >
          <Trash2 className="size-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Close note"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
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
}

/** A short confirmation, or a deletion with Undo. */
export function IslandNotice({
  notice,
  onUndo,
}: {
  notice: IslandNoticeState;
  onUndo: () => void;
}) {
  return (
    <div
      role="status"
      className="flex h-11 items-center gap-2.5 pr-1.5 pl-2 text-[13px] font-medium whitespace-nowrap"
    >
      <span
        aria-hidden="true"
        className="flex size-7 items-center justify-center rounded-full"
        style={{
          background:
            !notice.color || notice.color === "invisible"
              ? "var(--secondary)"
              : `var(--${notice.color}-secondary)`,
        }}
      >
        {notice.undo ? (
          <Trash2 className="size-3.5 text-muted-foreground" />
        ) : (
          <Check className="size-3.5" strokeWidth={2.4} />
        )}
      </span>
      {notice.label}
      {notice.undo ? (
        <button
          type="button"
          onClick={onUndo}
          className="ml-1 h-8 rounded-full bg-secondary px-3.5 text-[13px] font-medium focus-visible:outline-2 focus-visible:outline-ring"
        >
          Undo
        </button>
      ) : (
        <span className="w-2.5" />
      )}
    </div>
  );
}
