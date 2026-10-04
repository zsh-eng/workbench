import { AnimatePresence, motion } from "motion/react";
import { PenLine, Plus, Trash2 } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import { useLabScreen, useSampleSelection } from "../frames";
import {
  CURRENT_CHAPTER,
  CURRENT_PAGE,
  LATE_SAMPLE_SELECTION,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  clockTime,
  colorVar,
  EASE,
  measureMark,
  relativeDay,
  SPRING_SNAP,
  SPRING_SOFT,
  toLocal,
  useLabNotes,
  useLabToast,
  useMarkGeometry,
  type LabColor,
  type LabNote,
  type LabSelection,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import {
  DESKTOP_PAGE,
  Kbd,
  LabToast,
  ReaderSurface,
  SelectionPill,
  Swatch,
} from "../lab-ui";

type Focus =
  | { kind: "new"; selection: LabSelection }
  | { kind: "existing"; id: string };

type MarginMode = "wide" | "narrow";

const PAGE_TOP = DESKTOP_PAGE.top;
const PAGE_BOTTOM = DESKTOP_PAGE.top + DESKTOP_PAGE.height;
const PAGE_RIGHT = DESKTOP_PAGE.single.left + DESKTOP_PAGE.single.width;
const MARGIN_X = PAGE_RIGHT + 64;
const NOTE_WIDTH = 300;
const GAP = 10;
const SPREAD_LEFT = DESKTOP_PAGE.spread.left;
const SPREAD_RIGHT = DESKTOP_PAGE.spread.left + DESKTOP_PAGE.spread.width;

interface Anchor {
  /** Top of the passage's first line. */
  y: number;
  /** Vertical centre of the first line, for the connector. */
  mid: number;
  /** Narrow mode: which page the passage starts on. */
  side: "left" | "right";
}

/**
 * Marginalia: notes are typeset as sidenotes beside their passages. The margin
 * is the notebook. Hover draws a hairline from the passage to its note; a
 * narrow window folds notes into numbered margin dots.
 */
export function Marginalia() {
  const { screen } = useLabScreen();
  const [mode, setMode] = useState<MarginMode>("wide");
  const { notes, add, update, remove } = useLabNotes(seedNotes);
  const toast = useLabToast();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [ghost, setGhost] = useState<{ paragraph: number; y: number } | null>(
    null,
  );
  const [anchors, setAnchors] = useState<Record<string, Anchor>>({});
  const [heights, setHeights] = useState<Record<string, number>>({});
  const from = mode === "wide" ? 2 : 0;

  useSampleSelection(
    (selection) => {
      finishEditing();
      setFocus({ kind: "new", selection });
    },
    mode === "wide" ? LATE_SAMPLE_SELECTION : undefined,
  );

  const pageNotes = notes.filter(
    (note) => note.range && note.range.paragraph >= from,
  );
  const visible = pageNotes.filter(
    (note) =>
      anchors[note.id] &&
      (note.text || drafts[note.id] !== undefined || editing === note.id),
  );
  const active = editing ?? pinned ?? hover;

  const marks: PageMark[] = pageNotes
    .filter((note) => note.range!.end > note.range!.start)
    .map((note) => ({
      id: note.id,
      ...note.range!,
      color: note.color,
      tone: active === note.id ? "focus" : undefined,
    }));
  if (focus?.kind === "new")
    marks.push({ id: "pending", color: "pending", ...focus.selection.range });

  const focusId = focus?.kind === "new" ? "pending" : (focus?.id ?? null);
  const geometry = useMarkGeometry(screen, focusId, focus);
  const focusedNote =
    focus?.kind === "existing"
      ? notes.find((note) => note.id === focus.id)
      : undefined;

  // Measure every passage after layout. Passages on the hidden overflow page
  // have no anchor, so their notes leave the margin as a real page turn would.
  // A passive effect runs after the screen ref, an ancestor, is attached.
  const noteKey = pageNotes
    .map((note) => `${note.id}:${note.range!.start}:${note.range!.end}`)
    .join("|");
  const measureAnchors = useEffectEvent(() => {
    const root = screen.current;
    if (!root) return;
    const next: Record<string, Anchor> = {};
    for (const note of pageNotes) {
      const range = note.range!;
      let line: { x: number; y: number; height: number } | null = null;
      if (range.end > range.start)
        line = measureMark(root, note.id)?.first ?? null;
      else {
        const paragraph = root.querySelector(
          `[data-paragraph="${range.paragraph}"]`,
        );
        const rect = paragraph?.getClientRects()[0];
        if (rect) line = toLocal(rect, root);
      }
      if (!line) continue;
      const rightEdge = mode === "wide" ? PAGE_RIGHT : SPREAD_RIGHT;
      if (line.x > rightEdge || line.y > PAGE_BOTTOM) continue;
      next[note.id] = {
        y: line.y,
        mid: line.y + line.height / 2,
        side: line.x < 640 ? "left" : "right",
      };
    }
    setAnchors((current) =>
      JSON.stringify(current) === JSON.stringify(next) ? current : next,
    );
  });
  useEffect(() => {
    const root = screen.current;
    if (!root) return;
    const measure = () => measureAnchors();
    measure();
    void document.fonts.ready.then(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(root);
    return () => observer.disconnect();
  }, [screen, noteKey, mode, editing]);

  const positions = layoutMargin(
    visible.map((note) => ({
      id: note.id,
      anchor: anchors[note.id].y - 10,
      height: heights[note.id] ?? 72,
    })),
    editing,
  );

  function finishEditing() {
    if (!editing) return;
    const note = notes.find((entry) => entry.id === editing);
    const draft = drafts[editing];
    if (note && !note.text && !draft?.trim()) {
      if (note.color === "invisible") remove(editing);
      setDrafts(({ [editing]: _empty, ...rest }) => rest);
    }
    setEditing(null);
  }

  function compose(color: LabColor) {
    if (!focus) return;
    finishEditing();
    const id =
      focus.kind === "new"
        ? add({
            chapter: CURRENT_CHAPTER,
            page: CURRENT_PAGE,
            color,
            quote: focus.selection.text,
            text: "",
            range: focus.selection.range,
          })
        : focus.id;
    setDrafts((current) => ({
      ...current,
      [id]: current[id] ?? notes.find((note) => note.id === id)?.text ?? "",
    }));
    setFocus(null);
    setEditing(id);
  }

  function composeOnParagraph(paragraph: number) {
    finishEditing();
    const length = PARAGRAPHS[paragraph].length;
    const id = add({
      chapter: CURRENT_CHAPTER,
      page: CURRENT_PAGE,
      color: "invisible",
      quote: null,
      text: "",
      range: { paragraph, start: length, end: length },
    });
    setDrafts((current) => ({ ...current, [id]: "" }));
    setEditing(id);
    setGhost(null);
  }

  function highlight(color: LabColor) {
    if (!focus) return;
    if (focus.kind === "new")
      add({
        chapter: CURRENT_CHAPTER,
        page: CURRENT_PAGE,
        color,
        quote: focus.selection.text,
        text: "",
        range: focus.selection.range,
      });
    else if (focusedNote?.color === color && !focusedNote.text)
      remove(focus.id);
    else update(focus.id, { color });
    setFocus(null);
  }

  function save(id: string) {
    const text = drafts[id]?.trim();
    if (!text) return;
    update(id, { text });
    setDrafts(({ [id]: _saved, ...rest }) => rest);
    setEditing(null);
  }

  function edit(id: string) {
    finishEditing();
    setFocus(null);
    const note = notes.find((entry) => entry.id === id);
    setDrafts((current) => ({
      ...current,
      [id]: current[id] ?? note?.text ?? "",
    }));
    setEditing(id);
  }

  function deleteNote(id: string) {
    const undo = remove(id);
    setDrafts(({ [id]: _removed, ...rest }) => rest);
    if (editing === id) setEditing(null);
    setHover(null);
    setPinned(null);
    toast.show("Note deleted", {
      label: "Undo",
      run: () => {
        undo();
        toast.dismiss();
      },
    });
  }

  function clickMark(id: string) {
    const note = notes.find((entry) => entry.id === id);
    if (!note) return;
    finishEditing();
    if (note.text) {
      setFocus(null);
      setPinned((current) => (current === id ? null : id));
      return;
    }
    setFocus({ kind: "existing", id });
  }

  function ghostAt(y: number) {
    const root = screen.current;
    if (!root) return;
    let best: { paragraph: number; y: number } | null = null;
    for (const element of root.querySelectorAll<HTMLElement>(
      "[data-paragraph]",
    )) {
      const rect = element.getClientRects()[0];
      if (!rect) continue;
      const top = toLocal(rect, root).y;
      if (top <= y + 6)
        best = { paragraph: Number(element.dataset.paragraph), y: top };
    }
    setGhost(best);
  }

  // Reading order: the left page, then the right page, top to bottom.
  const number = (id: string) =>
    [...visible]
      .sort(
        (a, b) =>
          Number(anchors[a.id].side === "right") -
            Number(anchors[b.id].side === "right") ||
          anchors[a.id].y - anchors[b.id].y,
      )
      .findIndex((note) => note.id === id) + 1;

  return (
    <div
      className="absolute inset-0"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (
          target.closest(
            "[data-sidenote],[role=toolbar],mark,button,[data-margin-hit]",
          )
        )
          return;
        setFocus(null);
        setPinned(null);
        finishEditing();
      }}
    >
      <motion.div
        key={mode}
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.24, ease: EASE }}
      >
        <ReaderSurface
          layout={mode === "wide" ? "single" : "spread"}
          pageStyle={
            mode === "wide" ? { fontSize: 16.5, lineHeight: 1.6 } : undefined
          }
          topRight={<MarginToggle mode={mode} onChange={setMode} />}
        >
          {(pageStyle) => (
            <LabPage
              paragraphs={PARAGRAPHS}
              from={from}
              marks={marks}
              style={pageStyle}
              onSelect={(selection) => {
                finishEditing();
                setPinned(null);
                setFocus(selection ? { kind: "new", selection } : null);
              }}
              onMarkClick={clickMark}
              onMarkHover={(id) =>
                setHover(
                  id && notes.find((note) => note.id === id)?.text ? id : null,
                )
              }
            />
          )}
        </ReaderSurface>
      </motion.div>

      {mode === "wide" && (
        <>
          <div
            data-margin-hit
            aria-hidden
            className="absolute cursor-text"
            style={{
              left: PAGE_RIGHT + 16,
              width: MARGIN_X + NOTE_WIDTH - PAGE_RIGHT,
              top: PAGE_TOP,
              height: DESKTOP_PAGE.height,
            }}
            onPointerMove={(event) => {
              const root = screen.current;
              if (!root) return;
              const scale =
                root.getBoundingClientRect().width / root.offsetWidth;
              ghostAt(
                (event.clientY - root.getBoundingClientRect().top) / scale,
              );
            }}
            onPointerLeave={() => setGhost(null)}
            onClick={() => ghost && composeOnParagraph(ghost.paragraph)}
          />
          <AnimatePresence>
            {ghost && !editing && (
              <motion.div
                key={ghost.paragraph}
                aria-hidden
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18, ease: EASE }}
                className="pointer-events-none absolute flex items-center gap-1.5 border-l-2 border-dashed border-border pl-3 text-[12px] text-muted-foreground"
                style={{ left: MARGIN_X, top: ghost.y }}
              >
                <Plus className="size-3.5" />
                Note on this paragraph
              </motion.div>
            )}
          </AnimatePresence>

          <svg
            aria-hidden
            className="pointer-events-none absolute inset-0 z-10 size-full overflow-visible"
          >
            {visible.map((note) => {
              const anchor = anchors[note.id];
              const y = positions[note.id];
              if (!anchor || y === undefined) return null;
              const accent =
                note.color === "invisible"
                  ? "var(--muted-foreground)"
                  : colorVar(note.color);
              const sx = PAGE_RIGHT + 14;
              const ex = MARGIN_X - 4;
              const ey = y + 20;
              const on = active === note.id;
              return (
                <g key={note.id}>
                  <motion.circle
                    cx={sx}
                    cy={anchor.mid}
                    r={on ? 3.5 : 2.5}
                    animate={{ cy: anchor.mid, r: on ? 3.5 : 2.5 }}
                    transition={SPRING_SNAP}
                    style={{ fill: accent }}
                  />
                  {on && (
                    <motion.path
                      key={`${note.id}:${y}`}
                      d={`M ${sx} ${anchor.mid} C ${sx + 34} ${anchor.mid}, ${ex - 34} ${ey}, ${ex} ${ey}`}
                      initial={{ pathLength: 0, opacity: 0 }}
                      animate={{ pathLength: 1, opacity: 1 }}
                      transition={{ duration: 0.36, ease: EASE }}
                      fill="none"
                      strokeWidth={1.25}
                      strokeLinecap="round"
                      style={{ stroke: accent }}
                    />
                  )}
                </g>
              );
            })}
          </svg>
        </>
      )}

      <AnimatePresence>
        {visible.map((note) => {
          if (mode === "narrow") {
            const anchor = anchors[note.id];
            const open = active === note.id;
            const left =
              anchor.side === "left" ? SPREAD_LEFT - 34 : SPREAD_RIGHT + 14;
            return (
              <NarrowDot
                key={note.id}
                note={note}
                number={number(note.id)}
                x={left}
                y={anchor.mid - 10}
                open={open}
                onEnter={() => setHover(note.id)}
                onLeave={() => setHover(null)}
                onClick={() =>
                  setPinned((current) => (current === note.id ? null : note.id))
                }
              >
                <SideNote
                  note={note}
                  floating
                  editing={editing === note.id}
                  draft={drafts[note.id]}
                  active
                  onHeight={() => {}}
                  onEnter={() => setHover(note.id)}
                  onLeave={() => setHover(null)}
                  onEdit={() => edit(note.id)}
                  onDraft={(value) =>
                    setDrafts((current) => ({ ...current, [note.id]: value }))
                  }
                  onColor={(color) => update(note.id, { color })}
                  onSave={() => save(note.id)}
                  onCancel={finishEditing}
                  onDelete={() => deleteNote(note.id)}
                />
              </NarrowDot>
            );
          }
          return (
            <motion.div
              key={note.id}
              data-sidenote
              className="absolute top-0 z-20"
              style={{ left: MARGIN_X, width: NOTE_WIDTH }}
              initial={{ opacity: 0, x: -10, y: positions[note.id] }}
              animate={{ opacity: 1, x: 0, y: positions[note.id] }}
              exit={{ opacity: 0, x: -6, transition: { duration: 0.18 } }}
              transition={SPRING_SOFT}
            >
              <SideNote
                note={note}
                editing={editing === note.id}
                draft={drafts[note.id]}
                active={active === note.id}
                onHeight={(height) =>
                  setHeights((current) =>
                    Math.abs((current[note.id] ?? 0) - height) < 1
                      ? current
                      : { ...current, [note.id]: height },
                  )
                }
                onEnter={() => setHover(note.id)}
                onLeave={() => setHover(null)}
                onEdit={() => edit(note.id)}
                onDraft={(value) =>
                  setDrafts((current) => ({ ...current, [note.id]: value }))
                }
                onColor={(color) => update(note.id, { color })}
                onSave={() => save(note.id)}
                onCancel={finishEditing}
                onDelete={() => deleteNote(note.id)}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>

      <AnimatePresence>
        {focus && geometry && (
          <SelectionPill
            key={focusId}
            anchor={geometry.box}
            current={focusedNote?.color}
            onColor={highlight}
            onNote={() => compose(focusedNote?.color ?? "invisible")}
          />
        )}
      </AnimatePresence>
      <LabToast toast={toast.toast} />
    </div>
  );
}

/**
 * Places notes at their anchors without overlap. The note being written keeps
 * its anchor; neighbours move away from it in both directions.
 */
function layoutMargin(
  items: { id: string; anchor: number; height: number }[],
  priority: string | null,
) {
  const sorted = [...items].sort((a, b) => a.anchor - b.anchor);
  const top = new Array<number>(sorted.length);
  const fixed = sorted.findIndex((item) => item.id === priority);
  if (fixed >= 0) {
    top[fixed] = Math.max(PAGE_TOP - 10, sorted[fixed].anchor);
    for (let index = fixed - 1; index >= 0; index--)
      top[index] = Math.min(
        sorted[index].anchor,
        top[index + 1] - sorted[index].height - GAP,
      );
    for (let index = fixed + 1; index < sorted.length; index++)
      top[index] = Math.max(
        sorted[index].anchor,
        top[index - 1] + sorted[index - 1].height + GAP,
      );
  } else {
    sorted.forEach((item, index) => {
      top[index] =
        index === 0
          ? Math.max(PAGE_TOP - 10, item.anchor)
          : Math.max(
              item.anchor,
              top[index - 1] + sorted[index - 1].height + GAP,
            );
    });
  }
  return Object.fromEntries(sorted.map((item, index) => [item.id, top[index]]));
}

function MarginToggle({
  mode,
  onChange,
}: {
  mode: MarginMode;
  onChange: (mode: MarginMode) => void;
}) {
  return (
    <div className="flex h-7 items-center rounded-full border border-border p-0.5 text-[11px]">
      {(["wide", "narrow"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
          className="relative h-full rounded-full px-2.5 font-medium text-muted-foreground capitalize aria-pressed:text-foreground"
        >
          {mode === value && (
            <motion.span
              layoutId="margin-mode"
              transition={SPRING_SNAP}
              className="absolute inset-0 rounded-full bg-secondary"
            />
          )}
          <span className="relative">{value}</span>
        </button>
      ))}
    </div>
  );
}

function SideNote({
  note,
  editing,
  draft,
  active,
  floating = false,
  onHeight,
  onEnter,
  onLeave,
  onEdit,
  onDraft,
  onColor,
  onSave,
  onCancel,
  onDelete,
}: {
  note: LabNote;
  editing: boolean;
  draft: string | undefined;
  active: boolean;
  floating?: boolean;
  onHeight: (height: number) => void;
  onEnter: () => void;
  onLeave: () => void;
  onEdit: () => void;
  onDraft: (value: string) => void;
  onColor: (color: LabColor) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const isDraft = !note.text;
  const accent =
    note.color === "invisible"
      ? "color-mix(in srgb, var(--foreground) 35%, transparent)"
      : colorVar(note.color);

  useLayoutEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(() => onHeight(element.offsetHeight));
    observer.observe(element);
    onHeight(element.offsetHeight);
    return () => observer.disconnect();
  });

  useLayoutEffect(() => {
    if (!editing) return;
    const element = input.current;
    element?.focus({ preventScroll: true });
    element?.setSelectionRange(element.value.length, element.value.length);
  }, [editing]);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.max(44, element.scrollHeight)}px`;
  }, [draft, editing]);

  const raised = editing || floating;
  return (
    <div
      ref={box}
      data-sidenote
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
      className={cn(
        "group relative rounded-xl border py-2.5 pr-3 pl-4 transition-[background-color,border-color,box-shadow] duration-300",
        raised
          ? "border-border bg-popover shadow-[0_12px_32px_-12px_color-mix(in_srgb,var(--foreground)_28%,transparent)]"
          : "border-transparent hover:bg-secondary/55",
      )}
    >
      <motion.span
        aria-hidden
        className="absolute top-3 bottom-3 left-[5px] w-[2px] rounded-full"
        animate={{ opacity: active || editing ? 1 : 0.5 }}
        style={{ background: accent }}
      />
      <div className="mb-0.5 flex h-5 items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {editing ? (
          <span>{note.quote ? "Margin note" : "On this paragraph"}</span>
        ) : isDraft ? (
          <span className="italic normal-case tracking-normal">Draft</span>
        ) : (
          <span>
            {relativeDay(note.createdAt)} · {clockTime(note.createdAt)}
          </span>
        )}
        {!editing && (
          <span className="ml-auto flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
            <button
              type="button"
              aria-label="Edit note"
              onClick={onEdit}
              className="flex size-6 items-center justify-center rounded-full hover:bg-background hover:text-foreground"
            >
              <PenLine className="size-3" />
            </button>
            <button
              type="button"
              aria-label="Delete note"
              onClick={onDelete}
              className="flex size-6 items-center justify-center rounded-full hover:bg-background hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          </span>
        )}
      </div>
      {editing ? (
        <textarea
          ref={input}
          aria-label="Margin note"
          value={draft ?? ""}
          placeholder="Write in the margin…"
          onChange={(event) => onDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") {
              event.preventDefault();
              onCancel();
            }
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSave();
            }
          }}
          className="block w-full resize-none bg-transparent text-[14.5px] leading-[1.55] italic text-foreground outline-none placeholder:text-muted-foreground/70"
          style={{ fontFamily: "Lora, serif" }}
        />
      ) : (
        <p
          onDoubleClick={onEdit}
          className={cn(
            "text-[14.5px] leading-[1.55] whitespace-pre-wrap italic transition-colors duration-200",
            active ? "text-foreground" : "text-muted-foreground",
          )}
          style={{ fontFamily: "Lora, serif" }}
        >
          {note.text || draft}
        </p>
      )}
      <AnimatePresence initial={false}>
        {editing && (
          <motion.div
            key="footer"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.24, ease: EASE }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-1.5 pt-2.5">
              {note.quote &&
                [
                  ...HIGHLIGHT_COLORS.map(({ name }) => name),
                  "invisible" as const,
                ].map((color) => (
                  <Swatch
                    key={color}
                    color={color}
                    size={13}
                    selected={note.color === color}
                    label={color === "invisible" ? "No highlight" : undefined}
                    onSelect={() => onColor(color)}
                  />
                ))}
              <span className="ml-auto flex items-center gap-1 text-[10.5px] text-muted-foreground">
                <Kbd>⌘</Kbd>
                <Kbd>↵</Kbd>
              </span>
              <button
                type="button"
                disabled={!draft?.trim()}
                onClick={onSave}
                className="h-6 rounded-full bg-primary px-2.5 text-[11px] font-medium text-primary-foreground transition-opacity disabled:opacity-35"
              >
                Save
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Narrow windows keep notes one hover away, beside the line they belong to. */
function NarrowDot({
  note,
  number,
  x,
  y,
  open,
  onEnter,
  onLeave,
  onClick,
  children,
}: {
  note: LabNote;
  number: number;
  x: number;
  y: number;
  open: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onClick: () => void;
  children: React.ReactNode;
}) {
  const left = x < 640;
  return (
    <motion.div
      data-sidenote
      className="absolute z-30"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.6 }}
      transition={SPRING_SNAP}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <button
        type="button"
        aria-label={`Note ${number}`}
        onClick={onClick}
        className="flex size-5 items-center justify-center rounded-full font-numeric text-[10px] font-semibold text-foreground"
        style={{
          backgroundColor:
            note.color === "invisible"
              ? "color-mix(in srgb, var(--foreground) 12%, transparent)"
              : colorVar(note.color),
        }}
      >
        {number}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.96, x: left ? -4 : 4 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.97 }}
            transition={{ duration: 0.18, ease: EASE }}
            className={cn(
              "absolute top-[-8px] w-[280px]",
              left ? "left-7 origin-top-left" : "right-7 origin-top-right",
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
