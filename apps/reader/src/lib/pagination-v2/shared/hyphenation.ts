import { countGraphemes } from "./measure";

/**
 * Where a word may take a hyphen. Liang's TeX patterns, through the `hyphen`
 * package, run in the pagination worker. They load with the book, one
 * language at a time, before layout (see `waitForCommandFonts`), so a page
 * never reflows when they arrive. The build precaches them, so they work
 * offline. A book in another language is justified without hyphens.
 */

const SOFT_HYPHEN = "­";
/** TeX's \lefthyphenmin and \righthyphenmin, and no word shorter than six. */
const MIN_WORD_GRAPHEMES = 6;
const MIN_LEFT_GRAPHEMES = 2;
const MIN_RIGHT_GRAPHEMES = 3;
const WORD_RUN = /\p{L}[\p{L}\p{M}]*/gu;
const UNCASED_NOUNS_LANGUAGE = /^de/;
const NO_POINTS: readonly number[] = [];

type PatternsModule = Promise<{ default: unknown }>;

const PATTERNS: Record<string, () => PatternsModule> = {
  ca: () => import("hyphen/patterns/ca.js"),
  cs: () => import("hyphen/patterns/cs.js"),
  da: () => import("hyphen/patterns/da.js"),
  "de-1996": () => import("hyphen/patterns/de-1996.js"),
  "el-monoton": () => import("hyphen/patterns/el-monoton.js"),
  "en-gb": () => import("hyphen/patterns/en-gb.js"),
  "en-us": () => import("hyphen/patterns/en-us.js"),
  es: () => import("hyphen/patterns/es.js"),
  fi: () => import("hyphen/patterns/fi.js"),
  fr: () => import("hyphen/patterns/fr.js"),
  hr: () => import("hyphen/patterns/hr.js"),
  hu: () => import("hyphen/patterns/hu.js"),
  it: () => import("hyphen/patterns/it.js"),
  la: () => import("hyphen/patterns/la.js"),
  nb: () => import("hyphen/patterns/nb.js"),
  nl: () => import("hyphen/patterns/nl.js"),
  nn: () => import("hyphen/patterns/nn.js"),
  pl: () => import("hyphen/patterns/pl.js"),
  pt: () => import("hyphen/patterns/pt.js"),
  ro: () => import("hyphen/patterns/ro.js"),
  ru: () => import("hyphen/patterns/ru.js"),
  sk: () => import("hyphen/patterns/sk.js"),
  sl: () => import("hyphen/patterns/sl.js"),
  sv: () => import("hyphen/patterns/sv.js"),
  tr: () => import("hyphen/patterns/tr.js"),
  uk: () => import("hyphen/patterns/uk.js"),
};

/** The ISO 639-2 codes an EPUB's `dc:language` sometimes uses instead. */
const THREE_LETTER_LANGUAGES: Record<string, string> = {
  cat: "ca",
  ces: "cs",
  cze: "cs",
  dan: "da",
  deu: "de",
  dut: "nl",
  ell: "el",
  eng: "en",
  fin: "fi",
  fra: "fr",
  fre: "fr",
  ger: "de",
  gre: "el",
  hrv: "hr",
  hun: "hu",
  ita: "it",
  lat: "la",
  nld: "nl",
  nno: "nn",
  nob: "nb",
  nor: "nb",
  pol: "pl",
  por: "pt",
  ron: "ro",
  rum: "ro",
  rus: "ru",
  slk: "sk",
  slo: "sk",
  slv: "sl",
  spa: "es",
  swe: "sv",
  tur: "tr",
  ukr: "uk",
};

const LANGUAGE_PATTERNS: Record<string, string> = {
  de: "de-1996",
  el: "el-monoton",
  no: "nb",
};

/** English regions that spell as Britain does. */
const BRITISH_ENGLISH_REGIONS = new Set([
  "au",
  "gb",
  "ie",
  "in",
  "nz",
  "sg",
  "uk",
  "za",
]);

/** The pattern file for a book's language tag, if there is one. */
export function resolveHyphenationPatterns(
  language: string | undefined,
): string | null {
  if (!language) return null;
  const [primary = "", ...subtags] = language
    .trim()
    .toLowerCase()
    .replaceAll("_", "-")
    .split("-");
  const base = THREE_LETTER_LANGUAGES[primary] ?? primary;
  if (base === "en") {
    return subtags.some((subtag) => BRITISH_ENGLISH_REGIONS.has(subtag))
      ? "en-gb"
      : "en-us";
  }
  const name = LANGUAGE_PATTERNS[base] ?? base;
  return Object.hasOwn(PATTERNS, name) ? name : null;
}

/** The grapheme indices in a text segment where a line may end in a hyphen. */
export type HyphenPoints = (segment: string) => readonly number[];

const loaded = new Map<string, HyphenPoints>();
const loading = new Map<string, Promise<void>>();

function createHyphenPoints(
  name: string,
  hyphenate: (word: string) => string,
): HyphenPoints {
  const hyphenatesCapitals = UNCASED_NOUNS_LANGUAGE.test(name);
  const bySegment = new Map<string, readonly number[]>();

  function find(segment: string): readonly number[] {
    let points: number[] | null = null;
    for (const match of segment.matchAll(WORD_RUN)) {
      const word = match[0];
      if (word.length < MIN_WORD_GRAPHEMES) continue;
      // Book typesetters leave names and acronyms whole. German capitalises
      // every noun, so there only an all-capitals word stays whole.
      if (
        hyphenatesCapitals
          ? word === word.toLocaleUpperCase()
          : word !== word.toLocaleLowerCase()
      ) {
        continue;
      }

      const wordGraphemes = countGraphemes(word);
      if (wordGraphemes < MIN_WORD_GRAPHEMES) continue;
      const parts = hyphenate(word).split(SOFT_HYPHEN);
      let offset = 0;
      for (const part of parts.slice(0, -1)) {
        offset += part.length;
        const left = countGraphemes(word.slice(0, offset));
        if (
          left >= MIN_LEFT_GRAPHEMES &&
          wordGraphemes - left >= MIN_RIGHT_GRAPHEMES
        ) {
          (points ??= []).push(
            countGraphemes(segment.slice(0, match.index + offset)),
          );
        }
      }
    }
    return points ?? NO_POINTS;
  }

  return (segment) => {
    if (segment.length < MIN_WORD_GRAPHEMES) return NO_POINTS;
    let points = bySegment.get(segment);
    if (points === undefined) {
      points = find(segment);
      bySegment.set(segment, points);
    }
    return points;
  };
}

/**
 * Loads a language's patterns, for `getHyphenPoints`. Without them a book is
 * justified without hyphens, so a failed load only logs.
 */
export function ensureHyphenPoints(
  language: string | undefined,
): Promise<void> {
  const name = resolveHyphenationPatterns(language);
  if (!name || loaded.has(name)) return Promise.resolve();

  let pending = loading.get(name);
  if (!pending) {
    pending = Promise.all([import("hyphen/hyphen.js"), PATTERNS[name]!()])
      .then(([{ default: createHyphenator }, { default: patterns }]) => {
        loaded.set(
          name,
          createHyphenPoints(
            name,
            createHyphenator(patterns, {
              html: false,
              hyphenChar: SOFT_HYPHEN,
              minWordLength: MIN_WORD_GRAPHEMES,
            }),
          ),
        );
      })
      .catch((error: unknown) => {
        console.warn("[pagination] Failed to load hyphenation", name, error);
      })
      .finally(() => loading.delete(name));
    loading.set(name, pending);
  }
  return pending;
}

/** A loaded language's hyphen points; null until `ensureHyphenPoints` ends. */
export function getHyphenPoints(
  language: string | undefined,
): HyphenPoints | null {
  const name = resolveHyphenationPatterns(language);
  return name ? (loaded.get(name) ?? null) : null;
}
