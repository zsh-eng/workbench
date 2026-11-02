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
  { showFolios = true, provided = true } = {},
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
  });
  const { container } = render(
    provided
      ? createElement(
          PageFurnitureProvider,
          { book: BOOK, showFolios },
          furniture,
        )
      : furniture,
  );
  const texts = (selector: string) =>
    [...container.querySelectorAll(`${selector} > p`)].map(
      (element) => element.textContent,
    );
  return {
    container,
    heads: texts(".reader-running-heads"),
    folios: texts(".reader-folios"),
  };
}

afterEach(cleanup);

describe("a page's running head and folio", () => {
  it("title the left page with the book and the right with the chapter", () => {
    const { heads, folios } = renderFurniture(
      spreadOf(page(12, 4), page(13, 5)),
    );
    expect(heads).toEqual(["The Book", "One"]);
    expect(folios).toEqual(["12", "13"]);
  });

  it("title a single page with the chapter", () => {
    expect(renderFurniture(spreadOf(page(12, 4))).heads).toEqual(["One"]);
  });

  it("leave a chapter's opening without a head, which has its own title", () => {
    const { heads, folios } = renderFurniture(spreadOf(page(9, 1)));
    expect(heads).toEqual([""]);
    expect(folios).toEqual(["9"]);
  });

  it("fall back to the book for a file the contents does not list", () => {
    const { heads } = renderFurniture(
      spreadOf(page(30, 3, { chapterIndex: 1 })),
    );
    expect(heads).toEqual(["The Book"]);
  });

  it("leave a cover bare", () => {
    const cover = page(1, 1, { content: [{ type: "image" }] });
    const { heads, folios } = renderFurniture(spreadOf(cover));
    expect(heads).toEqual([""]);
    expect(folios).toEqual([""]);
  });

  it("leave the empty side of a spread empty", () => {
    const { heads, folios } = renderFurniture(spreadOf(page(12, 4), null));
    expect(heads).toEqual(["The Book", ""]);
    expect(folios).toEqual(["12", ""]);
  });

  it("hide the number until the book's pages are counted", () => {
    const { heads, folios } = renderFurniture(spreadOf(page(12, 4)), {
      showFolios: false,
    });
    expect(heads).toEqual(["One"]);
    expect(folios).toEqual([""]);
  });

  it("stay off a spread outside the Reader", () => {
    const { container } = renderFurniture(spreadOf(page(12, 4)), {
      provided: false,
    });
    expect(container.textContent).toBe("");
  });
});
