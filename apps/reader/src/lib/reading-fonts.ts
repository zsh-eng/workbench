/**
 * The reading fonts offered in Appearance → Type.
 *
 * Each font has one CSS font-family list. The pagination worker measures text
 * in exactly that list and the page renders the same list, so line breaks
 * agree. A list follows Pretext's rules for accurate measurement:
 *
 * - Name each family and end with a generic family.
 * - Use `system-ui` only where it measures like the page (see below).
 * - A bundled family (`@fontsource`) is imported in `main.tsx` for the page
 *   and in `pagination-v2/worker/fonts.ts` for the worker, with the same
 *   subsets and weights.
 *
 * Apple system families (Iowan Old Style, Seravek) come with iOS and macOS.
 * Elsewhere they fall back to a bundled family, in the page and the worker
 * alike.
 */

export const READING_FONT_IDS = [
  "lora",
  "iowan",
  "garamond",
  "monospace",
  "system",
  "seravek",
  "source-sans",
  "atkinson",
] as const;

export type FontFamily = (typeof READING_FONT_IDS)[number];

export interface ReadingFont {
  id: FontFamily;
  /** The name in Appearance → Type. */
  label: string;
  /** What the face is, in a few words. */
  description: string;
  /** The font-family list the worker measures and the page renders. */
  stack: string;
}

/**
 * Apple's WebKit resolves `system-ui` through Core Text in the page and in an
 * OffscreenCanvas alike, so San Francisco measures exactly (iOS 27 Safari:
 * identical widths at 14–24 px, regular to bold and italic). Chrome and
 * Firefox pick different optical sizes of San Francisco for a canvas and the
 * page (Pretext's PLATFORM_BUGS.md), so there System uses Source Sans.
 */
const SYSTEM_FONT_MEASURES_EXACTLY =
  typeof CSS !== "undefined" &&
  typeof CSS.supports === "function" &&
  CSS.supports("font", "-apple-system-body");

const SOURCE_SANS = '"Source Sans 3"';

export const READING_FONTS: readonly ReadingFont[] = [
  {
    id: "lora",
    label: "Lora",
    description: "A contemporary serif with calligraphic roots",
    stack: '"Lora", Georgia, serif',
  },
  {
    id: "iowan",
    label: "Iowan",
    description: "Apple Books’ old-style serif",
    stack: '"Iowan Old Style", "Palatino Linotype", serif',
  },
  {
    id: "garamond",
    label: "Garamond",
    description: "A Renaissance book face",
    stack: '"EB Garamond", Garamond, serif',
  },
  {
    id: "monospace",
    label: "Mono",
    description: "A typewriter face",
    stack: '"Courier New", Menlo, Monaco, monospace',
  },
  {
    id: "system",
    label: "System",
    description: SYSTEM_FONT_MEASURES_EXACTLY
      ? "San Francisco, the face of Apple’s own apps"
      : "Source Sans here; San Francisco on Apple devices",
    stack: SYSTEM_FONT_MEASURES_EXACTLY
      ? "system-ui, sans-serif"
      : `${SOURCE_SANS}, sans-serif`,
  },
  {
    id: "seravek",
    label: "Seravek",
    description: "Apple Books’ humanist sans",
    stack: `Seravek, ${SOURCE_SANS}, sans-serif`,
  },
  {
    id: "source-sans",
    label: "Source Sans",
    description: "Adobe’s open humanist sans, bundled",
    stack: `${SOURCE_SANS}, sans-serif`,
  },
  {
    id: "atkinson",
    label: "Atkinson",
    description: "Atkinson Hyperlegible Next, for the clearest letters",
    stack: '"Atkinson Hyperlegible Next", sans-serif',
  },
];

const READING_FONTS_BY_ID = new Map(
  READING_FONTS.map((font) => [font.id, font]),
);

export function isReadingFontId(value: unknown): value is FontFamily {
  return READING_FONTS_BY_ID.has(value as FontFamily);
}

export function getReadingFont(id: FontFamily): ReadingFont {
  return READING_FONTS_BY_ID.get(id)!;
}

/**
 * A saved font, or the nearest current one. Earlier builds offered Inter and
 * the generic families, which these replace.
 */
export function toReadingFontId(
  value: unknown,
  fallback: FontFamily,
): FontFamily {
  if (isReadingFontId(value)) return value;
  if (value === "inter" || value === "sans-serif") return "system";
  if (value === "serif") return "garamond";
  return fallback;
}
