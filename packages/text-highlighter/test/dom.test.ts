/**
 * Tests for DOM manipulation functions
 */

import { describe, test, expect, beforeEach } from "vitest";
import {
  applyHighlight,
  applyHighlights,
  removeHighlight,
  removeHighlightById,
  wrapRangeWithHighlight,
} from "../src/dom";
import { findRangeByTextOffset } from "../src/offsets";
import type { TextHighlight } from "../src/types";

/**
 * Helper to create a DOM container from HTML string
 */
function createContainer(html: string): HTMLElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  return container;
}

/**
 * Helper to create a mock highlight
 */
function createMockHighlight(
  startOffset: number,
  endOffset: number,
  selectedText: string,
  id?: string,
): TextHighlight & { id?: string } {
  return {
    startOffset,
    endOffset,
    selectedText,
    textBefore: "",
    textAfter: "",
    ...(id && { id }),
  };
}

describe("wrapRangeWithHighlight", () => {
  test("wraps a simple text range", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 0, 5)!;

    wrapRangeWithHighlight(range, document, { tagName: "mark" });

    expect(container.innerHTML).toBe("<p><mark>Hello</mark> world</p>");
  });

  test("applies className to highlight element", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 0, 5)!;

    wrapRangeWithHighlight(range, document, {
      tagName: "mark",
      className: "highlight",
    });

    const mark = container.querySelector("mark");
    expect(mark?.className).toBe("highlight");
  });

  test("applies custom attributes", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 0, 5)!;

    wrapRangeWithHighlight(range, document, {
      attributes: {
        "data-highlight-id": "test-123",
        "data-color": "yellow",
      },
    });

    const mark = container.querySelector("mark");
    expect(mark?.getAttribute("data-highlight-id")).toBe("test-123");
    expect(mark?.getAttribute("data-color")).toBe("yellow");
  });

  test("creates multiple marks for selection spanning block elements", () => {
    const container = createContainer("<p>Hello</p><p>World</p>");
    const range = findRangeByTextOffset(container, 3, 8)!; // "loWor"

    wrapRangeWithHighlight(range, document);

    const marks = container.querySelectorAll("mark");
    expect(marks.length).toBe(2);
    expect(marks[0].textContent).toBe("lo");
    expect(marks[1].textContent).toBe("Wor");
  });

  test("handles selection within nested elements", () => {
    const container = createContainer("<p>Hello <b>bold</b> text</p>");
    const range = findRangeByTextOffset(container, 6, 10)!; // "bold"

    wrapRangeWithHighlight(range, document);

    const mark = container.querySelector("mark");
    expect(mark?.textContent).toBe("bold");
  });

  test("wraps partial text node at start", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 3, 8)!; // "lo wo"

    wrapRangeWithHighlight(range, document);

    expect(container.textContent).toBe("Hello world");
    expect(container.querySelector("mark")?.textContent).toBe("lo wo");
  });

  test("wraps partial text node at end", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 6, 9)!; // "wor"

    wrapRangeWithHighlight(range, document);

    expect(container.textContent).toBe("Hello world");
    expect(container.querySelector("mark")?.textContent).toBe("wor");
  });

  test("wraps only children selected by element boundaries", () => {
    const container = createContainer(
      "<p>Before <b>bold</b> middle <em>italic</em> after</p>",
    );
    const paragraph = container.querySelector("p")!;
    const range = document.createRange();
    range.setStart(paragraph, 1);
    range.setEnd(paragraph, 4);

    wrapRangeWithHighlight(range, document);

    expect(container.innerHTML).toBe(
      "<p>Before <b><mark>bold</mark></b><mark> middle </mark><em><mark>italic</mark></em> after</p>",
    );
  });

  test("preserves partial endpoints across nested elements and blocks", () => {
    const container = createContainer(
      "<p>Before <b>bold</b> text</p><p><em>italic</em> after</p>",
    );
    const range = document.createRange();
    range.setStart(container.querySelector("b")!.firstChild!, 2);
    range.setEnd(container.querySelector("em")!.firstChild!, 3);

    wrapRangeWithHighlight(range, document);

    expect(container.innerHTML).toBe(
      "<p>Before <b>bo<mark>ld</mark></b><mark> text</mark></p><p><em><mark>ita</mark>lic</em> after</p>",
    );
  });

  test("marks the first and last visible segments across whitespace", () => {
    const container = createContainer("<p>One</p> <p>Two</p> <p>Three</p>");
    const range = document.createRange();
    range.selectNodeContents(container);

    wrapRangeWithHighlight(range, document, {
      segmentBoundaryAttributes: { start: "data-start", end: "data-end" },
    });

    expect(container.innerHTML).toBe(
      '<p><mark data-start="true">One</mark></p> <p><mark>Two</mark></p> <p><mark data-end="true">Three</mark></p>',
    );
  });

  test("uses custom tag name", () => {
    const container = createContainer("<p>Hello world</p>");
    const range = findRangeByTextOffset(container, 0, 5)!;

    wrapRangeWithHighlight(range, document, { tagName: "span" });

    expect(container.querySelector("span")).not.toBeNull();
    expect(container.querySelector("mark")).toBeNull();
  });
});

describe("applyHighlight", () => {
  test("applies highlight using offsets", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlight = createMockHighlight(0, 5, "Hello");

    const result = applyHighlight(container, highlight);

    expect(result).toBe(true);
    expect(container.querySelector("mark")?.textContent).toBe("Hello");
  });

  test("returns false for mismatched text", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlight = createMockHighlight(0, 5, "Goodbye");

    const result = applyHighlight(container, highlight);

    expect(result).toBe(false);
    expect(container.querySelector("mark")).toBeNull();
  });

  test("returns false for invalid offsets", () => {
    const container = createContainer("<p>Hello</p>");
    const highlight = createMockHighlight(100, 200, "text");

    const result = applyHighlight(container, highlight);

    expect(result).toBe(false);
  });

  test("applies custom options", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlight = createMockHighlight(0, 5, "Hello");

    applyHighlight(container, highlight, {
      className: "my-highlight",
      attributes: { "data-id": "123" },
    });

    const mark = container.querySelector("mark");
    expect(mark?.className).toBe("my-highlight");
    expect(mark?.getAttribute("data-id")).toBe("123");
  });
});

describe("applyHighlights", () => {
  test("applies multiple highlights", () => {
    const container = createContainer("<p>Hello world foo bar</p>");
    const highlights = [
      createMockHighlight(0, 5, "Hello", "h1"),
      createMockHighlight(12, 15, "foo", "h2"),
    ];

    const applied = applyHighlights(container, highlights);

    expect(applied).toEqual(["h1", "h2"]);
    expect(container.querySelectorAll("mark").length).toBe(2);
  });

  test("sorts highlights by start offset", () => {
    const container = createContainer("<p>Hello world foo bar</p>");
    // Provide in reverse order
    const highlights = [
      createMockHighlight(12, 15, "foo", "h2"),
      createMockHighlight(0, 5, "Hello", "h1"),
    ];

    const applied = applyHighlights(container, highlights);

    // Both should be applied successfully
    expect(applied).toEqual(["h1", "h2"]);
  });

  test("adds data-highlight-id attribute when id is provided", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlights = [createMockHighlight(0, 5, "Hello", "my-id")];

    applyHighlights(container, highlights);

    const mark = container.querySelector("mark");
    expect(mark?.getAttribute("data-highlight-id")).toBe("my-id");
  });

  test("returns only successfully applied highlight IDs", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlights = [
      createMockHighlight(0, 5, "Hello", "h1"),
      createMockHighlight(0, 5, "Wrong", "h2"), // Wrong text
    ];

    const applied = applyHighlights(container, highlights);

    expect(applied).toEqual(["h1"]);
  });
});

describe("removeHighlight", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = createContainer("<p>Hello world</p>");
    const highlight = createMockHighlight(0, 5, "Hello");
    applyHighlight(container, highlight, {
      attributes: { "data-highlight-id": "test-id" },
    });
  });

  test("removes highlight by selector", () => {
    expect(container.querySelector("mark")).not.toBeNull();

    removeHighlight(container, '[data-highlight-id="test-id"]');

    expect(container.querySelector("mark")).toBeNull();
    expect(container.textContent).toBe("Hello world");
  });

  test("preserves text content after removal", () => {
    const textBefore = container.textContent;

    removeHighlight(container, '[data-highlight-id="test-id"]');

    expect(container.textContent).toBe(textBefore);
  });

  test("normalizes text nodes after removal", () => {
    removeHighlight(container, '[data-highlight-id="test-id"]');

    // Text nodes should be merged
    const p = container.querySelector("p")!;
    expect(p.childNodes.length).toBe(1);
    expect(p.firstChild?.nodeType).toBe(Node.TEXT_NODE);
  });

  test("handles non-existent selector gracefully", () => {
    expect(() => {
      removeHighlight(container, '[data-highlight-id="non-existent"]');
    }).not.toThrow();
  });
});

describe("removeHighlightById", () => {
  test("removes highlight by ID", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlights = [createMockHighlight(0, 5, "Hello", "my-id")];
    applyHighlights(container, highlights);

    expect(container.querySelector("mark")).not.toBeNull();

    removeHighlightById(container, "my-id");

    expect(container.querySelector("mark")).toBeNull();
  });
});

describe("highlight removal restores original structure", () => {
  test("simple highlight removal", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlight = createMockHighlight(0, 5, "Hello", "test");
    applyHighlights(container, [highlight]);

    removeHighlightById(container, "test");

    expect(container.innerHTML).toBe("<p>Hello world</p>");
  });

  test("multiple highlight removal", () => {
    const container = createContainer("<p>Hello world</p>");
    const highlights = [
      createMockHighlight(0, 5, "Hello", "h1"),
      createMockHighlight(6, 11, "world", "h2"),
    ];
    applyHighlights(container, highlights);

    removeHighlightById(container, "h1");
    removeHighlightById(container, "h2");

    expect(container.textContent).toBe("Hello world");
    expect(container.querySelectorAll("mark").length).toBe(0);
  });

  test("removes multi-mark highlight (spanning blocks)", () => {
    const container = createContainer("<p>Hello</p><p>World</p>");
    const highlight = createMockHighlight(3, 8, "loWor", "test");
    applyHighlights(container, [highlight]);

    // Should have 2 marks
    expect(container.querySelectorAll("mark").length).toBe(2);

    removeHighlightById(container, "test");

    expect(container.querySelectorAll("mark").length).toBe(0);
    expect(container.textContent).toBe("HelloWorld");
  });
});
