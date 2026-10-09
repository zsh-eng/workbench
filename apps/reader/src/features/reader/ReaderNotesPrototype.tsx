import { flushSync } from "react-dom";
import { NotebookNote } from "./NotebookNote";
import { DesktopNotebookNote, NotebookNoteBody } from "./DesktopNotebookNote";
import { ReaderSheet } from "./shared/ReaderSheet";
import type { Note, NoteTarget } from "@/types/note";
import type { Highlight } from "@/types/highlight";
import type { HighlightColor } from "@/lib/highlight-constants";
import { NotebookFilters, type NotebookKindFilter } from "./NotebookFilters";
import { useReaderNotes } from "./hooks/use-reader-notes";
import { useNotebookDeletion } from "./hooks/use-notebook-deletion";
import {
  createNoteLocationResolver,
  highlightNoteTarget,
  noteMarginTop,
} from "./note-locations";
import {
  IslandNote,
  IslandNotice,
  IslandSurface,
  IslandTools,
  type IslandNoticeState,
} from "./NotesIsland";
import type {
  ReaderSessionState,
  ReaderSessionResources,
} from "./hooks/use-reader-session";
import type { ChapterEntry } from "./types";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { ArrowUp, Check, SlidersHorizontal, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MOTION } from "@/lib/motion";
import {
  useLayoutEffect,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type ComponentProps,
  type RefObject,
} from "react";

interface Location {
  page: number;
  chapter: string;
}
/** Book-scoped notebook UI; durable capture is owned by useReaderNotes. */
export function ReaderNotesPrototype({
  bookId,
  chapters,
  chapterAccess,
  pagination,
  locateAnchors,
  highlights,
  onVisitHighlight,
  location,
  currentChapterIndex,
  children,
  notebook,
  setNotebook,
  open,
  onActiveChange,
  onMobileComposerPresenceChange,
  onDraftPresenceChange,
  onReturnToReading,
  onVisit,
  margin,
  desktop,
  embeddedNotebook = false,
  commentPosition,
  quote: incomingTarget,
  onClearQuote,
  mobileAnnotation,
}: {
  mobileAnnotation?: {
    identity: object;
    tools: ReactNode;
    /** The existing highlight being edited, if any. */
    highlightId?: string;
    captureTarget: () => NoteTarget | null;
    close: () => void;
  };
  bookId: string;
  /** The book's highlights. Those without a note join the notebook. */
  highlights: Highlight[];
  onVisitHighlight: (highlight: Highlight) => void;
  chapters: ChapterEntry[];
  chapterAccess: ReaderSessionResources["chapterAccess"];
  pagination: ReaderSessionState["pagination"];
  locateAnchors: ReaderSessionResources["locateAnchors"];
  children: (panel: ReactNode) => ReactNode;
  notebook: boolean;
  setNotebook: (open: boolean) => void;
  commentPosition: { top: number; page: number };
  desktop: boolean;
  embeddedNotebook?: boolean;
  quote: NoteTarget | null;
  onClearQuote: () => void;
  margin: { width: number; location: Location; enabled: boolean };
  location: Location;
  currentChapterIndex: number;
  open: boolean;
  onActiveChange: (active: boolean) => void;
  onMobileComposerPresenceChange: (present: boolean) => void;
  /** Whether an unsent compose draft has text, for the footer capsule. */
  onDraftPresenceChange: (present: boolean) => void;
  /** Saving a note on the phone returns to plain reading. */
  onReturnToReading: () => void;
  onVisit: (page: number) => void;
}) {
  const composerOpen = open || Boolean(mobileAnnotation);
  const reduceMotion = useReducedMotion();
  // Book order by default, so the notebook opens where you are reading.
  const [order, setOrder] = useState<"time" | "chapter">("chapter");
  const [kindFilter, setKindFilter] = useState<NotebookKindFilter>("all");
  const [colorFilter, setColorFilter] = useState<HighlightColor[]>([]);
  const [notice, setNotice] = useState<IslandNoticeState | null>(null);
  // A tapped passage with a note shows the note; Palette asks for its colours.
  const [toolsRequested, setToolsRequested] = useState(false);
  const notes = useReaderNotes(bookId);
  const { deleteNote, restoredEntries } = useNotebookDeletion({
    remove: notes.remove,
    restore: notes.restore,
    shortcutEnabled: desktop && open && notebook && !notes.editingId,
  });
  const composerDraft = desktop ? notes.composeDraft : notes.draft;
  const inlineEditing = desktop && Boolean(notes.editingId);
  const draft = composerDraft?.content ?? "";
  const hasDraftText = draft.trim().length > 0;
  const target = composerDraft?.target;
  const editedNote = useMemo(
    () =>
      notes.editingId
        ? notes.notes.find((note) => note.id === notes.editingId)
        : undefined,
    [notes.notes, notes.editingId],
  );
  const editQuote =
    !desktop && editedNote?.kind === "note" ? editedNote.quote : undefined;
  const quote = editQuote
    ? { selectedText: editQuote.text, color: editQuote.color }
    : target?.kind === "highlight"
      ? { selectedText: target.quote.text, color: target.quote.color }
      : target?.kind === "selection"
        ? { selectedText: target.text, color: "invisible" }
        : null;
  const composeHasText = Boolean(notes.composeDraft?.content.trim());
  useEffect(() => {
    onDraftPresenceChange(composeHasText);
  }, [composeHasText, onDraftPresenceChange]);

  // Notes Island: one phone surface, in this order of priority. The notebook
  // sheet and the desktop margin use their own surfaces.
  const annotationNote = useMemo(() => {
    const highlightId = mobileAnnotation?.highlightId;
    if (!highlightId) return undefined;
    return notes.notes
      .filter(
        (note): note is Extract<Note, { kind: "note" }> =>
          note.kind === "note" && note.highlightId === highlightId,
      )
      .sort((a, b) => b.createdAt - a.createdAt)[0];
  }, [notes.notes, mobileAnnotation?.highlightId]);
  const composing = !desktop && !embeddedNotebook && open && !notebook;
  const islandState: "none" | "compose" | "note" | "tools" | "notice" =
    desktop || embeddedNotebook || notebook
      ? "none"
      : composing
        ? "compose"
        : mobileAnnotation
          ? annotationNote && !toolsRequested
            ? "note"
            : "tools"
          : notice
            ? "notice"
            : "none";
  // Keep reading chrome suppressed through exit, including quick dismiss/reopen.
  useLayoutEffect(() => {
    if (desktop) onMobileComposerPresenceChange(false);
    else if (islandState !== "none") onMobileComposerPresenceChange(true);
  }, [desktop, islandState, onMobileComposerPresenceChange]);
  useLayoutEffect(
    () => () => onMobileComposerPresenceChange(false),
    [onMobileComposerPresenceChange],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.undo ? 8000 : 1300);
    return () => clearTimeout(timer);
  }, [notice]);
  const resolver = useMemo(
    () =>
      createNoteLocationResolver(
        chapters,
        chapterAccess,
        pagination.paginationConfig,
      ),
    [chapters, chapterAccess, pagination.paginationConfig],
  );
  const resolved = useMemo(
    () =>
      (!pagination.spread || pagination.status === "idle"
        ? []
        : notes.notes
      ).map((note) => ({
        note,
        anchor: resolver.resolve(note.anchor),
      })),
    [notes.notes, resolver, pagination.status, pagination.spread],
  );
  // A highlight with a note is already shown by that note's quote.
  const notebookHighlights = useMemo(() => {
    const noted = new Set(
      notes.notes.flatMap((note) =>
        note.kind === "note" && note.highlightId ? [note.highlightId] : [],
      ),
    );
    return highlights.filter(
      (highlight) =>
        highlight.color !== "invisible" && !noted.has(highlight.id),
    );
  }, [highlights, notes.notes]);
  const resolvedHighlights = useMemo(
    () =>
      (!pagination.spread || pagination.status === "idle"
        ? []
        : notebookHighlights
      ).map((highlight) => ({
        highlight,
        anchor: resolver.resolve(highlightNoteTarget(highlight, true).anchor),
      })),
    [notebookHighlights, resolver, pagination.status, pagination.spread],
  );
  useEffect(() => {
    if (!resolvedHighlights.length) return;
    locateAnchors(
      resolvedHighlights.flatMap(({ highlight, anchor }) =>
        anchor ? [{ id: highlight.id, anchor }] : [],
      ),
      "notebook-highlights",
    );
  }, [resolvedHighlights, locateAnchors]);
  useEffect(() => {
    if (!resolved.length) return;
    locateAnchors(
      resolved.flatMap(({ note, anchor }) =>
        anchor ? [{ id: note.id, anchor }] : [],
      ),
    );
  }, [resolved, locateAnchors]);
  const handledTarget = useRef<NoteTarget | null>(null);
  useEffect(() => {
    if (
      !notes.ready ||
      notes.saving ||
      notes.editingId ||
      !incomingTarget ||
      handledTarget.current === incomingTarget
    )
      return;
    handledTarget.current = incomingTarget;
    notes.change(draft, incomingTarget);
    onClearQuote();
  }, [incomingTarget, notes.ready, draft, notes, onClearQuote]);
  const entries = useMemo(
    () =>
      resolved.map(({ note, anchor }) => ({
        id: note.id,
        kind: note.kind,
        text: note.kind === "note" ? note.content : "Bookmark",
        location: {
          page:
            anchor && pagination.status !== "recalculating"
              ? (pagination.anchorPages[note.id] ?? 0)
              : 0,
          chapter:
            chapters.find(
              (chapter) => chapter.spineItemId === note.anchor.spineItemId,
            )?.title ?? "Unknown chapter",
        },
        chapterIndex: chapters.findIndex(
          (chapter) => chapter.spineItemId === note.anchor.spineItemId,
        ),
        offset: note.anchor.startOffset,
        createdAt: note.createdAt,
        quote:
          note.kind === "note" && note.quote
            ? {
                selectedText: note.quote.text,
                // A highlight's colour can change after the note was written.
                color:
                  (note.highlightId &&
                    highlights.find(
                      (highlight) => highlight.id === note.highlightId,
                    )?.color) ||
                  note.quote.color,
              }
            : undefined,
        highlight: undefined as Highlight | undefined,
        top: noteMarginTop(anchor),
      })),
    [resolved, pagination.anchorPages, pagination.status, chapters, highlights],
  );
  // The notebook gathers notes and the highlights that have no note.
  const notebookEntries = useMemo(() => {
    const pages = pagination.highlightAnchorPages;
    return [
      ...entries,
      ...resolvedHighlights.map(({ highlight, anchor }) => ({
        id: highlight.id,
        kind: "highlight" as const,
        text: "",
        location: {
          page:
            anchor && pagination.status !== "recalculating"
              ? (pages[highlight.id] ?? 0)
              : 0,
          chapter:
            chapters.find(
              (chapter) => chapter.spineItemId === highlight.spineItemId,
            )?.title ?? "Unknown chapter",
        },
        chapterIndex: chapters.findIndex(
          (chapter) => chapter.spineItemId === highlight.spineItemId,
        ),
        offset: highlight.startOffset,
        createdAt: highlight.createdAt,
        quote: { selectedText: highlight.selectedText, color: highlight.color },
        highlight,
        top: 0,
      })),
    ].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }, [
    entries,
    resolvedHighlights,
    pagination.highlightAnchorPages,
    pagination.status,
    chapters,
  ]);
  const filtering = kindFilter !== "all" || colorFilter.length > 0;
  // While filters are set, the phone notebook keeps the tallest list height it
  // has had, so the filter controls stay under the finger.
  const [filterHeight, setFilterHeight] = useState<number | null>(null);
  const holdListHeight = useCallback((active: boolean) => {
    setFilterHeight((height) =>
      active
        ? Math.max(
            height ?? 0,
            list.current?.getBoundingClientRect().height ?? 0,
          )
        : null,
    );
  }, []);
  const changeKindFilter = useCallback(
    (kind: NotebookKindFilter) => {
      holdListHeight(kind !== "all" || colorFilter.length > 0);
      setKindFilter(kind);
    },
    [colorFilter.length, holdListHeight],
  );
  const changeColorFilter = useCallback(
    (colors: HighlightColor[]) => {
      holdListHeight(kindFilter !== "all" || colors.length > 0);
      setColorFilter(colors);
    },
    [kindFilter, holdListHeight],
  );
  const shownEntries = useMemo(
    () =>
      notebookEntries.filter(
        (entry) =>
          (kindFilter === "all" ||
            (kindFilter === "highlights"
              ? entry.kind === "highlight"
              : entry.kind !== "highlight")) &&
          (!colorFilter.length ||
            colorFilter.includes(entry.quote?.color as HighlightColor)),
      ),
    [notebookEntries, kindFilter, colorFilter],
  );

  const [keyboardOpen, setKeyboardOpen] = useState(false);
  // Content width inside the island's 1 px border, 10 px from each edge.
  const [islandWidth, setIslandWidth] = useState(() =>
    Math.min(window.innerWidth - 22, 520),
  );
  useEffect(() => {
    if (desktop) return;
    const update = () => setIslandWidth(Math.min(window.innerWidth - 22, 520));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [desktop]);
  // A new passage while writing folds the composer away; the draft stays and
  // the island offers to attach the passage to it.
  const annotationIdentity = mobileAnnotation?.identity;
  const seenAnnotation = useRef(annotationIdentity);
  useEffect(() => {
    if (desktop || seenAnnotation.current === annotationIdentity) return;
    seenAnnotation.current = annotationIdentity;
    setToolsRequested(false);
    if (!annotationIdentity) return;
    setNotice(null);
    if (composing) onActiveChange(false);
  }, [desktop, annotationIdentity, composing, onActiveChange]);
  const composer = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const sidebarInput = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // The phone sheet mounts the list after the notebook opens; its arrival
  // must rerun the effect that scrolls to the current chapter.
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null);
  const listRef = useCallback((element: HTMLDivElement | null) => {
    list.current = element;
    setListElement(element);
  }, []);
  const retainedEntry = useRef<{ id: string; offset: number } | null>(null);

  function changeOrder(value: string) {
    const container = list.current;
    const row =
      container &&
      [...container.querySelectorAll<HTMLElement>("[data-note-id]")].find(
        (node) =>
          node.getBoundingClientRect().bottom >
          container.getBoundingClientRect().top,
      );
    retainedEntry.current =
      row && container
        ? {
            id: row.dataset.noteId!,
            offset:
              row.getBoundingClientRect().top -
              container.getBoundingClientRect().top,
          }
        : null;
    setOrder(value === "chapter" ? "chapter" : "time");
  }
  useLayoutEffect(() => {
    const retained = retainedEntry.current;
    const container = list.current;
    if (!retained || !container) return;
    const row = container.querySelector<HTMLElement>(
      `[data-note-id="${retained.id}"]`,
    );
    if (row)
      container.scrollTop +=
        row.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        retained.offset;
    retainedEntry.current = null;
  }, [order]);

  // Position updates bypass React and Motion: scrolling must not wait for a
  // render or an animation. React only owns the keyboard-open layout variant.
  const tracksKeyboard = desktop
    ? false
    : embeddedNotebook || notebook
      ? false
      : islandState === "compose";
  useLayoutEffect(() => {
    const element = composer.current;
    const viewport = window.visualViewport;
    if (!tracksKeyboard || !element || !viewport) return;
    const update = () => {
      const inset = Math.max(
        0,
        window.innerHeight - viewport.height - viewport.offsetTop,
      );
      element.style.bottom = `${inset}px`;
      setKeyboardOpen(
        viewport.scale === 1 && window.innerHeight - viewport.height > 100,
      );
    };
    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("touchmove", update, { passive: true });
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("scroll", update);
      window.removeEventListener("touchmove", update);
      element.style.bottom = "";
      setKeyboardOpen(false);
    };
  }, [tracksKeyboard]);

  // Desktop keeps its panel mounted for the sidebar exit. Focus only when
  // the notebook opens; ordinary edits and the exit must not move focus.
  useLayoutEffect(() => {
    if (desktop && open && notebook)
      sidebarInput.current?.focus({ preventScroll: true });
  }, [desktop, open, notebook]);

  const pauseEdit = notes.pauseEdit;
  useEffect(() => {
    if (
      !desktop ||
      (open && notebook) ||
      !notes.editingId ||
      notes.saving ||
      notes.error
    )
      return;
    void pauseEdit().catch(() => {});
  }, [
    desktop,
    open,
    notebook,
    notes.editingId,
    notes.saving,
    notes.error,
    pauseEdit,
  ]);

  const flush = notes.flush;
  const close = useCallback(() => {
    void flush().catch(() => {});
    sidebarInput.current?.blur();
    input.current?.blur();
    setNotebook(false);
    onActiveChange(false);
    mobileAnnotation?.close();
    setKeyboardOpen(false);
    setToolsRequested(false);
  }, [flush, setNotebook, onActiveChange, mobileAnnotation]);
  async function send() {
    const editing = Boolean(notes.editingId);
    const color = quote?.color;
    if (!(await notes.send())) return;
    onClearQuote();
    mobileAnnotation?.close();
    if (notebook) {
      sidebarInput.current?.focus();
      return;
    }
    close();
    if (desktop) return;
    setNotice({
      key: Date.now(),
      label: editing ? "Note updated" : "Saved to notebook",
      color: color as IslandNoticeState["color"],
    });
    onReturnToReading();
  }

  /** Opens the island composer within the user event, so the phone keyboard
   * opens with it. */
  function openComposer() {
    flushSync(() => {
      setNotice(null);
      onActiveChange(true);
    });
    input.current?.focus({ preventScroll: true });
  }

  /** Note (or Attach) on the island's colour tools. An unfinished draft keeps
   * its text and takes the chosen passage. */
  async function noteOnPassage() {
    if (!mobileAnnotation || !notes.ready) return;
    const selected = mobileAnnotation.captureTarget();
    if (!selected) return;
    const text = notes.composeDraft?.content ?? "";
    mobileAnnotation.close();
    if (notes.editingId) {
      await notes.pauseEdit();
      notes.change(text, selected);
      flushSync(() => onActiveChange(true));
      input.current?.focus({ preventScroll: true });
      return;
    }
    notes.change(text, selected);
    openComposer();
  }

  function deleteFromIsland(id: string) {
    mobileAnnotation?.close();
    void deleteNote(id, (undo) => {
      const key = Date.now();
      setNotice({ key, label: "Note deleted", undo });
      return () =>
        setNotice((current) => (current?.key === key ? null : current));
    });
  }

  const editNote = notes.edit;
  const startEdit = useCallback(
    async (id: string) => {
      // Mobile must focus within the user event to open its keyboard. The
      // island composer is not mounted yet, so render it first.
      if (!desktop && !notebook) {
        flushSync(() => {
          mobileAnnotation?.close();
          setNotice(null);
          onActiveChange(true);
        });
      }
      if (!desktop) (notebook ? sidebarInput : input).current?.focus();
      if (!(await editNote(id)) || desktop) return;
      if (!embeddedNotebook) onActiveChange(true);
      (notebook ? sidebarInput : input).current?.focus();
    },
    [
      editNote,
      notebook,
      onActiveChange,
      desktop,
      embeddedNotebook,
      mobileAnnotation,
    ],
  );

  const orderedEntries = useMemo(
    () =>
      order === "time"
        ? shownEntries
        : [...shownEntries].sort(
            (a, b) =>
              a.chapterIndex - b.chapterIndex ||
              a.offset - b.offset ||
              a.createdAt - b.createdAt ||
              a.id.localeCompare(b.id),
          ),
    [order, shownEntries],
  );
  const groupLabel = useCallback(
    (entry: (typeof notebookEntries)[number]) => {
      if (order === "chapter") return entry.location.chapter;
      const date = new Date(entry.createdAt);
      if (date.toDateString() === new Date().toDateString()) return "Today";
      return date.toLocaleDateString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    },
    [order],
  );
  // The notebook opens where you are reading: at the current chapter in book
  // order, at the latest entry in time order. A new note comes into view.
  const previousList = useRef({ notebook: false, ids: new Set<string>() });
  useLayoutEffect(() => {
    const previous = previousList.current;
    const container = listElement;
    const ids = new Set(entries.map((entry) => entry.id));
    previousList.current = { notebook: notebook && !!container, ids };
    if (!notebook || !container) return;
    const opened = !previous.notebook;
    const added = entries.find(
      (entry) =>
        !previous.ids.has(entry.id) && !restoredEntries.current.has(entry.id),
    );
    if (!opened && !added) return;
    if (order === "time") {
      container.scrollTo({ top: container.scrollHeight });
      return;
    }
    const padding = parseFloat(getComputedStyle(container).paddingTop);
    if (added && !opened) {
      const row = container.querySelector<HTMLElement>(
        `[data-note-id="${CSS.escape(added.id)}"]`,
      );
      if (!row) return;
      const hidden =
        row.offsetTop < container.scrollTop ||
        row.offsetTop + row.offsetHeight >
          container.scrollTop + container.clientHeight;
      if (hidden) container.scrollTop = row.offsetTop - padding;
      return;
    }
    const chapter =
      orderedEntries.find((entry) => entry.chapterIndex >= currentChapterIndex)
        ?.chapterIndex ?? orderedEntries.at(-1)?.chapterIndex;
    const heading = container.querySelector<HTMLElement>(
      `[data-notebook-group="${chapter}"]`,
    );
    container.scrollTop = heading ? heading.offsetTop - padding : 0;
  }, [
    entries,
    notebook,
    listElement,
    restoredEntries,
    order,
    orderedEntries,
    currentChapterIndex,
  ]);
  const marginEntries = entries.filter(
    (entry) =>
      entry.location.page >= location.page &&
      entry.location.page <= margin.location.page,
  );
  // Use one rail geometry for the editor and saved comments. Keep the rail
  // beside the book text instead of attaching it to the window edge.
  const commentWidth = Math.min(360, Math.max(320, margin.width - 32));
  const commentLeft = `calc(100% - ${Math.max(commentWidth + 16, margin.width - 16)}px)`;
  const commentSurface =
    "rounded-xl border border-border/80 bg-background/95 p-3 text-sm shadow-sm";
  /** One note field for three surfaces: the phone's Notes Island, the
   * notebook (phone sheet or desktop sidebar), and the desktop margin. */
  function renderNoteInput(surface: "island" | "notebook" | "margin") {
    const inNotebook = surface === "notebook";
    const island = surface === "island";
    const editingInComposer = !desktop && Boolean(notes.editingId);
    const sendButton = (
      <button
        aria-label={editingInComposer ? "Save changes" : "Save note"}
        aria-hidden={!hasDraftText}
        tabIndex={hasDraftText ? 0 : -1}
        disabled={
          !notes.ready || notes.saving || !hasDraftText || inlineEditing
        }
        onPointerDown={(event) => event.preventDefault()}
        onClick={() => send()}
        className={`${desktop || island ? "relative" : "absolute right-0 bottom-0"} ${island ? "mb-0.5" : ""} flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,transform] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none ${hasDraftText ? "[transform:scale(1)] opacity-100 disabled:opacity-30" : "pointer-events-none [transform:scale(0.9)] opacity-0"}`}
      >
        {editingInComposer ? <Check size={20} /> : <ArrowUp size={20} />}
      </button>
    );
    const quoteRow = quote && (
      <div
        className={
          island
            ? "mx-2.5 mt-1.5 mb-1 flex items-start gap-2"
            : "mx-3 mt-1 flex items-center gap-2"
        }
        data-testid="note-quote"
      >
        <span
          className={`min-w-0 flex-1 border-l-[3px] py-1 pl-2 text-xs text-muted-foreground ${island ? "line-clamp-2" : "truncate"}`}
          style={{
            borderColor:
              quote.color === "invisible"
                ? "var(--muted-foreground)"
                : `var(--${quote.color}-secondary)`,
          }}
        >
          {quote.selectedText}
        </span>
        {!editingInComposer && (
          <button
            aria-label="Remove quote"
            onPointerDown={(event) => event.preventDefault()}
            className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
            onClick={() => {
              if (target)
                notes.change(draft, {
                  kind: "page",
                  anchor: target.anchor,
                });
              onClearQuote();
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
    );
    const field = (
      <NoteTextInput
        ref={inNotebook ? sidebarInput : input}
        autoFocus={desktop ? open && !inNotebook : island}
        aria-label={editingInComposer ? "Edit note" : "Write a note"}
        placeholder="Write a note…"
        value={draft}
        disabled={!notes.ready || inlineEditing}
        readOnly={notes.saving}
        rows={1}
        onChange={(event) => {
          const nextTarget = target ?? resolver.capture(pagination.spread);
          if (nextTarget) notes.change(event.target.value, nextTarget);
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.metaKey || event.ctrlKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            send();
          }
          if (event.key === "Escape") {
            if (notes.editingId) void notes.cancelEdit();
            else close();
          }
        }}
        className={`${desktop ? "min-h-8 text-sm" : "min-h-8 text-base"} ${island ? "px-2.5" : ""} min-w-0 flex-1 resize-none bg-transparent py-1 leading-6 outline-none placeholder:text-muted-foreground`}
      />
    );
    const error = notes.error && (island || inNotebook === notebook) && (
      <p role="alert" className="mx-3 mb-2 text-sm text-destructive">
        {notes.error}
      </p>
    );
    if (island)
      return (
        <div style={{ width: islandWidth }} className="p-1.5">
          {error}
          {editingInComposer && (
            <div
              data-note-edit-strip
              className="flex h-8 items-center justify-between gap-2 pr-1 pl-2.5 text-xs text-muted-foreground"
            >
              <span>Editing note</span>
              <button
                aria-label="Cancel editing"
                disabled={notes.saving}
                onPointerDown={(event) => event.preventDefault()}
                className="h-7 rounded-full px-2.5 hover:bg-secondary hover:text-foreground"
                onClick={() => notes.cancelEdit()}
              >
                Cancel
              </button>
            </div>
          )}
          {quoteRow}
          <div data-note-input-surface className="flex items-end gap-1.5">
            {field}
            {sendButton}
          </div>
        </div>
      );
    return (
      <div>
        {error}
        {editingInComposer && (
          <div
            data-note-edit-strip
            className="relative z-0 mx-4 -mb-3 flex h-10 items-center justify-between gap-2 rounded-[2rem] border border-border/50 bg-background/90 px-3 pb-2 text-xs text-muted-foreground backdrop-blur-xl"
          >
            <span>Editing note</span>
            <button
              aria-label="Cancel editing"
              disabled={notes.saving}
              className="self-stretch px-1 hover:text-foreground"
              onClick={() => notes.cancelEdit()}
            >
              Cancel
            </button>
          </div>
        )}
        <div
          data-note-compose-row
          inert={inlineEditing}
          className={
            desktop
              ? `flex items-end ${inlineEditing ? "opacity-45" : ""}`
              : undefined
          }
        >
          <div
            data-note-input-surface
            className={`relative z-10 min-w-0 flex-1 border p-1 focus-within:ring-2 focus-within:ring-ring/60 ${
              desktop && inNotebook
                ? "rounded-(--sidebar-panel-field-radius) border-border/50 bg-secondary/35 focus-within:border-border"
                : `rounded-3xl border-border/80 bg-background/95 ${desktop ? "shadow-sm" : ""}`
            }`}
          >
            {quoteRow}
            {/* The phone sheet keeps an internal send slot. Desktop reserves space outside the field. */}
            <div
              className={`relative flex items-end gap-1 ${desktop ? "px-3" : "pr-10 pl-2"}`}
            >
              {field}
              {!desktop && sendButton}
            </div>
          </div>
          {desktop && (
            <div
              className={`mb-[5px] shrink-0 overflow-hidden ${hasDraftText ? "ml-2 w-8" : "w-0"}`}
            >
              {sendButton}
            </div>
          )}
        </div>
      </div>
    );
  }
  const NotebookCard = desktop ? DesktopNotebookNote : NotebookNote;
  const notebookPanel = useMemo(
    () => (
      <motion.section
        key="notebook"
        initial={
          desktop || embeddedNotebook
            ? false
            : {
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(12px)",
              }
        }
        animate={{ opacity: 1, transform: "none" }}
        exit={
          desktop || embeddedNotebook
            ? undefined
            : {
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(12px)",
              }
        }
        transition={
          desktop || embeddedNotebook ? { duration: 0 } : MOTION.enter
        }
        aria-label="Book notebook"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <header className="flex items-center gap-3 px-4 py-2">
          <h2 className="flex flex-1 items-center gap-2 text-sm font-medium">
            <span>Notebook</span>{" "}
            <span className="text-xs font-normal text-muted-foreground font-numeric tabular-nums">
              {filtering
                ? `${shownEntries.length} of ${notebookEntries.length}`
                : notebookEntries.length}
            </span>
          </h2>
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Notebook order"
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <SlidersHorizontal size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={order} onValueChange={changeOrder}>
                <DropdownMenuRadioItem value="time">
                  By time
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="chapter">
                  By chapter
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {!desktop && (
            <button
              aria-label="Close notebook"
              onClick={close}
              className="flex size-8 items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
            >
              <X size={15} />
            </button>
          )}
        </header>
        {notebookEntries.length > 0 && (
          <NotebookFilters
            kind={kindFilter}
            colors={colorFilter}
            onKindChange={changeKindFilter}
            onColorsChange={changeColorFilter}
          />
        )}
        <div
          ref={listRef}
          className={`relative min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain p-4 ${desktop ? "flex-1" : ""}`}
          style={{
            minHeight:
              !desktop && !keyboardOpen && filterHeight
                ? filterHeight
                : "min(9rem, 24dvh)",
            maxHeight: desktop ? undefined : keyboardOpen ? "24dvh" : "48dvh",
          }}
        >
          {notebookEntries.length > 0 && !shownEntries.length && (
            <div className="absolute inset-x-4 top-4 px-4 py-10 text-center">
              <p className="font-serif text-lg text-muted-foreground">
                Nothing matches these filters.
              </p>
              <button
                type="button"
                onClick={() => {
                  setFilterHeight(null);
                  setKindFilter("all");
                  setColorFilter([]);
                }}
                className="mt-3 h-8 rounded-full px-3 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                Show everything
              </button>
            </div>
          )}
          {!notebookEntries.length && (
            <motion.p
              initial={desktop ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ ...MOTION.enter, delay: reduceMotion ? 0 : 0.16 }}
              className="absolute inset-x-4 top-4 px-4 py-10 text-center font-serif text-lg text-muted-foreground"
            >
              Write your first note below. Your thoughts and saved quotes will
              appear here.
            </motion.p>
          )}
          <AnimatePresence key={order} initial={false}>
            {orderedEntries.flatMap((entry, index) => [
              ...(index === 0 ||
              groupLabel(orderedEntries[index - 1]) !== groupLabel(entry)
                ? [
                    <motion.div
                      key={`heading:${order}:${order === "chapter" ? entry.chapterIndex : new Date(entry.createdAt).toDateString()}`}
                      initial={
                        restoredEntries.current.has(entry.id)
                          ? { height: reduceMotion ? "auto" : 0, opacity: 0 }
                          : false
                      }
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{
                        height: reduceMotion ? "auto" : 0,
                        opacity: 0,
                        transition: {
                          height: {
                            duration: reduceMotion ? 0 : 0.18,
                            delay: reduceMotion ? 0 : 0.16,
                          },
                          opacity: { duration: 0.16 },
                        },
                      }}
                      transition={{
                        duration: reduceMotion ? 0 : 0.18,
                        ease: MOTION.enter.ease,
                      }}
                      data-notebook-group={
                        order === "chapter" ? entry.chapterIndex : undefined
                      }
                      className="overflow-hidden"
                    >
                      <h3 className="mb-2 px-1 text-xs font-medium text-muted-foreground">
                        {groupLabel(entry)}
                      </h3>
                    </motion.div>,
                  ]
                : []),
              <motion.div
                key={entry.id}
                data-note-id={entry.id}
                initial={
                  restoredEntries.current.has(entry.id)
                    ? { height: reduceMotion ? "auto" : 0, opacity: 0 }
                    : false
                }
                animate={{ height: "auto", opacity: 1 }}
                exit={{
                  height: reduceMotion ? "auto" : 0,
                  opacity: 0,
                  transition: {
                    height: {
                      duration: reduceMotion ? 0 : 0.18,
                      delay: reduceMotion ? 0 : 0.16,
                      ease: MOTION.enter.ease,
                    },
                    opacity: { duration: 0.16 },
                  },
                }}
                transition={{
                  duration: reduceMotion ? 0 : 0.18,
                  ease: MOTION.enter.ease,
                }}
                className="flow-root overflow-hidden"
              >
                {entry.highlight ? (
                  <HighlightEntry
                    desktop={desktop}
                    text={entry.highlight.selectedText}
                    color={entry.highlight.color}
                    location={`${order === "time" ? `${entry.location.chapter} · ` : ""}${
                      entry.location.page
                        ? `p. ${entry.location.page}`
                        : "Location unavailable"
                    }`}
                    createdAt={entry.createdAt}
                    onSelect={() => {
                      onVisitHighlight(entry.highlight!);
                      close();
                    }}
                  />
                ) : (
                  <NotebookCard
                    text={entry.text}
                    dimmed={inlineEditing && notes.editingId !== entry.id}
                    disabled={!notes.ready || notes.saving}
                    canEdit={entry.kind === "note"}
                    editing={notes.editingId === entry.id}
                    onEdit={() => void startEdit(entry.id)}
                    onDelete={() => deleteNote(entry.id)}
                  >
                    {entry.quote && (
                      <blockquote
                        className="mb-2 whitespace-pre-wrap break-words border-l-[3px] pl-2 text-xs leading-relaxed text-muted-foreground"
                        style={{
                          borderColor:
                            entry.quote.color === "invisible"
                              ? "var(--muted-foreground)"
                              : `var(--${entry.quote.color}-secondary)`,
                        }}
                      >
                        {entry.quote.selectedText}
                      </blockquote>
                    )}
                    <NotebookNoteBody
                      content={entry.text}
                      edit={
                        desktop && notes.editingId === entry.id
                          ? {
                              value: notes.draft?.content ?? "",
                              saving: notes.saving,
                              onChange: (value) => {
                                if (notes.draft)
                                  notes.change(value, notes.draft.target);
                              },
                              onSave: notes.send,
                              onCancel: () => {
                                void notes.cancelEdit();
                              },
                            }
                          : undefined
                      }
                    >
                      <div className="flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
                        <button
                          disabled={!entry.location.page}
                          className="min-w-0 truncate text-left hover:text-foreground"
                          onClick={() => {
                            onVisit(entry.location.page);
                            close();
                          }}
                        >
                          {order === "time"
                            ? `${entry.location.chapter} · `
                            : ""}
                          {entry.location.page
                            ? `p. ${entry.location.page}`
                            : "Location unavailable"}
                        </button>
                        <time
                          dateTime={new Date(entry.createdAt).toISOString()}
                          title={new Date(entry.createdAt).toLocaleString()}
                          className="shrink-0"
                        >
                          {new Date(entry.createdAt).toLocaleTimeString([], {
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </time>
                      </div>
                    </NotebookNoteBody>
                  </NotebookCard>
                )}
              </motion.div>,
            ])}
          </AnimatePresence>
        </div>
      </motion.section>
    ),
    [
      notebookEntries,
      shownEntries,
      filtering,
      kindFilter,
      colorFilter,
      filterHeight,
      changeKindFilter,
      changeColorFilter,
      listRef,
      onVisitHighlight,
      restoredEntries,
      orderedEntries,
      startEdit,
      deleteNote,
      notes,
      inlineEditing,
      NotebookCard,
      order,
      desktop,
      embeddedNotebook,
      keyboardOpen,
      close,
      onVisit,
      reduceMotion,
      groupLabel,
    ],
  );
  return (
    <>
      {!desktop && !embeddedNotebook && (
        <ReaderSheet
          open={notebook && open}
          onOpenChange={(next) => {
            // Closing the notebook returns to reading, not to a composer.
            if (next) setNotebook(true);
            else close();
          }}
          title="Notebook"
          showHeader={false}
          bodyClassName="flex min-h-0 flex-col"
        >
          {notebookPanel}
          <div className="shrink-0 px-4 pt-1 pb-[max(8px,env(safe-area-inset-bottom))]">
            {renderNoteInput("notebook")}
          </div>
        </ReaderSheet>
      )}
      {children(
        <div className="flex h-full min-h-0 flex-col">
          {(desktop || embeddedNotebook) && notebookPanel}
          {(desktop || embeddedNotebook) && (
            <div
              className={
                desktop
                  ? "shrink-0 p-(--sidebar-panel-content-inset)"
                  : "shrink-0 p-4"
              }
            >
              {renderNoteInput("notebook")}
            </div>
          )}
        </div>,
      )}
      {margin.enabled && !notebook && (
        <aside
          aria-label="Page margin notes"
          className="fixed z-40 max-h-[calc(100dvh-6rem)] overflow-y-auto"
          style={{
            left: commentLeft,
            width: commentWidth,
            top: Math.max(
              80,
              Math.min(
                marginEntries[0]?.top ?? commentPosition.top,
                window.innerHeight - 220,
              ),
            ),
          }}
        >
          {margin.width >= 220
            ? marginEntries.map((entry, index) => (
                <article
                  key={entry.id}
                  data-margin-note
                  style={{ marginTop: index === 0 ? 0 : 8 }}
                  className={commentSurface}
                >
                  {entry.quote && (
                    <blockquote
                      className="mb-2 truncate border-l-[3px] pl-2 text-xs text-muted-foreground"
                      style={{
                        borderColor:
                          entry.quote.color === "invisible"
                            ? "var(--muted-foreground)"
                            : `var(--${entry.quote.color}-secondary)`,
                      }}
                    >
                      {entry.quote.selectedText}
                    </blockquote>
                  )}
                  <p className="max-h-48 overflow-auto whitespace-pre-wrap break-words leading-6">
                    {entry.text}
                  </p>
                </article>
              ))
            : marginEntries.length > 0 && (
                <button
                  aria-label="Read margin notes"
                  onClick={() => {
                    setNotebook(true);
                    onActiveChange(true);
                  }}
                  className="mt-1 text-xs text-muted-foreground"
                >
                  {marginEntries.length}
                </button>
              )}
          {desktop && open && margin.width >= 220 && (
            <div
              ref={composer}
              data-note-composer
              className={marginEntries.length ? "mt-2" : ""}
            >
              {renderNoteInput("margin")}
            </div>
          )}
        </aside>
      )}
      {desktop ? (
        <AnimatePresence>
          {composerOpen && !notebook && margin.width < 220 && (
            <motion.div
              ref={composer}
              data-note-composer
              key="composer"
              initial={{
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(8px)",
              }}
              animate={{ opacity: 1, transform: "none" }}
              exit={{
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(8px)",
              }}
              transition={MOTION.enter}
              className="fixed z-40 max-h-[calc(100dvh-7rem)] overflow-y-auto"
              style={{
                top: Math.max(
                  80,
                  Math.min(commentPosition.top, window.innerHeight - 220),
                ),
                left: commentLeft,
                width: commentWidth,
              }}
            >
              {renderNoteInput("margin")}
            </motion.div>
          )}
        </AnimatePresence>
      ) : (
        <AnimatePresence
          onExitComplete={() => {
            if (islandState === "none") onMobileComposerPresenceChange(false);
          }}
        >
          {islandState !== "none" && (
            <motion.div
              ref={composer}
              key="island"
              data-notes-island={islandState}
              data-note-composer={islandState === "compose" ? "" : undefined}
              initial={{
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(16px)",
              }}
              animate={{ opacity: 1, transform: "none" }}
              exit={{
                opacity: 0,
                transform: reduceMotion ? "none" : "translateY(12px)",
                transition: MOTION.exit,
              }}
              transition={MOTION.enter}
              className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center"
            >
              <div
                className="flex justify-center"
                style={{
                  paddingBottom: keyboardOpen
                    ? 8
                    : "max(env(safe-area-inset-bottom), 14px)",
                }}
              >
                <IslandSurface
                  layerKey={islandState}
                  radius={
                    islandState === "tools"
                      ? 26
                      : islandState === "notice"
                        ? 22
                        : 24
                  }
                >
                  {islandState === "tools" && mobileAnnotation && (
                    <IslandTools
                      tools={mobileAnnotation.tools}
                      actionLabel={composeHasText ? "Attach" : "Note"}
                      onNote={() => void noteOnPassage()}
                    />
                  )}
                  {islandState === "note" && annotationNote && (
                    <IslandNote
                      width={islandWidth}
                      text={annotationNote.content}
                      meta={noteMeta(
                        entries.find((entry) => entry.id === annotationNote.id)
                          ?.location.page ?? 0,
                        annotationNote.createdAt,
                      )}
                      onEdit={() => void startEdit(annotationNote.id)}
                      onDelete={() => deleteFromIsland(annotationNote.id)}
                      onShowTools={() => setToolsRequested(true)}
                      onClose={() => mobileAnnotation?.close()}
                    />
                  )}
                  {islandState === "compose" && renderNoteInput("island")}
                  {islandState === "notice" && notice && (
                    <IslandNotice
                      notice={notice}
                      onUndo={() => {
                        setNotice(null);
                        notice.undo?.();
                      }}
                    />
                  )}
                </IslandSurface>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
}

/** The sheet mounts in a portal after its parent. Size the actual input at its
 * own mount, and keep its ref separate from the composer that is still exiting.
 */
function NoteTextInput({
  ref,
  value,
  ...props
}: ComponentProps<"textarea"> & {
  ref: RefObject<HTMLTextAreaElement | null>;
}) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 144)}px`;
  }, [ref, value]);
  return <textarea {...props} ref={ref} value={value} />;
}

/** "p. 12 · Today" for a note shown on the island. */
function noteMeta(page: number, createdAt: number) {
  const date = new Date(createdAt);
  const day =
    date.toDateString() === new Date().toDateString()
      ? "Today"
      : date.toLocaleDateString([], { month: "short", day: "numeric" });
  return page ? `p. ${page} · ${day}` : day;
}

/** A highlight without a note, in the notebook. Choosing it opens its page. */
function HighlightEntry({
  desktop,
  text,
  color,
  location,
  createdAt,
  onSelect,
}: {
  desktop: boolean;
  text: string;
  color: string;
  location: string;
  createdAt: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Go to highlight: ${text}`}
      onClick={onSelect}
      className="group relative mb-2 block w-full rounded-2xl text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div
        className={`rounded-2xl px-4 py-3 ${desktop ? "bg-secondary/40 transition-colors duration-150 group-hover:bg-secondary/70 group-focus-visible:bg-secondary/70" : "bg-secondary"}`}
      >
        <blockquote
          className="border-l-[3px] pl-3 text-[15px] leading-relaxed break-words whitespace-pre-wrap"
          style={{ borderColor: `var(--${color}-secondary)` }}
        >
          {text}
        </blockquote>
        <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-muted-foreground">
          <span className="min-w-0 truncate">{location}</span>
          <time
            dateTime={new Date(createdAt).toISOString()}
            title={new Date(createdAt).toLocaleString()}
            className="shrink-0"
          >
            {new Date(createdAt).toLocaleTimeString([], {
              hour: "numeric",
              minute: "2-digit",
            })}
          </time>
        </div>
      </div>
    </button>
  );
}
