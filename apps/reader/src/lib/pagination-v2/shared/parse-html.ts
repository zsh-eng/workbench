/**
 * Parse chapter HTML into pagination `Block[]`.
 *
 * This parser is intentionally opinionated and only materializes the subset of
 * HTML needed by the pagination pipeline.
 *
 * Parsing contract:
 * - Block-level text nodes are produced for tags in `BLOCK_TAGS`.
 * - Container nodes in `CONTAINER_TAGS` are traversed recursively.
 * - Nodes in `IGNORE_TAGS` are dropped entirely.
 * - Images are extracted from:
 *   - `<img src="...">`
 *   - SVG `<image href|xlink:href="...">`
 * - Inline images mixed with text are not supported by pagination v2.
 *   Image-only wrappers like `<p><img /></p>` are still lifted out as block
 *   images during tree walking.
 * - Image sizing uses numeric `width`/`height`, then defaults.
 * - Inline formatting currently preserved in runs:
 *   - bold (`<strong>`, `<b>`)
 *   - italic (`<em>`, `<i>`)
 *   - link (`<a>`)
 *   - code (`<code>`, `<kbd>`, `<samp>`)
 *   - hard break (`<br>`)
 * - Fragment targets (`id`, `xml:id`, `name`) are normalized onto the nearest
 *   renderable block or text run during parsing. Empty target-only wrappers are
 *   only preserved as standalone empty blocks when there is no adjacent content
 *   to attach them to.
 * - Highlight metadata is captured from mark wrappers that provide
 *   `data-highlight-id` (and optional `data-color`). Nested marks are preserved
 *   as an ordered stack in `highlightMarks`.
 *
 * Important dependency notes:
 * - This stage preserves text and mark boundaries; whitespace normalization and
 *   collapsing happen later in `prepare-blocks.ts`.
 * - If supported HTML semantics change in Reader rendering, update this module's
 *   tag sets and inline extraction rules so pagination output stays consistent.
 */
import {
  createDeferredEpubImageSrc,
  DEFERRED_EPUB_IMAGE_ATTR,
  isExternalHref,
} from "@/lib/epub-resource-utils";
import {
  EPUB_HIGHLIGHT_END_ATTRIBUTE,
  EPUB_HIGHLIGHT_START_ATTRIBUTE,
  EPUB_LINK,
} from "@/types/reader.types";
import { DEFAULT_INTRINSIC_HEIGHT, DEFAULT_INTRINSIC_WIDTH } from "./spacing";
import {
  createBookPageBreakHintResolver,
  type BookPageBreakHintResolver,
} from "./book-page-break-hints";
import {
  applyContainerPageBreakHints,
  attachPageBreakHintsToBlock,
} from "./block-page-break-hints";
import {
  createPublisherStyleResolver,
  type PublisherStyleResolver,
} from "./publisher-styles";
import { normalizePublisherBodyFontScale } from "./publisher-body-scale";
import type {
  Block,
  BookPageBreakHints,
  BlockTag,
  ChapterCanonicalText,
  HighlightMark,
  InlineRun,
  LinkRef,
  PublisherFontFace,
  PublisherInlineStyle,
  BookStylesheet,
  PublisherStyleOptions,
  PublisherTextStyle,
  TextBlock,
} from "./types";

const BLOCK_TAGS = new Set<string>([
  "p",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "li",
  "blockquote",
  "pre",
  "figcaption",
]);

const CONTAINER_TAGS = new Set<string>([
  "div",
  "section",
  "article",
  "figure",
  "ul",
  "ol",
  "header",
  "footer",
  "nav",
  "main",
  "aside",
  "details",
  "summary",
  "dl",
  "dd",
  "dt",
  "span",
  "hgroup",
]);

const IGNORE_TAGS = new Set<string>([
  "script",
  "style",
  "noscript",
  "template",
]);

interface InlineContext {
  bold: boolean;
  italic: boolean;
  isCode: boolean;
  publisherInlineStyle?: PublisherInlineStyle;
  inlineStylePolicy?: InlineStylePolicy;
  inlineRole?: InlineRun["inlineRole"];
  link?: LinkRef;
  highlightMarks: HighlightMark[];
}

interface InlineStylePolicy {
  resolve: (element: Element) => PublisherInlineStyle | undefined;
}

const DEFAULT_CONTEXT: InlineContext = {
  bold: false,
  italic: false,
  isCode: false,
  highlightMarks: [],
};

function marksMatch(
  a: HighlightMark[] | undefined,
  b: HighlightMark[] | undefined,
) {
  if (!a || a.length === 0) return !b || b.length === 0;
  if (!b || b.length !== a.length) return false;

  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!left || !right) return false;
    if (
      left.id !== right.id ||
      left.color !== right.color ||
      left.isStart !== right.isStart ||
      left.isEnd !== right.isEnd
    ) {
      return false;
    }
  }

  return true;
}

function linksMatch(a: LinkRef | undefined, b: LinkRef | undefined): boolean {
  return a?.href === b?.href;
}

function targetIdsMatch(
  a: string[] | undefined,
  b: string[] | undefined,
): boolean {
  if (!a || a.length === 0) return !b || b.length === 0;
  if (!b || b.length !== a.length) return false;

  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }

  return true;
}

function publisherInlineStylesMatch(
  a: PublisherInlineStyle | undefined,
  b: PublisherInlineStyle | undefined,
): boolean {
  return (
    a?.fontFamily === b?.fontFamily &&
    a?.fontScale === b?.fontScale &&
    a?.fontWeight === b?.fontWeight &&
    a?.fontStyle === b?.fontStyle &&
    a?.displayBlock === b?.displayBlock
  );
}

function runsMatch(a: InlineRun, b: InlineRun): boolean {
  return (
    (a.hardBreak ?? false) === (b.hardBreak ?? false) &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.isCode === b.isCode &&
    publisherInlineStylesMatch(
      a.publisherInlineStyle,
      b.publisherInlineStyle,
    ) &&
    a.inlineRole === b.inlineRole &&
    linksMatch(a.link, b.link) &&
    targetIdsMatch(a.targetIds, b.targetIds) &&
    marksMatch(a.highlightMarks, b.highlightMarks)
  );
}

function appendTextRun(runs: InlineRun[], run: InlineRun): void {
  if (!run.text) return;
  const prev = runs[runs.length - 1];
  if (prev && runsMatch(prev, run)) {
    prev.text += run.text;
    return;
  }
  runs.push(run);
}

function createTextRun(
  text: string,
  ctx: InlineContext,
  targetIds: string[] = [],
): InlineRun {
  return {
    kind: "text",
    text,
    hardBreak: undefined,
    bold: ctx.bold,
    italic: ctx.italic,
    isCode: ctx.isCode,
    ...(ctx.publisherInlineStyle
      ? { publisherInlineStyle: ctx.publisherInlineStyle }
      : {}),
    ...(ctx.inlineRole ? { inlineRole: ctx.inlineRole } : {}),
    ...(ctx.link ? { link: { ...ctx.link } } : {}),
    ...(targetIds.length > 0 ? { targetIds: [...targetIds] } : {}),
    highlightMarks:
      ctx.highlightMarks.length > 0 ? [...ctx.highlightMarks] : undefined,
  };
}

function readHighlightMark(element: Element): HighlightMark | null {
  const id = element.getAttribute("data-highlight-id")?.trim();
  if (!id) return null;

  const color = element.getAttribute("data-color")?.trim() || undefined;
  const isStart =
    element.getAttribute(EPUB_HIGHLIGHT_START_ATTRIBUTE)?.trim() === "true";
  const isEnd =
    element.getAttribute(EPUB_HIGHLIGHT_END_ATTRIBUTE)?.trim() === "true";
  return {
    id,
    ...(color ? { color } : {}),
    ...(isStart ? { isStart: true } : {}),
    ...(isEnd ? { isEnd: true } : {}),
  };
}

function readLinkHref(element: Element): LinkRef | undefined {
  const internalHref = element.getAttribute(EPUB_LINK.hrefAttribute)?.trim();
  if (internalHref) {
    return { href: internalHref };
  }

  const rawHref = element.getAttribute("href")?.trim();
  if (rawHref) {
    return { href: rawHref };
  }

  return undefined;
}

function readTargetIds(element: Element): string[] {
  const candidates = [
    element.getAttribute("id"),
    element.getAttribute("xml:id"),
    element.getAttribute("name"),
  ];
  const targetIds: string[] = [];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || targetIds.includes(trimmed)) continue;
    targetIds.push(trimmed);
  }

  return targetIds;
}

function mergeTargetIds(a: string[], b: string[]): string[] {
  if (a.length === 0) return [...b];
  if (b.length === 0) return [...a];

  const merged = [...a];
  for (const targetId of b) {
    if (!merged.includes(targetId)) {
      merged.push(targetId);
    }
  }
  return merged;
}

function attachTargetsToRun(run: InlineRun, targetIds: string[]): void {
  if (targetIds.length === 0) return;
  run.targetIds = mergeTargetIds(run.targetIds ?? [], targetIds);
}

function attachTargetsToLastRun(
  runs: InlineRun[],
  targetIds: string[],
): boolean {
  const last = runs[runs.length - 1];
  if (!last) return false;
  attachTargetsToRun(last, targetIds);
  return true;
}

interface InlineExtractionResult {
  runs: InlineRun[];
  trailingTargets: string[];
  breakBefore?: boolean;
  breakAfter?: boolean;
}

function createHardBreakRun(ctx: InlineContext): InlineRun {
  const run = createTextRun("\n", ctx);
  run.hardBreak = true;
  return run;
}

function hasContentRun(runs: InlineRun[]): boolean {
  return runs.some((run) => run.hardBreak === true || run.text.length > 0);
}

function lastRunIsHardBreak(runs: InlineRun[]): boolean {
  return runs[runs.length - 1]?.hardBreak === true;
}

function prependHardBreakToRuns(runs: InlineRun[]): boolean {
  const firstTextRun = runs.find((run) => run.text.length > 0);
  if (!firstTextRun) return false;

  firstTextRun.text = `\n${firstTextRun.text}`;
  firstTextRun.hardBreak = true;
  return true;
}

function extractInlineNodes(
  nodes: Node[],
  ctx: InlineContext,
  pendingTargets: string[] = [],
): InlineExtractionResult {
  const runs: InlineRun[] = [];
  let trailingTargets = [...pendingTargets];
  let pendingDisplayBlockBreak = false;

  for (const node of nodes) {
    const result = extractInlineNode(node, ctx, trailingTargets);
    const hasResultContent = hasContentRun(result.runs);
    const shouldInsertBreakBefore =
      hasResultContent &&
      runs.length > 0 &&
      !lastRunIsHardBreak(runs) &&
      (pendingDisplayBlockBreak || result.breakBefore === true);
    if (shouldInsertBreakBefore) {
      const didPrependBreak = prependHardBreakToRuns(result.runs);
      if (!didPrependBreak) {
        appendTextRun(runs, createHardBreakRun(ctx));
      }
    }

    for (const run of result.runs) {
      appendTextRun(runs, run);
    }
    trailingTargets = result.trailingTargets;
    pendingDisplayBlockBreak = hasResultContent && result.breakAfter === true;
  }

  if (
    trailingTargets.length > 0 &&
    attachTargetsToLastRun(runs, trailingTargets)
  ) {
    trailingTargets = [];
  }

  return { runs, trailingTargets };
}

function extractInlineNode(
  node: Node,
  ctx: InlineContext,
  pendingTargets: string[],
): InlineExtractionResult {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) {
      return { runs: [], trailingTargets: [...pendingTargets] };
    }

    if (!text.trim()) {
      return {
        runs: [createTextRun(text, ctx)],
        trailingTargets: [...pendingTargets],
      };
    }

    return {
      runs: [createTextRun(text, ctx, pendingTargets)],
      trailingTargets: [],
    };
  }

  if (!(node instanceof Element)) {
    return { runs: [], trailingTargets: [...pendingTargets] };
  }

  const tag = node.tagName.toLowerCase();
  if (IGNORE_TAGS.has(tag)) {
    return { runs: [], trailingTargets: [...pendingTargets] };
  }

  const targetIds = mergeTargetIds(pendingTargets, readTargetIds(node));

  if (tag === "br") {
    const run = createTextRun("\n", ctx, targetIds);
    run.hardBreak = true;
    return { runs: [run], trailingTargets: [] };
  }

  if (tag === "img" || tag === "image") {
    // Inline images are intentionally unsupported in the text-layout pipeline.
    // Leave any pending targets unconsumed so the surrounding block walker can
    // attach them to the nearest renderable block instead.
    return { runs: [], trailingTargets: targetIds };
  }

  const next: InlineContext = {
    ...ctx,
    highlightMarks: [...ctx.highlightMarks],
  };
  const publisherInlineStyle = ctx.inlineStylePolicy?.resolve(node);
  if (publisherInlineStyle) {
    next.publisherInlineStyle = publisherInlineStyle;
  }

  const highlightMark = readHighlightMark(node);
  if (highlightMark) {
    const activeMark = next.highlightMarks.find(
      (mark) => mark.id === highlightMark.id,
    );
    if (!activeMark) {
      next.highlightMarks.push(highlightMark);
    } else {
      if (highlightMark.color && !activeMark.color) {
        activeMark.color = highlightMark.color;
      }
      if (highlightMark.isStart) {
        activeMark.isStart = true;
      }
      if (highlightMark.isEnd) {
        activeMark.isEnd = true;
      }
    }
  }

  if (tag === "strong" || tag === "b") next.bold = true;
  if (tag === "em" || tag === "i") next.italic = true;
  if (tag === "a") {
    next.link = readLinkHref(node);
  }
  if (tag === "sup") {
    next.inlineRole =
      next.link && !isExternalHref(next.link.href) ? "note-ref" : "superscript";
  }
  if (tag === "code" || tag === "kbd" || tag === "samp") next.isCode = true;

  const result = extractInlineNodes(Array.from(node.childNodes), next, targetIds);
  if (!publisherInlineStyle?.displayBlock) return result;

  return {
    ...result,
    breakBefore: true,
    breakAfter: true,
  };
}

function parseNumeric(value: string | null): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(trimmed)) {
    return null;
  }

  const n = Number.parseFloat(trimmed);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }

  return n;
}

function getImageSource(element: Element, tag: string): string | null {
  const deferredPath = element.getAttribute(DEFERRED_EPUB_IMAGE_ATTR)?.trim();
  if (deferredPath) {
    return createDeferredEpubImageSrc(deferredPath);
  }

  if (tag === "img") {
    return element.getAttribute("src");
  }

  if (tag !== "image") {
    return null;
  }

  return (
    element.getAttribute("href") ??
    element.getAttribute("xlink:href") ??
    element.getAttributeNS("http://www.w3.org/1999/xlink", "href")
  );
}

function createImageBlock(
  element: Element,
  id: string,
  targetIds: string[] = [],
  pageBreakHints: BookPageBreakHints | undefined = undefined,
): Block | null {
  const tag = element.tagName.toLowerCase();
  const src = getImageSource(element, tag);
  if (!src) return null;

  const intrinsicWidth =
    parseNumeric(element.getAttribute("width")) ?? DEFAULT_INTRINSIC_WIDTH;
  const intrinsicHeight =
    parseNumeric(element.getAttribute("height")) ?? DEFAULT_INTRINSIC_HEIGHT;

  return {
    type: "image",
    id,
    ...(targetIds.length > 0 ? { targetIds: [...targetIds] } : {}),
    ...(pageBreakHints ? { pageBreakHints: { ...pageBreakHints } } : {}),
    src,
    alt: element.getAttribute("alt") ?? undefined,
    intrinsicWidth,
    intrinsicHeight,
  };
}

function shouldPreservePublisherInlineStyles(
  publisherStyle: PublisherTextStyle | undefined,
): boolean {
  if (!publisherStyle) return false;
  return publisherStyle.role !== "body" && publisherStyle.role !== "list";
}

function createPublisherInlineStylePolicy(
  publisherStyle: PublisherTextStyle | undefined,
  publisherStyleResolver: PublisherStyleResolver | null,
): InlineStylePolicy | undefined {
  if (
    !publisherStyleResolver ||
    !shouldPreservePublisherInlineStyles(publisherStyle)
  ) {
    return undefined;
  }

  return {
    resolve: (element) => publisherStyleResolver.resolveInlineStyle(element),
  };
}

function createTextBlock(
  element: Element,
  tag: BlockTag,
  id: string,
  targetIds: string[] = [],
  publisherStyleResolver: PublisherStyleResolver | null = null,
  bookPageBreakHintResolver: BookPageBreakHintResolver | null = null,
): TextBlock | null {
  const publisherStyle = publisherStyleResolver?.resolveTextStyle(element, tag);
  const pageBreakHints = bookPageBreakHintResolver?.resolvePageBreakHints(element);
  const inlineStylePolicy = createPublisherInlineStylePolicy(
    publisherStyle,
    publisherStyleResolver,
  );
  const result = extractInlineNodes(
    Array.from(element.childNodes),
    {
      ...DEFAULT_CONTEXT,
      ...(inlineStylePolicy ? { inlineStylePolicy } : {}),
    },
  );
  const hasRenderableText = result.runs.some(
    (run) => run.hardBreak === true || run.text.trim().length > 0,
  );
  const hasRunTargets = result.runs.some(
    (run) => (run.targetIds?.length ?? 0) > 0,
  );
  if (!hasRenderableText && !hasRunTargets && targetIds.length === 0) {
    return null;
  }

  return {
    type: "text",
    id,
    tag,
    ...(targetIds.length > 0 ? { targetIds: [...targetIds] } : {}),
    ...(pageBreakHints ? { pageBreakHints } : {}),
    ...(publisherStyle ? { publisherStyle } : {}),
    runs: result.runs.filter((run) => run.text.length > 0),
  };
}

function hasVisibleInlineText(block: TextBlock): boolean {
  return block.runs.some(
    (run) => run.hardBreak === true || run.text.trim().length > 0,
  );
}

function createEmptyTargetBlock(id: string, targetIds: string[]): TextBlock {
  return {
    type: "text",
    id,
    tag: "p",
    targetIds: [...targetIds],
    runs: [],
  };
}

interface WalkResult {
  blocks: Block[];
  remainingTargets: string[];
}

interface ParseChapterContext {
  counter: { value: number };
  currentCanonicalOffset: number;
  blockStarts: Map<string, number> | null;
  publisherStyleResolver: PublisherStyleResolver | null;
  bookPageBreakHintResolver: BookPageBreakHintResolver | null;
}

function attachTargetsToBlock(block: Block, targetIds: string[]): void {
  if (targetIds.length === 0) return;
  block.targetIds = mergeTargetIds(block.targetIds ?? [], targetIds);
}

function attachTargetsToLastBlock(
  blocks: Block[],
  targetIds: string[],
): boolean {
  const last = blocks[blocks.length - 1];
  if (!last) return false;
  attachTargetsToBlock(last, targetIds);
  return true;
}

function getNodeTextLength(node: Node): number {
  return node.textContent?.length ?? 0;
}

function recordBlockStart(
  context: ParseChapterContext,
  blockId: string,
  offset: number,
): void {
  context.blockStarts?.set(blockId, offset);
}

export interface ParseChapterHtmlOptions extends PublisherStyleOptions {
  bookStylesheets?: BookStylesheet[];
  publisherFontFaces?: PublisherFontFace[];
}

function hasBlockChildren(element: Element): boolean {
  return Array.from(element.children).some((child) =>
    BLOCK_TAGS.has(child.tagName.toLowerCase()),
  );
}

function attachPublisherFontFaces(
  blocks: Block[],
  publisherFontFaces: PublisherFontFace[] | undefined,
): void {
  if (!publisherFontFaces || publisherFontFaces.length === 0) return;

  const firstTextBlock = blocks.find(
    (block): block is TextBlock => block.type === "text",
  );
  if (!firstTextBlock) return;
  firstTextBlock.publisherFontFaces = publisherFontFaces;
}

function parseChapterHtmlInternal(
  html: string,
  options: ParseChapterHtmlOptions = {},
): {
  blocks: Block[];
  canonicalText: ChapterCanonicalText;
} {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  const publisherStyleResolver = options.publisherBookStylingEnabled
    ? createPublisherStyleResolver(doc, options.bookStylesheets ?? [])
    : null;
  const bookPageBreakHintResolver = createBookPageBreakHintResolver(
    doc,
    options.bookStylesheets ?? [],
  );
  const context: ParseChapterContext = {
    counter: { value: 1 },
    currentCanonicalOffset: 0,
    blockStarts: new Map<string, number>(),
    publisherStyleResolver,
    bookPageBreakHintResolver,
  };

  function walkChildren(nodes: Node[], pendingTargets: string[]): WalkResult {
    const blocks: Block[] = [];
    let remainingTargets = [...pendingTargets];

    for (const child of nodes) {
      const result = walk(child, remainingTargets);
      blocks.push(...result.blocks);
      remainingTargets = result.remainingTargets;
    }

    if (
      remainingTargets.length > 0 &&
      attachTargetsToLastBlock(blocks, remainingTargets)
    ) {
      remainingTargets = [];
    }

    return { blocks, remainingTargets };
  }

  function walk(node: Node, pendingTargets: string[] = []): WalkResult {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      const blockStart = context.currentCanonicalOffset;
      context.currentCanonicalOffset += text.length;
      if (!text.trim()) {
        return { blocks: [], remainingTargets: [...pendingTargets] };
      }

      const p = document.createElement("p");
      p.textContent = text;
      const block = createTextBlock(
        p,
        "p",
        `text-${context.counter.value++}`,
        pendingTargets,
        context.publisherStyleResolver,
        context.bookPageBreakHintResolver,
      );
      if (block) {
        recordBlockStart(context, block.id, blockStart);
      }
      return block
        ? { blocks: [block], remainingTargets: [] }
        : { blocks: [], remainingTargets: [...pendingTargets] };
    }

    if (!(node instanceof Element)) {
      return { blocks: [], remainingTargets: [...pendingTargets] };
    }

    const tag = node.tagName.toLowerCase();
    const blockStart = context.currentCanonicalOffset;
    const nodeTextLength = getNodeTextLength(node);
    if (IGNORE_TAGS.has(tag)) {
      context.currentCanonicalOffset += nodeTextLength;
      return { blocks: [], remainingTargets: [...pendingTargets] };
    }

    const targetIds = mergeTargetIds(pendingTargets, readTargetIds(node));
    const pageBreakHints =
      context.bookPageBreakHintResolver?.resolvePageBreakHints(node);
    const walkChildBlocks = (): WalkResult => {
      const childrenResult = walkChildren(
        Array.from(node.childNodes),
        targetIds,
      );
      if (childrenResult.blocks.length > 0) {
        applyContainerPageBreakHints(childrenResult.blocks, pageBreakHints);
      }
      return childrenResult;
    };

    const imageBlock = createImageBlock(
      node,
      `image-${context.counter.value}`,
      targetIds,
      pageBreakHints,
    );
    if (imageBlock) {
      context.counter.value += 1;
      recordBlockStart(context, imageBlock.id, blockStart);
      context.currentCanonicalOffset += nodeTextLength;
      return { blocks: [imageBlock], remainingTargets: [] };
    }

    if (tag === "hr") {
      const spacerId = `spacer-${context.counter.value++}`;
      recordBlockStart(context, spacerId, blockStart);
      context.currentCanonicalOffset += nodeTextLength;
      return {
        blocks: [
          {
            type: "spacer",
            id: spacerId,
            ...(targetIds.length > 0 ? { targetIds } : {}),
            ...(pageBreakHints ? { pageBreakHints } : {}),
          },
        ],
        remainingTargets: [],
      };
    }

    if (BLOCK_TAGS.has(tag)) {
      if (
        context.publisherStyleResolver &&
        tag === "blockquote" &&
        hasBlockChildren(node)
      ) {
        const childrenResult = walkChildBlocks();
        if (childrenResult.blocks.length > 0) {
          return childrenResult;
        }
      }

      const block = createTextBlock(
        node,
        tag as BlockTag,
        `text-${context.counter.value++}`,
        targetIds,
        context.publisherStyleResolver,
        context.bookPageBreakHintResolver,
      );
      if (block && hasVisibleInlineText(block)) {
        recordBlockStart(context, block.id, blockStart);
        context.currentCanonicalOffset += nodeTextLength;
        return { blocks: [block], remainingTargets: [] };
      }

      const childrenResult = walkChildBlocks();
      if (childrenResult.blocks.length > 0) {
        return childrenResult;
      }

      return {
        blocks: [],
        remainingTargets: [...childrenResult.remainingTargets],
      };
    }

    if (tag === "table") {
      const p = document.createElement("p");
      p.textContent = node.textContent;
      const block = createTextBlock(
        p,
        "p",
        `text-${context.counter.value++}`,
        targetIds,
        context.publisherStyleResolver,
        context.bookPageBreakHintResolver,
      );
      if (block) {
        attachPageBreakHintsToBlock(block, pageBreakHints);
        recordBlockStart(context, block.id, blockStart);
      }
      context.currentCanonicalOffset += nodeTextLength;
      return block
        ? { blocks: [block], remainingTargets: [] }
        : { blocks: [], remainingTargets: [...targetIds] };
    }

    if (CONTAINER_TAGS.has(tag)) {
      const childrenResult = walkChildBlocks();
      if (childrenResult.blocks.length > 0) {
        return childrenResult;
      }

      return { blocks: [], remainingTargets: childrenResult.remainingTargets };
    }

    const childrenResult = walkChildBlocks();
    if (childrenResult.blocks.length > 0) {
      return childrenResult;
    }

    return { blocks: [], remainingTargets: childrenResult.remainingTargets };
  }

  const result = walkChildren(Array.from(doc.body.childNodes), []);
  if (result.remainingTargets.length > 0) {
    const blockId = `text-${context.counter.value++}`;
    recordBlockStart(context, blockId, context.currentCanonicalOffset);
    result.blocks.push(
      createEmptyTargetBlock(blockId, result.remainingTargets),
    );
  }
  if (options.publisherBookStylingEnabled) {
    attachPublisherFontFaces(result.blocks, options.publisherFontFaces);
  }
  const blocks =
    options.publisherBookStylingEnabled &&
    options.matchPublisherBodyTextSize &&
    options.publisherBodyFontScale
      ? normalizePublisherBodyFontScale(
          result.blocks,
          options.publisherBodyFontScale,
        )
      : result.blocks;

  return {
    blocks,
    canonicalText: {
      fullText: doc.body.textContent ?? "",
      blockStarts: context.blockStarts ?? new Map<string, number>(),
    },
  };
}

export function parseChapterHtmlWithCanonicalText(
  html: string,
  options: ParseChapterHtmlOptions = {},
): {
  blocks: Block[];
  canonicalText: ChapterCanonicalText;
} {
  return parseChapterHtmlInternal(html, options);
}

export function parseChapterHtml(
  html: string,
  options: ParseChapterHtmlOptions = {},
): Block[] {
  return parseChapterHtmlInternal(html, options).blocks;
}
