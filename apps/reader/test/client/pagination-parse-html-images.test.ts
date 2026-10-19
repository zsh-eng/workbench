import { parseChapterHtml } from "@/lib/pagination-v2";
import { describe, expect, it } from "vitest";

describe("parseChapterHtml image extraction", () => {
  it("preserves figcaptions as text blocks after figure images", () => {
    const html = `
      <figure>
        <img alt="battle" src="../Images/image029.jpg" />
        <figcaption>Figure 29. Carefully researched illustration.</figcaption>
      </figure>
    `;

    const blocks = parseChapterHtml(html);

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({
      type: "image",
      src: "../Images/image029.jpg",
      alt: "battle",
    });
    expect(blocks[1]).toMatchObject({
      type: "text",
      tag: "figcaption",
    });

    const captionBlock = blocks[1];
    expect(captionBlock?.type).toBe("text");
    if (captionBlock?.type !== "text") {
      throw new Error("Expected a figcaption text block");
    }

    expect(captionBlock.runs.map((run) => run.text).join("")).toContain(
      "Figure 29.",
    );
  });

  it("keeps cover images nested inside heading tags", () => {
    const html = `
      <h1 class="cubierta" title="Book One: The Way of Kings">
        <img alt="book1" src="../Images/book1.jpg" />
      </h1>
    `;

    const blocks = parseChapterHtml(html);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "image",
      src: "../Images/book1.jpg",
      alt: "book1",
    });
  });

  it("keeps cover images nested inside svg image tags", () => {
    const html = `
      <div class="x-ebookmaker-cover">
        <svg xmlns="http://www.w3.org/2000/svg"
             xmlns:xlink="http://www.w3.org/1999/xlink"
             viewBox="0 0 1500 2114"
             width="100%"
             height="100%">
          <image width="1500"
                 height="2114"
                 xlink:href="1098001722820821904_cover.jpg" />
        </svg>
      </div>
    `;

    const blocks = parseChapterHtml(html);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "image",
      src: "1098001722820821904_cover.jpg",
      intrinsicWidth: 1500,
      intrinsicHeight: 2114,
    });
  });

  it("uses explicit numeric width and height as the image size", () => {
    const html = `<img src="cover.jpg" width="600" height="800" />`;

    const blocks = parseChapterHtml(html);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "image",
      src: "cover.jpg",
      intrinsicWidth: 600,
      intrinsicHeight: 800,
    });
  });

  it("ignores inline images mixed with text because only block images are supported", () => {
    const html = `
      <p>
        Before
        <img alt="inline" src="../Images/inline.jpg" />
        after
      </p>
    `;

    const blocks = parseChapterHtml(html);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({
      type: "text",
      tag: "p",
    });

    const block = blocks[0];
    expect(block?.type).toBe("text");
    if (block?.type !== "text") {
      throw new Error("Expected a text block");
    }

    expect(block.runs.map((run) => run.text).join("")).toContain("Before");
    expect(block.runs.map((run) => run.text).join("")).toContain("after");
    expect(blocks.some((candidate) => candidate.type === "image")).toBe(false);
  });
});

it("keeps decorative image alt text distinct from missing descriptions", () => {
  const blocks = parseChapterHtml(
    '<img src="decoration.jpg" alt=""><img src="unknown.jpg">',
  );
  expect(blocks[0]).toMatchObject({ type: "image", alt: "" });
  expect(blocks[1]).toMatchObject({ type: "image", alt: undefined });
});
