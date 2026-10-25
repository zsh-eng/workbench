import type { Book } from "@/lib/db";
import type {
  Block,
  PaginationConfig,
  ResolvedSpread,
  SpreadConfig,
} from "@/lib/pagination-v2";
import type { ReaderSettings } from "@/types/reader.types";
import type { ChapterEntry } from "../types";

export const READER_PAGE_DEBUG_DUMP_VERSION = 1;

export interface ReaderPageDebugDumpLayout {
  viewport: { width: number; height: number };
  spreadColumns: 1 | 2 | 3;
  columnGapPx: number;
  paddingTopPx: number;
  paddingBottomPx: number;
  paddingLeftPx: number;
  paddingRightPx: number;
}

export interface ReaderPageDebugDumpElementMetrics {
  clientWidth: number;
  clientHeight: number;
  scrollWidth: number;
  scrollHeight: number;
  offsetWidth: number;
  offsetHeight: number;
  rect: {
    x: number;
    y: number;
    width: number;
    height: number;
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  overflowX: number;
  overflowY: number;
}

export interface ReaderPageDebugDumpLineProbe {
  font: string;
  fontFamily: string;
  fontSize: string;
  fontStyle: string;
  fontWeight: string;
  lineHeight: string;
  lineHeightPx: number | null;
  sampleLineCount: number;
  expectedHeight: number | null;
  metrics: ReaderPageDebugDumpElementMetrics;
  overflowPerLine: number | null;
}

export interface ReaderPageDebugDumpVisualLineStyleSample {
  text: string;
  tagName: string;
  className: string;
  fontFamily: string;
  fontSize: string;
  fontStyle: string;
  fontWeight: string;
  lineHeight: string;
}

export interface ReaderPageDebugDumpInlineStyleSummary {
  tagName: string;
  className: string;
  fontFamily: string;
  fontSize: string;
  fontStyle: string;
  fontWeight: string;
  lineHeight: string;
  textNodeCount: number;
}

export interface ReaderPageDebugDumpVisualLineDetail {
  index: number;
  top: number;
  bottom: number;
  height: number;
  left: number;
  right: number;
  width: number;
  rectCount: number;
  expectedTop: number | null;
  expectedBottom: number | null;
  topDelta: number | null;
  bottomDelta: number | null;
  heightDelta: number | null;
  strideToNext: number | null;
  strideDelta: number | null;
  issue: string;
  textSample: string;
  styleSamples: ReaderPageDebugDumpVisualLineStyleSample[];
}

export interface ReaderPageDebugDumpVisualLineMetrics {
  lineCount: number;
  rectCount: number;
  firstTop: number | null;
  lastBottom: number | null;
  lineTops: number[];
  lines?: ReaderPageDebugDumpVisualLineDetail[];
  worstLine?: ReaderPageDebugDumpVisualLineDetail | null;
}

export interface ReaderPageDebugDumpEnvironment {
  userAgent: string;
  window: {
    innerWidth: number;
    innerHeight: number;
    outerWidth: number;
    outerHeight: number;
    devicePixelRatio: number;
  };
  visualViewport: {
    width: number;
    height: number;
    offsetTop: number;
    offsetLeft: number;
    pageTop: number;
    pageLeft: number;
    scale: number;
  } | null;
  documentElement: {
    clientWidth: number;
    clientHeight: number;
    scrollWidth: number;
    scrollHeight: number;
  };
  safeAreaInsets: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
  stageSlot: ReaderPageDebugDumpElementMetrics | null;
  stageContent: ReaderPageDebugDumpElementMetrics | null;
  pageSlots: Array<{
    slotIndex: number;
    currentPage: number | null;
    metrics: ReaderPageDebugDumpElementMetrics;
    contentMetrics: ReaderPageDebugDumpElementMetrics | null;
    slices: Array<{
      sliceIndex: number;
      type: string;
      blockId: string;
      expectedHeight: number | null;
      lineCount: number | null;
      lineHeight: number | null;
      computedStyle: {
        font: string;
        fontFamily: string;
        fontSize: string;
        fontStyle: string;
        fontWeight: string;
        lineHeight: string;
      } | null;
      containerStyle: {
        font: string;
        fontFamily: string;
        fontSize: string;
        fontStyle: string;
        fontWeight: string;
        lineHeight: string;
      } | null;
      inlineStyles: ReaderPageDebugDumpInlineStyleSummary[];
      lineProbe: ReaderPageDebugDumpLineProbe | null;
      visualLines: ReaderPageDebugDumpVisualLineMetrics | null;
      metrics: ReaderPageDebugDumpElementMetrics;
    }>;
  }>;
}

export interface ReaderPageDebugDump {
  version: typeof READER_PAGE_DEBUG_DUMP_VERSION;
  capturedAt: string;
  book: {
    id: string;
    title: string;
  };
  page: {
    currentPage: number;
    currentSpread: number;
    totalPages: number;
    chapterIndexStart: number | null;
    chapterIndexEnd: number | null;
  };
  layout: ReaderPageDebugDumpLayout;
  environment?: ReaderPageDebugDumpEnvironment;
  settings: ReaderSettings;
  paginationConfig: PaginationConfig;
  spreadConfig: SpreadConfig;
  renderedSpread: ResolvedSpread;
  layoutInputs: Array<{
    chapterIndex: number;
    chapterTitle: string;
    blocks: Block[];
  }>;
}

export interface BuildReaderPageDebugDumpOptions {
  book: Book;
  settings: ReaderSettings;
  spread: ResolvedSpread;
  paginationConfig: PaginationConfig;
  spreadConfig: SpreadConfig;
  layout: ReaderPageDebugDumpLayout;
  environment?: ReaderPageDebugDumpEnvironment;
  chapterEntries: ChapterEntry[];
  getBlocks: (chapterIndex: number) => Block[] | null;
}

function getVisibleChapterIndices(spread: ResolvedSpread): number[] {
  const indices = new Set<number>();

  for (const slot of spread.slots) {
    if (slot.kind === "page") {
      indices.add(slot.page.chapterIndex);
    }
  }

  return [...indices].sort((a, b) => a - b);
}

/**
 * Captures both the rendered page slices and the source blocks that produced
 * them so wrapping issues can be reproduced either as a frozen render or as a
 * fresh pagination run from the same inputs.
 */
export function buildReaderPageDebugDump({
  book,
  settings,
  spread,
  paginationConfig,
  spreadConfig,
  layout,
  environment,
  chapterEntries,
  getBlocks,
}: BuildReaderPageDebugDumpOptions): ReaderPageDebugDump {
  return {
    version: READER_PAGE_DEBUG_DUMP_VERSION,
    capturedAt: new Date().toISOString(),
    book: {
      id: book.id,
      title: book.title,
    },
    page: {
      currentPage: spread.currentPage,
      currentSpread: spread.currentSpread,
      totalPages: spread.totalPages,
      chapterIndexStart: spread.chapterIndexStart,
      chapterIndexEnd: spread.chapterIndexEnd,
    },
    layout,
    ...(environment ? { environment } : {}),
    settings,
    paginationConfig,
    spreadConfig,
    renderedSpread: spread,
    layoutInputs: getVisibleChapterIndices(spread).map((chapterIndex) => ({
      chapterIndex,
      chapterTitle:
        chapterEntries[chapterIndex]?.title || `Chapter ${chapterIndex + 1}`,
      blocks: getBlocks(chapterIndex) ?? [],
    })),
  };
}

function roundMetric(value: number): number {
  return Math.round(value * 100) / 100;
}

function getElementMetrics(
  element: HTMLElement | null,
): ReaderPageDebugDumpElementMetrics | null {
  if (!element) return null;

  const rect = element.getBoundingClientRect();
  return {
    clientWidth: element.clientWidth,
    clientHeight: element.clientHeight,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    offsetWidth: element.offsetWidth,
    offsetHeight: element.offsetHeight,
    rect: {
      x: roundMetric(rect.x),
      y: roundMetric(rect.y),
      width: roundMetric(rect.width),
      height: roundMetric(rect.height),
      top: roundMetric(rect.top),
      right: roundMetric(rect.right),
      bottom: roundMetric(rect.bottom),
      left: roundMetric(rect.left),
    },
    overflowX: element.scrollWidth - element.clientWidth,
    overflowY: element.scrollHeight - element.clientHeight,
  };
}

function getSafeAreaInsets() {
  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.paddingTop = "env(safe-area-inset-top)";
  probe.style.paddingRight = "env(safe-area-inset-right)";
  probe.style.paddingBottom = "env(safe-area-inset-bottom)";
  probe.style.paddingLeft = "env(safe-area-inset-left)";
  document.body.appendChild(probe);

  const style = window.getComputedStyle(probe);
  const insets = {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };

  probe.remove();
  return insets;
}

function parsePixelValue(value: string): number | null {
  if (!value.endsWith("px")) return null;

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getSliceComputedStyle(sliceElement: HTMLElement) {
  const inlineElement =
    sliceElement.querySelector<HTMLElement>("span, a") ?? sliceElement;
  const style = window.getComputedStyle(inlineElement);

  return {
    font: style.font,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
  };
}

function getElementComputedStyle(element: HTMLElement) {
  const style = window.getComputedStyle(element);

  return {
    font: style.font,
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
  };
}

function getInlineStyleSummaryKey(
  summary: Omit<ReaderPageDebugDumpInlineStyleSummary, "textNodeCount">,
) {
  return [
    summary.tagName,
    summary.className,
    summary.fontFamily,
    summary.fontSize,
    summary.fontStyle,
    summary.fontWeight,
    summary.lineHeight,
  ].join("|");
}

function collectInlineStyleSummary(
  root: HTMLElement,
): ReaderPageDebugDumpInlineStyleSummary[] {
  const summaries = new Map<string, ReaderPageDebugDumpInlineStyleSummary>();
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.textContent && node.textContent.trim().length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    },
  );

  for (
    let currentNode = walker.nextNode();
    currentNode;
    currentNode = walker.nextNode()
  ) {
    const parentElement = (currentNode as Text).parentElement;
    if (!parentElement) continue;

    const style = window.getComputedStyle(parentElement);
    const summary = {
      tagName: parentElement.tagName.toLowerCase(),
      className:
        typeof parentElement.className === "string"
          ? parentElement.className
          : "",
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontStyle: style.fontStyle,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
    };
    const key = getInlineStyleSummaryKey(summary);
    const existingSummary = summaries.get(key);

    if (existingSummary) {
      existingSummary.textNodeCount += 1;
      continue;
    }

    summaries.set(key, {
      ...summary,
      textNodeCount: 1,
    });
  }

  return [...summaries.values()].sort(
    (a, b) => b.textNodeCount - a.textNodeCount,
  );
}

function collectLineProbe(options: {
  sliceElement: HTMLElement;
  computedStyle: ReturnType<typeof getSliceComputedStyle>;
  lineCount: number | null;
  lineHeight: number | null;
}): ReaderPageDebugDumpLineProbe | null {
  const lineHeightPx =
    parsePixelValue(options.computedStyle.lineHeight) ?? options.lineHeight;
  if (!lineHeightPx) return null;

  const sampleLineCount = Math.max(
    1,
    Math.min(options.lineCount ?? 8, 16),
  );
  const expectedHeight = sampleLineCount * lineHeightPx;
  const probe = document.createElement("div");
  probe.textContent = Array.from(
    { length: sampleLineCount },
    () => "Agjy pqÅÉ The quick brown fox",
  ).join("\n");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.left = "-10000px";
  probe.style.top = "0";
  probe.style.boxSizing = "border-box";
  probe.style.width = `${Math.max(1, options.sliceElement.clientWidth)}px`;
  probe.style.height = `${expectedHeight}px`;
  probe.style.margin = "0";
  probe.style.padding = "0";
  probe.style.border = "0";
  probe.style.overflow = "hidden";
  probe.style.whiteSpace = "pre";
  probe.style.font = options.computedStyle.font;
  probe.style.fontFamily = options.computedStyle.fontFamily;
  probe.style.fontSize = options.computedStyle.fontSize;
  probe.style.fontStyle = options.computedStyle.fontStyle;
  probe.style.fontWeight = options.computedStyle.fontWeight;
  probe.style.lineHeight = `${lineHeightPx}px`;

  document.body.appendChild(probe);
  const metrics = getElementMetrics(probe);
  probe.remove();

  if (!metrics) return null;

  return {
    ...options.computedStyle,
    lineHeightPx,
    sampleLineCount,
    expectedHeight,
    metrics,
    overflowPerLine: metrics.overflowY / sampleLineCount,
  };
}

interface VisualLineGroup {
  index: number;
  top: number;
  bottom: number;
  left: number;
  right: number;
  rectCount: number;
  textParts: string[];
  styleSamples: ReaderPageDebugDumpVisualLineStyleSample[];
}

export function createVisualLineGroups(
  rects: DOMRect[],
  lineHeight: number | null = null,
): VisualLineGroup[] {
  const sorted = [...rects].sort((a, b) => a.top - b.top);
  const groups: VisualLineGroup[] = [];
  const topTolerancePx =
    lineHeight !== null && lineHeight > 0 ? lineHeight * 0.5 : 1;

  for (const rect of sorted) {
    const top = roundMetric(rect.top);
    const bottom = roundMetric(rect.bottom);
    const left = roundMetric(rect.left);
    const right = roundMetric(rect.right);
    const previousGroup = groups[groups.length - 1];

    if (
      !previousGroup ||
      Math.abs(top - previousGroup.top) > topTolerancePx
    ) {
      groups.push({
        index: groups.length,
        top,
        bottom,
        left,
        right,
        rectCount: 1,
        textParts: [],
        styleSamples: [],
      });
      continue;
    }

    previousGroup.top = Math.min(previousGroup.top, top);
    previousGroup.bottom = Math.max(previousGroup.bottom, bottom);
    previousGroup.left = Math.min(previousGroup.left, left);
    previousGroup.right = Math.max(previousGroup.right, right);
    previousGroup.rectCount += 1;
  }

  return groups;
}

function findVisualLineGroupForRect(
  groups: VisualLineGroup[],
  rect: DOMRect,
): VisualLineGroup | null {
  if (groups.length === 0) return null;

  const centerY = (rect.top + rect.bottom) / 2;
  const overlapTolerancePx = 1;
  const overlappingGroup = groups.find(
    (group) =>
      centerY >= group.top - overlapTolerancePx &&
      centerY <= group.bottom + overlapTolerancePx,
  );

  if (overlappingGroup) return overlappingGroup;

  return groups.reduce((closest, group) => {
    return Math.abs(rect.top - group.top) < Math.abs(rect.top - closest.top)
      ? group
      : closest;
  }, groups[0]!);
}

function appendLineTextSample(group: VisualLineGroup, text: string) {
  const normalized = text.replace(/\s+/g, " ");
  if (!normalized) return;

  const currentLength = group.textParts.join("").length;
  if (currentLength >= 180) return;

  group.textParts.push(normalized.slice(0, Math.max(0, 180 - currentLength)));
}

function getStyleSample(
  element: HTMLElement,
  text: string,
): ReaderPageDebugDumpVisualLineStyleSample {
  const style = window.getComputedStyle(element);

  return {
    text: text.trim().slice(0, 40),
    tagName: element.tagName.toLowerCase(),
    className:
      typeof element.className === "string" ? element.className : "",
    fontFamily: style.fontFamily,
    fontSize: style.fontSize,
    fontStyle: style.fontStyle,
    fontWeight: style.fontWeight,
    lineHeight: style.lineHeight,
  };
}

function addLineStyleSample(
  group: VisualLineGroup,
  sample: ReaderPageDebugDumpVisualLineStyleSample,
) {
  if (!sample.text || group.styleSamples.length >= 4) return;

  const sampleKey = [
    sample.tagName,
    sample.className,
    sample.fontFamily,
    sample.fontSize,
    sample.fontStyle,
    sample.fontWeight,
    sample.lineHeight,
  ].join("|");
  const hasSample = group.styleSamples.some(
    (existing) =>
      [
        existing.tagName,
        existing.className,
        existing.fontFamily,
        existing.fontSize,
        existing.fontStyle,
        existing.fontWeight,
        existing.lineHeight,
      ].join("|") === sampleKey,
  );

  if (!hasSample) {
    group.styleSamples.push(sample);
  }
}

function getTextTokens(text: string) {
  return Array.from(text.matchAll(/\S+|\s+/g)).map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function annotateVisualLineGroupsWithText(
  root: HTMLElement,
  groups: VisualLineGroup[],
) {
  const walker = document.createTreeWalker(
    root,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: (node) =>
        node.textContent && node.textContent.trim().length > 0
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT,
    },
  );
  const range = document.createRange();

  try {
    for (
      let currentNode = walker.nextNode();
      currentNode;
      currentNode = walker.nextNode()
    ) {
      const textNode = currentNode as Text;
      const parentElement = textNode.parentElement;
      if (!parentElement) continue;

      for (const token of getTextTokens(textNode.data)) {
        range.setStart(textNode, token.start);
        range.setEnd(textNode, token.end);

        const tokenRects = Array.from(range.getClientRects()).filter(
          (rect) => rect.width > 0 && rect.height > 0,
        );
        const assignedGroups = new Set<number>();

        for (const rect of tokenRects) {
          const group = findVisualLineGroupForRect(groups, rect);
          if (!group || assignedGroups.has(group.index)) continue;

          assignedGroups.add(group.index);
          appendLineTextSample(group, token.text);
          addLineStyleSample(
            group,
            getStyleSample(parentElement, token.text),
          );
        }
      }
    }
  } finally {
    range.detach();
  }
}

function getVisualLineIssue(options: {
  line: ReaderPageDebugDumpVisualLineDetail;
  expectedLineCount: number | null;
}) {
  if (
    options.expectedLineCount !== null &&
    options.line.index >= options.expectedLineCount
  ) {
    return "extra DOM line";
  }

  if ((options.line.strideDelta ?? 0) > 0.5) return "wide line stride";
  if ((options.line.heightDelta ?? 0) > 0.5) return "tall visual rect";
  if ((options.line.bottomDelta ?? 0) > 0.5) return "below modeled line";
  if ((options.line.topDelta ?? 0) < -0.5) return "above modeled line";
  return "tallest visual rect";
}

function getVisualLineScore(
  line: ReaderPageDebugDumpVisualLineDetail,
  expectedLineCount: number | null,
  lineHeight: number | null,
) {
  const extraDomLineScore =
    expectedLineCount !== null && line.index >= expectedLineCount
      ? lineHeight ?? 100
      : 0;

  return Math.max(
    extraDomLineScore,
    line.height,
    Math.max(0, line.heightDelta ?? 0),
    Math.max(0, line.strideDelta ?? 0),
    Math.max(0, line.bottomDelta ?? 0),
    Math.max(0, -(line.topDelta ?? 0)),
  );
}

function collectVisualLineMetrics(
  element: HTMLElement,
  options: {
    expectedLineCount: number | null;
    lineHeight: number | null;
  },
): ReaderPageDebugDumpVisualLineMetrics | null {
  const range = document.createRange();
  range.selectNodeContents(element);
  const rects = Array.from(range.getClientRects()).filter(
    (rect) => rect.width > 0 && rect.height > 0,
  );
  range.detach();

  if (rects.length === 0) return null;

  const groups = createVisualLineGroups(rects, options.lineHeight);
  annotateVisualLineGroupsWithText(element, groups);

  const elementRect = element.getBoundingClientRect();
  const lineHeight = options.lineHeight;
  const linesWithoutIssues = groups.map((group, index) => {
    const nextGroup = groups[index + 1];
    const height = roundMetric(group.bottom - group.top);
    const width = roundMetric(group.right - group.left);
    const expectedTop =
      lineHeight !== null
        ? roundMetric(elementRect.top + index * lineHeight)
        : null;
    const expectedBottom =
      lineHeight !== null && expectedTop !== null
        ? roundMetric(expectedTop + lineHeight)
        : null;
    const strideToNext = nextGroup
      ? roundMetric(nextGroup.top - group.top)
      : null;

    return {
      index,
      top: group.top,
      bottom: group.bottom,
      height,
      left: group.left,
      right: group.right,
      width,
      rectCount: group.rectCount,
      expectedTop,
      expectedBottom,
      topDelta: expectedTop !== null ? roundMetric(group.top - expectedTop) : null,
      bottomDelta:
        expectedBottom !== null
          ? roundMetric(group.bottom - expectedBottom)
          : null,
      heightDelta:
        lineHeight !== null ? roundMetric(height - lineHeight) : null,
      strideToNext,
      strideDelta:
        strideToNext !== null && lineHeight !== null
          ? roundMetric(strideToNext - lineHeight)
          : null,
      issue: "",
      textSample: group.textParts.join("").trim(),
      styleSamples: group.styleSamples,
    } satisfies ReaderPageDebugDumpVisualLineDetail;
  });
  const lines = linesWithoutIssues.map((line) => ({
    ...line,
    issue: getVisualLineIssue({
      line,
      expectedLineCount: options.expectedLineCount,
    }),
  }));
  const worstLine =
    lines.length > 0
      ? lines.reduce((worst, line) => {
          const worstScore = getVisualLineScore(
            worst,
            options.expectedLineCount,
            lineHeight,
          );
          const lineScore = getVisualLineScore(
            line,
            options.expectedLineCount,
            lineHeight,
          );

          if (lineScore === worstScore) {
            return line.height > worst.height ? line : worst;
          }

          return lineScore > worstScore ? line : worst;
        }, lines[0]!)
      : null;
  const lineTops = lines.map((line) => line.top);

  return {
    lineCount: lines.length,
    rectCount: rects.length,
    firstTop: lineTops[0] ?? null,
    lastBottom:
      lines.length > 0
        ? Math.max(...lines.map((line) => line.bottom))
        : null,
    lineTops,
    lines,
    worstLine,
  };
}

export function collectReaderPageDebugDumpEnvironment(options: {
  stageSlotElement: HTMLElement | null;
  stageContentElement: HTMLElement | null;
}): ReaderPageDebugDumpEnvironment | undefined {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return undefined;
  }

  const { visualViewport } = window;
  const { documentElement } = document;
  const pageSlotElements = Array.from(
    options.stageContentElement?.querySelectorAll<HTMLElement>(
      "[data-reader-spread-layer='current'] [data-reader-page-slot]",
    ) ?? [],
  );

  return {
    userAgent: navigator.userAgent,
    window: {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      outerWidth: window.outerWidth,
      outerHeight: window.outerHeight,
      devicePixelRatio: window.devicePixelRatio,
    },
    visualViewport: visualViewport
      ? {
          width: roundMetric(visualViewport.width),
          height: roundMetric(visualViewport.height),
          offsetTop: roundMetric(visualViewport.offsetTop),
          offsetLeft: roundMetric(visualViewport.offsetLeft),
          pageTop: roundMetric(visualViewport.pageTop),
          pageLeft: roundMetric(visualViewport.pageLeft),
          scale: roundMetric(visualViewport.scale),
        }
      : null,
    documentElement: {
      clientWidth: documentElement.clientWidth,
      clientHeight: documentElement.clientHeight,
      scrollWidth: documentElement.scrollWidth,
      scrollHeight: documentElement.scrollHeight,
    },
    safeAreaInsets: getSafeAreaInsets(),
    stageSlot: getElementMetrics(options.stageSlotElement),
    stageContent: getElementMetrics(options.stageContentElement),
    pageSlots: pageSlotElements.flatMap((element) => {
      const metrics = getElementMetrics(element);
      if (!metrics) return [];

      const contentMetrics = getElementMetrics(
        element.querySelector<HTMLElement>("[data-reader-page-content]"),
      );
      const sliceElements = Array.from(
        element.querySelectorAll<HTMLElement>("[data-reader-page-slice]"),
      );

      return [
        {
          slotIndex: Number(element.dataset.readerPageSlot ?? 0),
          currentPage: element.dataset.readerCurrentPage
            ? Number(element.dataset.readerCurrentPage)
            : null,
          metrics,
          contentMetrics,
          slices: sliceElements.flatMap((sliceElement) => {
            const sliceMetrics = getElementMetrics(sliceElement);
            if (!sliceMetrics) return [];
            const lineCount = sliceElement.dataset.readerLineCount
              ? Number(sliceElement.dataset.readerLineCount)
              : null;
            const lineHeight = sliceElement.dataset.readerLineHeight
              ? Number(sliceElement.dataset.readerLineHeight)
              : null;
            const computedStyle =
              sliceElement.dataset.readerSliceType === "text"
                ? getSliceComputedStyle(sliceElement)
                : null;
            const containerStyle =
              sliceElement.dataset.readerSliceType === "text"
                ? getElementComputedStyle(sliceElement)
                : null;
            const inlineStyles =
              sliceElement.dataset.readerSliceType === "text"
                ? collectInlineStyleSummary(sliceElement)
                : [];
            const lineProbe = computedStyle
              ? collectLineProbe({
                  sliceElement,
                  computedStyle,
                  lineCount,
                  lineHeight,
                })
              : null;
            const visualLines =
              sliceElement.dataset.readerSliceType === "text"
                ? collectVisualLineMetrics(sliceElement, {
                    expectedLineCount: lineCount,
                    lineHeight,
                  })
                : null;

            return [
              {
                sliceIndex: Number(sliceElement.dataset.readerPageSlice ?? 0),
                type: sliceElement.dataset.readerSliceType ?? "unknown",
                blockId: sliceElement.dataset.readerBlockId ?? "",
                expectedHeight: sliceElement.dataset.readerExpectedHeight
                  ? Number(sliceElement.dataset.readerExpectedHeight)
                  : null,
                lineCount,
                lineHeight,
                computedStyle,
                containerStyle,
                inlineStyles,
                lineProbe,
                visualLines,
                metrics: sliceMetrics,
              },
            ];
          }),
        },
      ];
    }),
  };
}

export function serializeReaderPageDebugDump(
  dump: ReaderPageDebugDump,
): string {
  return JSON.stringify(dump, null, 2);
}

export function parseReaderPageDebugDump(
  value: string,
): ReaderPageDebugDump {
  const parsed = JSON.parse(value) as Partial<ReaderPageDebugDump>;

  if (parsed.version !== READER_PAGE_DEBUG_DUMP_VERSION) {
    throw new Error("Unsupported reader debug dump version.");
  }

  if (
    !parsed.book ||
    !parsed.layout ||
    !parsed.paginationConfig ||
    !parsed.spreadConfig ||
    !parsed.renderedSpread ||
    !Array.isArray(parsed.layoutInputs)
  ) {
    throw new Error("Debug dump is missing required reader data.");
  }

  return parsed as ReaderPageDebugDump;
}
