import {
  ChapterSearchText,
  foldQuery,
  foldText,
} from "@/features/reader/search/search-text";
import { parseChapterHtmlWithCanonicalText } from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

function chapter(html: string) {
  const { canonicalText } = parseChapterHtmlWithCanonicalText(html);
  return new ChapterSearchText({
    fullText: canonicalText.fullText,
    blockStarts: [...canonicalText.blockStarts],
  });
}

function found(search: ChapterSearchText, query: string) {
  return search
    .search(foldQuery(query))
    .map((match) => search.chapter.fullText.slice(match.start, match.end));
}

describe("search folding", () => {
  it("ignores case, accents, ligatures and typographic punctuation", () => {
    expect(foldText("Naïve CAFÉ ﬁnds “don’t” — ok").text).toBe(
      'naive cafe finds "don\'t" - ok',
    );
  });

  it("treats a run of whitespace, and a soft hyphen, as nothing more", () => {
    expect(foldText("one \n\t two  para­graph").text).toBe("one two paragraph");
    expect(foldQuery("  Two   Paragraph ")).toBe("two paragraph");
  });
});

describe("chapter search", () => {
  const search = chapter(
    "<p>The <em>naïve</em> Café opened.</p>" +
      "<p>A second para­graph about a cafe, and another café.</p>" +
      "<p>Emoji 👍🏽 and éclair.</p>",
  );

  it("finds every match, across inline markup, with canonical offsets", () => {
    expect(found(search, "naive cafe")).toEqual(["naïve Café"]);
    expect(found(search, "CAFE")).toEqual(["Café", "cafe", "café"]);
    expect(found(search, "paragraph")).toEqual(["para­graph"]);
  });

  it("keeps whole code points and their marks", () => {
    expect(found(search, "eclair")).toEqual(["éclair"]);
    expect(found(search, "👍🏽")).toEqual(["👍🏽"]);
  });

  it("does not match from one paragraph into the next", () => {
    expect(found(search, "opened. a second")).toEqual([]);
  });

  it("names the block and quotes the match in its paragraph", () => {
    const [match] = search.search(foldQuery("another"));
    expect(match).toMatchObject({
      blockId: "text-2",
      snippet: {
        before: "A second paragraph about a cafe, and ",
        match: "another",
        after: " café.",
      },
    });
  });
});
