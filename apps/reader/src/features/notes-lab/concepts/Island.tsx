import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import { ArrowUp, NotebookText, PenLine, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { HIGHLIGHT_COLORS } from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";
import {
  FauxKeyboard,
  invertedTheme,
  KEYBOARD_HEIGHT,
  useLabScreen,
  useSampleSelection,
} from "../frames";
import { JournalList, type JournalOrder } from "../JournalList";
import {
  CURRENT_CHAPTER,
  CURRENT_PAGE,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  EASE,
  EASE_SHEET,
  SPRING_SNAP,
  SPRING_SOFT,
  useLabNotes,
  useLabToast,
  type LabColor,
  type LabNote,
  type LabSelection,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import { LabToast, ReaderSurface, Swatch } from "../lab-ui";

type IslandState = "rest" | "select" | "compose" | "saved" | "notebook";

interface Draft {
  text: string;
  selection: LabSelection | null;
  color: LabColor;
}

const RADIUS: Record<IslandState, number> = {
  rest: 22,
  select: 26,
  compose: 26,
  saved: 22,
  notebook: 34,
};

/**
 * Island: one floating surface that changes shape for each step of the flow:
 * resting, selection tools, writing, saved, notebook. The surface inverts the
 * reading theme so it reads as an instrument above the page.
 */
export function Island() {
  const { screen, theme, bare } = useLabScreen();
  const { notes, add } = useLabNotes(seedNotes);
  const toast = useLabToast(2400);
  const [selection, setSelection] = useState<LabSelection | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [composing, setComposing] = useState(false);
  const [notebook, setNotebook] = useState(false);
  const [order, setOrder] = useState<JournalOrder>("book");
  const [flash, setFlash] = useState<{
    key: number;
    label: string;
    color: LabColor;
  } | null>(null);
  const [emphasis, setEmphasis] = useState<string | null>(null);
  const [bump, setBump] = useState(0);
  useSampleSelection((sample) => {
    setNotebook(false);
    setComposing(false);
    setSelection(sample);
  });

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), 1300);
    return () => clearTimeout(timer);
  }, [flash]);
  useEffect(() => {
    if (!emphasis) return;
    const timer = setTimeout(() => setEmphasis(null), 1600);
    return () => clearTimeout(timer);
  }, [emphasis]);

  const state: IslandState = notebook
    ? "notebook"
    : composing
      ? "compose"
      : flash
        ? "saved"
        : selection
          ? "select"
          : "rest";

  const marks: PageMark[] = notes
    .filter((note) => note.range && note.range.end > note.range.start)
    .map((note) => ({
      id: note.id,
      ...note.range!,
      color: note.color,
      tone: emphasis === note.id ? "focus" : undefined,
    }));
  if (selection)
    marks.push({ id: "pending", color: "pending", ...selection.range });
  else if (draft?.selection)
    marks.push({ id: "draft", color: draft.color, ...draft.selection.range });

  function highlight(color: LabColor) {
    if (!selection) return;
    add({
      chapter: CURRENT_CHAPTER,
      page: CURRENT_PAGE,
      color,
      quote: selection.text,
      text: "",
      range: selection.range,
    });
    setSelection(null);
    setBump((value) => value + 1);
    setFlash({ key: Date.now(), label: "Highlighted", color });
  }

  function compose() {
    // A new passage attaches to an unfinished thought instead of replacing it.
    setDraft((current) => ({
      text: current?.text ?? "",
      selection: selection ?? current?.selection ?? null,
      color: selection ? "invisible" : (current?.color ?? "invisible"),
    }));
    setSelection(null);
    setNotebook(false);
    setComposing(true);
  }

  function send() {
    if (!draft?.text.trim()) return;
    const anchor = PARAGRAPHS[0].length;
    add({
      chapter: CURRENT_CHAPTER,
      page: CURRENT_PAGE,
      color: draft.color,
      quote: draft.selection?.text ?? null,
      text: draft.text.trim(),
      range: draft.selection?.range ?? {
        paragraph: 0,
        start: anchor,
        end: anchor,
      },
    });
    setDraft(null);
    setComposing(false);
    setBump((value) => value + 1);
    setFlash({
      key: Date.now(),
      label: "Saved to notebook",
      color: draft.color,
    });
  }

  function openEntry(note: LabNote) {
    setNotebook(false);
    if (note.range) {
      setEmphasis(note.id);
      return;
    }
    toast.show(`Opens page ${note.page}`);
  }

  const width = screen.current?.offsetWidth ?? 390;
  const height = screen.current?.offsetHeight ?? 844;
  const keyboard = composing && !bare ? KEYBOARD_HEIGHT : 0;
  const bottom =
    state === "compose"
      ? keyboard
        ? keyboard + 8
        : 12
      : state === "notebook"
        ? 10
        : 18;

  return (
    <div className="absolute inset-0">
      <div
        className="absolute inset-0"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("mark")) return;
          if (selection) setSelection(null);
          if (composing) setComposing(false);
        }}
      >
        <ReaderSurface bottomInset={76} pageNumber={false}>
          {(pageStyle) => (
            <LabPage
              paragraphs={PARAGRAPHS}
              marks={marks}
              style={pageStyle}
              onSelect={(next) => {
                setComposing(false);
                setNotebook(false);
                setSelection(next);
              }}
            />
          )}
        </ReaderSurface>
      </div>

      <AnimatePresence>
        {notebook && (
          <motion.button
            type="button"
            aria-label="Close notebook"
            className="absolute inset-0 z-30 bg-foreground/15"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={() => setNotebook(false)}
          />
        )}
      </AnimatePresence>

      <motion.div
        className="pointer-events-none absolute inset-x-0 z-40 flex justify-center"
        initial={false}
        animate={{ bottom: `calc(var(--safe-bottom) + ${bottom}px)` }}
        transition={
          state === "compose" || keyboard
            ? { duration: 0.42, ease: EASE_SHEET }
            : SPRING_SOFT
        }
        style={{
          filter:
            "drop-shadow(0 14px 28px color-mix(in srgb, var(--foreground) 22%, transparent)) drop-shadow(0 2px 4px color-mix(in srgb, var(--foreground) 12%, transparent))",
        }}
      >
        <IslandSurface state={state} theme={invertedTheme(theme)}>
          {state === "rest" && (
            <div className="flex h-11 items-center gap-0.5 px-1.5 whitespace-nowrap">
              <button
                type="button"
                aria-label={`Notebook, ${notes.length} entries`}
                onClick={() => setNotebook(true)}
                className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-secondary"
              >
                <motion.span
                  key={bump}
                  initial={bump ? { scale: 1 } : false}
                  animate={{ scale: [1, 1.3, 1] }}
                  transition={{ duration: 0.45, ease: EASE }}
                  className="flex"
                >
                  <NotebookText className="size-4" />
                </motion.span>
                <AnimatedNumber
                  value={notes.length}
                  variant="pop"
                  className="font-numeric tabular-nums"
                />
              </button>
              <span className="h-4 w-px bg-border" />
              <button
                type="button"
                onClick={compose}
                className="relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-secondary"
              >
                <PenLine className="size-4" />
                {draft?.text.trim() ? "Draft" : "Jot"}
                {draft?.text.trim() && (
                  <motion.span
                    className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-foreground"
                    animate={{ opacity: [0.3, 1, 0.3] }}
                    transition={{ duration: 1.8, repeat: Infinity }}
                  />
                )}
              </button>
            </div>
          )}

          {state === "select" && (
            <div className="flex h-[52px] items-center gap-3 pr-1.5 pl-4 whitespace-nowrap">
              {HIGHLIGHT_COLORS.map(({ name }, index) => (
                <motion.span
                  key={name}
                  initial={{ opacity: 0, y: 6, scale: 0.6 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ ...SPRING_SNAP, delay: 0.04 + index * 0.035 }}
                  className="flex"
                >
                  <Swatch
                    color={name}
                    size={28}
                    fill={`var(--page-${name})`}
                    onSelect={() => highlight(name)}
                  />
                </motion.span>
              ))}
              <span className="h-5 w-px bg-border" />
              <button
                type="button"
                onPointerDown={(event) => event.preventDefault()}
                onClick={compose}
                className="flex h-10 items-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-medium"
              >
                <PenLine className="size-4" />
                {draft?.text.trim() ? "Attach" : "Note"}
              </button>
            </div>
          )}

          {state === "compose" && draft && (
            <Composer
              width={width - 20}
              draft={draft}
              onChange={(text) => setDraft({ ...draft, text })}
              onColor={(color) => setDraft({ ...draft, color })}
              onRemoveQuote={() =>
                setDraft({ ...draft, selection: null, color: "invisible" })
              }
              onSend={send}
              onClose={() => setComposing(false)}
            />
          )}

          {state === "saved" && flash && (
            <div className="flex h-11 items-center gap-2.5 pr-4 pl-2 text-[13px] font-medium whitespace-nowrap">
              <span
                className="flex size-7 items-center justify-center rounded-full"
                style={{
                  background:
                    flash.color === "invisible"
                      ? "var(--secondary)"
                      : `var(--page-${flash.color})`,
                }}
              >
                <svg
                  viewBox="0 0 16 16"
                  className="size-3.5 fill-none stroke-current"
                  strokeWidth={2.2}
                >
                  <motion.path
                    d="M3.5 8.5 6.5 11.5 12.5 4.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    initial={{ pathLength: 0 }}
                    animate={{ pathLength: 1 }}
                    transition={{ duration: 0.36, ease: EASE, delay: 0.12 }}
                    style={{
                      stroke:
                        flash.color === "invisible"
                          ? "var(--foreground)"
                          : "var(--page-foreground)",
                    }}
                  />
                </svg>
              </span>
              {flash.label}
            </div>
          )}

          {state === "notebook" && (
            <div
              className="flex flex-col"
              style={{ width: width - 16, height: Math.round(height * 0.68) }}
            >
              <header className="flex items-center gap-2 px-5 pt-4 pb-1">
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
                      onClick={() => setOrder(value)}
                      className="relative h-full rounded-full px-2.5 font-medium text-muted-foreground aria-pressed:text-foreground"
                    >
                      {order === value && (
                        <motion.span
                          layoutId="island-order"
                          transition={SPRING_SNAP}
                          className="absolute inset-0 rounded-full bg-background"
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
                  onClick={() => setNotebook(false)}
                  className="flex size-8 items-center justify-center rounded-full hover:bg-secondary"
                >
                  <X className="size-4" />
                </button>
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6">
                <JournalList
                  notes={notes}
                  order={order}
                  onSelect={(id) => {
                    const note = notes.find((entry) => entry.id === id);
                    if (note) openEntry(note);
                  }}
                  dense
                />
              </div>
            </div>
          )}
        </IslandSurface>
      </motion.div>

      <FauxKeyboard open={composing} />
      <LabToast toast={toast.toast} bottom={80} />
    </div>
  );
}

/**
 * Animates its own size to the natural size of the current layer. Explicit
 * width and height (not layout projection) keep the morph correct inside a
 * scaled device frame.
 */
function IslandSurface({
  state,
  theme,
  children,
}: {
  state: IslandState;
  theme: string;
  children: React.ReactNode;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig();
  const [size, setSize] = useState({ width: 150, height: 44 });
  useLayoutEffect(() => {
    const element = layer.current;
    if (!element) return;
    const update = () =>
      setSize({ width: element.offsetWidth, height: element.offsetHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [state]);
  return (
    <motion.div
      className={cn(
        theme,
        "pointer-events-auto relative overflow-hidden bg-background text-foreground",
      )}
      initial={false}
      animate={{
        width: size.width,
        height: size.height,
        borderRadius: RADIUS[state],
      }}
      transition={reduced ? { duration: 0 } : SPRING_SOFT}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={state}
          ref={layer}
          className="absolute bottom-0 left-1/2 w-max -translate-x-1/2"
          initial={{ opacity: 0, scale: 0.94, filter: "blur(6px)" }}
          animate={{ opacity: 1, scale: 1, filter: "blur(0px)" }}
          exit={{
            opacity: 0,
            scale: 0.98,
            filter: "blur(6px)",
            transition: { duration: 0.14, ease: EASE },
          }}
          transition={{ duration: 0.3, ease: EASE, delay: 0.06 }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function Composer({
  width,
  draft,
  onChange,
  onColor,
  onRemoveQuote,
  onSend,
  onClose,
}: {
  width: number;
  draft: Draft;
  onChange: (text: string) => void;
  onColor: (color: LabColor) => void;
  onRemoveQuote: () => void;
  onSend: () => void;
  onClose: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = draft.text.trim().length > 0;
  useLayoutEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [draft.text]);
  return (
    <div style={{ width }} className="p-1.5">
      {draft.selection && (
        <div className="mx-2.5 mt-2 mb-1 flex items-start gap-2.5">
          <span
            className="mt-0.5 w-[3px] self-stretch rounded-full"
            style={{
              background:
                draft.color === "invisible"
                  ? "var(--muted-foreground)"
                  : `var(--page-${draft.color})`,
            }}
          />
          <p
            className="line-clamp-2 flex-1 text-[13px] leading-snug text-muted-foreground italic"
            style={{ fontFamily: "Lora, serif" }}
          >
            {draft.selection.text}
          </p>
          <button
            type="button"
            aria-label="Remove quote"
            onPointerDown={(event) => event.preventDefault()}
            onClick={onRemoveQuote}
            className="-mt-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          ref={input}
          rows={1}
          aria-label="Write a note"
          value={draft.text}
          placeholder={draft.selection ? "Add a thought…" : "Jot a thought…"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") onClose();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSend();
            }
          }}
          className="min-h-9 flex-1 resize-none bg-transparent px-3 py-[7px] text-[16px] leading-[22px] outline-none placeholder:text-muted-foreground"
        />
        <motion.button
          type="button"
          aria-label="Save note"
          disabled={!ready}
          onPointerDown={(event) => event.preventDefault()}
          onClick={onSend}
          initial={false}
          animate={{ scale: ready ? 1 : 0.6, opacity: ready ? 1 : 0 }}
          transition={SPRING_SNAP}
          className="mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        >
          <ArrowUp className="size-[18px]" strokeWidth={2.4} />
        </motion.button>
      </div>
      {draft.selection && (
        <div className="flex items-center gap-2 px-3 pt-1 pb-1.5">
          {[
            ...HIGHLIGHT_COLORS.map(({ name }) => name),
            "invisible" as const,
          ].map((color) => (
            <Swatch
              key={color}
              color={color}
              size={16}
              fill={color === "invisible" ? undefined : `var(--page-${color})`}
              selected={draft.color === color}
              label={color === "invisible" ? "No highlight" : undefined}
              onSelect={() => onColor(color)}
            />
          ))}
          <span className="ml-auto text-[11px] text-muted-foreground">
            {draft.color === "invisible" ? "Note only" : "Note + highlight"}
          </span>
        </div>
      )}
    </div>
  );
}
