import { AnimatePresence, motion, useReducedMotionConfig } from "motion/react";
import {
  ArrowUp,
  BookOpen,
  NotebookText,
  PenLine,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { AnimatedNumber } from "@/components/ui/animated-number";
import { ReaderFooter } from "@/features/reader/footer";
import { ReaderHeader } from "@/features/reader/ReaderHeader";
import type { ChapterEntry } from "@/features/reader/types";
import {
  HIGHLIGHT_COLORS,
  type HighlightColor,
} from "@/lib/highlight-constants";
import {
  FauxKeyboard,
  KEYBOARD_HEIGHT,
  useLabScreen,
  useSampleSelection,
  useScreenSize,
} from "../frames";
import { JournalList, type JournalOrder } from "../JournalList";
import {
  BOOK,
  CHAPTERS,
  CURRENT_CHAPTER,
  CURRENT_PAGE,
  PARAGRAPHS,
  seedNotes,
} from "../lab-content";
import {
  colorVar,
  EASE,
  EASE_SHEET,
  relativeDay,
  SPRING_CALM,
  SPRING_SNAP,
  useLabNotes,
  type LabColor,
  type LabNote,
  type LabSelection,
} from "../lab-model";
import { LabPage, type PageMark } from "../LabPage";
import { MorphSurface, ReaderSurface, Swatch } from "../lab-ui";
import {
  ColorFilter,
  FilterChips,
  filterNotes,
  OrderToggle,
  Ribbon,
  useEntriesInView,
  type NoteFilter,
} from "../NotebookTools";

type IslandState =
  | "hidden"
  | "rest"
  | "select"
  | "peek"
  | "compose"
  | "flash"
  | "undo"
  | "notebook";

const RADIUS: Record<IslandState, number> = {
  hidden: 22,
  rest: 22,
  select: 26,
  peek: 24,
  compose: 24,
  flash: 22,
  undo: 22,
  notebook: 30,
};

// ReaderFooter's mobile timings, so the docked capsule moves with the footer.
const CHROME_ENTER = { duration: 0.26, ease: [0.16, 1, 0.3, 1] as const };
const CHROME_EXIT = { duration: 0.18, ease: [0.32, 0, 0.67, 0] as const };
const CHROME_FADE_IN = { duration: 0.18, ease: "easeOut" as const };
const CHROME_FADE_OUT = { duration: 0.14, ease: "easeIn" as const };

const CHAPTER_ENTRIES: ChapterEntry[] = CHAPTERS.map((chapter, index) => ({
  index,
  spineItemId: chapter.id,
  href: `#${chapter.id}`,
  title: `Chapter ${chapter.numeral}. ${chapter.title}`,
}));
const CHAPTER_STARTS = CHAPTERS.map((chapter) => chapter.start);
const CHAPTER_INDEX = CHAPTERS.findIndex(
  (chapter) => chapter.id === CURRENT_CHAPTER,
);

interface Draft {
  text: string;
  selection: LabSelection | null;
  color: LabColor;
  /** The saved annotation this draft edits, if any. */
  editing: string | null;
}

interface Notice {
  key: number;
  kind: "saved" | "highlighted" | "page" | "undo";
  label: string;
  color?: LabColor;
  undo?: () => void;
}

const noop = () => {};

/**
 * Notes Island prototype. One surface owns notes on the phone, in the reading
 * theme's own material. It is never shown during plain reading:
 *
 * - Chrome visible: a capsule rides on the real footer, replacing Jot a note.
 * - Text selected: the chrome steps away; the capsule rises as the palette.
 * - Noted passage tapped: the capsule shows that note.
 * - Writing: the capsule becomes the composer above the keyboard.
 * - Saved: a short confirmation, then back to reading.
 */
export function NotesIsland() {
  const { bare, screen } = useLabScreen();
  const { width, height } = useScreenSize();
  const reduced = useReducedMotionConfig();
  const { notes, add, update, remove } = useLabNotes(seedNotes);
  const [chrome, setChrome] = useState(false);
  const [bookmarked, setBookmarked] = useState(false);
  const [selection, setSelection] = useState<LabSelection | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [composing, setComposing] = useState(false);
  const [notebook, setNotebook] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [bump, setBump] = useState(0);
  // The count pops once for each new entry, not on every appearance.
  const [seenBump, setSeenBump] = useState(0);
  const [footerHeight, setFooterHeight] = useState(154);
  const safeProbe = useRef<HTMLDivElement>(null);
  const [safeBottom, setSafeBottom] = useState(28);
  const [order, setOrder] = useState<JournalOrder>("book");
  const [filter, setFilter] = useState<NoteFilter>("all");
  const [colors, setColors] = useState<HighlightColor[]>([]);
  const [activeEntry, setActiveEntry] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const inView = useEntriesInView(list, [notebook, filter, colors, order]);

  useSampleSelection((sample) => {
    setComposing(false);
    setNotebook(false);
    setFocusId(null);
    setNotice(null);
    setChrome(false);
    setSelection(sample);
  });

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(
      () => setNotice(null),
      notice.kind === "undo" ? 5000 : 1300,
    );
    return () => clearTimeout(timer);
  }, [notice]);

  // Positions animate in pixels; resolve the safe-area inset once it renders.
  useEffect(() => {
    const probe = safeProbe.current;
    if (!probe) return;
    const update = () => setSafeBottom(probe.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(probe);
    return () => observer.disconnect();
  }, []);

  // The capsule rests just above the footer, whatever the footer's height.
  useEffect(() => {
    const footer = screen.current?.querySelector<HTMLElement>(
      "[data-reader-footer]",
    );
    if (!chrome || !footer) return;
    const update = () => setFooterHeight(footer.offsetHeight);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => observer.disconnect();
  }, [chrome, screen]);

  const focused = focusId
    ? notes.find((note) => note.id === focusId)
    : undefined;
  const state: IslandState = notebook
    ? "notebook"
    : composing
      ? "compose"
      : notice
        ? notice.kind === "undo"
          ? "undo"
          : "flash"
        : focused?.text
          ? "peek"
          : selection || focused
            ? "select"
            : chrome
              ? "rest"
              : "hidden";

  const shownNotes = filterNotes(notes, filter, colors);
  const hasDraft = Boolean(draft?.text.trim()) && !draft?.editing;
  const keyboard = composing && !bare ? KEYBOARD_HEIGHT : 0;
  const surfaceWidth = width - 20;

  const marks: PageMark[] = notes
    .filter((note) => note.range && note.range.end > note.range.start)
    .map((note) => ({
      id: note.id,
      ...note.range!,
      color: note.color,
      tone: focusId === note.id ? "focus" : undefined,
    }));
  if (selection)
    marks.push({ id: "pending", color: "pending", ...selection.range });
  else if (draft?.selection && !draft.editing)
    marks.push({ id: "draft", color: draft.color, ...draft.selection.range });

  function dismissTransient() {
    setSelection(null);
    setFocusId(null);
    setNotice(null);
  }

  function tapPage(event: React.MouseEvent) {
    if (window.getSelection()?.toString()) return;
    if ((event.target as HTMLElement).closest("button,mark,[data-lab-ignore]"))
      return;
    if (composing) {
      // Collapsing keeps a new note's draft; an unsaved edit is discarded.
      if (draft?.editing) setDraft(null);
      setComposing(false);
      return;
    }
    if (selection || focusId || notice) {
      dismissTransient();
      return;
    }
    setChrome((visible) => !visible);
  }

  function tapNote(id: string) {
    setChrome(false);
    setSelection(null);
    setNotice(null);
    setFocusId((current) => (current === id ? null : id));
  }

  function chooseColor(color: LabColor) {
    if (selection) {
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
      setNotice({
        key: Date.now(),
        kind: "highlighted",
        label: "Highlighted",
        color,
      });
      return;
    }
    if (!focused) return;
    if (focused.color !== color) {
      update(focused.id, { color });
      setFocusId(null);
      return;
    }
    const undo = remove(focused.id);
    setFocusId(null);
    setNotice({
      key: Date.now(),
      kind: "undo",
      label: "Highlight removed",
      undo,
    });
  }

  function startNote() {
    if (focused) {
      setDraft({
        text: focused.text,
        selection:
          focused.range && focused.quote
            ? { range: focused.range, text: focused.quote }
            : null,
        color: focused.color,
        editing: focused.id,
      });
    } else {
      // A new passage attaches to an unfinished thought instead of replacing it.
      setDraft((current) => ({
        text: current?.editing ? "" : (current?.text ?? ""),
        selection:
          selection ?? (current?.editing ? null : (current?.selection ?? null)),
        color: selection ? "invisible" : (current?.color ?? "invisible"),
        editing: null,
      }));
    }
    setSelection(null);
    setFocusId(null);
    setNotice(null);
    setChrome(false);
    setNotebook(false);
    setComposing(true);
  }

  function send() {
    if (!draft?.text.trim()) return;
    if (draft.editing)
      update(draft.editing, { text: draft.text.trim(), color: draft.color });
    else {
      const end = PARAGRAPHS[0].length;
      add({
        chapter: CURRENT_CHAPTER,
        page: CURRENT_PAGE,
        color: draft.color,
        quote: draft.selection?.text ?? null,
        text: draft.text.trim(),
        range: draft.selection?.range ?? { paragraph: 0, start: end, end },
      });
      setBump((value) => value + 1);
    }
    setDraft(null);
    setComposing(false);
    setNotice({
      key: Date.now(),
      kind: "saved",
      label: draft.editing ? "Note updated" : "Saved to notebook",
      color: draft.color,
    });
  }

  function deleteFocused() {
    if (!focused) return;
    const undo = remove(focused.id);
    setFocusId(null);
    setNotice({ key: Date.now(), kind: "undo", label: "Note deleted", undo });
  }

  function openEntry(note: LabNote) {
    setNotebook(false);
    if (note.range) {
      setFocusId(note.id);
      return;
    }
    setNotice({
      key: Date.now(),
      kind: "page",
      label: `Opens page ${note.page}`,
    });
  }

  function jumpTo(id: string) {
    const container = list.current;
    const element = container?.querySelector<HTMLElement>(
      `[data-journal-id="${CSS.escape(id)}"]`,
    );
    if (!container || !element) return;
    setActiveEntry(id);
    container.scrollTo({ top: element.offsetTop - 48, behavior: "smooth" });
  }

  // Two placements. The resting capsule is an accessory of the footer and
  // stays right-aligned where Jot a note was. Everything about the page is
  // centred at the bottom and changes shape in place. Moving between the two
  // is a handoff, never a flight across the screen.
  const placement =
    state === "hidden" ? "none" : state === "rest" ? "dock" : "bottom";
  const bottomOffset =
    state === "compose"
      ? keyboard
        ? keyboard + 8
        : safeBottom + 10
      : state === "notebook"
        ? safeBottom + 6
        : safeBottom + 14;
  const riseWithKeyboard = { duration: 0.42, ease: EASE_SHEET };
  const restCapsule = (
    <div className="flex h-11 items-center gap-0.5 px-1.5 whitespace-nowrap">
      <button
        type="button"
        aria-label={`Notebook, ${notes.length} entries`}
        onClick={() => {
          setChrome(false);
          setNotebook(true);
        }}
        className="flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-secondary"
      >
        <motion.span
          key={bump}
          initial={bump > seenBump ? { scale: 1 } : false}
          animate={{ scale: bump > seenBump ? [1, 1.3, 1] : 1 }}
          transition={{ duration: 0.45, ease: EASE }}
          onAnimationComplete={() => setSeenBump(bump)}
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
        aria-label={hasDraft ? "Continue draft" : "Jot a note"}
        onClick={startNote}
        className="relative flex h-8 items-center gap-1.5 rounded-full px-3 text-[13px] font-medium hover:bg-secondary"
      >
        <PenLine className="size-4" />
        {hasDraft ? "Draft" : "Jot"}
        {hasDraft && (
          <motion.span
            className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-foreground"
            animate={{ opacity: [0.3, 1, 0.3] }}
            transition={{ duration: 1.8, repeat: Infinity }}
          />
        )}
      </button>
    </div>
  );

  return (
    <div className="absolute inset-0">
      <div className="absolute inset-0" onClick={tapPage}>
        <ReaderSurface pageNumber={false} chapterTitle={false}>
          {(pageStyle) => (
            <LabPage
              paragraphs={PARAGRAPHS}
              marks={marks}
              style={pageStyle}
              onSelect={(next) => {
                setChrome(false);
                setComposing(false);
                setFocusId(null);
                setNotice(null);
                setSelection(next);
              }}
              onMarkClick={(id) => {
                if (id === "pending" || id === "draft") return;
                tapNote(id);
              }}
              afterMark={(id) => {
                const note = notes.find((entry) => entry.id === id);
                if (!note?.text) return null;
                return (
                  <NoteDot
                    active={focusId === id}
                    onClick={() => tapNote(id)}
                  />
                );
              }}
            />
          )}
        </ReaderSurface>
      </div>

      <ReaderChrome
        visible={chrome}
        bare={bare}
        bookmarked={bookmarked}
        onToggleBookmark={() => setBookmarked((value) => !value)}
      />

      <AnimatePresence>
        {state === "notebook" && (
          <motion.button
            key="scrim"
            type="button"
            aria-label="Close notebook"
            className="absolute inset-0 z-30 bg-black/25"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            onClick={() => setNotebook(false)}
          />
        )}
      </AnimatePresence>

      <div
        ref={safeProbe}
        aria-hidden
        className="pointer-events-none invisible absolute bottom-0 w-0"
        style={{ height: "var(--safe-bottom)" }}
      />

      {/* Docked capsule: moves with the footer on the footer's own curves. */}
      <AnimatePresence>
        {placement === "dock" && (
          <motion.div
            key="dock"
            data-island="dock"
            className="absolute right-[10px] z-40 overflow-hidden rounded-full border border-border/70 bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-xl"
            style={{ bottom: footerHeight + 10 }}
            initial={{ y: footerHeight, opacity: 0 }}
            animate={{
              y: 0,
              opacity: 1,
              transition: reduced
                ? { duration: 0 }
                : { y: CHROME_ENTER, opacity: CHROME_FADE_IN },
            }}
            exit={{
              y: footerHeight,
              opacity: 0,
              transition: reduced
                ? { duration: 0 }
                : { y: CHROME_EXIT, opacity: CHROME_FADE_OUT },
            }}
          >
            {restCapsule}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bottom island: rises at its own size, then changes shape in place. */}
      <AnimatePresence>
        {placement === "bottom" && (
          <motion.div
            key="island"
            data-island="bottom"
            className="pointer-events-none absolute inset-x-0 z-40 flex justify-center"
            style={{ bottom: bottomOffset }}
            initial={{
              opacity: 0,
              y:
                state === "compose" && keyboard
                  ? keyboard
                  : state === "notebook"
                    ? 48
                    : 16,
            }}
            animate={{ opacity: 1, y: 0, bottom: bottomOffset }}
            exit={{
              opacity: 0,
              y: 12,
              transition: { duration: reduced ? 0 : 0.16, ease: EASE },
            }}
            transition={
              reduced
                ? { duration: 0 }
                : {
                    opacity: { duration: 0.2, ease: EASE },
                    y: state === "compose" ? riseWithKeyboard : SPRING_CALM,
                    bottom:
                      keyboard || state === "compose"
                        ? riseWithKeyboard
                        : SPRING_CALM,
                  }
            }
          >
            <MorphSurface
              layerKey={state}
              radius={RADIUS[state]}
              transition={SPRING_CALM}
              className="border border-border/70 bg-popover/95 text-popover-foreground shadow-lg backdrop-blur-xl"
            >
              {state === "select" && (
                <div className="flex h-[52px] items-center gap-3 pr-1.5 pl-4 whitespace-nowrap">
                  {HIGHLIGHT_COLORS.map(({ name }, index) => (
                    <motion.span
                      key={name}
                      initial={{ opacity: 0, y: 6, scale: 0.6 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      transition={{
                        ...SPRING_SNAP,
                        delay: 0.04 + index * 0.035,
                      }}
                      className="flex"
                    >
                      <Swatch
                        color={name}
                        size={28}
                        selected={focused?.color === name}
                        label={
                          focused?.color === name
                            ? "Remove highlight"
                            : `Highlight ${name}`
                        }
                        onSelect={() => chooseColor(name)}
                      />
                    </motion.span>
                  ))}
                  <span className="h-5 w-px bg-border" />
                  <button
                    type="button"
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={startNote}
                    className="flex h-10 items-center gap-1.5 rounded-full bg-secondary px-4 text-[13px] font-medium"
                  >
                    <PenLine className="size-4" />
                    {hasDraft && !focused ? "Attach" : "Note"}
                  </button>
                </div>
              )}

              {state === "peek" && focused && (
                <NotePeek
                  width={surfaceWidth}
                  note={focused}
                  onEdit={startNote}
                  onDelete={deleteFocused}
                  onClose={() => setFocusId(null)}
                />
              )}

              {state === "compose" && draft && (
                <Composer
                  width={surfaceWidth}
                  draft={draft}
                  onChange={(text) => setDraft({ ...draft, text })}
                  onColor={(color) => setDraft({ ...draft, color })}
                  onRemoveQuote={() =>
                    setDraft({ ...draft, selection: null, color: "invisible" })
                  }
                  onSend={send}
                  onCancel={() => {
                    if (draft.editing) setDraft(null);
                    setComposing(false);
                  }}
                />
              )}

              {(state === "flash" || state === "undo") && notice && (
                <NoticeLayer
                  notice={notice}
                  onUndo={() => {
                    notice.undo?.();
                    setNotice(null);
                  }}
                />
              )}

              {state === "notebook" && (
                <div
                  className="flex flex-col"
                  style={{
                    width: surfaceWidth,
                    height: Math.round(height * 0.72),
                  }}
                >
                  <header className="flex items-center gap-2 pt-4 pr-3 pl-5">
                    <h2 className="flex flex-1 items-baseline gap-2 text-[15px] font-semibold">
                      Notebook
                      <span className="font-numeric text-xs font-normal text-muted-foreground tabular-nums">
                        {shownNotes.length === notes.length
                          ? notes.length
                          : `${shownNotes.length} of ${notes.length}`}
                      </span>
                    </h2>
                    <OrderToggle value={order} onChange={setOrder} />
                    <button
                      type="button"
                      aria-label="Close notebook"
                      onClick={() => setNotebook(false)}
                      className="flex size-8 items-center justify-center rounded-full hover:bg-secondary"
                    >
                      <X className="size-4" />
                    </button>
                  </header>
                  <div className="px-5">
                    <Ribbon
                      notes={shownNotes}
                      inView={inView}
                      active={activeEntry}
                      onJump={jumpTo}
                    />
                    <div className="flex items-center gap-2 pb-1">
                      <FilterChips value={filter} onChange={setFilter} />
                      <span className="h-4 w-px bg-border" />
                      <ColorFilter value={colors} onChange={setColors} />
                    </div>
                  </div>
                  <div
                    ref={list}
                    className="relative mt-1 min-h-0 flex-1 overflow-y-auto overscroll-contain pb-6"
                  >
                    <JournalList
                      notes={shownNotes}
                      order={order}
                      activeId={activeEntry}
                      dense
                      onSelect={(id) => {
                        const note = notes.find((entry) => entry.id === id);
                        if (note) openEntry(note);
                      }}
                    />
                    <AnimatePresence>
                      {!shownNotes.length && (
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="px-8 py-14 text-center"
                        >
                          <p
                            className="text-[15px] text-muted-foreground italic"
                            style={{ fontFamily: "Lora, serif" }}
                          >
                            Nothing matches these filters.
                          </p>
                          <button
                            type="button"
                            onClick={() => {
                              setFilter("all");
                              setColors([]);
                            }}
                            className="mt-3 rounded-full border border-border px-3 py-1 text-xs font-medium"
                          >
                            Show everything
                          </button>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </MorphSurface>
          </motion.div>
        )}
      </AnimatePresence>

      <FauxKeyboard open={composing} />
    </div>
  );
}

/**
 * The real Reader header and footer with prototype data. In a device frame,
 * the header starts below the status bar, as the safe-area inset would place it.
 */
function ReaderChrome({
  visible,
  bare,
  bookmarked,
  onToggleBookmark,
}: {
  visible: boolean;
  bare: boolean;
  bookmarked: boolean;
  onToggleBookmark: () => void;
}) {
  const header = (
    <ReaderHeader
      chromeVisible={visible}
      bookTitle={BOOK.title}
      isMobile
      onBackToLibrary={noop}
      isBookmarked={bookmarked}
      onToggleBookmark={onToggleBookmark}
      isMenuOpen={false}
      onOpenMenu={noop}
    />
  );
  return (
    <>
      {bare ? (
        header
      ) : (
        <>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-20 bg-background/88 backdrop-blur-xl"
            style={{ height: "var(--safe-top)" }}
            initial={false}
            animate={{ opacity: visible ? 1 : 0 }}
            transition={{ duration: 0.18 }}
          />
          <div
            className="pointer-events-none absolute inset-x-0 z-20 h-[110px] overflow-hidden"
            style={{ top: "var(--safe-top)" }}
          >
            {header}
          </div>
        </>
      )}
      <ReaderFooter
        chromeVisible={visible}
        isMobile
        currentPage={CURRENT_PAGE}
        totalPages={BOOK.pages}
        currentChapterIndex={CHAPTER_INDEX}
        currentChapterEndIndex={CHAPTER_INDEX}
        displayChapterIndex={CHAPTER_INDEX}
        isContentsOpen={false}
        chapterEntries={CHAPTER_ENTRIES}
        chapterStartPages={CHAPTER_STARTS}
        onScrubPreview={noop}
        onScrubCommit={noop}
        onGoToChapter={noop}
        onPrevChapter={noop}
        onOpenContents={noop}
      />
    </>
  );
}

/**
 * A quiet mark after a noted passage: the passage is tappable, the dot says so.
 * A plain inline span with an absolute child adds no line-break opportunity,
 * so punctuation after the passage stays on its line.
 */
function NoteDot({
  active,
  onClick,
}: {
  active: boolean;
  onClick: () => void;
}) {
  return (
    <span data-lab-ignore className="relative select-none">
      <button
        type="button"
        aria-label="Read note"
        onClick={(event) => {
          event.stopPropagation();
          onClick();
        }}
        className="absolute -top-[0.2em] -left-[2px] flex size-3.5 items-center justify-center"
      >
        <motion.span
          className="block size-[5px] rounded-full bg-muted-foreground"
          animate={{ scale: active ? 1.6 : 1, opacity: active ? 1 : 0.7 }}
          transition={SPRING_SNAP}
        />
      </button>
    </span>
  );
}

function NotePeek({
  width,
  note,
  onEdit,
  onDelete,
  onClose,
}: {
  width: number;
  note: LabNote;
  onEdit: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <div style={{ width }} className="px-4 pt-3.5 pb-2">
      {note.quote && (
        <div className="mb-2 flex items-start gap-2.5">
          <span
            className="mt-0.5 w-[3px] self-stretch rounded-full"
            style={{
              background:
                note.color === "invisible"
                  ? "var(--muted-foreground)"
                  : colorVar(note.color),
            }}
          />
          <p
            className="line-clamp-2 flex-1 text-[13px] leading-snug text-muted-foreground italic"
            style={{ fontFamily: "Lora, serif" }}
          >
            {note.quote}
          </p>
        </div>
      )}
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-foreground">
        {note.text}
      </p>
      <footer className="mt-2 -mr-2 flex items-center gap-1 text-[11px] text-muted-foreground">
        <span>
          p. {note.page} · {relativeDay(note.createdAt)}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          onClick={onEdit}
          className="flex h-8 items-center gap-1 rounded-full px-2.5 hover:bg-secondary hover:text-foreground"
        >
          <PenLine className="size-3.5" />
          Edit
        </button>
        <button
          type="button"
          aria-label="Delete note"
          onClick={onDelete}
          className="flex size-8 items-center justify-center rounded-full hover:bg-secondary hover:text-destructive"
        >
          <Trash2 className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label="Close note"
          onClick={onClose}
          className="flex size-8 items-center justify-center rounded-full hover:bg-secondary hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      </footer>
    </div>
  );
}

function NoticeLayer({
  notice,
  onUndo,
}: {
  notice: Notice;
  onUndo: () => void;
}) {
  return (
    <div className="flex h-11 items-center gap-2.5 pr-1.5 pl-2 text-[13px] font-medium whitespace-nowrap">
      <span
        className="flex size-7 items-center justify-center rounded-full"
        style={{
          background:
            !notice.color || notice.color === "invisible"
              ? "var(--secondary)"
              : colorVar(notice.color),
        }}
      >
        {notice.kind === "page" ? (
          <BookOpen className="size-3.5" />
        ) : notice.kind === "undo" ? (
          <Trash2 className="size-3.5 text-muted-foreground" />
        ) : (
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
            />
          </svg>
        )}
      </span>
      {notice.label}
      {notice.kind === "undo" ? (
        <button
          type="button"
          onClick={onUndo}
          className="ml-1 h-8 rounded-full bg-secondary px-3.5 text-[13px] font-medium"
        >
          Undo
        </button>
      ) : (
        <span className="w-2.5" />
      )}
    </div>
  );
}

function Composer({
  width,
  draft,
  onChange,
  onColor,
  onRemoveQuote,
  onSend,
  onCancel,
}: {
  width: number;
  draft: Draft;
  onChange: (text: string) => void;
  onColor: (color: LabColor) => void;
  onRemoveQuote: () => void;
  onSend: () => void;
  onCancel: () => void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const ready = draft.text.trim().length > 0;
  useLayoutEffect(() => {
    const element = input.current;
    element?.focus({ preventScroll: true });
    element?.setSelectionRange(element.value.length, element.value.length);
  }, []);
  useLayoutEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [draft.text]);
  return (
    <div style={{ width }} className="p-1.5">
      {draft.editing && (
        <div className="flex h-7 items-center justify-between px-3 pt-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          Editing note
          <button
            type="button"
            onPointerDown={(event) => event.preventDefault()}
            onClick={onCancel}
            className="rounded-full px-2 py-1 normal-case tracking-normal hover:bg-secondary hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      )}
      {draft.selection && (
        <div className="mx-2.5 mt-2 mb-1 flex items-start gap-2.5">
          <span
            className="mt-0.5 w-[3px] self-stretch rounded-full"
            style={{
              background:
                draft.color === "invisible"
                  ? "var(--muted-foreground)"
                  : colorVar(draft.color),
            }}
          />
          <p
            className="line-clamp-2 flex-1 text-[13px] leading-snug text-muted-foreground italic"
            style={{ fontFamily: "Lora, serif" }}
          >
            {draft.selection.text}
          </p>
          {!draft.editing && (
            <button
              type="button"
              aria-label="Remove quote"
              onPointerDown={(event) => event.preventDefault()}
              onClick={onRemoveQuote}
              className="-mt-1 flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        <textarea
          ref={input}
          rows={1}
          aria-label={draft.editing ? "Edit note" : "Write a note"}
          value={draft.text}
          placeholder={draft.selection ? "Add a thought…" : "Jot a thought…"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Escape") onCancel();
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              onSend();
            }
          }}
          className="min-h-9 flex-1 resize-none bg-transparent px-3 py-[7px] text-[16px] leading-[22px] outline-none placeholder:text-muted-foreground"
        />
        <motion.button
          type="button"
          aria-label={draft.editing ? "Save changes" : "Save note"}
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
