import {
  PageFurniture,
  PageFurnitureProvider,
} from "@/features/reader/PageFurniture";
import type { Book } from "@/lib/db";
import type { ResolvedSpread } from "@/lib/pagination-v2/types";
import { cleanup, render } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

const BOOK = {
  title: "The Book",
  spine: [{ idref: "one" }, { idref: "unlisted" }],
  manifest: [
    { id: "one", href: "one.xhtml" },
    { id: "unlisted", href: "unlisted.xhtml" },
  ],
  toc: [{ id: "toc-1", label: "One", href: "one.xhtml", children: [] }],
} as unknown as Book;

const TEXT = {
  type: "text",
  blockId: "b",
  tag: "p",
  lineHeight: 24,
  textAlign: "left",
  renderMode: "native",
  lines: [],
};

function page(
  currentPage: number,
  currentPageInChapter: number,
  options: { chapterIndex?: number; content?: unknown[] } = {},
) {
  return {
    currentPage,
    totalPages: 100,
    currentPageInChapter,
    totalPagesInChapter: 10,
    chapterIndex: options.chapterIndex ?? 0,
    content: options.content ?? [TEXT],
  };
}

function spreadOf(...pages: (ReturnType<typeof page> | null)[]) {
  return {
    slots: pages.map((content, slotIndex) =>
      content
        ? { kind: "page", slotIndex, page: content }
        : { kind: "gap", slotIndex },
    ),
  } as unknown as ResolvedSpread;
}

function renderFurniture(
  spread: ResolvedSpread,
  {
    isTablet = false,
    showTitles = true,
    showNumbers = true,
    numbersReady = true,
    provided = true,
  } = {},
) {
  const furniture = createElement(PageFurniture, {
    spread,
    columns: spread.slots.length,
    columnGapPx: 40,
    paddingTopPx: 56,
    paddingLeftPx: 24,
    paddingRightPx: 24,
    textHeightPx: 500,
    fontFamily: "serif",
    fontSizePx: 18,
    lineHeightPx: 26,
  });
  const { container } = render(
    provided
      ? createElement(
          PageFurnitureProvider,
          { book: BOOK, isTablet, showTitles, showNumbers, numbersReady },
          furniture,
        )
      : furniture,
  );
  const head = container.querySelector<HTMLElement>(".reader-running-heads");
  const foot = container.querySelector<HTMLElement>(".reader-folios");
  const textsOf = (row: Element | null, selector: string) =>
    row
      ? [...row.querySelectorAll(selector)].map(
          (element) => element.textContent,
        )
      : null;
  return {
    container,
    head,
    foot,
    titles: textsOf(head, "p"),
    /** Each page's number on the title row, from its outer corner. */
    headNumbers: head
      ? [...head.children].map((cell, index) =>
          index === 0
            ? cell.firstElementChild!.textContent
            : cell.lastElementChild!.textContent,
        )
      : null,
    footNumbers: textsOf(foot, "p"),
  };
}

afterEach(cleanup);

describe("a page's running title and number", () => {
  it("on a computer, title the left page with the book and the right with the chapter, and number them below", () => {
    const { titles, headNumbers, footNumbers } = renderFurniture(
      spreadOf(page(12, 4), page(13, 5)),
    );
    expect(titles).toEqual(["The Book", "One"]);
    expect(headNumbers).toEqual(["", ""]);
    expect(footNumbers).toEqual(["12", "13"]);
  });

  it("on a tablet, number two pages at the outer corners on the titles' line", () => {
    const { titles, headNumbers, foot } = renderFurniture(
      spreadOf(page(12, 4), page(13, 5)),
      { isTablet: true },
    );
    expect(titles).toEqual(["The Book", "One"]);
    expect(headNumbers).toEqual(["12", "13"]);
    expect(foot).toBeNull();
  });

  it("give one page its number at the foot and no title", () => {
    const { head, footNumbers } = renderFurniture(spreadOf(page(12, 4)), {
      isTablet: true,
    });
    expect(head).toBeNull();
    expect(footNumbers).toEqual(["12"]);
  });

  it("set titles in small capitals and numbers to their height, in the text's ink", () => {
    const { head, foot } = renderFurniture(spreadOf(page(12, 4), page(13, 5)));
    const title = head!.querySelector("p")!;
    const number = foot!.querySelector("span")!;
    expect(title.className).toContain("all-small-caps");
    expect(number.style.fontSize).toBe("13px");
    expect(head!.className).toContain("text-foreground");
    // Half a line clear of the text: above its first line, below its last.
    expect(head!.style.top).toBe(`${56 - 13 - 26}px`);
    expect(foot!.style.top).toBe(`${56 + 500 + 13}px`);
  });

  it("leave a chapter's opening without a title, which has its own", () => {
    const { titles, footNumbers } = renderFurniture(
      spreadOf(page(9, 1), page(10, 2)),
    );
    expect(titles).toEqual(["", "One"]);
    expect(footNumbers).toEqual(["9", "10"]);
  });

  it("fall back to the book for a file the contents does not list", () => {
    const { titles } = renderFurniture(
      spreadOf(page(29, 2, { chapterIndex: 1 }), page(30, 3, { chapterIndex: 1 })),
    );
    expect(titles).toEqual(["The Book", "The Book"]);
  });

  it("leave a cover bare", () => {
    const cover = page(1, 1, { content: [{ type: "image" }] });
    const { titles, footNumbers } = renderFurniture(spreadOf(cover, page(2, 2)));
    expect(titles).toEqual(["", "One"]);
    expect(footNumbers).toEqual(["", "2"]);
  });

  it("leave the empty side of a spread empty", () => {
    const { titles, footNumbers } = renderFurniture(
      spreadOf(page(12, 4), null),
    );
    expect(titles).toEqual(["The Book", ""]);
    expect(footNumbers).toEqual(["12", ""]);
  });

  it("hide the numbers until the book's pages are counted", () => {
    const { titles, footNumbers } = renderFurniture(
      spreadOf(page(12, 4), page(13, 5)),
      { numbersReady: false },
    );
    expect(titles).toEqual(["The Book", "One"]);
    expect(footNumbers).toEqual(["", ""]);
  });

  it("follow Titles on two pages and Page numbers", () => {
    const spread = spreadOf(page(12, 4), page(13, 5));
    expect(renderFurniture(spread, { showTitles: false }).head).toBeNull();
    cleanup();
    const tablet = renderFurniture(spread, {
      isTablet: true,
      showTitles: false,
    });
    expect(tablet.titles).toEqual(["", ""]);
    expect(tablet.headNumbers).toEqual(["12", "13"]);
    cleanup();
    expect(renderFurniture(spread, { showNumbers: false }).foot).toBeNull();
  });

  it("stay off a spread outside the Reader", () => {
    const { container } = renderFurniture(spreadOf(page(12, 4)), {
      provided: false,
    });
    expect(container.textContent).toBe("");
  });
});
