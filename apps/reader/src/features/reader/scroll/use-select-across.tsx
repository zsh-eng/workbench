import type { FontConfig, ResolvedSpread } from "@/lib/pagination-v2";
import { AnimatePresence } from "motion/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { ReaderSessionChapterAccess } from "../hooks/use-reader-session";
import { SpillTab } from "./SpillTab";
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
 * Selecting across a page break. A page selection that a break cuts
 * offers the spill tab under the cut; tapping it visits the column: the
 * selection moves in and grows to the end of the sentence, and once it
 * becomes a highlight or a note (or is dismissed) the column snaps back to
 * pages.
 */
export function useSelectAcross({
  enabled,
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
  enabled: boolean;
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
  const pageBreak = usePageBreakSelection({
    enabled: enabled && scrollMode.selectAcrossPagesAvailable,
    stageContentRef,
    spread,
    chapterAccess,
    fontConfig,
    publisherBookStylingEnabled,
    resolveSelectionRange: annotation.resolveSelectionRange,
  });
  // The tab belongs with the highlight tools.
  const offered =
    pageBreak && annotation.kind === "creating" ? pageBreak : null;

  // The column is made ready while the tab shows, so a tap opens it soon.
  const { prepareColumn } = scrollMode;
  const offeredChapter = offered?.chapterIndex ?? null;
  useEffect(() => {
    prepareColumn(offeredChapter);
  }, [offeredChapter, prepareColumn]);

  // The visit to the column. It ends once the selection is a highlight or
  // a note, or is gone.
  const [handedOver, setHandedOver] = useState(false);
  // From the tap until the column holds the grown selection, the tools
  // would act on the page's shorter one, so they wait.
  const [handingOver, setHandingOver] = useState(false);
  const kept = useRef(false);
  const visiting = scrollMode.mode === "scroll" && handedOver;
  useEffect(() => {
    if (scrollMode.mode === "pages") {
      setHandedOver(false);
      setHandingOver(false);
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
    setHandingOver(false);
  }, [refreshSelection]);

  const visit = (from: PageBreakSelection) => {
    const text = chapterAccess.getCanonicalText(from.chapterIndex);
    if (!text) return;
    const { continuation } = from;
    const entered = scrollMode.enterWithSelection(from.locators, {
      pageIndex: from.pageIndex,
      extension: {
        edge: continuation.edge,
        start: continuation.start,
        end: continuation.end,
        grownFrom:
          continuation.edge === "end"
            ? from.selection.end
            : from.selection.start,
        text: { fullText: text.fullText, blocks: canonicalBlockRanges(text) },
      },
      reveal: continuation.edge,
    });
    if (entered) setHandingOver(true);
  };

  const tab = offered ? (
    <SpillTab
      key={`${offered.continuation.edge}:${offered.continuation.start}:${offered.continuation.end}`}
      pageBreak={offered}
      onContinue={() => visit(offered)}
    />
  ) : null;

  return {
    /** The spill tab, under the cut. */
    overlay: <AnimatePresence>{tab}</AnimatePresence>,
    /** The tools give the page's foot to the spill tab. */
    islandDock: (isMobile && offered?.continuation.edge === "end"
      ? "top"
      : "bottom") as "top" | "bottom",
    /** The selection is moving into the column; its tools wait for it. */
    handingOver,
    /** The visit keeps its selection: return to where it ends. */
    keep: () => {
      if (scrollMode.excursion) kept.current = true;
    },
    onSelectionHandedOver,
  };
}
