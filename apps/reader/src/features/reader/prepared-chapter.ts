import {
  prepareBlocks,
  type Block,
  type FontConfig,
  type PreparedBlock,
} from "@/lib/pagination-v2";

const preparedCache = new WeakMap<
  Block[],
  { key: string; prepared: PreparedBlock[] }
>();

/**
 * A chapter's blocks prepared for a font setup, kept while the chapter's
 * blocks are. Reading a selection needs them on every tap of the highlight
 * tools; preparing a long chapter again each time cost a 220,000-character
 * chapter 15 ms with the CPU 4 times slower.
 */
export function preparedChapter(
  blocks: Block[],
  fontConfig: FontConfig,
  publisherBookStylingEnabled: boolean,
): PreparedBlock[] {
  const key = `${JSON.stringify(fontConfig)}:${publisherBookStylingEnabled}`;
  const cached = preparedCache.get(blocks);
  if (cached?.key === key) return cached.prepared;
  const prepared = prepareBlocks(blocks, fontConfig, {
    publisherBookStylingEnabled,
  });
  preparedCache.set(blocks, { key, prepared });
  return prepared;
}
