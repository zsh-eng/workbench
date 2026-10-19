import {
  CONTENT_ANCHOR_BLOCK_ID_ATTR,
  CONTENT_ANCHOR_END_ATTR,
  CONTENT_ANCHOR_START_ATTR,
} from "@/lib/pagination-v2/content-anchor-dom";
import { PageSliceView } from "@/features/reader/PageSliceView";
import type { TextSlice } from "@/lib/pagination-v2";
import {
  EPUB_HIGHLIGHT_END_ATTRIBUTE,
  EPUB_HIGHLIGHT_START_ATTRIBUTE,
} from "@/types/reader.types";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

describe("PageSliceView", () => {
  it("renders linked text fragments as anchors with hrefs", () => {
    const slice: TextSlice = {
      type: "text",
      blockId: "linked-block",
      tag: "p",
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines: [
        {
          fragments: [
            {
              kind: "text",
              text: "Jump",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              link: { href: "OEBPS/Text/Chapter2.xhtml#note-1" },
              isCode: false,
              anchorStart: {
                itemIndex: 0,
                segmentIndex: 0,
                graphemeIndex: 0,
              },
              anchorEnd: {
                itemIndex: 0,
                segmentIndex: 1,
                graphemeIndex: 0,
              },
            },
          ],
          isLastInBlock: true,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice,
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    expect(markup).toContain('href="OEBPS/Text/Chapter2.xhtml#note-1"');
    expect(markup).toContain(`${CONTENT_ANCHOR_BLOCK_ID_ATTR}="linked-block"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_START_ATTR}="0:0:0"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_END_ATTR}="0:1:0"`);
    expect(markup).toContain(">Jump<");
  });

  it("renders leading gaps as breakable spaces before anchored fragments", () => {
    const slice: TextSlice = {
      type: "text",
      blockId: "gap-block",
      tag: "p",
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines: [
        {
          fragments: [
            {
              kind: "text",
              text: "alpha",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              isCode: false,
            },
            {
              kind: "text",
              text: "beta",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 4,
              isCode: false,
            },
          ],
          isLastInBlock: true,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice,
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    expect(markup).toContain("> </span>");
    expect(markup).toContain("white-space:nowrap");
    expect(markup).not.toContain("margin-left");
  });

  it("renders note refs as links with preserved anchor metadata", () => {
    const slice: TextSlice = {
      type: "text",
      blockId: "note-ref-block",
      tag: "p",
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines: [
        {
          fragments: [
            {
              kind: "text",
              text: "12",
              font: '400 12px "Inter", sans-serif',
              leadingGap: 0,
              inlineRole: "note-ref",
              link: { href: "#note-12" },
              isCode: false,
              anchorStart: {
                itemIndex: 1,
                segmentIndex: 0,
                graphemeIndex: 0,
              },
              anchorEnd: {
                itemIndex: 1,
                segmentIndex: 1,
                graphemeIndex: 0,
              },
            },
          ],
          isLastInBlock: true,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice,
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    expect(markup).toContain('href="#note-12"');
    expect(markup).toContain(`${CONTENT_ANCHOR_START_ATTR}="1:0:0"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_END_ATTR}="1:1:0"`);
    expect(markup).toContain(">12<");
  });

  it("keeps fragment anchor metadata when text is wrapped in highlight marks", () => {
    const slice: TextSlice = {
      type: "text",
      blockId: "highlighted-block",
      tag: "p",
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines: [
        {
          fragments: [
            {
              kind: "text",
              text: "world",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              isCode: false,
              highlightMarks: [
                { id: "h1", color: "yellow", isStart: true, isEnd: true },
              ],
              anchorStart: {
                itemIndex: 2,
                segmentIndex: 3,
                graphemeIndex: 0,
              },
              anchorEnd: {
                itemIndex: 2,
                segmentIndex: 4,
                graphemeIndex: 0,
              },
            },
          ],
          isLastInBlock: true,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice,
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    expect(markup).toContain(
      `${CONTENT_ANCHOR_BLOCK_ID_ATTR}="highlighted-block"`,
    );
    expect(markup).toContain(`${CONTENT_ANCHOR_START_ATTR}="2:3:0"`);
    expect(markup).toContain(`${CONTENT_ANCHOR_END_ATTR}="2:4:0"`);
    expect(markup).toContain('data-highlight-id="h1"');
    expect(markup).toContain('data-color="yellow"');
    expect(markup).toContain(`${EPUB_HIGHLIGHT_START_ATTRIBUTE}="true"`);
    expect(markup).toContain(`${EPUB_HIGHLIGHT_END_ATTRIBUTE}="true"`);
  });

  it("marks only the outer edges for consecutive highlight fragments", () => {
    const slice: TextSlice = {
      type: "text",
      blockId: "joined-highlight-block",
      tag: "p",
      lineHeight: 24,
      textAlign: "left",
      renderMode: "native",
      lines: [
        {
          fragments: [
            {
              kind: "text",
              text: "Great",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              isCode: false,
              highlightMarks: [{ id: "h1", color: "yellow", isStart: true }],
            },
            {
              kind: "space",
              text: " ",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              isCode: false,
              highlightMarks: [{ id: "h1", color: "yellow" }],
            },
            {
              kind: "text",
              text: "Britain",
              font: '400 16px "Inter", sans-serif',
              leadingGap: 0,
              isCode: false,
              highlightMarks: [{ id: "h1", color: "yellow", isEnd: true }],
            },
          ],
          isLastInBlock: true,
        },
      ],
    };

    const markup = renderToStaticMarkup(
      createElement(PageSliceView, {
        slice,
        sliceIndex: 0,
        bookId: "book-1",
        deferredImageCache: new Map(),
        baseFontSize: 16,
      }),
    );

    const highlightStarts = markup.match(
      new RegExp(`${EPUB_HIGHLIGHT_START_ATTRIBUTE}="true"`, "g"),
    );
    const highlightEnds = markup.match(
      new RegExp(`${EPUB_HIGHLIGHT_END_ATTRIBUTE}="true"`, "g"),
    );

    expect(highlightStarts).toHaveLength(1);
    expect(highlightEnds).toHaveLength(1);
  });
});
