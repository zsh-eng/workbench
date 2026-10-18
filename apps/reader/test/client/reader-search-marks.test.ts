import {
  alignSlice,
  collectSearchRanges,
} from "@/features/reader/search/search-marks";
import { describe, expect, it } from "vitest";

/** A text slice as the page draws it: lines joined by line breaks. */
function slice(lines: string[]): HTMLElement {
  const element = document.createElement("p");
  element.dataset.readerBlockId = "text-1";
  element.dataset.readerPageSlice = "0";
  element.dataset.readerSliceType = "text";
  element.innerHTML = lines
    .map((line) => `<span style="white-space: nowrap">${line}</span>`)
    .join("<br>");
  document.body.append(element);
  return element;
}

function text(range: Range | null) {
  return range?.toString() ?? null;
}

describe("search marks", () => {
  it("places a canonical range across inline markup and line wraps", () => {
    const blockText = "The Rabbit actually  took a watch out of its pocket.";
    const element = slice([
      "The Rabbit actually <em>took a</em>",
      "<em>watch</em> out of its pocket.",
    ]);
    const aligned = alignSlice(element, blockText, 100, false)!;
    expect(aligned).toMatchObject({ start: 100, end: 100 + blockText.length });
    const start = 100 + blockText.indexOf("took");
    const range = aligned.rangeFor(start, start + "took a  watch".length);
    // The page has no space where the line wraps.
    expect(text(range)).toBe("took awatch");
    expect(range?.startContainer.parentElement?.tagName).toBe("EM");
    element.remove();
  });

  it("skips the hyphen the page adds at a soft-hyphen break", () => {
    const blockText = "An extra­ordinary thing, and nothing else.";
    const element = slice([
      "An extra-",
      "ordinary thing, and",
      "nothing else.",
    ]);
    const aligned = alignSlice(element, blockText, 0, false)!;
    const start = blockText.indexOf("extra");
    const end = blockText.indexOf(" thing");
    expect(text(aligned.rangeFor(start, end))).toBe("extra-ordinary");
    element.remove();
  });

  it("finds where the end of a paragraph from the page before starts", () => {
    const blockText = "One two three. Four five six. One two three.";
    // The page starts mid-paragraph; its text also starts the paragraph.
    const element = slice(["One two three."]);
    const aligned = alignSlice(element, blockText, 10, true)!;
    expect(aligned.start).toBe(10 + blockText.lastIndexOf("One"));
    expect(text(aligned.rangeFor(aligned.start, aligned.start + 3))).toBe(
      "One",
    );
    element.remove();
  });

  it("matches text with combining marks and astral characters", () => {
    const blockText = "Café and the 🦞 quadrille";
    const element = slice(["Café and the 🦞", "quadrille"]);
    const aligned = alignSlice(element, blockText, 0, false)!;
    expect(text(aligned.rangeFor(0, 5))).toBe("Café");
    const lobster = blockText.indexOf("🦞");
    expect(text(aligned.rangeFor(lobster, lobster + 2))).toBe("🦞");
    element.remove();
  });

  it("collects ranges for the matches on each page, the active one apart", () => {
    const stage = document.createElement("div");
    const page = document.createElement("div");
    page.dataset.readerChapterIndex = "3";
    stage.append(page);
    const content = document.createElement("div");
    content.setAttribute("data-reader-page-content", "");
    page.append(content);
    document.body.append(stage);
    const element = slice(["Alice was beginning to get very tired"]);
    content.append(element);
    const fullText = "Chapter I. Alice was beginning to get very tired";
    const blockStart = fullText.indexOf("Alice");
    const ranges = collectSearchRanges(
      stage,
      {
        getChapterText: (chapterIndex) =>
          chapterIndex === 3
            ? {
                fullText,
                blockRanges: new Map([
                  ["text-1", { start: blockStart, end: fullText.length }],
                ]),
              }
            : null,
        matchesFor: (chapterIndex, blockId) =>
          chapterIndex === 3 && blockId === "text-1"
            ? [
                { id: "a", start: blockStart, end: blockStart + 5 },
                {
                  id: "b",
                  start: fullText.indexOf("tired"),
                  end: fullText.length,
                },
              ]
            : [],
      },
      "b",
    );
    expect(ranges.all.map((range) => range.toString())).toEqual(["Alice"]);
    expect(ranges.active.map((range) => range.toString())).toEqual(["tired"]);
    stage.remove();
  });
});
