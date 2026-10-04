import type { HighlightColor } from "@/lib/highlight-constants";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";

/**
 * Notes Lab model. Everything here is in-memory prototype state: nothing is
 * written to IndexedDB, sync, or Reader preferences.
 */
export type LabColor = HighlightColor | "invisible";

export interface TextRange {
  paragraph: number;
  start: number;
  end: number;
}

export interface LabNote {
  id: string;
  chapter: string;
  page: number;
  color: LabColor;
  /** Quoted passage. Null for a page note. */
  quote: string | null;
  /** Empty text means a highlight without a note. */
  text: string;
  createdAt: number;
  /** Position on the visible lab page; null for notebook-only entries. */
  range: TextRange | null;
}

export interface LabSelection {
  range: TextRange;
  text: string;
}

export interface LocalRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EASE = [0.23, 1, 0.32, 1] as const;
/** iOS sheet and keyboard curve. */
export const EASE_SHEET = [0.32, 0.72, 0, 1] as const;
export const SPRING_SOFT = {
  type: "spring",
  bounce: 0.18,
  duration: 0.5,
} as const;
/** Low-bounce spring for surfaces that change shape near reading text. */
export const SPRING_CALM = {
  type: "spring",
  bounce: 0.1,
  duration: 0.42,
} as const;
export const SPRING_SNAP = {
  type: "spring",
  bounce: 0.32,
  duration: 0.38,
} as const;

export function colorVar(color: LabColor | "pending") {
  if (color === "pending")
    return "color-mix(in srgb, var(--blue-secondary) 55%, transparent)";
  if (color === "invisible") return "var(--muted-foreground)";
  return `var(--${color}-secondary)`;
}

let nextId = 0;
export function labId(prefix = "note") {
  nextId += 1;
  return `${prefix}-${Date.now().toString(36)}-${nextId}`;
}

/** In-memory note list with an undo-capable remove. */
export function useLabNotes(seed: () => LabNote[]) {
  const [notes, setNotes] = useState(seed);
  const add = useCallback((note: Omit<LabNote, "id" | "createdAt">) => {
    const id = labId();
    setNotes((current) => [...current, { ...note, id, createdAt: Date.now() }]);
    return id;
  }, []);
  const update = useCallback((id: string, patch: Partial<LabNote>) => {
    setNotes((current) =>
      current.map((note) => (note.id === id ? { ...note, ...patch } : note)),
    );
  }, []);
  const remove = useCallback(
    (id: string) => {
      const index = notes.findIndex((note) => note.id === id);
      const removed = notes[index];
      setNotes((current) => current.filter((note) => note.id !== id));
      return () => {
        if (!removed) return;
        setNotes((current) => {
          if (current.some((note) => note.id === id)) return current;
          const next = [...current];
          next.splice(Math.min(index, next.length), 0, removed);
          return next;
        });
      };
    },
    [notes],
  );
  return { notes, setNotes, add, update, remove };
}

export interface LabToastState {
  id: number;
  message: string;
  action?: { label: string; run: () => void };
}

export function useLabToast(duration = 5000) {
  const [toast, setToast] = useState<LabToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismiss = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }, []);
  const show = useCallback(
    (message: string, action?: LabToastState["action"]) => {
      if (timer.current) clearTimeout(timer.current);
      setToast({ id: Date.now(), message, action });
      timer.current = setTimeout(() => setToast(null), duration);
    },
    [duration],
  );
  useEffect(
    () => () => void (timer.current && clearTimeout(timer.current)),
    [],
  );
  return { toast, show, dismiss };
}

// ---------------------------------------------------------------------------
// DOM geometry. Frames are scaled with CSS transforms, so every measurement is
// converted back into the unscaled coordinates of its positioned container.

export function scaleOf(container: HTMLElement) {
  const width = container.getBoundingClientRect().width;
  return container.offsetWidth ? width / container.offsetWidth : 1;
}

export function toLocal(rect: DOMRect, container: HTMLElement): LocalRect {
  const origin = container.getBoundingClientRect();
  const scale = scaleOf(container);
  return {
    x: (rect.left - origin.left) / scale,
    y: (rect.top - origin.top) / scale,
    width: rect.width / scale,
    height: rect.height / scale,
  };
}

export interface MarkGeometry {
  box: LocalRect;
  first: LocalRect;
  last: LocalRect;
}

/** Measures every line fragment of one mark, including split segments. */
export function measureMark(
  container: HTMLElement,
  id: string,
): MarkGeometry | null {
  const lines = [
    ...container.querySelectorAll(`[data-mark-id="${CSS.escape(id)}"]`),
  ]
    .flatMap((element) => [...element.getClientRects()])
    .filter((rect) => rect.width > 0)
    .map((rect) => toLocal(rect, container));
  if (!lines.length) return null;
  const left = Math.min(...lines.map((line) => line.x));
  const top = Math.min(...lines.map((line) => line.y));
  const right = Math.max(...lines.map((line) => line.x + line.width));
  const bottom = Math.max(...lines.map((line) => line.y + line.height));
  return {
    box: { x: left, y: top, width: right - left, height: bottom - top },
    first: lines[0],
    last: lines[lines.length - 1],
  };
}

/**
 * Re-measures a mark after layout and whenever the container resizes. Runs as
 * a passive effect: the container is an ancestor whose ref attaches after
 * descendant layout effects on mount.
 */
export function useMarkGeometry(
  container: RefObject<HTMLElement | null>,
  id: string | null,
  version: unknown,
) {
  const [geometry, setGeometry] = useState<MarkGeometry | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element || !id) {
      setGeometry(null);
      return;
    }
    const update = () => setGeometry(measureMark(element, id));
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, [container, id, version]);
  return geometry;
}

// ---------------------------------------------------------------------------
// Text offsets. Paragraph elements carry data-paragraph; decorative inline
// elements carry data-lab-ignore so they never count toward text offsets.

function textNodes(paragraph: Element) {
  const walker = document.createTreeWalker(paragraph, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-lab-ignore]")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  const nodes: Text[] = [];
  while (walker.nextNode()) nodes.push(walker.currentNode as Text);
  return nodes;
}

function offsetWithin(paragraph: Element, node: Node, offset: number) {
  if (node.nodeType !== Node.TEXT_NODE) {
    // Element boundary: count the text before the indexed child.
    const child = node.childNodes[offset];
    if (!child) return paragraph.textContent?.length ?? 0;
    const first = textNodes(child as Element)[0] ?? child;
    return offsetWithin(paragraph, first, 0);
  }
  let total = 0;
  for (const text of textNodes(paragraph)) {
    if (text === node) return total + offset;
    total += text.length;
  }
  return total;
}

function paragraphOf(node: Node | null) {
  const element = node instanceof Element ? node : node?.parentElement;
  return element?.closest<HTMLElement>("[data-paragraph]") ?? null;
}

const WORD = /[\p{L}\p{N}’'-]/u;

/** Expands a raw range to whole words and trims surrounding space. */
export function snapToWords(text: string, start: number, end: number) {
  while (start > 0 && WORD.test(text[start - 1]) && WORD.test(text[start]))
    start -= 1;
  while (end < text.length && WORD.test(text[end - 1]) && WORD.test(text[end]))
    end += 1;
  while (start < end && /\s/.test(text[start])) start += 1;
  while (end > start && /\s/.test(text[end - 1])) end -= 1;
  return { start, end };
}

/** Converts the current DOM selection inside root into one paragraph range. */
export function selectionToRange(
  root: HTMLElement,
  paragraphs: string[],
): LabSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const startParagraph = paragraphOf(range.startContainer);
  if (!startParagraph) return null;
  const index = Number(startParagraph.dataset.paragraph);
  const text = paragraphs[index];
  const endParagraph = paragraphOf(range.endContainer);
  const rawStart = offsetWithin(
    startParagraph,
    range.startContainer,
    range.startOffset,
  );
  // A selection that runs into the next paragraph ends at this one's end.
  const rawEnd =
    endParagraph === startParagraph
      ? offsetWithin(startParagraph, range.endContainer, range.endOffset)
      : text.length;
  const { start, end } = snapToWords(text, rawStart, rawEnd);
  if (end - start < 2) return null;
  return {
    range: { paragraph: index, start, end },
    text: text.slice(start, end),
  };
}

const SENTENCE_END = /[.!?]+[”’)"]*(?=\s|$)/g;

/** Finds the sentence around a text offset. */
export function sentenceAt(text: string, offset: number) {
  let start = 0;
  for (const match of text.matchAll(SENTENCE_END)) {
    const end = match.index + match[0].length;
    if (offset < end) return snapToWords(text, start, end);
    start = end;
  }
  return snapToWords(text, start, text.length);
}

/** Resolves a screen point to the sentence under it. */
export function sentenceAtPoint(
  x: number,
  y: number,
  paragraphs: string[],
): LabSelection | null {
  const doc = document as Document & {
    caretPositionFromPoint?: (
      x: number,
      y: number,
    ) => { offsetNode: Node; offset: number } | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (doc.caretPositionFromPoint) {
    const position = doc.caretPositionFromPoint(x, y);
    node = position?.offsetNode ?? null;
    offset = position?.offset ?? 0;
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    node = range?.startContainer ?? null;
    offset = range?.startOffset ?? 0;
  }
  const paragraph = paragraphOf(node);
  if (!paragraph || !node) return null;
  const index = Number(paragraph.dataset.paragraph);
  const text = paragraphs[index];
  const { start, end } = sentenceAt(
    text,
    offsetWithin(paragraph, node, offset),
  );
  if (end - start < 2) return null;
  return {
    range: { paragraph: index, start, end },
    text: text.slice(start, end),
  };
}

export function rangeOf(
  paragraphs: string[],
  paragraph: number,
  quote: string,
) {
  const start = paragraphs[paragraph].indexOf(quote);
  return { paragraph, start, end: start + quote.length };
}

export function relativeDay(timestamp: number) {
  const days = Math.floor(
    (new Date().setHours(0, 0, 0, 0) -
      new Date(timestamp).setHours(0, 0, 0, 0)) /
      (24 * 60 * 60 * 1000),
  );
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

export function clockTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}
