import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { ScrollText } from "lucide-react";
import { captureSelection, type SelectionLocators } from "./selection-transfer";

const CHIP_HEIGHT_PX = 34;
const CHIP_GAP_PX = 8;

interface ChipState {
  locators: SelectionLocators;
  top: number;
  left: number;
}

interface PageEdges {
  left: number;
  right: number;
  firstLineTop: number;
  firstLineBottom: number;
  lastLineTop: number;
  lastLineBottom: number;
}

function readPageEdges(slot: Element): PageEdges | null {
  const slices = slot.querySelectorAll<HTMLElement>(
    '[data-reader-slice-type="text"]',
  );
  const first = slices[0];
  const last = slices[slices.length - 1];
  if (!first || !last) return null;
  const firstRect = first.getBoundingClientRect();
  const lastRect = last.getBoundingClientRect();
  const firstLine = Number(first.dataset.readerLineHeight) || 24;
  const lastLine = Number(last.dataset.readerLineHeight) || 24;
  const slotRect = slot.getBoundingClientRect();
  return {
    left: slotRect.left,
    right: slotRect.right,
    firstLineTop: firstRect.top,
    firstLineBottom: firstRect.top + firstLine,
    lastLineTop: lastRect.bottom - lastLine,
    lastLineBottom: lastRect.bottom,
  };
}

/**
 * "Select across pages in Scroll": shown when a selection on a page reaches
 * the page's first or last line, where a page break stops it. Tapping it
 * opens scroll mode with the same selection, ready to extend.
 */
export function SelectionScrollChip({
  enabled,
  stageContentRef,
  onActivate,
}: {
  enabled: boolean;
  stageContentRef: RefObject<HTMLDivElement | null>;
  onActivate: (locators: SelectionLocators) => void;
}) {
  const [chip, setChip] = useState<ChipState | null>(null);

  const evaluate = useEffectEvent(() => {
    const layer = stageContentRef.current?.querySelector(
      '[data-reader-spread-layer="current"]',
    );
    const selection = window.getSelection();
    const locators =
      enabled && layer ? captureSelection(layer, selection) : null;
    if (!layer || !selection || !locators) {
      setChip(null);
      return;
    }
    const rects = Array.from(selection.getRangeAt(0).getClientRects()).filter(
      (rect) => rect.width > 0 && rect.height > 0,
    );
    if (rects.length === 0) {
      setChip(null);
      return;
    }

    let touchesLast = false;
    let touchesFirst = false;
    let pageEdges: PageEdges | null = null;
    for (const slot of layer.querySelectorAll("[data-reader-page-slot]")) {
      const edges = readPageEdges(slot);
      if (!edges) continue;
      const onPage = rects.filter(
        (rect) => rect.right > edges.left && rect.left < edges.right,
      );
      if (onPage.length === 0) continue;
      pageEdges = edges;
      touchesLast ||= onPage.some(
        (rect) =>
          rect.bottom > edges.lastLineTop + 2 &&
          rect.top < edges.lastLineBottom,
      );
      touchesFirst ||= onPage.some(
        (rect) =>
          rect.top < edges.firstLineBottom - 2 &&
          rect.bottom > edges.firstLineTop,
      );
    }
    if (!pageEdges || (!touchesLast && !touchesFirst)) {
      setChip(null);
      return;
    }

    // Below the selection when it fits above the phone's annotation bar or
    // the screen's foot; otherwise above the selection.
    const firstRect = rects[0]!;
    const lastRect = rects[rects.length - 1]!;
    const island = document
      .querySelector("[data-notes-island]")
      ?.getBoundingClientRect();
    const floor = Math.min(
      island && island.height > 0 ? island.top : Infinity,
      window.innerHeight - 12,
    );
    const below = lastRect.bottom + CHIP_GAP_PX;
    const top =
      below + CHIP_HEIGHT_PX <= floor
        ? below
        : Math.max(12, firstRect.top - CHIP_GAP_PX - CHIP_HEIGHT_PX);
    setChip({
      locators,
      top,
      left: (pageEdges.left + pageEdges.right) / 2,
    });
  });

  useEffect(() => {
    if (!enabled) {
      setChip(null);
      return;
    }
    let timer = 0;
    let settleTimer = 0;
    const onSelectionChange = () => {
      window.clearTimeout(timer);
      window.clearTimeout(settleTimer);
      timer = window.setTimeout(evaluate, 140);
      // Again once the annotation bar has risen, to sit clear of it.
      settleTimer = window.setTimeout(evaluate, 520);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    onSelectionChange();
    return () => {
      window.clearTimeout(timer);
      window.clearTimeout(settleTimer);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [enabled]);

  if (!chip) return null;
  return (
    <button
      type="button"
      data-reader-selection-scroll-chip=""
      // Keep the selection: a press on the chip must not collapse it.
      onPointerDown={(event) => event.preventDefault()}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        const locators = chip.locators;
        setChip(null);
        onActivate(locators);
      }}
      className="fixed z-[45] flex -translate-x-1/2 items-center whitespace-nowrap gap-1.5 rounded-full border border-border/80 bg-background/95 px-3 text-[12px] font-medium text-foreground shadow-md backdrop-blur-md transition-[scale] duration-150 active:scale-[0.97]"
      style={{ top: chip.top, left: chip.left, height: CHIP_HEIGHT_PX }}
    >
      <ScrollText
        className="size-3.5 text-muted-foreground"
        aria-hidden="true"
      />
      Select across pages in Scroll
    </button>
  );
}
