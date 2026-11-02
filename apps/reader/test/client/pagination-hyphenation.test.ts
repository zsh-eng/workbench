import {
  ensureHyphenPoints,
  getHyphenPoints,
  resolveHyphenationPatterns,
} from "@/lib/pagination-v2/shared/hyphenation";
import { beforeAll, describe, expect, it } from "vitest";

/** A word with its hyphen points, as `hy-phen-ation`. */
function marked(word: string, language: string): string {
  const points = getHyphenPoints(language)!(word);
  const graphemes = Array.from(word);
  return graphemes
    .map((grapheme, index) =>
      points.includes(index) ? `-${grapheme}` : grapheme,
    )
    .join("");
}

describe("the book's language", () => {
  it.each([
    ["en", "en-us"],
    ["en-US", "en-us"],
    ["en-GB", "en-gb"],
    ["en_AU", "en-gb"],
    ["eng", "en-us"],
    ["de-DE", "de-1996"],
    ["ger", "de-1996"],
    ["fr-CA", "fr"],
    ["pt-BR", "pt"],
    ["no", "nb"],
    ["el", "el-monoton"],
  ])("%s uses the %s patterns", (language, patterns) => {
    expect(resolveHyphenationPatterns(language)).toBe(patterns);
  });

  it.each([undefined, "", "und", "zh-CN", "ja"])(
    "%s has no patterns, so a book justifies without hyphens",
    async (language) => {
      expect(resolveHyphenationPatterns(language)).toBeNull();
      await ensureHyphenPoints(language);
      expect(getHyphenPoints(language)).toBeNull();
    },
  );
});

describe("hyphen points", () => {
  beforeAll(() =>
    Promise.all([ensureHyphenPoints("en"), ensureHyphenPoints("de")]),
  );

  it("are the patterns' breaks, two letters in and three from the end", () => {
    expect(marked("hyphenation", "en")).toBe("hy-phen-ation");
    // The patterns also allow "togeth-er".
    expect(marked("together", "en")).toBe("to-gether");
  });

  it("count only letters, so a word keeps its punctuation", () => {
    const quoted = "“hyphenation,”";
    expect(getHyphenPoints("en")!(quoted)).toEqual([3, 7]);
  });

  it("count graphemes, so a combining mark stays with its letter", () => {
    const composed = "pre\u0301sentation";
    const points = getHyphenPoints("fr") ?? getHyphenPoints("en")!;
    for (const point of points(composed)) {
      expect(Array.from(composed)[point]).not.toBe("\u0301");
    }
  });

  it("leave short words, names and acronyms whole", () => {
    const points = getHyphenPoints("en")!;
    expect(points("table")).toEqual([]);
    expect(points("Hyphenation")).toEqual([]);
    expect(points("HYPHENATION")).toEqual([]);
  });

  it("break German's capitalised nouns", () => {
    expect(getHyphenPoints("de")!("Silbentrennung").length).toBeGreaterThan(0);
    expect(getHyphenPoints("de")!("SILBENTRENNUNG")).toEqual([]);
  });
});
