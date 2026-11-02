import type { LayoutCursor, PreparedTextWithSegments } from "@chenglou/pretext";
import { layoutNextLine, prepareWithSegments } from "@chenglou/pretext";
import {
  layoutNextRichInlineLineRange,
  materializeRichInlineLineRange,
  prepareRichInline,
  type RichInlineCursor,
} from "@chenglou/pretext/rich-inline";
import type { HyphenPoints } from "./hyphenation";
import {
  LINE_START_CURSOR,
  countGraphemes,
  cursorsMatch,
  graphemePrefixLength,
  measureTextWidth,
} from "./measure";
import type {
  HighlightMark,
  LayoutTheme,
  PageFragment,
  PageLine,
  PreparedInlineItem,
  TextCursorOffset,
  TextRenderMode,
} from "./types";

const SOFT_HYPHEN = "\u00AD";
const ZERO_WIDTH_BREAK = "\u200B";
const NATIVE_INLINE_WRAP_SAFETY_PX = 2;
const NATIVE_INLINE_ZERO_WIDTH_BREAK_SAFETY_PX = 8;

type TextLineLayoutResult = {
  lines: PageLine[];
  renderMode: TextRenderMode;
};

type TextLineLayoutOptions = {
  textAlign?: LayoutTheme["textAlign"];
  firstLineIndentPx?: number;
  /** Where words may take a hyphen in justified text. */
  hyphenPoints?: HyphenPoints | null;
};

function createOffset(
  itemIndex: number,
  cursor: LayoutCursor,
): TextCursorOffset {
  return {
    itemIndex,
    segmentIndex: cursor.segmentIndex,
    graphemeIndex: cursor.graphemeIndex,
  };
}

function itemHasForcedBreak(item: PreparedInlineItem): boolean {
  return item.prepared.kinds.includes("hard-break");
}

function projectHighlightMarks(
  highlightMarks: HighlightMark[] | undefined,
  options: {
    preserveStart: boolean;
    preserveEnd: boolean;
  },
): HighlightMark[] | undefined {
  if (!highlightMarks || highlightMarks.length === 0) {
    return undefined;
  }

  return highlightMarks.map((mark) => ({
    id: mark.id,
    ...(mark.color ? { color: mark.color } : {}),
    ...(options.preserveStart && mark.isStart ? { isStart: true } : {}),
    ...(options.preserveEnd && mark.isEnd ? { isEnd: true } : {}),
  }));
}

export function layoutTextLines(
  items: PreparedInlineItem[],
  maxWidth: number,
  options?: TextLineLayoutOptions,
): TextLineLayoutResult {
  const safeWidth = Math.max(1, maxWidth);
  const firstLineIndentPx = Math.max(0, options?.firstLineIndentPx ?? 0);

  if (options?.textAlign === "justify-knuth-plass") {
    const justifiedLines = layoutTextLinesJustified(
      items,
      safeWidth,
      firstLineIndentPx,
      options.hyphenPoints ?? null,
    );
    if (justifiedLines !== null) {
      return {
        lines: justifiedLines,
        renderMode: "manual-justify",
      };
    }
  }

  return {
    lines: layoutTextLinesGreedy(items, safeWidth, firstLineIndentPx),
    renderMode: "native",
  };
}

function layoutTextLinesGreedy(
  items: PreparedInlineItem[],
  safeWidth: number,
  firstLineIndentPx = 0,
): PageLine[] {
  const hasZeroWidthBreaks = items.some((item) =>
    item.rawText.includes(ZERO_WIDTH_BREAK),
  );
  const wrapSafety = Math.max(
    NATIVE_INLINE_WRAP_SAFETY_PX,
    hasZeroWidthBreaks ? NATIVE_INLINE_ZERO_WIDTH_BREAK_SAFETY_PX : 0,
  );
  const layoutWidth = Math.max(1, safeWidth - wrapSafety);
  const words = groupItemsIntoWords(items);
  const prepared = prepareRichInline(
    words.map(({ item }) => ({
      text: item.leadingGap > 0 ? ` ${item.rawText}` : item.rawText,
      font: item.font,
      extraWidth: item.chromeWidth,
    })),
  );
  const lines: PageLine[] = [];
  let cursor: RichInlineCursor | undefined;
  let isFirstLine = true;

  while (true) {
    const indentPx = isFirstLine
      ? Math.min(firstLineIndentPx, safeWidth - 1)
      : 0;
    const currentLayoutWidth = Math.max(1, layoutWidth - indentPx);
    const richLineRange = layoutNextRichInlineLineRange(
      prepared,
      currentLayoutWidth,
      cursor,
    );
    if (!richLineRange) break;

    const richLine = materializeRichInlineLineRange(prepared, richLineRange);
    const fragments = richLine.fragments.flatMap((fragment) => {
      const group = words[fragment.itemIndex];
      if (!group || !fragment.text) return [];
      return splitGroupFragment(items, group, fragment);
    });
    const firstFragment = richLine.fragments[0];
    const lastFragment = richLine.fragments[richLine.fragments.length - 1];
    const firstGroup = firstFragment && words[firstFragment.itemIndex];
    const lastGroup = lastFragment && words[lastFragment.itemIndex];

    if (fragments.length > 0 && firstGroup && lastGroup) {
      lines.push({
        fragments,
        startOffset: groupCursorToItemOffset(
          items,
          firstGroup,
          firstFragment.start,
          "start",
        ),
        endOffset: groupCursorToItemOffset(
          items,
          lastGroup,
          lastFragment.end,
          "end",
        ),
        isLastInBlock: false,
        ...(indentPx > 0 ? { indentPx } : {}),
      });
    }

    cursor = richLine.end;
    isFirstLine = false;
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Items that form one word
// ---------------------------------------------------------------------------

/**
 * Consecutive prepared items that line breaking must treat as one item.
 * `item` is the item itself, or the items' joined text prepared again.
 */
interface ItemGroup {
  item: PreparedInlineItem;
  itemIndices: number[];
  /** Where each item's text starts in `item.rawText`. */
  textStarts: number[];
}

const segmentsSpellTextCache = new WeakMap<PreparedTextWithSegments, boolean>();

/** Offsets map to cursors only when the segments are the text, in order. */
function segmentsSpellText(item: PreparedInlineItem): boolean {
  let spells = segmentsSpellTextCache.get(item.prepared);
  if (spells === undefined) {
    spells = item.prepared.segments.join("") === item.rawText;
    segmentsSpellTextCache.set(item.prepared, spells);
  }
  return spells;
}

/**
 * A group is prepared again as normal text, so items with preserved spaces,
 * tabs or line breaks stay on their own.
 */
function isPreparedAsNormalText(item: PreparedInlineItem): boolean {
  return !item.prepared.kinds.some(
    (kind) =>
      kind === "preserved-space" || kind === "tab" || kind === "hard-break",
  );
}

function canJoinWord(
  previous: PreparedInlineItem,
  next: PreparedInlineItem,
): boolean {
  return (
    next.leadingGap === 0 &&
    next.font === previous.font &&
    previous.chromeWidth === 0 &&
    next.chromeWidth === 0 &&
    isPreparedAsNormalText(previous) &&
    isPreparedAsNormalText(next) &&
    segmentsSpellText(previous) &&
    segmentsSpellText(next)
  );
}

/**
 * A highlight splits its run into separate items, and a phone selects a word
 * without the quotes or commas next to it, so an item boundary often falls
 * inside what line breaking treats as one word. Pretext breaks a line at any
 * item boundary when the next item does not fit, and splits the first word of
 * an item to fill a line, so a new highlight moved its text between lines and
 * pages. Items in one font with no space between them are laid out as one
 * item, and their line fragments are split back into the items afterwards.
 */
function groupItemsIntoWords(items: PreparedInlineItem[]): ItemGroup[] {
  const groups: { itemIndices: number[] }[] = [];
  for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
    const item = items[itemIndex]!;
    const group = groups[groups.length - 1];
    const previousIndex = group?.itemIndices[group.itemIndices.length - 1];
    const previous =
      previousIndex === undefined ? undefined : items[previousIndex];
    if (group && previous && canJoinWord(previous, item)) {
      group.itemIndices.push(itemIndex);
    } else {
      groups.push({ itemIndices: [itemIndex] });
    }
  }

  return groups.flatMap(({ itemIndices }): ItemGroup[] => {
    const alone = itemIndices.map((itemIndex) => ({
      item: items[itemIndex]!,
      itemIndices: [itemIndex],
      textStarts: [0],
    }));
    if (itemIndices.length === 1) return alone;

    const first = items[itemIndices[0]!]!;
    const textStarts: number[] = [];
    let text = "";
    for (const itemIndex of itemIndices) {
      textStarts.push(text.length);
      text += items[itemIndex]!.rawText;
    }
    // prepareRichInline prepares the same text in the same font, so these
    // segments are the ones its cursors count.
    const prepared = prepareWithSegments(text, first.font);
    // Otherwise cursors would not map back to the items.
    if (prepared.segments.join("") !== text) return alone;

    return [
      {
        item: {
          ...first,
          highlightMarks: undefined,
          targetIds: undefined,
          prepared,
          rawText: text,
          fullText: text,
          fullWidth: prepared.widths.reduce((total, width) => total + width, 0),
          endCursor: {
            segmentIndex: prepared.segments.length,
            graphemeIndex: 0,
          },
        },
        itemIndices,
        textStarts,
      },
    ];
  });
}

function cursorToTextOffset(
  prepared: PreparedTextWithSegments,
  cursor: LayoutCursor,
): number {
  let offset = 0;
  for (let index = 0; index < cursor.segmentIndex; index++) {
    offset += prepared.segments[index]?.length ?? 0;
  }
  const segment = prepared.segments[cursor.segmentIndex];
  return segment === undefined
    ? offset
    : offset + graphemePrefixLength(segment, cursor.graphemeIndex);
}

function textOffsetToCursor(
  item: PreparedInlineItem,
  offset: number,
): LayoutCursor {
  if (offset >= item.rawText.length) return item.endCursor;

  let segmentStart = 0;
  const { segments } = item.prepared;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const segment = segments[segmentIndex]!;
    if (offset < segmentStart + segment.length) {
      return {
        segmentIndex,
        graphemeIndex: countGraphemes(segment.slice(0, offset - segmentStart)),
      };
    }
    segmentStart += segment.length;
  }
  return item.endCursor;
}

/**
 * A group cursor as an item cursor. A boundary between two items is the end
 * of the first when it ends a range and the start of the second when it
 * starts one.
 */
function groupCursorToItemOffset(
  items: PreparedInlineItem[],
  group: ItemGroup,
  cursor: LayoutCursor,
  edge: "start" | "end",
): TextCursorOffset {
  if (group.itemIndices.length === 1) {
    return createOffset(group.itemIndices[0]!, cursor);
  }

  const offset = cursorToTextOffset(group.item.prepared, cursor);
  let member = 0;
  while (member < group.itemIndices.length - 1) {
    const end =
      group.textStarts[member]! +
      items[group.itemIndices[member]!]!.rawText.length;
    if (edge === "start" ? offset < end : offset <= end) break;
    member++;
  }
  const itemIndex = group.itemIndices[member]!;
  return createOffset(
    itemIndex,
    textOffsetToCursor(items[itemIndex]!, offset - group.textStarts[member]!),
  );
}

function createItemFragment(
  items: PreparedInlineItem[],
  itemIndex: number,
  text: string,
  leadingGap: number,
  start: LayoutCursor,
  end: LayoutCursor,
): PageFragment {
  const item = items[itemIndex]!;
  return {
    kind: "text",
    text,
    font: item.font,
    leadingGap,
    inlineRole: item.inlineRole,
    link: item.link,
    isCode: item.isCode,
    highlightMarks: projectHighlightMarks(item.highlightMarks, {
      preserveStart: cursorsMatch(start, LINE_START_CURSOR),
      preserveEnd: cursorsMatch(end, item.endCursor),
    }),
    anchorStart: createOffset(itemIndex, start),
    anchorEnd: createOffset(itemIndex, end),
  };
}

/** A group's text on one line. */
interface GroupFragment {
  text: string;
  gapBefore: number;
  start: LayoutCursor;
  end: LayoutCursor;
}

/** A group's fragment on one line, as one fragment for each item in it. */
function splitGroupFragment(
  items: PreparedInlineItem[],
  group: ItemGroup,
  fragment: GroupFragment,
): PageFragment[] {
  if (group.itemIndices.length === 1) {
    return [
      createItemFragment(
        items,
        group.itemIndices[0]!,
        fragment.text,
        fragment.gapBefore,
        fragment.start,
        fragment.end,
      ),
    ];
  }

  const from = cursorToTextOffset(group.item.prepared, fragment.start);
  const to = cursorToTextOffset(group.item.prepared, fragment.end);
  const pieces: {
    itemIndex: number;
    from: number;
    to: number;
    text: string;
  }[] = [];
  for (let member = 0; member < group.itemIndices.length; member++) {
    const itemIndex = group.itemIndices[member]!;
    const item = items[itemIndex]!;
    const start = group.textStarts[member]!;
    const pieceFrom = Math.max(from, start) - start;
    const pieceTo = Math.min(to, start + item.rawText.length) - start;
    if (pieceFrom >= pieceTo) continue;
    pieces.push({
      itemIndex,
      from: pieceFrom,
      to: pieceTo,
      text: item.rawText.slice(pieceFrom, pieceTo).replaceAll(SOFT_HYPHEN, ""),
    });
  }
  // A line that ends at a soft hyphen shows the hyphen.
  const lastPiece = pieces[pieces.length - 1];
  if (lastPiece && fragment.text === `${pieces.map((p) => p.text).join("")}-`) {
    lastPiece.text += "-";
  }

  return pieces
    .filter((piece) => piece.text)
    .map((piece, index) => {
      const item = items[piece.itemIndex]!;
      return createItemFragment(
        items,
        piece.itemIndex,
        piece.text,
        index === 0 ? fragment.gapBefore : 0,
        textOffsetToCursor(item, piece.from),
        textOffsetToCursor(item, piece.to),
      );
    });
}

function layoutTextLinesPreWrap(
  items: PreparedInlineItem[],
  safeWidth: number,
): PageLine[] {
  const words = groupItemsIntoWords(items);
  const lines: PageLine[] = [];

  let groupIndex = 0;
  let textCursor: LayoutCursor | null = null;

  while (groupIndex < words.length) {
    const fragments: PageLine["fragments"] = [];
    let remainingWidth = safeWidth;
    let lineStartOffset: TextCursorOffset | null = null;
    let lineEndOffset: TextCursorOffset | null = null;

    lineLoop: while (groupIndex < words.length) {
      const group = words[groupIndex];
      if (!group) break;
      const { item } = group;
      if (textCursor && cursorsMatch(textCursor, item.endCursor)) {
        groupIndex++;
        textCursor = null;
        continue;
      }

      const leadingGap = fragments.length === 0 ? 0 : item.leadingGap;
      const reservedWidth = leadingGap + item.chromeWidth;

      if (fragments.length > 0 && reservedWidth >= remainingWidth) {
        break lineLoop;
      }

      // Fast path: whole run fits
      if (!textCursor && !itemHasForcedBreak(item)) {
        const fullWidth = leadingGap + item.fullWidth + item.chromeWidth;
        if (fullWidth <= remainingWidth) {
          lineStartOffset ??= groupCursorToItemOffset(
            items,
            group,
            LINE_START_CURSOR,
            "start",
          );
          lineEndOffset = groupCursorToItemOffset(
            items,
            group,
            item.endCursor,
            "end",
          );
          fragments.push(
            ...splitGroupFragment(items, group, {
              text: item.fullText,
              gapBefore: leadingGap,
              start: LINE_START_CURSOR,
              end: item.endCursor,
            }),
          );
          remainingWidth -= fullWidth;
          groupIndex++;
          continue;
        }
      }

      // Slow path: split via layoutNextLine
      const start = textCursor ?? LINE_START_CURSOR;
      const line = layoutNextLine(
        item.prepared,
        start,
        Math.max(1, remainingWidth - reservedWidth),
      );

      if (!line || cursorsMatch(start, line.end)) {
        groupIndex++;
        textCursor = null;
        continue;
      }

      // layoutNextLine always places something, so a run that starts after
      // other text could leave the first letters of its first word behind.
      // Wrap before the run when that does not fit, or when a space before it
      // gives a break, as rich-inline does for the greedy path.
      if (
        fragments.length > 0 &&
        !textCursor &&
        (reservedWidth + line.width > remainingWidth ||
          (item.leadingGap > 0 &&
            line.end.segmentIndex === 0 &&
            line.end.graphemeIndex > 0))
      ) {
        break lineLoop;
      }

      lineStartOffset ??= groupCursorToItemOffset(items, group, start, "start");
      lineEndOffset = groupCursorToItemOffset(items, group, line.end, "end");
      fragments.push(
        ...splitGroupFragment(items, group, {
          text: line.text,
          gapBefore: leadingGap,
          start,
          end: line.end,
        }),
      );
      remainingWidth -= leadingGap + line.width + item.chromeWidth;

      if (cursorsMatch(line.end, item.endCursor)) {
        groupIndex++;
        textCursor = null;
        continue;
      }

      textCursor = line.end;
      break lineLoop;
    }

    if (fragments.length === 0) break;
    lines.push({
      fragments,
      startOffset: lineStartOffset ?? undefined,
      endOffset: lineEndOffset ?? undefined,
      isLastInBlock: false,
    });
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Justified text
// ---------------------------------------------------------------------------

/**
 * Justified text breaks a whole paragraph at once, in the manner of Knuth and
 * Plass's TeX: of all the ways to break it, the one whose word spaces stay
 * closest to natural. A line that breaks only when it must leaves the wide
 * spaces that line up into rivers. Text is never changed: a hyphen break is a
 * cursor inside a segment, so anchors, highlights and search see the book's
 * own text, and the hyphen lives only in the line's rendered fragment.
 */

/**
 * Spaces stretch by half, as TeX's fonts do, and shrink only to 80%, as
 * InDesign's defaults do. TeX's third is cramped in a font with Lora's narrow
 * space, and a tight line beside a loose one reads worse than two loose ones.
 */
const SPACE_STRETCH = 0.5;
const SPACE_SHRINK = 0.2;

/**
 * Each paragraph takes the first pass that can set it. Hyphens wait until a
 * paragraph needs them, and the last pass is for a measure too narrow to set
 * well, where wide spaces still look better than one ragged paragraph.
 */
const JUSTIFY_PASSES = [
  { hyphenate: false, maxStretchRatio: 1, allowBareLines: false },
  { hyphenate: true, maxStretchRatio: 1.5, allowBareLines: false },
  { hyphenate: true, maxStretchRatio: 4, allowBareLines: true },
];

const BADNESS_LIMIT = 10_000;
const LINE_PENALTY = 10;
const HYPHEN_DEMERITS = 2_500;
const ADJACENT_HYPHENS_DEMERITS = 10_000;
const FINAL_HYPHEN_DEMERITS = 5_000;
const FITNESS_JUMP_DEMERITS = 10_000;
const SHORT_LAST_LINE_DEMERITS = 10_000;
const SHORT_LAST_LINE_SHARE = 0.1;

/** Tight, decent, loose and very loose lines. */
const FITNESS_CLASSES = 4;
const DECENT_FITNESS = 1;

const ENDS_IN_DASH = /[-‐‒-―]$/;

/**
 * Canvas widths run up to about 3px from what the page draws, as they miss
 * kerning against spaces. Word spacing stops this short of the edge, for the
 * browser's own justification to close. It cannot close a line that overruns.
 */
const JUSTIFY_EDGE_SLACK_PX = 3;

/** A place a line can end, with totals from the start of the paragraph. */
interface LineBreak {
  groupIndex: number;
  /** Where the next line starts, in that group. */
  cursor: LayoutCursor;
  showsHyphen: boolean;
  hyphenWidth: number;
  /** Width of a segment's first part, for a break inside it. An estimate. */
  prefixWidth: number;
  /** Totals for the line that ends here, whose last space does not show. */
  width: number;
  spaces: number;
  spaceWidth: number;
  /** Totals where the next line starts. */
  nextWidth: number;
  nextSpaces: number;
  nextSpaceWidth: number;
}

type JustifyPass = (typeof JUSTIFY_PASSES)[number];

function collectLineBreaks(
  groups: ItemGroup[],
  hyphenPoints: HyphenPoints | null,
): LineBreak[] {
  const breaks: LineBreak[] = [];
  let width = 0;
  let spaces = 0;
  let spaceWidth = 0;

  const pushBreak = (
    groupIndex: number,
    cursor: LayoutCursor,
    spaceAfter = 0,
  ) => {
    breaks.push({
      groupIndex,
      cursor,
      showsHyphen: false,
      hyphenWidth: 0,
      prefixWidth: 0,
      width,
      spaces,
      spaceWidth,
      nextWidth: width + spaceAfter,
      nextSpaces: spaces + (spaceAfter > 0 ? 1 : 0),
      nextSpaceWidth: spaceWidth + spaceAfter,
    });
  };
  const addSpace = (spaceAdvance: number) => {
    width += spaceAdvance;
    spaces += 1;
    spaceWidth += spaceAdvance;
  };

  pushBreak(0, LINE_START_CURSOR);

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const { item } = groups[groupIndex]!;
    if (groupIndex > 0 && item.leadingGap > 0) {
      pushBreak(groupIndex, LINE_START_CURSOR, item.leadingGap);
      addSpace(item.leadingGap);
    }
    width += item.chromeWidth;

    // The chrome of inline code surrounds one piece on one line.
    const canBreak = item.chromeWidth === 0;
    const { segments, kinds, widths, breakableFitAdvances } = item.prepared;
    const { discretionaryHyphenWidth } = item.prepared;

    for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
      const segment = segments[segmentIndex]!;
      const kind = kinds[segmentIndex]!;
      const segmentWidth = widths[segmentIndex]!;
      const next = { segmentIndex: segmentIndex + 1, graphemeIndex: 0 };

      if (kind === "space") {
        if (canBreak) pushBreak(groupIndex, next, segmentWidth);
        addSpace(segmentWidth);
        continue;
      }

      if (kind === "soft-hyphen" || kind === "zero-width-break") {
        width += segmentWidth;
        if (canBreak) {
          pushBreak(groupIndex, next);
          if (kind === "soft-hyphen") {
            const softHyphen = breaks[breaks.length - 1]!;
            softHyphen.showsHyphen = true;
            softHyphen.hyphenWidth = discretionaryHyphenWidth;
          }
        }
        continue;
      }

      const advances = breakableFitAdvances[segmentIndex];
      if (canBreak && hyphenPoints && !item.isCode && advances) {
        let prefixWidth = 0;
        let graphemeIndex = 0;
        for (const point of hyphenPoints(segment)) {
          while (graphemeIndex < point) {
            prefixWidth += advances[graphemeIndex++] ?? 0;
          }
          width += prefixWidth;
          pushBreak(groupIndex, { segmentIndex, graphemeIndex: point });
          width -= prefixWidth;
          const hyphenBreak = breaks[breaks.length - 1]!;
          hyphenBreak.showsHyphen = true;
          hyphenBreak.hyphenWidth = discretionaryHyphenWidth;
          hyphenBreak.prefixWidth = prefixWidth;
        }
      }

      width += segmentWidth;

      if (
        canBreak &&
        kinds[segmentIndex + 1] === "text" &&
        ENDS_IN_DASH.test(segment)
      ) {
        pushBreak(groupIndex, next);
      }
    }
  }

  const lastGroupIndex = groups.length - 1;
  pushBreak(lastGroupIndex, groups[lastGroupIndex]!.item.endCursor);
  return breaks;
}

/** How far a line's spaces move, as a share of how far they may: 1 is full. */
function getSpaceRatio(
  naturalWidth: number,
  spaceWidth: number,
  availableWidth: number,
): number {
  const slack = availableWidth - naturalWidth;
  if (Math.abs(slack) < 0.01) return 0;
  if (spaceWidth <= 0) return slack > 0 ? Infinity : -Infinity;
  return slack / (spaceWidth * (slack > 0 ? SPACE_STRETCH : SPACE_SHRINK));
}

function getFitnessClass(ratio: number): number {
  if (ratio < -0.5) return 0;
  if (ratio <= 0.5) return DECENT_FITNESS;
  return ratio <= 1 ? 2 : 3;
}

/** The breaks of the best way to set the paragraph, in order; null if none. */
function chooseLineBreaks(
  breaks: LineBreak[],
  maxWidth: number,
  firstLineWidth: number,
  pass: JustifyPass,
): number[] | null {
  // One state for each break and the fitness of the line that ends there.
  const stateCount = breaks.length * FITNESS_CLASSES;
  const demerits = new Float64Array(stateCount).fill(Infinity);
  const previous = new Int32Array(stateCount).fill(-1);
  demerits[DECENT_FITNESS] = 0;

  const lastBreak = breaks.length - 1;
  for (let to = 1; to <= lastBreak; to++) {
    const end = breaks[to]!;
    const isLastLine = to === lastBreak;

    for (let from = to - 1; from >= 0; from--) {
      const start = breaks[from]!;
      const availableWidth = from === 0 ? firstLineWidth : maxWidth;
      const wordsWidth = end.width - start.nextWidth;
      const spaceWidth = end.spaceWidth - start.nextSpaceWidth;
      // Starting earlier only makes this line longer.
      if (wordsWidth - spaceWidth * SPACE_SHRINK > availableWidth) break;

      const naturalWidth = wordsWidth + end.hyphenWidth;
      const ratio = isLastLine
        ? naturalWidth <= availableWidth + 0.01
          ? 0
          : -Infinity
        : getSpaceRatio(naturalWidth, spaceWidth, availableWidth);
      const isBareLine = ratio === Infinity && pass.allowBareLines;
      if (ratio < -1 || (ratio > pass.maxStretchRatio && !isBareLine)) continue;
      // Short of the last resort, the tail of a broken word never stands
      // alone as a paragraph's last line.
      if (
        isLastLine &&
        start.showsHyphen &&
        end.spaces === start.nextSpaces &&
        !pass.allowBareLines
      ) {
        continue;
      }

      const badness = Math.min(BADNESS_LIMIT, 100 * Math.abs(ratio) ** 3);
      let lineDemerits = (LINE_PENALTY + badness) ** 2;
      if (end.showsHyphen) lineDemerits += HYPHEN_DEMERITS;
      if (start.showsHyphen && end.showsHyphen) {
        lineDemerits += ADJACENT_HYPHENS_DEMERITS;
      }
      if (isLastLine) {
        if (start.showsHyphen) lineDemerits += FINAL_HYPHEN_DEMERITS;
        if (naturalWidth < availableWidth * SHORT_LAST_LINE_SHARE) {
          lineDemerits += SHORT_LAST_LINE_DEMERITS;
        }
      }

      const fitness = getFitnessClass(ratio);
      const state = to * FITNESS_CLASSES + fitness;
      for (
        let priorFitness = 0;
        priorFitness < FITNESS_CLASSES;
        priorFitness++
      ) {
        const priorState = from * FITNESS_CLASSES + priorFitness;
        const prior = demerits[priorState]!;
        if (prior === Infinity) continue;
        const total =
          prior +
          lineDemerits +
          (Math.abs(fitness - priorFitness) > 1 ? FITNESS_JUMP_DEMERITS : 0);
        if (total < demerits[state]!) {
          demerits[state] = total;
          previous[state] = priorState;
        }
      }
    }
  }

  let bestState = -1;
  let bestDemerits = Infinity;
  for (let fitness = 0; fitness < FITNESS_CLASSES; fitness++) {
    const state = lastBreak * FITNESS_CLASSES + fitness;
    if (demerits[state]! < bestDemerits) {
      bestDemerits = demerits[state]!;
      bestState = state;
    }
  }
  if (bestState < 0) return null;

  const chosen: number[] = [];
  for (let state = bestState; state >= 0; state = previous[state]!) {
    chosen.push(Math.floor(state / FITNESS_CLASSES));
  }
  return chosen.reverse();
}

/** The text between two cursors, without soft hyphens. */
function getPreparedTextBetween(
  prepared: PreparedTextWithSegments,
  start: LayoutCursor,
  end: LayoutCursor,
): string {
  let text = "";
  for (
    let segmentIndex = start.segmentIndex;
    segmentIndex <= end.segmentIndex;
    segmentIndex++
  ) {
    const segment = prepared.segments[segmentIndex];
    if (segment === undefined || prepared.kinds[segmentIndex] === "soft-hyphen")
      continue;
    const from =
      segmentIndex === start.segmentIndex
        ? graphemePrefixLength(segment, start.graphemeIndex)
        : 0;
    const to =
      segmentIndex === end.segmentIndex
        ? graphemePrefixLength(segment, end.graphemeIndex)
        : segment.length;
    text += segment.slice(from, to);
  }
  return text;
}

/**
 * A line's natural width as it will render. Breaks choose with the widths
 * of a word's letters; a line that starts or ends inside a word uses that
 * word's pieces as drawn, with their kerning.
 */
function measureLineWidth(
  groups: ItemGroup[],
  start: LineBreak,
  end: LineBreak,
): number {
  let width = end.width + end.hyphenWidth - start.nextWidth;
  const sameSegment =
    start.groupIndex === end.groupIndex &&
    start.cursor.segmentIndex === end.cursor.segmentIndex;
  if (sameSegment) return width;

  if (end.cursor.graphemeIndex > 0) {
    const { item } = groups[end.groupIndex]!;
    const segment = item.prepared.segments[end.cursor.segmentIndex]!;
    const prefix = segment.slice(
      0,
      graphemePrefixLength(segment, end.cursor.graphemeIndex),
    );
    width +=
      measureTextWidth(`${prefix}-`, item.font) -
      end.prefixWidth -
      end.hyphenWidth;
  }
  if (start.cursor.graphemeIndex > 0) {
    const { item } = groups[start.groupIndex]!;
    const { segmentIndex, graphemeIndex } = start.cursor;
    const segment = item.prepared.segments[segmentIndex]!;
    const suffix = segment.slice(graphemePrefixLength(segment, graphemeIndex));
    width +=
      measureTextWidth(suffix, item.font) -
      (item.prepared.widths[segmentIndex]! - start.prefixWidth);
  }
  return width;
}

function buildJustifiedLine(
  items: PreparedInlineItem[],
  groups: ItemGroup[],
  start: LineBreak,
  end: LineBreak,
  availableWidth: number,
  options: { indentPx: number; isLastLine: boolean },
): PageLine {
  const fragments: PageFragment[] = [];
  let startOffset: TextCursorOffset | undefined;
  let endOffset: TextCursorOffset | undefined;

  for (
    let groupIndex = start.groupIndex;
    groupIndex <= end.groupIndex;
    groupIndex++
  ) {
    const group = groups[groupIndex]!;
    const from =
      groupIndex === start.groupIndex ? start.cursor : LINE_START_CURSOR;
    const to =
      groupIndex === end.groupIndex ? end.cursor : group.item.endCursor;
    if (cursorsMatch(from, to)) continue;

    const text = getPreparedTextBetween(group.item.prepared, from, to);
    const showsHyphen = end.showsHyphen && groupIndex === end.groupIndex;
    fragments.push(
      ...splitGroupFragment(items, group, {
        text: showsHyphen ? `${text}-` : text,
        gapBefore: fragments.length === 0 ? 0 : group.item.leadingGap,
        start: from,
        end: to,
      }),
    );
    startOffset ??= groupCursorToItemOffset(items, group, from, "start");
    endOffset = groupCursorToItemOffset(items, group, to, "end");
  }

  const spaces = end.spaces - start.nextSpaces;
  const justifies = !options.isLastLine && spaces > 0;
  return {
    fragments,
    startOffset,
    endOffset,
    isLastInBlock: false,
    ...(justifies
      ? {
          wordSpacingPx:
            (availableWidth -
              JUSTIFY_EDGE_SLACK_PX -
              measureLineWidth(groups, start, end)) /
            spaces,
        }
      : {}),
    ...(options.indentPx > 0 ? { indentPx: options.indentPx } : {}),
  };
}

/** Null when a paragraph cannot be justified, so it sets as ragged text. */
function layoutTextLinesJustified(
  items: PreparedInlineItem[],
  maxWidth: number,
  firstLineIndentPx: number,
  hyphenPoints: HyphenPoints | null,
): PageLine[] | null {
  if (items.length === 0 || !items.every(isPreparedAsNormalText)) return null;

  const indentPx = Math.min(firstLineIndentPx, maxWidth - 1);
  const firstLineWidth = maxWidth - indentPx;
  const groups = groupItemsIntoWords(items);
  const breaksByHyphenation = new Map<boolean, LineBreak[]>();

  for (const pass of JUSTIFY_PASSES) {
    let breaks = breaksByHyphenation.get(pass.hyphenate);
    if (!breaks) {
      breaks = collectLineBreaks(groups, pass.hyphenate ? hyphenPoints : null);
      breaksByHyphenation.set(pass.hyphenate, breaks);
    }

    const chosen = chooseLineBreaks(breaks, maxWidth, firstLineWidth, pass);
    if (!chosen) continue;

    const lastLine = chosen.length - 2;
    const lineBreaks = breaks;
    return chosen.slice(1).map((breakIndex, lineIndex) =>
      buildJustifiedLine(
        items,
        groups,
        lineBreaks[chosen[lineIndex]!]!,
        lineBreaks[breakIndex]!,
        lineIndex === 0 ? firstLineWidth : maxWidth,
        {
          indentPx: lineIndex === 0 ? indentPx : 0,
          isLastLine: lineIndex === lastLine,
        },
      ),
    );
  }

  return null;
}

export function layoutPreWrapLines(
  items: PreparedInlineItem[],
  maxWidth: number,
): PageLine[] {
  return layoutTextLinesPreWrap(items, Math.max(1, maxWidth));
}
