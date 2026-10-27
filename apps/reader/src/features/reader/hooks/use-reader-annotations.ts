import type { AnnotationColor } from "@/lib/highlight-constants";
import {
  resolveCanonicalRangeText,
  resolveContentAnchorRangeToHighlight,
  resolveDomEndpointToContentAnchor,
  type FontConfig,
  type PreparedBlock,
  type ResolvedSpread,
} from "@/lib/pagination-v2";
import type { Highlight } from "@/types/highlight";
import {
  EPUB_HIGHLIGHT_ACTIVE_CLASS,
  EPUB_HIGHLIGHT_CLASS,
  EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
  EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
} from "@/types/reader.types";
import {
  createHighlightInteractionManager,
  type HighlightInteractionManager,
} from "@zsh-eng/text-highlighter";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ChapterEntry } from "../types";
import {
  READER_TOUCH_TAP_HANDLED_EVENT,
  TOUCH_TAP_SELECTION_SUPPRESSION_MS,
} from "./reader-interaction-events";
import { selectParagraph } from "../paragraph-selection";
import { preparedChapter } from "../prepared-chapter";
import { getSpreadContentKey } from "../spread-identity";
import type { ReaderSessionChapterAccess } from "./use-reader-session";

export interface ActiveHighlightState {
  id: string;
  position: { x: number; y: number };
}

interface PendingHighlightDraft {
  /** The selection's top centre, and its foot for tools that open below. */
  position: { x: number; y: number; bottom: number };
  spineItemId: string;
  highlight: NonNullable<
    ReturnType<typeof resolveContentAnchorRangeToHighlight>
  >;
  /** The passage as copied: page spacing and paragraph breaks, not source whitespace. */
  copyText: string;
}

/**
 * Reader annotation interaction states:
 *
 * - `idle`
 *   No active text selection and no selected existing highlight.
 *
 * - `creating`
 *   The current text selection resolved into a valid new highlight draft.
 *   The toolbar should show create actions.
 *
 * - `active`
 *   The user selected an existing highlight. The toolbar should show edit or
 *   close actions for that highlight.
 *
 * Invariant:
 * Only one non-idle annotation mode may be active at a time.
 */
export type ReaderAnnotationState =
  | { kind: "idle" }
  | { kind: "creating"; draft: PendingHighlightDraft }
  | { kind: "active"; highlight: ActiveHighlightState };

interface UseReaderAnnotationsOptions {
  bookId?: string;
  spread: ResolvedSpread | null;
  stageContentRef: RefObject<HTMLDivElement | null>;
  chapterEntries: ChapterEntry[];
  chapterAccess: ReaderSessionChapterAccess;
  fontConfig: FontConfig;
  publisherBookStylingEnabled: boolean;
  highlights: Highlight[];
  onCreateHighlight: (highlight: Highlight) => void;
}

interface UseReaderAnnotationsResult {
  /** The selection as a note's passage, read as a tool does (see below). */
  captureSelectionNote: () => Highlight | null;
  state: ReaderAnnotationState;
  activeHighlight: ActiveHighlightState | null;
  activeHighlightData: Highlight | null;
  isCreatingHighlight: boolean;
  /** Where the selection was when the Reader last read it: for placing the
   * tools only. */
  creationPosition: { x: number; y: number; bottom?: number };
  /** The selection as Copy writes it, read as a tool does (see below). */
  readSelectionCopyText: () => string;
  /** The selected highlight's text as the toolbar copies it. */
  activeHighlightCopyText: string;
  /** Highlights the selection, read as a tool does (see below). */
  selectColor: (color: AnnotationColor) => Highlight | undefined;
  closeCreation: () => void;
  clearActiveHighlight: () => void;
  /** The current selection's canonical range, without opening any tools. */
  resolveSelectionRange: (selection: Selection) => {
    chapterIndex: number;
    startOffset: number;
    endOffset: number;
  } | null;
  /** Reads a selection set by code, which no pointer release announces. */
  refreshSelection: () => void;
}

function clearDomSelection(): void {
  window.getSelection()?.removeAllRanges();
}

/** The page's selection as it is now, or null when nothing is selected. */
function selectedRange(): Range | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  return selection.getRangeAt(0);
}

function buildPreparedByVisibleChapter(
  spread: ResolvedSpread,
  fontConfig: FontConfig,
  publisherBookStylingEnabled: boolean,
  chapterAccess: ReaderSessionChapterAccess,
): (PreparedBlock[] | null)[] {
  const preparedByChapter: (PreparedBlock[] | null)[] = [];

  for (const slot of spread.slots) {
    if (slot.kind !== "page") continue;

    const { chapterIndex } = slot.page;
    if (preparedByChapter[chapterIndex] !== undefined) continue;

    const chapterBlocks = chapterAccess.getBlocks(chapterIndex);
    preparedByChapter[chapterIndex] = chapterBlocks
      ? preparedChapter(chapterBlocks, fontConfig, publisherBookStylingEnabled)
      : null;
  }

  return preparedByChapter;
}

function getVisibleSpineItemIds(
  spread: ResolvedSpread | null,
  chapterEntries: ChapterEntry[],
): Set<string> {
  if (!spread) return new Set<string>();

  const start = spread.chapterIndexStart;
  const end = spread.chapterIndexEnd;
  if (start === null || end === null) {
    return new Set<string>();
  }

  const visibleIds = new Set<string>();
  for (let chapterIndex = start; chapterIndex <= end; chapterIndex++) {
    const chapter = chapterEntries[chapterIndex];
    if (!chapter) continue;
    visibleIds.add(chapter.spineItemId);
  }

  return visibleIds;
}

function buildHighlightFromDraft(
  bookId: string,
  draft: PendingHighlightDraft,
  color: AnnotationColor,
): Highlight {
  return {
    id: crypto.randomUUID(),
    bookId,
    spineItemId: draft.spineItemId,
    startOffset: draft.highlight.startOffset,
    endOffset: draft.highlight.endOffset,
    selectedText: draft.highlight.selectedText,
    textBefore: draft.highlight.textBefore,
    textAfter: draft.highlight.textAfter,
    color,
    createdAt: Date.now(),
  };
}

function resolvePendingHighlightDraft(options: {
  range: Range;
  spread: ResolvedSpread;
  stageContentRef: RefObject<HTMLDivElement | null>;
  chapterEntries: ChapterEntry[];
  chapterAccess: ReaderSessionChapterAccess;
  preparedByChapter: (PreparedBlock[] | null)[];
}): PendingHighlightDraft | null {
  const {
    range,
    spread,
    stageContentRef,
    chapterEntries,
    chapterAccess,
    preparedByChapter,
  } = options;

  const container = stageContentRef.current;
  if (!container) return null;
  if (
    !container.contains(range.startContainer) ||
    !container.contains(range.endContainer)
  )
    return null;
  if (!range.toString().trim()) return null;

  const rect = range.getBoundingClientRect();
  const position = {
    x: rect.left + rect.width / 2,
    y: rect.top,
    bottom: rect.bottom,
  };

  const startAnchor = resolveDomEndpointToContentAnchor({
    node: range.startContainer,
    offset: range.startOffset,
    spread,
    preparedByChapter,
    fallbackBias: "forward",
  });
  const endAnchor = resolveDomEndpointToContentAnchor({
    node: range.endContainer,
    offset: range.endOffset,
    spread,
    preparedByChapter,
    fallbackBias: "backward",
  });

  if (!startAnchor || !endAnchor) return null;
  if (startAnchor.chapterIndex !== endAnchor.chapterIndex) return null;

  const chapterBlocks = chapterAccess.getBlocks(startAnchor.chapterIndex);
  const chapterCanonicalText = chapterAccess.getCanonicalText(
    startAnchor.chapterIndex,
  );
  const preparedChapter = preparedByChapter[startAnchor.chapterIndex];
  if (!chapterBlocks || !chapterCanonicalText || !preparedChapter) return null;

  const highlight = resolveContentAnchorRangeToHighlight({
    startAnchor,
    endAnchor,
    chapterBlocks,
    preparedChapter,
    chapterCanonicalText,
  });
  if (!highlight) return null;

  const chapter = chapterEntries[startAnchor.chapterIndex];
  if (!chapter) return null;

  return {
    position,
    spineItemId: chapter.spineItemId,
    highlight,
    copyText: resolveCanonicalRangeText({
      chapterBlocks,
      chapterCanonicalText,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
    }),
  };
}

/** A saved highlight's copy text, from its chapter when that is loaded. */
function resolveHighlightCopyText(
  highlight: Highlight,
  chapterEntries: ChapterEntry[],
  chapterAccess: ReaderSessionChapterAccess,
): string {
  const chapterIndex = chapterEntries.findIndex(
    (entry) => entry.spineItemId === highlight.spineItemId,
  );
  if (chapterIndex < 0) return highlight.selectedText;
  const chapterBlocks = chapterAccess.getBlocks(chapterIndex);
  const chapterCanonicalText = chapterAccess.getCanonicalText(chapterIndex);
  if (!chapterBlocks || !chapterCanonicalText) return highlight.selectedText;
  return (
    resolveCanonicalRangeText({
      chapterBlocks,
      chapterCanonicalText,
      startOffset: highlight.startOffset,
      endOffset: highlight.endOffset,
    }) || highlight.selectedText
  );
}

/**
 * Selection, highlight and note state for the Reader's pages.
 *
 * The Reader reads a selection for its tools 100 ms after a mouse release,
 * or 300 ms after a touch ends (`creating`). That draft only places and
 * shows the tools. A selection can change after it: a key changes it with
 * no release, a native handle's last change can come after its touchend,
 * and a tap can come within the delay. So the tools act on the selection
 * itself:
 *
 * - A press on a tool (inside `[data-selection-tools]`) reads the
 *   selection on `pointerdown`, before the browser's default actions for
 *   the tap can change it. The action at `click` takes that reading.
 * - An action with no press before it, such as a key on a focused tool,
 *   reads the selection when it runs.
 *
 * Each press is taken once. A key, a cancelled pointer, or a press outside
 * the tools forgets it.
 */
export function useReaderAnnotations({
  bookId,
  spread,
  stageContentRef,
  chapterEntries,
  chapterAccess,
  fontConfig,
  publisherBookStylingEnabled,
  highlights,
  onCreateHighlight,
}: UseReaderAnnotationsOptions): UseReaderAnnotationsResult {
  const [state, setState] = useState<ReaderAnnotationState>({ kind: "idle" });
  const highlightManagerRef = useRef<HighlightInteractionManager | null>(null);
  const suppressSelectionUntilRef = useRef(0);
  /** The selection as a press on the tools read it, until an action takes it. */
  const pressRef = useRef<{ draft: PendingHighlightDraft | null } | null>(null);

  const activeHighlight = state.kind === "active" ? state.highlight : null;
  const pendingDraft = state.kind === "creating" ? state.draft : null;

  const visibleSpineItemIds = useMemo(
    () => getVisibleSpineItemIds(spread, chapterEntries),
    [chapterEntries, spread],
  );

  const visibleHighlights = useMemo(
    () =>
      highlights.filter((highlight) =>
        visibleSpineItemIds.has(highlight.spineItemId),
      ),
    [highlights, visibleSpineItemIds],
  );

  const activeHighlightData = useMemo(() => {
    if (!activeHighlight) return null;

    return (
      highlights.find((highlight) => highlight.id === activeHighlight.id) ??
      null
    );
  }, [activeHighlight, highlights]);

  const activeHighlightCopyText = useMemo(
    () =>
      activeHighlightData
        ? resolveHighlightCopyText(
            activeHighlightData,
            chapterEntries,
            chapterAccess,
          )
        : "",
    [activeHighlightData, chapterAccess, chapterEntries],
  );

  const resolveSelectionDraft = useCallback(
    (range: Range | null): PendingHighlightDraft | null => {
      if (!spread || !range) return null;

      const preparedByChapter = buildPreparedByVisibleChapter(
        spread,
        fontConfig,
        publisherBookStylingEnabled,
        chapterAccess,
      );

      return resolvePendingHighlightDraft({
        range,
        spread,
        stageContentRef,
        chapterEntries,
        chapterAccess,
        preparedByChapter,
      });
    },
    [
      chapterAccess,
      chapterEntries,
      fontConfig,
      publisherBookStylingEnabled,
      spread,
      stageContentRef,
    ],
  );

  useEffect(() => {
    const container = stageContentRef.current;
    if (!container) return;

    const manager = createHighlightInteractionManager(container, {
      highlightClass: EPUB_HIGHLIGHT_CLASS,
      idAttribute: EPUB_HIGHLIGHT_DATA_ATTRIBUTE,
      hoverClass: EPUB_HIGHLIGHT_GROUP_HOVER_CLASS,
      activeClass: EPUB_HIGHLIGHT_ACTIVE_CLASS,
      onHighlightClick: (id, position) => {
        clearDomSelection();
        setState((previousState) => {
          if (
            previousState.kind === "active" &&
            previousState.highlight.id === id
          ) {
            return { kind: "idle" };
          }

          return { kind: "active", highlight: { id, position } };
        });
      },
    });

    highlightManagerRef.current = manager;
    return () => {
      manager.destroy();
      if (highlightManagerRef.current === manager) {
        highlightManagerRef.current = null;
      }
    };
  }, [spread, stageContentRef]);

  useEffect(() => {
    highlightManagerRef.current?.setActiveHighlight(
      activeHighlight?.id ?? null,
    );
  }, [activeHighlight, spread]);

  useEffect(() => {
    const handleResolvedSelection = () => {
      if (Date.now() < suppressSelectionUntilRef.current) {
        clearDomSelection();
        setState((previousState) =>
          previousState.kind === "creating" ? { kind: "idle" } : previousState,
        );
        return;
      }

      const nextDraft = resolveSelectionDraft(selectedRange());

      setState((previousState) => {
        if (nextDraft) {
          return { kind: "creating", draft: nextDraft };
        }

        if (previousState.kind === "creating") {
          return { kind: "idle" };
        }

        return previousState;
      });
    };

    let timeoutId = 0;
    let paragraphTimeoutId = 0;
    const isTouchDevice =
      "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const delay = isTouchDevice ? 300 : 100;

    const handlePointerUp = (event: Event) => {
      // Composer interactions must not replace the captured passage with the
      // textarea selection after the keyboard takes focus.
      if (
        event.target instanceof Element &&
        event.target.closest("[data-note-composer]")
      )
        return;
      // A triple-click means the paragraph. Selecting it fires selectionchange,
      // so its timer must not be the one selectionchange cancels.
      const container = stageContentRef.current;
      const selection = window.getSelection();
      if (
        event instanceof MouseEvent &&
        event.detail >= 3 &&
        event.target instanceof Node &&
        container?.contains(event.target) &&
        selection &&
        selectParagraph(selection)
      ) {
        window.clearTimeout(paragraphTimeoutId);
        paragraphTimeoutId = window.setTimeout(handleResolvedSelection, delay);
        return;
      }
      timeoutId = window.setTimeout(handleResolvedSelection, delay);
    };

    const handleSelectionChange = () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = 0;
      }
    };

    const handleTouchTapHandled = () => {
      suppressSelectionUntilRef.current =
        Date.now() + TOUCH_TAP_SELECTION_SUPPRESSION_MS;
      clearDomSelection();
    };

    // A native copy (Cmd+C, or Copy in the iOS selection menu) would take
    // a line break from every wrapped line. Copy the passage as text instead.
    const handleCopy = (event: ClipboardEvent) => {
      const draft = resolveSelectionDraft(selectedRange());
      if (!draft || !event.clipboardData) return;
      event.clipboardData.setData("text/plain", draft.copyText);
      event.preventDefault();
    };

    document.addEventListener("copy", handleCopy);
    document.addEventListener("mouseup", handlePointerUp);
    document.addEventListener("touchend", handlePointerUp);
    document.addEventListener("selectionchange", handleSelectionChange);
    document.addEventListener(
      READER_TOUCH_TAP_HANDLED_EVENT,
      handleTouchTapHandled,
    );

    return () => {
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("mouseup", handlePointerUp);
      document.removeEventListener("touchend", handlePointerUp);
      document.removeEventListener("selectionchange", handleSelectionChange);
      document.removeEventListener(
        READER_TOUCH_TAP_HANDLED_EVENT,
        handleTouchTapHandled,
      );
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      window.clearTimeout(paragraphTimeoutId);
    };
  }, [resolveSelectionDraft, stageContentRef]);

  // A press on the tools reads the selection before the tap's default
  // actions run. Capture phase, so no handler that stops the event hides it.
  useEffect(() => {
    const handlePress = (event: PointerEvent) => {
      pressRef.current =
        event.target instanceof Element &&
        event.target.closest("[data-selection-tools]")
          ? { draft: resolveSelectionDraft(selectedRange()) }
          : null;
    };
    const forgetPress = () => {
      pressRef.current = null;
    };
    document.addEventListener("pointerdown", handlePress, true);
    document.addEventListener("pointercancel", forgetPress, true);
    document.addEventListener("keydown", forgetPress, true);
    return () => {
      document.removeEventListener("pointerdown", handlePress, true);
      document.removeEventListener("pointercancel", forgetPress, true);
      document.removeEventListener("keydown", forgetPress, true);
    };
  }, [resolveSelectionDraft]);

  /** The selection for an action: the press's reading, else the page's now. */
  const takeSelectionDraft = useCallback(() => {
    const press = pressRef.current;
    pressRef.current = null;
    return press ? press.draft : resolveSelectionDraft(selectedRange());
  }, [resolveSelectionDraft]);

  // Clear a selection when the pages it was made on go away.
  const visiblePagesKey = spread ? getSpreadContentKey(spread) : "";
  useEffect(() => {
    clearDomSelection();
    setState((previousState) =>
      previousState.kind === "creating" ? { kind: "idle" } : previousState,
    );
  }, [visiblePagesKey]);

  useEffect(() => {
    if (state.kind !== "active") return;

    const isHighlightStillVisible = visibleHighlights.some(
      (highlight) => highlight.id === state.highlight.id,
    );
    if (!isHighlightStillVisible) {
      setState({ kind: "idle" });
    }
  }, [state, visibleHighlights]);

  const selectColor = useCallback(
    (color: AnnotationColor) => {
      const draft = takeSelectionDraft();
      clearDomSelection();
      setState({ kind: "idle" });
      if (!draft || !bookId) return;

      const highlight = buildHighlightFromDraft(bookId, draft, color);
      onCreateHighlight(highlight);
      return highlight;
    },
    [bookId, onCreateHighlight, takeSelectionDraft],
  );

  const closeCreation = useCallback(() => {
    clearDomSelection();
    setState((previousState) =>
      previousState.kind === "creating" ? { kind: "idle" } : previousState,
    );
  }, []);

  const clearActiveHighlight = useCallback(() => {
    setState((previousState) =>
      previousState.kind === "active" ? { kind: "idle" } : previousState,
    );
  }, []);

  const captureSelectionNote = useCallback(() => {
    const draft = takeSelectionDraft();
    if (!draft || !bookId) return null;
    return buildHighlightFromDraft(bookId, draft, "invisible");
  }, [bookId, takeSelectionDraft]);

  const readSelectionCopyText = useCallback(
    () => takeSelectionDraft()?.copyText ?? "",
    [takeSelectionDraft],
  );

  const resolveSelectionRange = useCallback(
    (selection: Selection) => {
      const draft = resolveSelectionDraft(
        selection.rangeCount && !selection.isCollapsed
          ? selection.getRangeAt(0)
          : null,
      );
      return draft
        ? {
            chapterIndex: draft.highlight.chapterIndex,
            startOffset: draft.highlight.startOffset,
            endOffset: draft.highlight.endOffset,
          }
        : null;
    },
    [resolveSelectionDraft],
  );

  const refreshSelection = useCallback(() => {
    const draft = resolveSelectionDraft(selectedRange());
    setState((previousState) =>
      draft
        ? { kind: "creating", draft }
        : previousState.kind === "creating"
          ? { kind: "idle" }
          : previousState,
    );
  }, [resolveSelectionDraft]);

  return {
    captureSelectionNote,
    state,
    activeHighlight,
    activeHighlightData,
    isCreatingHighlight: state.kind === "creating",
    creationPosition: pendingDraft?.position ?? { x: 0, y: 0 },
    readSelectionCopyText,
    activeHighlightCopyText,
    selectColor,
    closeCreation,
    clearActiveHighlight,
    resolveSelectionRange,
    refreshSelection,
  };
}
