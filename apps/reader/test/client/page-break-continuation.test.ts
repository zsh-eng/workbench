import { describe, expect, it } from "vitest";
import {
  findPageBreakContinuation,
  type PageTextBounds,
  type TextBlockRange,
} from "@/features/reader/scroll/page-break-continuation";

/** Paragraphs joined as canonical text keeps them: source whitespace between. */
function chapter(...paragraphs: string[]) {
  let fullText = "";
  const blocks: TextBlockRange[] = [];
  paragraphs.forEach((paragraph, index) => {
    const start = fullText.length;
    fullText += paragraph + "\n  ";
    blocks.push({ blockId: `b${index}`, start, end: fullText.length });
  });
  return { fullText, blocks };
}

const at = (fullText: string, text: string, after = 0) => {
  const index = fullText.indexOf(text, after);
  if (index < 0) throw new Error(`No "${text}"`);
  return index;
};

/** A page that ends just after `endText` and starts at `startText`. */
function page(
  fullText: string,
  startText: string,
  endText: string,
  lineChars = 30,
): PageTextBounds {
  const start = at(fullText, startText);
  const end = at(fullText, endText) + endText.length;
  return {
    start,
    end,
    firstLineEnd: start + lineChars,
    lastLineStart: end - lineChars,
  };
}

describe("findPageBreakContinuation", () => {
  const { fullText, blocks } = chapter(
    "The merchant spoke softly. I was prosperous, but I was also a man who had lost his way, and the gate stood open before me.",
    "A new paragraph begins here. It has two sentences.",
  );

  it("finishes the sentence the page break cuts", () => {
    const bounds = page(fullText, "The merchant", "I was prosperous, but");
    const selection = {
      start: at(fullText, "I was prosperous"),
      end: bounds.end,
    };
    const result = findPageBreakContinuation({
      fullText,
      blocks,
      selection,
      page: bounds,
      edge: "end",
    })!;
    expect(fullText.slice(result.start, result.end)).toBe(
      "I was prosperous, but I was also a man who had lost his way, and the gate stood open before me.",
    );
    expect(result.beyond).toBe(
      "I was also a man who had lost his way, and the gate stood open before me.",
    );
    expect(result.preview).toBe("I was also a man");
    expect(result.previewTruncated).toBe(true);
  });

  it("stops at the paragraph when the next page starts a new one", () => {
    const bounds = page(fullText, "The merchant", "stood open before me.");
    const selection = {
      start: at(fullText, "and the gate"),
      end: bounds.end,
    };
    const result = findPageBreakContinuation({
      fullText,
      blocks,
      selection,
      page: bounds,
      edge: "end",
    })!;
    // Run to the page's last character: the next sentence comes along.
    expect(result.beyond).toBe("A new paragraph begins here.");
    expect(result.end).toBe(
      at(fullText, "begins here.") + "begins here.".length,
    );
  });

  it("offers nothing for a selection clear of the last line", () => {
    const bounds = page(fullText, "The merchant", "I was prosperous, but");
    const selection = {
      start: at(fullText, "The merchant"),
      end: at(fullText, "spoke"),
    };
    expect(
      findPageBreakContinuation({
        fullText,
        blocks,
        selection,
        page: { ...bounds, lastLineStart: bounds.end - 4 },
        edge: "end",
      }),
    ).toBeNull();
  });

  it("offers nothing when the selection's sentence ends on this page", () => {
    // The last line holds "...spoke softly. I was prosperous, but"; the
    // selection ends after "softly." and the cut sentence comes later.
    const bounds = page(fullText, "The merchant", "I was prosperous, but", 60);
    const selection = {
      start: at(fullText, "The merchant"),
      end: at(fullText, "softly.") + "softly.".length,
    };
    expect(
      findPageBreakContinuation({
        fullText,
        blocks,
        selection,
        page: bounds,
        edge: "end",
      }),
    ).toBeNull();
  });

  it("reaches back to where the sentence starts on the previous page", () => {
    const pageStart = at(fullText, "I was also a man");
    const bounds: PageTextBounds = {
      start: pageStart,
      end: fullText.length,
      firstLineEnd: pageStart + 30,
      lastLineStart: fullText.length - 30,
    };
    const selection = {
      start: pageStart,
      end: at(fullText, "his way") + "his way".length,
    };
    const result = findPageBreakContinuation({
      fullText,
      blocks,
      selection,
      page: bounds,
      edge: "start",
    })!;
    expect(fullText.slice(result.start, result.end)).toBe(
      "I was prosperous, but I was also a man who had lost his way",
    );
    expect(result.beyond).toBe("I was prosperous, but");
    // The words nearest the break.
    expect(result.preview).toBe("I was prosperous, but");
    expect(result.previewTruncated).toBe(false);
  });

  it("offers nothing at the end of the chapter", () => {
    const bounds = page(fullText, "The merchant", "It has two sentences.");
    const selection = { start: at(fullText, "It has"), end: bounds.end };
    expect(
      findPageBreakContinuation({
        fullText,
        blocks,
        selection,
        page: bounds,
        edge: "end",
      }),
    ).toBeNull();
  });
});
