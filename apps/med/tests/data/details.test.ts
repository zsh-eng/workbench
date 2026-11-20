import type { Element } from "hast";
import rehypeStringify from "rehype-stringify";
import { unified } from "unified";
import { expect, test } from "vitest";
import { wordsTree } from "../../src/web/markdown/words/tree";

const stringify = unified().use(rehypeStringify);
const tree = (markdown: string) => wordsTree(markdown, {});
const html = (markdown: string) =>
  stringify.stringify(tree(markdown)).replace(/\n+/g, "").replace(/>\s+</g, "><");

test("a fold shows its summary and folds the Markdown up to its end", () => {
  expect(
    html(
      "<details>\n<summary>Why</summary>\n\nBecause **this**:\n\n- one\n- two\n\n</details>\n\nAfter",
    ),
  ).toBe(
    "<details><summary>Why</summary><p>Because <strong>this</strong>:</p><ul><li>one</li><li>two</li></ul></details><p>After</p>",
  );
  expect(html("<details open>\n<summary>Shown</summary>\n\nText\n\n</details>")).toBe(
    "<details open><summary>Shown</summary><p>Text</p></details>",
  );
  // A blank line between the tags is a separate HTML block.
  expect(html("<details>\n\n<summary>Apart</summary>\n\nText\n\n</details>")).toBe(
    "<details><summary>Apart</summary><p>Text</p></details>",
  );
});

test("a summary keeps its marks, and a fold without one says Details", () => {
  expect(html("<details><summary><b>Bold</b> and `code`</summary>\n\nText\n\n</details>")).toBe(
    "<details><summary><strong>Bold</strong> and <code>code</code></summary><p>Text</p></details>",
  );
  expect(html("<details>\n<summary><h3>A &amp; B</h3></summary>\n\nText\n\n</details>")).toBe(
    "<details><summary>A &#x26; B</summary><p>Text</p></details>",
  );
  expect(html("<details>\n\nText\n\n</details>")).toBe(
    "<details><summary>Details</summary><p>Text</p></details>",
  );
});

test("folds nest, end with their parent when they do not close, and stray ends drop", () => {
  expect(
    html(
      "<details>\n<summary>Outer</summary>\n\n<details>\n<summary>Inner</summary>\n\nDeep\n\n</details>\n\nShallow\n\n</details>",
    ),
  ).toBe(
    "<details><summary>Outer</summary><details><summary>Inner</summary><p>Deep</p></details><p>Shallow</p></details>",
  );
  expect(html("Before\n\n<details>\n<summary>Open</summary>\n\nRest\n\nMore")).toBe(
    "<p>Before</p><details><summary>Open</summary><p>Rest</p><p>More</p></details>",
  );
  expect(html("Text\n\n</details>\n\nMore")).toBe("<p>Text</p><p>More</p>");
  // One fold ends where the next starts, in the same HTML block.
  expect(
    html(
      "<details>\n<summary>A</summary>\n\nOne\n\n</details>\n<details>\n<summary>B</summary>\n\nTwo\n\n</details>",
    ),
  ).toBe(
    "<details><summary>A</summary><p>One</p></details><details><summary>B</summary><p>Two</p></details>",
  );
});

test("words in the fold's own HTML block are plain text, as on GitHub", () => {
  expect(html("<details><summary>Log</summary>\nNot **bold** here\n</details>")).toBe(
    "<details><summary>Log</summary><p>Not **bold** here</p></details>",
  );
});

test("a fold stands in a list item and a quote", () => {
  expect(html("- Item\n\n  <details>\n  <summary>More</summary>\n\n  Inside\n\n  </details>")).toBe(
    "<ul><li><p>Item</p><details><summary>More</summary><p>Inside</p></details></li></ul>",
  );
  expect(html("> <details>\n> <summary>Quoted</summary>\n>\n> Inside\n>\n> </details>")).toBe(
    "<blockquote><details><summary>Quoted</summary><p>Inside</p></details></blockquote>",
  );
});

test("a fold covers the lines from its tag to its end, for the page's line map", () => {
  const [fold, after] = tree("<details>\n<summary>Why</summary>\n\nBody\n\n</details>\n\nAfter")
    .children as Element[];
  expect(fold!.tagName).toBe("details");
  expect([fold!.position!.start.line, fold!.position!.end.line]).toEqual([1, 6]);
  expect(after!.position!.start.line).toBe(8);
  // Summary words have no lines of their own.
  expect((fold!.children[0] as Element).children[0]!.position).toBeUndefined();
});

test("other HTML shows nothing", () => {
  expect(html('<div align="center">\nHello\n</div>\n\nAfter')).toBe("<p>After</p>");
});
