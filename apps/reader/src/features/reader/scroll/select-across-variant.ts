/**
 * Ways to carry a selection across a page break, compared in Design ideas
 * (Debug mode). `?selectAcross=` picks one for a Reader:
 *
 * - spill: a tab under the cut previews the next words; tapping it eases
 *   into the column and finishes the sentence. The default.
 * - sentence: a line in the highlight tools previews the rest of the
 *   sentence and includes it without leaving pages.
 * - hold: holding the selection's end at the page's last word eases into
 *   the column so the selection can keep going.
 * - toolbar: the earlier Scroll button in the highlight tools.
 */
export const SELECT_ACROSS_VARIANTS = [
  "spill",
  "sentence",
  "hold",
  "toolbar",
] as const;

export type SelectAcrossVariant = (typeof SELECT_ACROSS_VARIANTS)[number];

export function parseSelectAcrossVariant(
  value: string | null,
): SelectAcrossVariant {
  return SELECT_ACROSS_VARIANTS.find((variant) => variant === value) ?? "spill";
}
