import type { Block, PublisherBox, PublisherLength, TextBlock } from "./types";

/**
 * A book's page margin, set on its paragraphs.
 *
 * Converters such as Calibre give every ordinary paragraph a side margin
 * (`p.calibre4 { margin: 0 1em }`), a page margin for readers that draw
 * none. Reader draws its own margins, so with Book styles on, the side margin
 * a chapter's body text shares comes off every block: body text runs the full
 * measure, and a block set wider than the body (a quotation, a letter) keeps
 * only the difference.
 *
 * The body's margin is the left and right pair carried by most of the
 * chapter's body paragraphs, by characters. A chapter with little body text,
 * or none in the majority, keeps its margins as the book gives them.
 */
const MIN_BODY_SAMPLE_CHARS = 200;
const MIN_DOMINANT_BODY_SHARE = 0.5;

interface SideMargins {
  left: PublisherLength | undefined;
  right: PublisherLength | undefined;
}

function textLength(block: TextBlock): number {
  return block.runs.reduce(
    (total, run) => total + run.text.replace(/\s+/g, " ").trim().length,
    0,
  );
}

const round = (value: number | undefined) =>
  Math.round((value ?? 0) * 10_000) / 10_000;

function lengthKey(length: PublisherLength | undefined): string {
  return `${round(length?.em)}:${round(length?.percent)}`;
}

function isZero(length: PublisherLength | undefined): boolean {
  return round(length?.em) === 0 && round(length?.percent) === 0;
}

/** The side margins most of the chapter's body paragraphs share, if any. */
export function inferPublisherPageMargin(
  blocks: readonly Block[],
): SideMargins | undefined {
  const buckets = new Map<string, { margins: SideMargins; chars: number }>();
  let totalChars = 0;

  for (const block of blocks) {
    if (block.type !== "text" || block.tag !== "p") continue;
    if (block.publisherStyle?.role !== "body") continue;
    const chars = textLength(block);
    if (chars === 0) continue;

    const margins = {
      left: block.publisherStyle.margin?.left,
      right: block.publisherStyle.margin?.right,
    };
    const key = `${lengthKey(margins.left)}|${lengthKey(margins.right)}`;
    const bucket = buckets.get(key) ?? { margins, chars: 0 };
    bucket.chars += chars;
    buckets.set(key, bucket);
    totalChars += chars;
  }

  if (totalChars < MIN_BODY_SAMPLE_CHARS) return undefined;
  const dominant = [...buckets.values()].sort((a, b) => b.chars - a.chars)[0];
  if (!dominant || dominant.chars / totalChars <= MIN_DOMINANT_BODY_SHARE) {
    return undefined;
  }
  if (isZero(dominant.margins.left) && isZero(dominant.margins.right)) {
    return undefined;
  }
  return dominant.margins;
}

/**
 * `length` less `page`. Each part subtracts separately; a part may go below
 * zero where the units differ, and layout clamps the whole at zero.
 */
function subtract(
  length: PublisherLength | undefined,
  page: PublisherLength | undefined,
): PublisherLength | undefined {
  if (!page) return length;
  const em = round((length?.em ?? 0) - (page.em ?? 0));
  const percent = round((length?.percent ?? 0) - (page.percent ?? 0));
  if (em <= 0 && percent <= 0) return undefined;
  return {
    ...(em !== 0 ? { em } : {}),
    ...(percent !== 0 ? { percent } : {}),
  };
}

function withoutPageMargin(
  box: PublisherBox | undefined,
  page: SideMargins,
): PublisherBox | undefined {
  const left = subtract(box?.left, page.left);
  const right = subtract(box?.right, page.right);
  const next: PublisherBox = {
    ...(box?.before ? { before: box.before } : {}),
    ...(box?.after ? { after: box.after } : {}),
    ...(left ? { left } : {}),
    ...(right ? { right } : {}),
  };
  return Object.keys(next).length > 0 ? next : undefined;
}

/** Takes the body text's shared side margin off every block of a chapter. */
export function removePublisherPageMargin(blocks: Block[]): Block[] {
  const page = inferPublisherPageMargin(blocks);
  if (!page) return blocks;

  return blocks.map((block) => {
    if (block.type !== "text" || !block.publisherStyle) return block;
    const { margin: _margin, ...style } = block.publisherStyle;
    const margin = withoutPageMargin(block.publisherStyle.margin, page);
    return {
      ...block,
      publisherStyle: margin ? { ...style, margin } : style,
    };
  });
}
