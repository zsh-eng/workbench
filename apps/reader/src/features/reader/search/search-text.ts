/**
 * Text matching for book search. Search folds case, accents, compatibility
 * forms (ligatures, full-width letters) and typographic punctuation, and
 * treats any run of whitespace as one space, so "naive cafe" finds
 * "Naïve   café" and "dont" does not, but "don't" finds "don’t".
 *
 * Matches are reported as offsets into a chapter's canonical text, the same
 * coordinates highlights and notes use.
 */

/** Typographic forms a reader types with the plain key. */
const PUNCTUATION: Record<string, string> = {
  "‘": "'",
  "’": "'",
  "‚": "'",
  "‛": "'",
  "′": "'",
  ʼ: "'",
  "“": '"',
  "”": '"',
  "„": '"',
  "‟": '"',
  "″": '"',
  "«": '"',
  "»": '"',
  "‐": "-",
  "‑": "-",
  "‒": "-",
  "–": "-",
  "—": "-",
  "―": "-",
  "−": "-",
};

/** Characters that never print: soft hyphens and zero-width joiners. */
const INVISIBLE = /^(?:\u00ad|\u200b|\u200c|\u200d|\u2060|\ufeff)$/;
const WHITESPACE = /^\s$/;
const COMBINING = /\p{M}/u;
const COMBINING_ALL = /\p{M}/gu;

const foldedCodePoints = new Map<string, string>();

/** The folded form of one code point: "" for marks and invisible characters. */
function foldCodePoint(codePoint: string): string {
  const cached = foldedCodePoints.get(codePoint);
  if (cached !== undefined) return cached;
  const folded =
    PUNCTUATION[codePoint] ??
    (INVISIBLE.test(codePoint)
      ? ""
      : WHITESPACE.test(codePoint)
        ? " "
        : codePoint.normalize("NFKD").replace(COMBINING_ALL, "").toLowerCase());
  foldedCodePoints.set(codePoint, folded);
  return folded;
}

/** Folded text and, for each folded character, where it came from. */
export interface FoldedText {
  text: string;
  /** Source index of each folded character's code point, or -1 for a break. */
  source: Int32Array;
}

/**
 * Folds `parts` of `source` into one searchable string. Each part is folded
 * on its own and joined with a line break, so no match runs from one
 * paragraph into the next.
 */
export function foldText(
  source: string,
  parts: readonly { start: number; end: number }[] = [
    { start: 0, end: source.length },
  ],
): FoldedText {
  // Typed buffers keep folding a whole book fast; most text folds 1:1.
  let codes = new Uint16Array(source.length + parts.length + 16);
  let indices = new Int32Array(codes.length);
  let length = 0;
  const push = (code: number, index: number) => {
    if (length === codes.length) {
      const grownCodes = new Uint16Array(codes.length * 2);
      grownCodes.set(codes);
      codes = grownCodes;
      const grownIndices = new Int32Array(indices.length * 2);
      grownIndices.set(indices);
      indices = grownIndices;
    }
    codes[length] = code;
    indices[length] = index;
    length++;
  };

  parts.forEach((part, partIndex) => {
    if (partIndex > 0) push(0x0a, -1);
    let lastWasSpace = true;
    let index = part.start;
    while (index < part.end) {
      const code = source.charCodeAt(index);
      // ASCII needs no table.
      if (code < 0x80) {
        if (code === 0x20 || (code >= 0x09 && code <= 0x0d)) {
          if (!lastWasSpace) push(0x20, index);
          lastWasSpace = true;
        } else {
          push(code >= 0x41 && code <= 0x5a ? code + 32 : code, index);
          lastWasSpace = false;
        }
        index++;
        continue;
      }
      const width = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
      const folded = foldCodePoint(source.slice(index, index + width));
      if (folded === " ") {
        if (!lastWasSpace) push(0x20, index);
        lastWasSpace = true;
      } else if (folded) {
        for (let i = 0; i < folded.length; i++)
          push(folded.charCodeAt(i), index);
        lastWasSpace = false;
      }
      index += width;
    }
  });

  const chunks: string[] = [];
  for (let start = 0; start < length; start += 8192)
    chunks.push(
      String.fromCharCode(
        ...codes.subarray(start, Math.min(length, start + 8192)),
      ),
    );
  return { text: chunks.join(""), source: indices.slice(0, length) };
}

/** The query as search compares it, or "" when there is nothing to find. */
export function foldQuery(query: string): string {
  return foldText(query).text.trim();
}

/** The end of the source code point at `index`, with any marks after it. */
function sourceEnd(source: string, index: number): number {
  const code = source.charCodeAt(index);
  let end = index + (code >= 0xd800 && code <= 0xdbff ? 2 : 1);
  while (end < source.length && COMBINING.test(source[end]!)) end++;
  return end;
}

export interface TextMatch {
  /** Canonical offsets of the matched text. */
  start: number;
  end: number;
}

/**
 * Finds `foldedQuery` in folded text, without overlaps, and maps each match
 * back to source offsets.
 */
export function findFoldedMatches(
  folded: FoldedText,
  source: string,
  foldedQuery: string,
  limit = Infinity,
): TextMatch[] {
  const matches: TextMatch[] = [];
  if (!foldedQuery) return matches;
  let from = 0;
  while (matches.length < limit) {
    const index = folded.text.indexOf(foldedQuery, from);
    if (index < 0) break;
    const first = folded.source[index]!;
    const last = folded.source[index + foldedQuery.length - 1]!;
    matches.push({ start: first, end: sourceEnd(source, last) });
    from = index + foldedQuery.length;
  }
  return matches;
}

/** A chapter's canonical text split into its blocks. */
export interface SearchChapterText {
  fullText: string;
  /** Block id and canonical start offset, in any order. */
  blockStarts: readonly (readonly [string, number])[];
}

export interface ChapterBlockRange {
  blockId: string;
  start: number;
  end: number;
}

/** The chapter's blocks in reading order, each up to the next one. */
export function chapterBlockRanges(
  chapter: SearchChapterText,
): ChapterBlockRange[] {
  const starts = [...chapter.blockStarts].sort((a, b) => a[1] - b[1]);
  return starts.map(([blockId, start], index) => ({
    blockId,
    start,
    end: starts[index + 1]?.[1] ?? chapter.fullText.length,
  }));
}

export interface SearchSnippet {
  before: string;
  match: string;
  after: string;
}

const SNIPPET_BEFORE = 40;
const SNIPPET_AFTER = 70;

function collapse(text: string): string {
  return text.replace(/[­​]/g, "").replace(/\s+/g, " ");
}

/**
 * The match with some of its paragraph either side, cut at word boundaries
 * and marked with an ellipsis where the paragraph goes on.
 */
export function buildSnippet(
  fullText: string,
  block: ChapterBlockRange,
  match: TextMatch,
): SearchSnippet {
  let before = collapse(
    fullText.slice(
      Math.max(block.start, match.start - SNIPPET_BEFORE),
      match.start,
    ),
  );
  if (match.start - SNIPPET_BEFORE > block.start) {
    before = `…${before.replace(/^\S*\s/, "")}`;
  } else before = before.trimStart();
  let after = collapse(
    fullText.slice(match.end, Math.min(block.end, match.end + SNIPPET_AFTER)),
  );
  if (match.end + SNIPPET_AFTER < block.end) {
    after = `${after.replace(/\s\S*$/, "")}…`;
  } else after = after.trimEnd();
  return {
    before,
    match: collapse(fullText.slice(match.start, match.end)),
    after,
  };
}

export interface ChapterSearchMatch extends TextMatch {
  blockId: string;
  snippet: SearchSnippet;
}

/** A chapter folded once and searched for every query after. */
export class ChapterSearchText {
  readonly chapter: SearchChapterText;
  readonly blocks: ChapterBlockRange[];
  private foldedText: FoldedText | null = null;

  constructor(chapter: SearchChapterText) {
    this.chapter = chapter;
    this.blocks = chapterBlockRanges(chapter);
  }

  get folded(): FoldedText {
    this.foldedText ??= foldText(
      this.chapter.fullText,
      this.blocks.length
        ? this.blocks
        : [{ start: 0, end: this.chapter.fullText.length }],
    );
    return this.foldedText;
  }

  /** The block that holds canonical `offset`. */
  blockAt(offset: number): ChapterBlockRange | undefined {
    let low = 0;
    let high = this.blocks.length - 1;
    let found: ChapterBlockRange | undefined;
    while (low <= high) {
      const middle = (low + high) >> 1;
      const block = this.blocks[middle]!;
      if (block.start <= offset) {
        found = block;
        low = middle + 1;
      } else high = middle - 1;
    }
    return found;
  }

  search(foldedQuery: string, limit = Infinity): ChapterSearchMatch[] {
    return findFoldedMatches(
      this.folded,
      this.chapter.fullText,
      foldedQuery,
      limit,
    ).flatMap((match) => {
      const block = this.blockAt(match.start);
      if (!block) return [];
      return [
        {
          ...match,
          blockId: block.blockId,
          snippet: buildSnippet(this.chapter.fullText, block, match),
        },
      ];
    });
  }
}
