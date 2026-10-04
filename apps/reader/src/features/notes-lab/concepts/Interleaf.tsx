import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { Check, PenLine, Plus, Trash2 } from "lucide-react";
import { useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import {
  FauxKeyboard,
  KEYBOARD_HEIGHT,
  useLabScreen,
  useSampleSelection,
} from "../frames";
import {
  CURRENT_CHAPTER,
  CURRENT_PAGE,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  clockTime,
  colorVar,
  EASE,
  relativeDay,
  SPRING_SNAP,
  useLabNotes,
  useLabToast,
  useMarkGeometry,
  type LabColor,
  type LabNote,
  type LabSelection,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import { Kbd, LabToast, ReaderSurface, SelectionPill, Swatch } from "../lab-ui";

type Focus =
  | { kind: "new"; selection: LabSelection }
  | { kind: "existing"; id: string };

/**
 * Interleaf: the page parts below a passage and the note is written inside
 * the reading flow. Saved notes fold away into numbered footnote marks.
 */
export function Interleaf() {
  const { device, screen } = useLabScreen();
  const phone = device === "phone";
  const reduceMotion = useReducedMotionConfig();
  const { notes, add, update, remove } = useLabNotes(seedNotes);
  const toast = useLabToast();
  const [focus, setFocus] = useState<Focus | null>(null);
  const [open, setOpen] = useState<{
    id: string;
    mode: "write" | "read";
  } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [lift, setLift] = useState(0);
  useSampleSelection((selection) => {
    closePanel();
    setFocus({ kind: "new", selection });
  });

  const pageNotes = notes.filter((note) => note.range);
  const ordered = [...pageNotes]
    .filter((note) => note.text || drafts[note.id] !== undefined)
    .sort(
      (a, b) =>
        a.range!.paragraph - b.range!.paragraph ||
        a.range!.start - b.range!.start,
    );
  const footnote = (id: string) =>
    ordered.findIndex((note) => note.id === id) + 1;

  const marks: PageMark[] = pageNotes
    .filter((note) => note.range!.end > note.range!.start)
    .map((note) => ({
      id: note.id,
      ...note.range!,
      color: note.color,
      tone: open?.id === note.id ? "focus" : undefined,
    }));
  if (focus?.kind === "new")
    marks.push({ id: "pending", color: "pending", ...focus.selection.range });

  const focusId = focus?.kind === "new" ? "pending" : (focus?.id ?? null);
  const geometry = useMarkGeometry(screen, focusId, focus);
  const focusedNote =
    focus?.kind === "existing"
      ? notes.find((note) => note.id === focus.id)
      : undefined;

  function closePanel() {
    if (!open) return;
    const note = notes.find((entry) => entry.id === open.id);
    const draft = drafts[open.id];
    if (note && !note.text && !draft?.trim()) {
      // An empty thought leaves no trace; a highlight stays a highlight.
      if (note.color === "invisible") remove(open.id);
      setDrafts(({ [open.id]: _discarded, ...rest }) => rest);
    }
    setOpen(null);
    setLift(0);
  }

  function writeNote(color: LabColor) {
    if (!focus) return;
    let id: string;
    if (focus.kind === "new") {
      id = add({
        chapter: CURRENT_CHAPTER,
        page: CURRENT_PAGE,
        color,
        quote: focus.selection.text,
        text: "",
        range: focus.selection.range,
      });
    } else id = focus.id;
    setDrafts((current) => ({
      ...current,
      [id]: current[id] ?? notes.find((note) => note.id === id)?.text ?? "",
    }));
    setFocus(null);
    setOpen({ id, mode: "write" });
  }

  function pageNote(paragraph: number) {
    closePanel();
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
    setOpen({ id, mode: "write" });
  }

  function chooseColor(color: LabColor) {
    if (!focus) return;
    if (focus.kind === "new") {
      add({
        chapter: CURRENT_CHAPTER,
        page: CURRENT_PAGE,
        color,
        quote: focus.selection.text,
        text: "",
        range: focus.selection.range,
      });
    } else if (focusedNote?.color === color && !focusedNote.text) {
      remove(focus.id);
    } else update(focus.id, { color });
    setFocus(null);
  }

  function save(id: string) {
    const text = drafts[id]?.trim();
    if (!text) return;
    update(id, { text });
    setDrafts(({ [id]: _saved, ...rest }) => rest);
    setOpen(null);
    setLift(0);
  }

  function deleteNote(id: string) {
    const undo = remove(id);
    setDrafts(({ [id]: _removed, ...rest }) => rest);
    setOpen(null);
    setLift(0);
    toast.show("Note deleted", {
      label: "Undo",
      run: () => {
        undo();
        toast.dismiss();
      },
    });
  }

  function openNote(id: string) {
    const note = notes.find((entry) => entry.id === id);
    if (!note) return;
    if (open?.id === id) return closePanel();
    if (open) closePanel();
    setFocus(null);
    if (!note.text) {
      setFocus({ kind: "existing", id });
      return;
    }
    setOpen({ id, mode: drafts[id] !== undefined ? "write" : "read" });
  }

  const openEntry = open
    ? notes.find((note) => note.id === open.id)
    : undefined;
  const writing = open?.mode === "write";

  return (
    <div
      className="absolute inset-0"
      onPointerDown={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("[data-interleaf],[role=toolbar],mark,sup,button"))
          return;
        if (focus) setFocus(null);
        if (open) closePanel();
      }}
    >
      <motion.div
        className="absolute inset-0"
        animate={{ y: -lift }}
        transition={{ duration: 0.42, ease: EASE }}
      >
        <ReaderSurface>
          {(pageStyle) => (
            <LabPage
              paragraphs={PARAGRAPHS}
              marks={marks}
              style={pageStyle}
              onSelect={(selection) => {
                closePanel();
                setFocus(selection ? { kind: "new", selection } : null);
              }}
              onMarkClick={openNote}
              afterMark={(id) => {
                const note = notes.find((entry) => entry.id === id);
                if (!note || (!note.text && drafts[id] === undefined))
                  return null;
                return (
                  <Footnote
                    number={footnote(id)}
                    color={note.color}
                    draft={!note.text}
                    active={open?.id === id}
                    onClick={() => openNote(id)}
                  />
                );
              }}
              paragraphAside={(index) => {
                const notesHere = pageNotes.filter(
                  (note) => note.range!.paragraph === index && !note.quote,
                );
                return (
                  <div
                    data-lab-ignore
                    className="absolute top-[0.2em] -left-9 flex w-7 flex-col items-center gap-1"
                  >
                    {notesHere.map((note) => (
                      <Footnote
                        key={note.id}
                        number={footnote(note.id)}
                        color={note.color}
                        draft={!note.text}
                        active={open?.id === note.id}
                        onClick={() => openNote(note.id)}
                      />
                    ))}
                    {!phone && !notesHere.length && (
                      <button
                        type="button"
                        aria-label="Note on this paragraph"
                        title="Note on this paragraph"
                        onClick={() => pageNote(index)}
                        className="flex size-6 items-center justify-center rounded-full text-muted-foreground/0 transition-colors duration-150 group-hover/para:text-muted-foreground/70 hover:bg-secondary hover:text-muted-foreground focus-visible:text-muted-foreground"
                      >
                        <Plus className="size-3.5" />
                      </button>
                    )}
                  </div>
                );
              }}
              afterParagraph={(index) => (
                <AnimatePresence initial={false}>
                  {openEntry && openEntry.range!.paragraph === index && (
                    <InterleafPanel
                      key={openEntry.id}
                      note={openEntry}
                      mode={open!.mode}
                      draft={drafts[openEntry.id] ?? ""}
                      number={footnote(openEntry.id) || ordered.length + 1}
                      reduceMotion={Boolean(reduceMotion)}
                      onDraft={(value) =>
                        setDrafts((current) => ({
                          ...current,
                          [openEntry.id]: value,
                        }))
                      }
                      onColor={(color) => update(openEntry.id, { color })}
                      onSave={() => save(openEntry.id)}
                      onClose={closePanel}
                      onEdit={() => {
                        setDrafts((current) => ({
                          ...current,
                          [openEntry.id]: openEntry.text,
                        }));
                        setOpen({ id: openEntry.id, mode: "write" });
                      }}
                      onDelete={() => deleteNote(openEntry.id)}
                      onMeasure={(bottom) => {
                        if (!phone) return;
                        const height = screen.current?.offsetHeight ?? 844;
                        const limit = height - KEYBOARD_HEIGHT - 16;
                        setLift(Math.max(0, bottom - limit));
                      }}
                    />
                  )}
                </AnimatePresence>
              )}
            />
          )}
        </ReaderSurface>
      </motion.div>
      <AnimatePresence>
        {focus && geometry && (
          <SelectionPill
            key={focusId}
            anchor={geometry.box}
            current={focusedNote?.color}
            onColor={chooseColor}
            onNote={() =>
              writeNote(
                focus.kind === "existing"
                  ? (focusedNote?.color ?? "invisible")
                  : "invisible",
              )
            }
          />
        )}
      </AnimatePresence>
      {phone && <FauxKeyboard open={writing} />}
      <LabToast toast={toast.toast} bottom={phone ? 40 : 24} />
    </div>
  );
}

function Footnote({
  number,
  color,
  draft,
  active,
  onClick,
}: {
  number: number;
  color: LabColor;
  draft: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <sup
      data-lab-ignore
      className="relative top-[-0.15em] ml-[2px] inline-block align-super leading-none select-none"
    >
      <motion.button
        type="button"
        aria-label={draft ? "Open draft note" : `Open note ${number}`}
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: active ? 1.12 : 1, opacity: 1 }}
        exit={{ scale: 0, opacity: 0 }}
        whileHover={{ scale: 1.15 }}
        whileTap={{ scale: 0.92 }}
        transition={SPRING_SNAP}
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className={cn(
          "inline-flex h-[17px] min-w-[17px] items-center justify-center rounded-full px-[4px] font-numeric text-[10px] font-semibold text-foreground tabular-nums",
          draft && "border border-dashed border-foreground/50 bg-transparent",
          active && "ring-2 ring-foreground/25",
        )}
        style={
          draft
            ? undefined
            : {
                backgroundColor:
                  color === "invisible"
                    ? "color-mix(in srgb, var(--foreground) 12%, transparent)"
                    : colorVar(color),
              }
        }
      >
        {draft ? (
          <motion.span
            className="size-[5px] rounded-full bg-foreground/70"
            animate={{ opacity: [0.35, 1, 0.35] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        ) : (
          number
        )}
      </motion.button>
    </sup>
  );
}

function InterleafPanel({
  note,
  mode,
  draft,
  number,
  reduceMotion,
  onDraft,
  onColor,
  onSave,
  onClose,
  onEdit,
  onDelete,
  onMeasure,
}: {
  note: LabNote;
  mode: "write" | "read";
  draft: string;
  number: number;
  reduceMotion: boolean;
  onDraft: (value: string) => void;
  onColor: (color: LabColor) => void;
  onSave: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onMeasure: (bottom: number) => void;
}) {
  const { screen } = useLabScreen();
  const container = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const accent =
    note.color === "invisible"
      ? "color-mix(in srgb, var(--foreground) 30%, transparent)"
      : colorVar(note.color);

  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.max(48, element.scrollHeight)}px`;
  }, [draft, mode]);

  // Report the panel's final bottom edge before its height finishes opening.
  const measure = useEffectEvent(() => {
    const box = container.current;
    const root = screen.current;
    if (!box || !root || !content.current) return;
    const scale = root.getBoundingClientRect().width / root.offsetWidth;
    const top =
      (box.getBoundingClientRect().top - root.getBoundingClientRect().top) /
      scale;
    onMeasure(top + content.current.scrollHeight);
  });
  useLayoutEffect(() => {
    if (mode === "write") input.current?.focus({ preventScroll: true });
    // Measure once per mode; typing growth is handled by the textarea.
    measure();
  }, [mode]);

  return (
    <motion.div
      ref={container}
      data-interleaf
      initial={{ height: 0, marginBottom: 0 }}
      animate={{ height: "auto", marginBottom: "0.9em" }}
      exit={{
        height: 0,
        marginBottom: 0,
        transition: { duration: 0.34, ease: EASE, delay: 0.06 },
      }}
      transition={{ duration: reduceMotion ? 0 : 0.44, ease: EASE }}
      className="relative overflow-hidden [break-inside:avoid]"
    >
      <div
        ref={content}
        className="relative px-1 py-4"
        style={{
          background: "color-mix(in srgb, var(--secondary) 70%, transparent)",
          boxShadow:
            "inset 0 10px 12px -12px color-mix(in srgb, var(--foreground) 35%, transparent), inset 0 -10px 12px -12px color-mix(in srgb, var(--foreground) 35%, transparent)",
        }}
      >
        <motion.span
          aria-hidden
          className="absolute inset-x-0 top-0 h-px origin-left bg-border"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: EASE }}
        />
        <motion.span
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px origin-right bg-border"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 0.6, ease: EASE, delay: 0.08 }}
        />
        <motion.div
          initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.32, ease: EASE, delay: 0.14 }}
          className="relative mx-2 border-l-2 pl-3 font-sans"
          style={{ borderColor: accent }}
        >
          <div className="mb-1 flex items-center gap-1.5 text-[10.5px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            <span className="font-numeric">
              {note.text || mode === "read" ? number : "New"}
            </span>
            <span aria-hidden>·</span>
            <span>
              {note.quote ? "Between the lines" : "On this paragraph"}
            </span>
          </div>
          <AnimatePresence mode="popLayout" initial={false}>
            {mode === "write" ? (
              <motion.div
                key="write"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                <textarea
                  ref={input}
                  aria-label="Write a note"
                  value={draft}
                  placeholder="Write between the lines…"
                  onChange={(event) => onDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing) return;
                    if (event.key === "Escape") {
                      event.preventDefault();
                      onClose();
                    }
                    if (
                      event.key === "Enter" &&
                      (event.metaKey || event.ctrlKey)
                    ) {
                      event.preventDefault();
                      onSave();
                    }
                  }}
                  className="block w-full resize-none bg-transparent text-[15px] leading-[1.55] text-foreground outline-none placeholder:text-muted-foreground/70 placeholder:italic"
                  style={{ fontFamily: "Lora, serif" }}
                />
                <div className="mt-2 flex items-center gap-2">
                  {note.quote &&
                    [
                      ...HIGHLIGHT_COLORS.map(({ name }) => name),
                      "invisible" as const,
                    ].map((color) => (
                      <Swatch
                        key={color}
                        color={color}
                        size={14}
                        selected={note.color === color}
                        label={
                          color === "invisible" ? "No highlight" : undefined
                        }
                        onSelect={() => onColor(color)}
                      />
                    ))}
                  <span className="ml-auto hidden items-center gap-1 text-[10.5px] text-muted-foreground sm:flex [[data-lab-screen]_&]:flex">
                    <Kbd>esc</Kbd> keeps draft
                  </span>
                  <motion.button
                    type="button"
                    aria-label="Save note"
                    disabled={!draft.trim()}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={onSave}
                    animate={{
                      scale: draft.trim() ? 1 : 0.85,
                      opacity: draft.trim() ? 1 : 0.35,
                    }}
                    transition={SPRING_SNAP}
                    className="flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-[12px] font-medium text-primary-foreground"
                  >
                    <Check className="size-3.5" />
                    Save
                  </motion.button>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="read"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
              >
                <p
                  className="text-[15px] leading-[1.55] whitespace-pre-wrap text-foreground"
                  style={{ fontFamily: "Lora, serif" }}
                >
                  {note.text}
                </p>
                <div className="mt-2 flex items-center gap-1 text-[11px] text-muted-foreground">
                  <span>
                    {relativeDay(note.createdAt)}, {clockTime(note.createdAt)}
                  </span>
                  <button
                    type="button"
                    onClick={onEdit}
                    className="ml-auto flex h-7 items-center gap-1 rounded-full px-2.5 hover:bg-background hover:text-foreground"
                  >
                    <PenLine className="size-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    aria-label="Delete note"
                    onClick={onDelete}
                    className="flex size-7 items-center justify-center rounded-full hover:bg-background hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      </div>
    </motion.div>
  );
}
