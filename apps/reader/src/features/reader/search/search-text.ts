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

/**
 * Folded text and where each folded character came from. Most text folds
 * one to one, so the map keeps only where that breaks: run `k` starts at
 * folded index `runFolded[k]`, which came from source index `runSource[k]`,
 * and each character after it in the run from the next source index.
 */
export interface FoldedText {
  text: string;
  runFolded: Int32Array;
  runSource: Int32Array;
}

/** Source index of folded character `index`'s code point, or -1 for a break. */
export function sourceIndex(folded: FoldedText, index: number): number {
  const { runFolded, runSource } = folded;
  let low = 0;
  let high = runFolded.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (runFolded[middle]! <= index) low = middle;
    else high = middle - 1;
  }
  const source = runSource[low]!;
  return source < 0 ? -1 : source + index - runFolded[low]!;
}

/**
 * Each BMP code unit's fold, filled in as text meets it: the folded unit, or
 * one of these markers.
 */
const unitFolds = new Uint16Array(0x10000);
const UNIT_UNKNOWN = 0;
const UNIT_DROP = 1;
const UNIT_SPACE = 2;
/** Folds to more than one unit, or is a surrogate: fold the code point. */
const UNIT_OTHER = 3;
/**
 * Turns folded code units into a string, keeping any BOM as text. Typed
 * arrays are little-endian on every platform the reader runs on.
 */
const UTF16 = new TextDecoder("utf-16le", { ignoreBOM: true });

function unitFold(code: number): number {
  let fold = unitFolds[code]!;
  if (fold !== UNIT_UNKNOWN) return fold;
  if (code >= 0xd800 && code <= 0xdfff) fold = UNIT_OTHER;
  else {
    const folded = foldCodePoint(String.fromCharCode(code));
    fold =
      folded === ""
        ? UNIT_DROP
        : folded === " "
          ? UNIT_SPACE
          : folded.length === 1 && folded.charCodeAt(0) > UNIT_OTHER
            ? folded.charCodeAt(0)
            : UNIT_OTHER;
  }
  unitFolds[code] = fold;
  return fold;
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
  // Typed buffers keep folding a whole book fast.
  let codes = new Uint16Array(source.length + parts.length + 16);
  let length = 0;
  let runFolded = new Int32Array(256);
  let runSource = new Int32Array(256);
  let runs = 0;
  /** The source index that continues the current run. */
  let next = -2;
  const startRun = (index: number) => {
    if (runs === runFolded.length) {
      const grownFolded = new Int32Array(runs * 2);
      grownFolded.set(runFolded);
      runFolded = grownFolded;
      const grownSource = new Int32Array(runs * 2);
      grownSource.set(runSource);
      runSource = grownSource;
    }
    runFolded[runs] = length;
    runSource[runs] = index;
    runs++;
  };
  const push = (code: number, index: number) => {
    if (index !== next) startRun(index);
    next = index + 1;
    if (length === codes.length) {
      const grown = new Uint16Array(length * 2);
      grown.set(codes);
      codes = grown;
    }
    codes[length++] = code;
  };

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex]!;
    if (partIndex > 0) {
      push(0x0a, -1);
      next = -2;
    }
    let lastWasSpace = true;
    let index = part.start;
    while (index < part.end) {
      const code = source.charCodeAt(index);
      // ASCII and most other text fold one unit to one unit.
      let fold: number;
      if (code < 0x80) {
        fold =
          code === 0x20 || (code >= 0x09 && code <= 0x0d)
            ? UNIT_SPACE
            : code >= 0x41 && code <= 0x5a
              ? code + 32
              : code;
      } else fold = unitFold(code);
      if (fold === UNIT_SPACE) {
        if (!lastWasSpace) push(0x20, index);
        lastWasSpace = true;
        index++;
      } else if (fold === UNIT_DROP) {
        index++;
      } else if (fold !== UNIT_OTHER) {
        push(fold, index);
        lastWasSpace = false;
        index++;
      } else {
        const width = code >= 0xd800 && code <= 0xdbff ? 2 : 1;
        const folded = foldCodePoint(source.slice(index, index + width));
        if (folded === " ") {
          if (!lastWasSpace) push(0x20, index);
          lastWasSpace = true;
        } else if (folded) {
          for (let i = 0; i < folded.length; i++) {
            // Each unit of the fold comes from the same code point.
            if (i > 0) next = -2;
            push(folded.charCodeAt(i), index);
          }
          lastWasSpace = false;
        }
        index += width;
      }
    }
  }

  return {
    text: UTF16.decode(codes.subarray(0, length)),
    runFolded: runFolded.slice(0, runs),
    runSource: runSource.slice(0, runs),
  };
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
    const first = sourceIndex(folded, index);
    const last = sourceIndex(folded, index + foldedQuery.length - 1);
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

  /**
   * The chapter's matches in order, up to `limit`, or only those starting
   * at or after `range.from`, or before `range.to`.
   */
  search(
    foldedQuery: string,
    limit = Infinity,
    range: { from?: number; to?: number } = {},
  ): ChapterSearchMatch[] {
    const { from = 0, to = Infinity } = range;
    return findFoldedMatches(
      this.folded,
      this.chapter.fullText,
      foldedQuery,
      from > 0 ? Infinity : limit,
    )
      .filter((match) => match.start >= from && match.start < to)
      .slice(0, limit)
      .flatMap((match) => {
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
