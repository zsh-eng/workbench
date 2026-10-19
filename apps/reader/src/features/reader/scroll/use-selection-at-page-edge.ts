import { useEffect, useEffectEvent, useState, type RefObject } from "react";
import { captureSelection, type SelectionLocators } from "./selection-transfer";

/** Waits out a drag of the selection's handles before measuring. */
const SETTLE_MS = 80;

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

/** Whether the selection's rects reach a page's first or last line. */
function touchesPageEdge(layer: Element, rects: DOMRect[]): boolean {
  for (const slot of layer.querySelectorAll("[data-reader-page-slot]")) {
    const edges = readPageEdges(slot);
    if (!edges) continue;
    const onPage = rects.filter(
      (rect) => rect.right > edges.left && rect.left < edges.right,
    );
    if (
      onPage.some(
        (rect) =>
          (rect.bottom > edges.lastLineTop + 2 &&
            rect.top < edges.lastLineBottom) ||
          (rect.top < edges.firstLineBottom - 2 &&
            rect.bottom > edges.firstLineTop),
      )
    )
      return true;
  }
  return false;
}

/**
 * A selection on a page that reaches the page's first or last line, where a
 * page break stops it. The highlight tools then offer to carry it into
 * scroll mode, ready to extend across the break.
 */
export function useSelectionAtPageEdge({
  enabled,
  stageContentRef,
}: {
  enabled: boolean;
  stageContentRef: RefObject<HTMLDivElement | null>;
}): SelectionLocators | null {
  const [locators, setLocators] = useState<SelectionLocators | null>(null);

  const evaluate = useEffectEvent(() => {
    const layer = stageContentRef.current?.querySelector(
      '[data-reader-spread-layer="current"]',
    );
    const selection = window.getSelection();
    const captured =
      enabled && layer ? captureSelection(layer, selection) : null;
    const rects =
      captured && selection
        ? Array.from(selection.getRangeAt(0).getClientRects()).filter(
            (rect) => rect.width > 0 && rect.height > 0,
          )
        : [];
    setLocators(
      captured && layer && touchesPageEdge(layer, rects) ? captured : null,
    );
  });

  useEffect(() => {
    if (!enabled) {
      setLocators(null);
      return;
    }
    let timer = 0;
    const onSelectionChange = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(evaluate, SETTLE_MS);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    onSelectionChange();
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelectionChange);
    };
  }, [enabled]);

  return locators;
}
