import atkinsonExt400CssText from "@fontsource/atkinson-hyperlegible-next/latin-ext-400.css?inline";
import atkinsonExt400ItalicCssText from "@fontsource/atkinson-hyperlegible-next/latin-ext-400-italic.css?inline";
import atkinsonExt600CssText from "@fontsource/atkinson-hyperlegible-next/latin-ext-600.css?inline";
import atkinsonExt700CssText from "@fontsource/atkinson-hyperlegible-next/latin-ext-700.css?inline";
import atkinson400CssText from "@fontsource/atkinson-hyperlegible-next/latin-400.css?inline";
import atkinson400ItalicCssText from "@fontsource/atkinson-hyperlegible-next/latin-400-italic.css?inline";
import atkinson600CssText from "@fontsource/atkinson-hyperlegible-next/latin-600.css?inline";
import atkinson700CssText from "@fontsource/atkinson-hyperlegible-next/latin-700.css?inline";
import ebGaramond400CssText from "@fontsource/eb-garamond/400.css?inline";
import ebGaramond400ItalicCssText from "@fontsource/eb-garamond/400-italic.css?inline";
import ebGaramond500CssText from "@fontsource/eb-garamond/500.css?inline";
import ebGaramond600CssText from "@fontsource/eb-garamond/600.css?inline";
import lora400CssText from "@fontsource/lora/400.css?inline";
import lora400ItalicCssText from "@fontsource/lora/400-italic.css?inline";
import lora500CssText from "@fontsource/lora/500.css?inline";
import lora600CssText from "@fontsource/lora/600.css?inline";
import sourceSansExt400CssText from "@fontsource/source-sans-3/latin-ext-400.css?inline";
import sourceSansExt400ItalicCssText from "@fontsource/source-sans-3/latin-ext-400-italic.css?inline";
import sourceSansExt600CssText from "@fontsource/source-sans-3/latin-ext-600.css?inline";
import sourceSansExt700CssText from "@fontsource/source-sans-3/latin-ext-700.css?inline";
import sourceSans400CssText from "@fontsource/source-sans-3/latin-400.css?inline";
import sourceSans400ItalicCssText from "@fontsource/source-sans-3/latin-400-italic.css?inline";
import sourceSans600CssText from "@fontsource/source-sans-3/latin-600.css?inline";
import sourceSans700CssText from "@fontsource/source-sans-3/latin-700.css?inline";
import {
  parseFontFaceRules,
  stripCssQuotes,
  type ParsedFontFaceRule,
} from "../shared/font-face-parser";

/**
 * Bundled reading fonts by CSS family name: the same stylesheets the page
 * imports in `main.tsx`, so the worker measures the faces the page draws.
 *
 * We bundle the processed CSS text into the worker on purpose. Using `?url`
 * forced the worker to fetch mode-specific payloads: preview served raw CSS,
 * while Vite dev served a JS wrapper around the CSS. `?inline` gives us the
 * same final stylesheet text in both modes, so the worker registers fonts
 * from one consistent representation.
 */
const BUNDLED_FONT_STYLESHEETS: Record<string, readonly string[]> = {
  "EB Garamond": [
    ebGaramond400CssText,
    ebGaramond500CssText,
    ebGaramond600CssText,
    ebGaramond400ItalicCssText,
  ],
  Lora: [lora400CssText, lora500CssText, lora600CssText, lora400ItalicCssText],
  "Source Sans 3": [
    sourceSansExt400CssText,
    sourceSans400CssText,
    sourceSansExt400ItalicCssText,
    sourceSans400ItalicCssText,
    sourceSansExt600CssText,
    sourceSans600CssText,
    sourceSansExt700CssText,
    sourceSans700CssText,
  ],
  "Atkinson Hyperlegible Next": [
    atkinsonExt400CssText,
    atkinson400CssText,
    atkinsonExt400ItalicCssText,
    atkinson400ItalicCssText,
    atkinsonExt600CssText,
    atkinson600CssText,
    atkinsonExt700CssText,
    atkinson700CssText,
  ],
};

let bundledFontRules: Map<string, ParsedFontFaceRule[]> | null = null;
const familyLoads = new Map<string, Promise<void>>();

/** Parses the bundled stylesheets once; nothing downloads until a family loads. */
function getBundledFontRules(): Map<string, ParsedFontFaceRule[]> {
  if (bundledFontRules) return bundledFontRules;

  bundledFontRules = new Map();
  for (const [family, stylesheets] of Object.entries(
    BUNDLED_FONT_STYLESHEETS,
  )) {
    const rules: ParsedFontFaceRule[] = [];
    for (const cssText of stylesheets) {
      try {
        rules.push(...parseFontFaceRules(cssText, import.meta.url));
      } catch (error) {
        console.warn("[pagination worker] Failed to parse font stylesheet", {
          family,
          error,
        });
      }
    }
    bundledFontRules.set(family, rules);
  }
  return bundledFontRules;
}

/** The family names in a CSS font-family list, unquoted. */
export function parseFontFamilyList(fontFamilyList: string): string[] {
  return fontFamilyList
    .split(",")
    .map((name) => stripCssQuotes(name.trim()))
    .filter((name) => name.length > 0);
}

function loadBundledFamily(
  family: string,
  rules: readonly ParsedFontFaceRule[],
): Promise<void> {
  const existing = familyLoads.get(family);
  if (existing) return existing;

  const load = (async () => {
    const scope = globalThis as WorkerGlobalScope & { fonts?: FontFaceSet };
    const fontFaceSet = scope.fonts;
    if (!fontFaceSet || typeof FontFace === "undefined") return;

    const queries = new Set<string>();
    for (const rule of rules) {
      // Add each face before it loads: Safari keeps a canvas on its fallback
      // for a face that loaded before it joined the set.
      fontFaceSet.add(new FontFace(rule.family, rule.src, rule.descriptors));
      queries.add(
        `${rule.descriptors.style ?? "normal"} ${rule.descriptors.weight ?? "400"} 16px "${rule.family}"`,
      );
    }
    // The default sample text loads each face's Latin subset, which body
    // text needs first; other subsets load when text uses them.
    await Promise.all([...queries].map((query) => fontFaceSet.load(query)));
  })().catch((error) => {
    console.warn("[pagination worker] Falling back to system fonts", {
      family,
      error,
    });
  });

  familyLoads.set(family, load);
  return load;
}

/**
 * Loads the bundled families named in font-family lists, such as the reading
 * font's, before text in them is measured. System and generic families need
 * no loading. Each family loads once per worker, so only the fonts in use
 * leave CacheStorage.
 */
export function ensureBundledFontsReady(
  fontFamilyLists: readonly string[],
): Promise<void> {
  const rulesByFamily = getBundledFontRules();
  const families = new Set(fontFamilyLists.flatMap(parseFontFamilyList));
  return Promise.all(
    [...families].flatMap((family) => {
      const rules = rulesByFamily.get(family);
      return rules ? [loadBundledFamily(family, rules)] : [];
    }),
  ).then(() => {});
}
