import type { AnnotationColor } from "@/lib/highlight-constants";
import {
  prepareBlocks,
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
  getSelectionPosition,
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
  captureSelectionNote: () => Highlight | null;
  state: ReaderAnnotationState;
  activeHighlight: ActiveHighlightState | null;
  activeHighlightData: Highlight | null;
  isCreatingHighlight: boolean;
  creationPosition: { x: number; y: number; bottom?: number };
  creationText: string;
  /** The selected highlight's text as the toolbar copies it. */
  activeHighlightCopyText: string;
  selectColor: (color: AnnotationColor) => Highlight | undefined;
  closeCreation: () => void;
  clearActiveHighlight: () => void;
}

function clearDomSelection(): void {
  window.getSelection()?.removeAllRanges();
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
      ? prepareBlocks(chapterBlocks, fontConfig, {
          publisherBookStylingEnabled,
        })
      : null;
  }

  return preparedByChapter;
}

function isSelectionInsideContainer(
  selection: Selection,
  container: HTMLDivElement,
): boolean {
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;

  return (
    !!anchorNode &&
    !!focusNode &&
    container.contains(anchorNode) &&
    container.contains(focusNode)
  );
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
  selection: Selection;
  spread: ResolvedSpread;
  stageContentRef: RefObject<HTMLDivElement | null>;
  chapterEntries: ChapterEntry[];
  chapterAccess: ReaderSessionChapterAccess;
  preparedByChapter: (PreparedBlock[] | null)[];
}): PendingHighlightDraft | null {
  const {
    selection,
    spread,
    stageContentRef,
    chapterEntries,
    chapterAccess,
    preparedByChapter,
  } = options;

  const container = stageContentRef.current;
  if (!container) return null;
  if (!selection.rangeCount || selection.isCollapsed) return null;
  if (!selection.toString().trim()) return null;
  if (!isSelectionInsideContainer(selection, container)) return null;

  const range = selection.getRangeAt(0);
  const selectionPosition = getSelectionPosition(selection);
  if (!selectionPosition) return null;
  const position = {
    ...selectionPosition,
    bottom: range.getBoundingClientRect().bottom,
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
    (selection: Selection): PendingHighlightDraft | null => {
      if (!spread) return null;

      const preparedByChapter = buildPreparedByVisibleChapter(
        spread,
        fontConfig,
        publisherBookStylingEnabled,
        chapterAccess,
      );

      return resolvePendingHighlightDraft({
        selection,
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

      const selection = window.getSelection();
      const nextDraft = selection ? resolveSelectionDraft(selection) : null;

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
      const selection = window.getSelection();
      const draft = selection ? resolveSelectionDraft(selection) : null;
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
      if (state.kind !== "creating" || !bookId) {
        clearDomSelection();
        setState({ kind: "idle" });
        return;
      }

      const highlight = buildHighlightFromDraft(bookId, state.draft, color);
      onCreateHighlight(highlight);
      clearDomSelection();
      setState({ kind: "idle" });
      return highlight;
    },
    [bookId, onCreateHighlight, state],
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

  const captureSelectionNote = () => {
    const selection = window.getSelection();
    const draft =
      state.kind === "creating"
        ? state.draft
        : selection
          ? resolveSelectionDraft(selection)
          : null;
    if (!draft || !bookId) return null;
    return buildHighlightFromDraft(bookId, draft, "invisible");
  };

  return {
    captureSelectionNote,
    state,
    activeHighlight,
    activeHighlightData,
    isCreatingHighlight: state.kind === "creating",
    creationPosition: pendingDraft?.position ?? { x: 0, y: 0 },
    creationText: pendingDraft?.copyText ?? "",
    activeHighlightCopyText,
    selectColor,
    closeCreation,
    clearActiveHighlight,
  };
}
