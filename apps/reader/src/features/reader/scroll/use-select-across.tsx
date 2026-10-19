import type { FontConfig, ResolvedSpread } from "@/lib/pagination-v2";
import { AnimatePresence } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { HighlightExtension } from "../hooks/use-reader-annotations";
import type { ReaderSessionChapterAccess } from "../hooks/use-reader-session";
import { createColumnTextPoints } from "./column-text-points";
import { HoldSignalLog } from "./HoldSignalLog";
import type { SelectAcrossVariant } from "./select-across-variant";
import { SelectAcrossPagesButton } from "./SelectAcrossPagesButton";
import { SentenceContinuation } from "./SentenceContinuation";
import { SpillTab } from "./SpillTab";
import { useHoldAtPageEdge } from "./use-hold-at-page-edge";
import {
  canonicalBlockRanges,
  usePageBreakSelection,
  type PageBreakSelection,
  type ResolvedSelectionRange,
} from "./use-page-break-selection";
import type { useReaderScrollMode } from "./use-reader-scroll-mode";

type ScrollMode = ReturnType<typeof useReaderScrollMode>;

/** A beat to see the new highlight in the column before pages return. */
const RETURN_AFTER_KEEP_MS = 520;
const RETURN_AFTER_DISMISS_MS = 160;

/**
 * Selecting across a page break, in one of the variants Design ideas
 * compares (see select-across-variant.ts). It watches page selections that
 * a break cuts, offers the variant's affordance, and runs the visit to the
 * column that the spill tab and hold use: the selection moves in, grows,
 * and once it becomes a highlight or a note (or is dismissed) the column
 * snaps back to pages.
 */
export function useSelectAcross({
  variant,
  enabled,
  log,
  isMobile,
  scrollMode,
  stageContentRef,
  spread,
  chapterAccess,
  fontConfig,
  publisherBookStylingEnabled,
  annotation,
  notesActive,
}: {
  variant: SelectAcrossVariant;
  enabled: boolean;
  /** Shows the hold variant's signal log. */
  log: boolean;
  isMobile: boolean;
  scrollMode: ScrollMode;
  stageContentRef: RefObject<HTMLDivElement | null>;
  spread: ResolvedSpread | null;
  chapterAccess: ReaderSessionChapterAccess;
  fontConfig: FontConfig;
  publisherBookStylingEnabled: boolean;
  annotation: {
    kind: "idle" | "creating" | "active";
    resolveSelectionRange: (
      selection: Selection,
    ) => ResolvedSelectionRange | null;
    refreshSelection: () => void;
  };
  /** A note composer or the notebook is open over the reader. */
  notesActive: boolean;
}) {
  const creating = annotation.kind === "creating";
  const pageBreak = usePageBreakSelection({
    enabled: enabled && scrollMode.selectAcrossPagesAvailable,
    stageContentRef,
    spread,
    chapterAccess,
    fontConfig,
    publisherBookStylingEnabled,
    resolveSelectionRange: annotation.resolveSelectionRange,
  });
  // The spill tab and the sentence line belong with the highlight tools;
  // hold works while the handles are still moving.
  const offered = pageBreak && creating ? pageBreak : null;

  // The visit to the column. It ends once the selection is a highlight or
  // a note, or is gone.
  const [handedOver, setHandedOver] = useState(false);
  const kept = useRef(false);
  const visiting = scrollMode.mode === "scroll" && handedOver;
  useEffect(() => {
    if (scrollMode.mode === "pages") {
      setHandedOver(false);
      kept.current = false;
    }
  }, [scrollMode.mode]);
  const idle = annotation.kind === "idle" && !notesActive;
  const { endExcursion } = scrollMode;
  useEffect(() => {
    if (!visiting || !scrollMode.excursion || !idle) return;
    const timer = window.setTimeout(
      () => endExcursion(kept.current ? "kept" : "dismissed"),
      kept.current ? RETURN_AFTER_KEEP_MS : RETURN_AFTER_DISMISS_MS,
    );
    return () => window.clearTimeout(timer);
  }, [endExcursion, idle, scrollMode.excursion, visiting]);

  const { refreshSelection } = annotation;
  const onSelectionHandedOver = useCallback(() => {
    refreshSelection();
    setHandedOver(true);
  }, [refreshSelection]);

  const textOf = (chapterIndex: number) => {
    const text = chapterAccess.getCanonicalText(chapterIndex);
    return text
      ? { fullText: text.fullText, blocks: canonicalBlockRanges(text) }
      : null;
  };

  const visit = (from: PageBreakSelection, grow: boolean) => {
    const text = textOf(from.chapterIndex);
    if (!text) return;
    const { continuation } = from;
    scrollMode.enterWithSelection(from.locators, {
      excursion: true,
      pageIndex: from.pageIndex,
      extension: grow
        ? {
            edge: continuation.edge,
            start: continuation.start,
            end: continuation.end,
            grownFrom:
              continuation.edge === "end"
                ? from.selection.end
                : from.selection.start,
            text,
          }
        : null,
      reveal: continuation.edge,
    });
  };

  // Hold at the edge.
  useHoldAtPageEdge({
    enabled:
      enabled && variant === "hold" && scrollMode.selectAcrossPagesAvailable,
    pageBreak,
    onHold: (from) => visit(from, false),
  });

  // Finish the sentence: whether the continuation is in the highlight.
  const [included, setIncluded] = useState<{
    start: number;
    end: number;
  } | null>(null);
  const extension: HighlightExtension | null =
    variant === "sentence" &&
    offered &&
    included?.start === offered.continuation.start &&
    included.end === offered.continuation.end
      ? {
          startOffset: offered.continuation.start,
          endOffset: offered.continuation.end,
        }
      : null;
  const toggleIncluded = (from: PageBreakSelection) => {
    if (extension) {
      setIncluded(null);
      return;
    }
    setIncluded({ start: from.continuation.start, end: from.continuation.end });
    // The page's selection runs to the edge, so the page shows what the
    // highlight will cover here.
    const layer = stageContentRef.current?.querySelector(
      '[data-reader-spread-layer="current"]',
    );
    const text = textOf(from.chapterIndex);
    const selection = window.getSelection();
    if (!layer || !text || !selection) return;
    const points = createColumnTextPoints(layer, text);
    const foot = from.continuation.edge === "end";
    const fixed = foot
      ? points.start(from.selection.start)
      : points.end(from.selection.end);
    const edge = foot
      ? points.end(from.pageText.end)
      : points.start(from.pageText.start);
    if (fixed && edge) {
      selection.setBaseAndExtent(
        fixed.node,
        fixed.offset,
        edge.node,
        edge.offset,
      );
    }
  };

  const tab =
    variant === "spill" && offered ? (
      <SpillTab
        key={`${offered.continuation.edge}:${offered.continuation.start}:${offered.continuation.end}`}
        pageBreak={offered}
        onContinue={() => visit(offered, true)}
      />
    ) : null;

  const islandAction =
    variant === "toolbar" && offered ? (
      <SelectAcrossPagesButton
        variant="island"
        onSelect={() => scrollMode.enterWithSelection(offered.locators)}
      />
    ) : undefined;
  const toolbarAction =
    variant === "toolbar" && offered ? (
      <SelectAcrossPagesButton
        variant="toolbar"
        onSelect={() => scrollMode.enterWithSelection(offered.locators)}
      />
    ) : undefined;
  const sentenceLine = (kind: "island" | "toolbar"): ReactNode =>
    variant === "sentence" && offered ? (
      <SentenceContinuation
        variant={kind}
        pageBreak={offered}
        included={extension !== null}
        onToggle={() => toggleIncluded(offered)}
      />
    ) : undefined;

  return {
    pageBreak,
    /** The spill tab, and the hold variant's signal log when asked for. */
    overlay: (
      <>
        <AnimatePresence>{tab}</AnimatePresence>
        {log && variant === "hold" && <HoldSignalLog />}
      </>
    ),
    /**
     * The tools give the page's foot to the spill tab, and to a selection
     * at the foot that the taller sentence tools would cover.
     */
    islandDock: (isMobile &&
    offered?.continuation.edge === "end" &&
    (variant === "spill" || variant === "sentence")
      ? "top"
      : "bottom") as "top" | "bottom",
    islandAction,
    islandAccessory: sentenceLine("island"),
    toolbarAction,
    toolbarAccessory: sentenceLine("toolbar"),
    /** What a highlight or note made now should also cover. */
    extension,
    /** The visit keeps its selection: return to where it ends. */
    keep: () => {
      if (scrollMode.excursion) kept.current = true;
    },
    onSelectionHandedOver,
  };
}
