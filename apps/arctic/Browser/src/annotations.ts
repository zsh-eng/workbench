import { encodeSorted, type RecordStorage } from "./sync/storage";
import type { Session } from "./sync/session";

/**
 * Highlights and notes, as Arctic on iPhone stores them (AnnotationStore.swift):
 * `annotation/<UUID>` in `arctic-annotations`. A quote finds its passage by
 * text and context, so it survives a different copy of the article; `start`
 * is only a hint. A note without a quote belongs to the whole article. A
 * removed passage keeps its record with `deletedAt`, so sync cannot revive it.
 */
export const COLOURS = ["yellow", "sage", "rose", "blue"] as const;
export type Colour = (typeof COLOURS)[number];

export type Quote = {
  exact: string;
  prefix: string;
  suffix: string;
  start: number;
};

export type Annotation = {
  id: string;
  articleURL: string;
  quote?: Quote;
  note: string;
  isHighlighted: boolean;
  colour?: Colour;
  createdAt: number;
  updatedAt: number;
  deletedAt?: number;
};

const SWIFT_EPOCH_MS = 978_307_200_000;
const toSwift = (ms: number) => (ms - SWIFT_EPOCH_MS) / 1000;
const fromSwift = (value: unknown) =>
  typeof value === "number" ? value * 1000 + SWIFT_EPOCH_MS : undefined;

/** Every passage and note in the account that is not removed. */
export function readAnnotations(storage: RecordStorage): Annotation[] {
  const annotations: Annotation[] = [];
  for (const key of storage.keys()) {
    if (!key.startsWith("annotation/")) continue;
    const view = storage.view(key);
    if (!view || view.isDeleted) continue;
    try {
      const value = JSON.parse(view.value);
      const createdAt = fromSwift(value.createdAt);
      if (typeof value.articleURL !== "string" || createdAt === undefined)
        continue;
      if (value.deletedAt !== undefined) continue;
      const quote = value.quote;
      annotations.push({
        id: String(value.id ?? key.slice("annotation/".length)),
        articleURL: value.articleURL,
        quote:
          quote && typeof quote.exact === "string"
            ? {
                exact: quote.exact,
                prefix: String(quote.prefix ?? ""),
                suffix: String(quote.suffix ?? ""),
                start: Number(quote.start) || 0,
              }
            : undefined,
        note: typeof value.note === "string" ? value.note : "",
        isHighlighted: value.isHighlighted === true,
        colour: COLOURS.includes(value.colour) ? value.colour : undefined,
        createdAt,
        updatedAt: fromSwift(value.updatedAt) ?? createdAt,
      });
    } catch {
      /* A damaged record is skipped; the others still show. */
    }
  }
  return annotations;
}

export function newAnnotation(
  articleURL: string,
  fields: Partial<Annotation>,
): Annotation {
  const now = Date.now();
  return {
    id: crypto.randomUUID().toUpperCase(),
    articleURL,
    note: "",
    isHighlighted: true,
    colour: "yellow",
    createdAt: now,
    updatedAt: now,
    ...fields,
  };
}

/** Writes the whole record, with Swift's sorted keys and reference dates. */
export async function saveAnnotation(session: Session, annotation: Annotation) {
  const { quote, colour, deletedAt } = annotation;
  await session.annotations.write([
    {
      key: `annotation/${annotation.id}`,
      value: encodeSorted({
        articleURL: annotation.articleURL,
        ...(colour ? { colour } : {}),
        createdAt: toSwift(annotation.createdAt),
        ...(deletedAt ? { deletedAt: toSwift(deletedAt) } : {}),
        id: annotation.id,
        isHighlighted: annotation.isHighlighted,
        note: annotation.note,
        ...(quote ? { quote } : {}),
        updatedAt: toSwift(annotation.updatedAt),
      }),
    },
  ]);
  session.syncSoon();
}

export function editAnnotation(
  session: Session,
  annotation: Annotation,
  fields: Partial<Annotation>,
) {
  return saveAnnotation(session, {
    ...annotation,
    ...fields,
    updatedAt: Date.now(),
  });
}

/* Anchoring: the phone's Resources/annotations.js, on this app's DOM. */

const SKIPPED = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE"]);
type TextNodes = { nodes: { node: Text; start: number }[]; text: string };

/** The root's text, as UTF-16 offsets over its text nodes. */
function textOf(root: Element): TextNodes {
  const walker = root.ownerDocument.createTreeWalker(
    root,
    NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.nodeType === Node.TEXT_NODE
          ? NodeFilter.FILTER_ACCEPT
          : SKIPPED.has((node as Element).tagName.toUpperCase())
            ? NodeFilter.FILTER_REJECT
            : NodeFilter.FILTER_SKIP,
    },
  );
  const nodes: TextNodes["nodes"] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push({ node: node as Text, start: text.length });
    text += node.textContent;
  }
  return { nodes, text };
}

function rangeAt(root: Element, { nodes }: TextNodes, start: number, end: number) {
  const first = nodes.find((item) => item.start + item.node.length > start);
  const last = nodes.find((item) => item.start + item.node.length >= end);
  if (!first || !last) return null;
  const range = root.ownerDocument.createRange();
  range.setStart(first.node, start - first.start);
  range.setEnd(last.node, end - last.start);
  return range;
}

function offsetOf({ nodes }: TextNodes, range: Range) {
  for (const item of nodes) {
    if (item.node === range.startContainer)
      return item.start + range.startOffset;
    if (range.comparePoint(item.node, item.node.length) >= 0) return item.start;
  }
  const last = nodes.at(-1);
  return last ? last.start + last.node.length : 0;
}

const bare = (value: string) => value.replace(/\s+/g, "");

/** Where a quote is in the text, or -1 when it is missing or ambiguous. */
function locate(text: string, quote: Quote) {
  if (!quote.exact) return -1;
  const end = (index: number) => index + quote.exact.length;
  const inContext = (index: number) =>
    (!quote.prefix || text.slice(0, index).endsWith(quote.prefix)) &&
    (!quote.suffix || text.slice(end(index)).startsWith(quote.suffix));
  if (
    text.slice(quote.start, end(quote.start)) === quote.exact &&
    inContext(quote.start)
  )
    return quote.start;
  const matches: number[] = [];
  for (
    let index = text.indexOf(quote.exact);
    index >= 0;
    index = text.indexOf(quote.exact, index + 1)
  )
    matches.push(index);
  const contextual = matches.filter(inContext);
  if (contextual.length === 1) return contextual[0]!;
  // Another copy shares words, not always the text between blocks: score each
  // side on nearby text without spaces, and use only a single best match.
  const before = bare(quote.prefix).slice(-16);
  const after = bare(quote.suffix).slice(0, 16);
  if (matches.length > 1 && (before || after)) {
    const scores = matches.map(
      (index) =>
        (before &&
        bare(text.slice(Math.max(0, index - 160), index)).endsWith(before)
          ? 1
          : 0) +
        (after && bare(text.slice(end(index), end(index) + 160)).startsWith(after)
          ? 1
          : 0),
    );
    const best = Math.max(...scores);
    if (best > 0 && scores.indexOf(best) === scores.lastIndexOf(best))
      return matches[scores.indexOf(best)]!;
  }
  // An ambiguous quote stays in Notes rather than marking the wrong passage.
  return matches.length === 1 ? matches[0]! : -1;
}

/** The quote of a selection inside the root, with 48 characters of context. */
export function quoteOf(root: Element, range: Range): Quote | null {
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer))
    return null;
  const exact = range.toString();
  if (!exact.trim()) return null;
  const content = textOf(root);
  const start = offsetOf(content, range);
  return {
    exact,
    start,
    prefix: content.text.slice(Math.max(0, start - 48), start),
    suffix: content.text.slice(
      start + exact.length,
      start + exact.length + 48,
    ),
  };
}

/** Finds each quote in the root. Missing ones are not in the map. */
export function resolve(root: Element, annotations: Annotation[]) {
  const content = textOf(root);
  const ranges = new Map<string, Range>();
  for (const annotation of annotations) {
    if (!annotation.quote) continue;
    const start = locate(content.text, annotation.quote);
    const range =
      start < 0
        ? null
        : rangeAt(root, content, start, start + annotation.quote.exact.length);
    if (range) ranges.set(annotation.id, range);
  }
  return ranges;
}

/** Paints highlights with the CSS Custom Highlight API; the DOM is unchanged. */
export function paint(
  annotations: Annotation[],
  ranges: Map<string, Range>,
  focus?: string,
) {
  if (!("highlights" in CSS)) return;
  for (const colour of COLOURS) {
    const painted = annotations
      .filter(
        (item) =>
          item.isHighlighted &&
          (item.colour ?? "yellow") === colour &&
          ranges.has(item.id),
      )
      .map((item) => ranges.get(item.id)!);
    if (painted.length)
      CSS.highlights.set(`arctic-${colour}`, new Highlight(...painted));
    else CSS.highlights.delete(`arctic-${colour}`);
  }
  const focused = focus ? ranges.get(focus) : undefined;
  if (focused) CSS.highlights.set("arctic-focus", new Highlight(focused));
  else CSS.highlights.delete("arctic-focus");
}

export function clearPaint() {
  if (!("highlights" in CSS)) return;
  for (const colour of COLOURS) CSS.highlights.delete(`arctic-${colour}`);
  CSS.highlights.delete("arctic-focus");
}

/** The passage under a point; the last painted wins an overlap. */
export function passageAt(ranges: Map<string, Range>, x: number, y: number) {
  for (const [id, range] of [...ranges].reverse())
    for (const rect of range.getClientRects())
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
        return id;
  return undefined;
}
