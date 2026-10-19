/**
 * What a selection cut by a page break is missing: the rest of the sentence
 * on the other side of the break.
 *
 * Everything here is canonical chapter text. Offsets are the ones highlights
 * store, so the same range selects in the scroll column, saves a highlight
 * from pages, or previews the words beyond the break.
 */

export interface TextBlockRange {
  blockId: string;
  start: number;
  end: number;
}

/** The canonical text a page draws, by its first and last lines. */
export interface PageTextBounds {
  /** The first character the page draws. */
  start: number;
  /** One past the last character the page draws. */
  end: number;
  /** Where the page's first line ends. */
  firstLineEnd: number;
  /** Where the page's last line starts. */
  lastLineStart: number;
}

export type PageBreakEdge = "end" | "start";

export interface PageBreakContinuation {
  /** "end": the selection runs off the page's foot; "start": off its head. */
  edge: PageBreakEdge;
  /** The canonical range the selection grows to. */
  start: number;
  end: number;
  /** The words on the other page, as a reader would quote them. */
  beyond: string;
  /** A few words from `beyond`, nearest the break. */
  preview: string;
  /** `beyond` runs on past the preview. */
  previewTruncated: boolean;
  wordCount: number;
}

/** Longer runs stop at a word boundary: the column shows the rest. */
const MAX_CONTINUATION_CHARS = 600;
const PREVIEW_WORDS = 5;

const sentenceSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "sentence" })
    : null;

const collapse = (text: string) =>
  text
    .replace(/[­​]/g, "")
    .replace(/\s+/g, " ")
    .trim();

function blockAt(
  blocks: readonly TextBlockRange[],
  offset: number,
): TextBlockRange | null {
  let low = 0;
  let high = blocks.length - 1;
  let found: TextBlockRange | null = null;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (blocks[middle]!.start <= offset) {
      found = blocks[middle]!;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found && offset < found.end ? found : null;
}

/** Sentence spans of one block, trimmed, in canonical offsets. */
function sentencesOf(
  fullText: string,
  block: TextBlockRange,
): { start: number; end: number }[] {
  // Source line wraps are spaces to a reader; a sentence segmenter would
  // break at each one. Replacing them keeps every offset in place.
  const text = fullText.slice(block.start, block.end).replace(/\s/g, " ");
  const spans: { start: number; end: number }[] = [];
  const segments = sentenceSegmenter
    ? Array.from(sentenceSegmenter.segment(text), (segment) => ({
        index: segment.index,
        text: segment.segment,
      }))
    : // Without Intl.Segmenter: break after . ! ? and closing quotes.
      Array.from(text.matchAll(/[^.!?]*(?:[.!?]+["'”’)\]]*|$)\s*/g), (m) => ({
        index: m.index ?? 0,
        text: m[0],
      })).filter((segment) => segment.text);
  for (const segment of segments) {
    const leading = segment.text.length - segment.text.trimStart().length;
    const body = segment.text.trim();
    if (!body) continue;
    const start = block.start + segment.index + leading;
    spans.push({ start, end: start + body.length });
  }
  return spans;
}

function firstNonSpace(fullText: string, from: number, limit: number) {
  let index = from;
  while (index < limit && /\s/.test(fullText[index] ?? "")) index++;
  return index;
}

function lastNonSpaceEnd(fullText: string, to: number, limit: number) {
  let index = to;
  while (index > limit && /\s/.test(fullText[index - 1] ?? "")) index--;
  return index;
}

/** Cuts a long run at a word boundary, from the break outwards. */
function capForward(fullText: string, from: number, to: number) {
  if (to - from <= MAX_CONTINUATION_CHARS) return to;
  const cut = fullText.lastIndexOf(" ", from + MAX_CONTINUATION_CHARS);
  return cut > from ? cut : from + MAX_CONTINUATION_CHARS;
}

function capBackward(fullText: string, from: number, to: number) {
  if (to - from <= MAX_CONTINUATION_CHARS) return from;
  const cut = fullText.indexOf(" ", to - MAX_CONTINUATION_CHARS);
  return cut >= 0 && cut < to ? cut + 1 : to - MAX_CONTINUATION_CHARS;
}

function words(text: string): string[] {
  return collapse(text).split(" ").filter(Boolean);
}

/**
 * The continuation of a selection that reaches a page's last line (edge
 * "end") or first line (edge "start").
 *
 * A selection reaches across the break when the sentence it ends in (or
 * starts in) continues on the other page. One that runs to the very last
 * character of the page also continues into the next sentence, since there
 * is nothing left on the page to drag to. The range then grows to that
 * sentence's end (or start), but never past its paragraph.
 *
 * Returns null when the selection is clear of the edge, the sentence ends
 * on this page, or there is no more text in the chapter.
 */
export function findPageBreakContinuation({
  fullText,
  blocks,
  selection,
  page,
  edge,
}: {
  fullText: string;
  /** The chapter's blocks in order; each ends where the next starts. */
  blocks: readonly TextBlockRange[];
  selection: { start: number; end: number };
  page: PageTextBounds;
  edge: PageBreakEdge;
}): PageBreakContinuation | null {
  if (edge === "end") {
    if (selection.end <= page.lastLineStart) return null;
    const next = firstNonSpace(fullText, page.end, fullText.length);
    if (next >= fullText.length) return null;
    const block = blockAt(blocks, next);
    if (!block) return null;
    const sentence = sentencesOf(fullText, block).find(
      (span) => span.start <= next && next < span.end,
    );
    if (!sentence) return null;
    const pageEndTrimmed = lastNonSpaceEnd(fullText, page.end, page.start);
    const cut = sentence.start < page.end;
    const toEnd = selection.end >= pageEndTrimmed;
    // The selection's own sentence ends on this page: drag the handle on.
    if (!cut && !toEnd) return null;
    // A cut sentence that the selection has not reached yet.
    if (cut && sentence.start > selection.end) return null;
    const blockEnd = lastNonSpaceEnd(fullText, block.end, block.start);
    const end = capForward(fullText, next, Math.min(sentence.end, blockEnd));
    const beyond = fullText.slice(next, end);
    const beyondWords = words(beyond);
    return {
      edge,
      start: selection.start,
      end,
      beyond: collapse(beyond),
      preview: beyondWords.slice(0, PREVIEW_WORDS).join(" "),
      previewTruncated: beyondWords.length > PREVIEW_WORDS,
      wordCount: beyondWords.length,
    };
  }

  if (selection.start >= page.firstLineEnd) return null;
  const previous = lastNonSpaceEnd(fullText, page.start, 0);
  if (previous <= 0) return null;
  const block = blockAt(blocks, previous - 1);
  if (!block) return null;
  const sentence = sentencesOf(fullText, block).find(
    (span) => span.start < previous && previous <= span.end,
  );
  if (!sentence) return null;
  const pageStartTrimmed = firstNonSpace(fullText, page.start, page.end);
  const cut = sentence.end > pageStartTrimmed;
  const fromStart = selection.start <= pageStartTrimmed;
  if (!cut && !fromStart) return null;
  if (cut && sentence.end < selection.start) return null;
  const blockStart = firstNonSpace(fullText, block.start, block.end);
  const start = capBackward(
    fullText,
    Math.max(sentence.start, blockStart),
    previous,
  );
  const beyond = fullText.slice(start, previous);
  const beyondWords = words(beyond);
  return {
    edge,
    start,
    end: selection.end,
    beyond: collapse(beyond),
    preview: beyondWords.slice(-PREVIEW_WORDS).join(" "),
    previewTruncated: beyondWords.length > PREVIEW_WORDS,
    wordCount: beyondWords.length,
  };
}
