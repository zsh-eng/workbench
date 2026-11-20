import { expect, test } from "vitest";
import type { Element, Root, RootContent } from "hast";
import { unified } from "unified";
import rehypeStringify from "rehype-stringify";
import { renderWords } from "../../src/web/markdown/words/words";
import { parseWords } from "../../src/web/markdown/words/hast";
import { wordsTree } from "../../src/web/markdown/words/tree";

const stringify = unified().use(rehypeStringify);
const toHtml = (node: Root | RootContent) =>
  stringify.stringify(node.type === "root" ? node : { type: "root", children: [node] });
const lines = (node: RootContent) =>
  node.position ? [node.position.start.line, node.position.end.line] : undefined;
const tag = (node: RootContent) => (node.type === "element" ? node.tagName : node.type);
const find = (tree: Root | Element, name: string): Element[] =>
  tree.children.flatMap((child) =>
    child.type === "element"
      ? [...(child.tagName === name ? [child] : []), ...find(child, name)]
      : [],
  );

test("Words ends each top-level block with its lines and leaves raw HTML as escaped text", () => {
  const html = renderWords("# Title\n\nSome <b>bold</b> text\nover two lines\n\n<div>gone</div>\n");
  expect(html.split("\0")).toEqual([
    '<h1 data-source-line="1" data-source-end="1">Title</h1>\n',
    "1,1",
    "\n<p>Some <template data-html>&lt;b&gt;</template>bold<template data-html>&lt;/b&gt;</template> text\nover two lines</p>\n",
    "3,4",
    '\n<template data-html data-source-line="6" data-source-end="6">&lt;div&gt;gone&lt;/div&gt;</template>\n',
    "6,6",
    "",
  ]);
});

test("a reply's $HOME and $3 are text, and $$ is math; a file's single dollar is math", () => {
  const reply = renderWords("Set $HOME to $3, then $$x^2$$.", { singleDollarMath: false });
  expect(reply).toContain(
    '<p>Set $HOME to $3, then <code class="language-math math-inline">x^2</code>.</p>',
  );
  expect(renderWords("Area $a^2$ here.", { singleDollarMath: true })).toContain(
    '<code class="language-math math-inline">a^2</code>',
  );
});

test("Words' HTML parses as a hast tree: properties, text, and positions", () => {
  const [list] = parseWords(
    '<ol start="3">\n<li><input checked="" disabled="" type="checkbox"> a &amp; b</li>\n</ol>',
  ) as Element[];
  expect(list).toMatchObject({ tagName: "ol", properties: { start: 3 } });
  const item = list!.children[1] as Element;
  expect(item.children[0]).toMatchObject({
    tagName: "input",
    properties: { checked: true, disabled: true, type: "checkbox" },
  });
  expect(item.children[1]).toEqual({ type: "text", value: " a & b" });
  const [pre] = parseWords(
    '<pre data-source-line="4" data-source-end="6"><code class="language-ts">a &lt; b\n</code></pre>',
  ) as Element[];
  expect(pre!.position).toMatchObject({ start: { line: 4 }, end: { line: 6 } });
  expect(pre!.properties).toEqual({});
  expect((pre!.children[0] as Element).properties.className).toEqual(["language-ts"]);
  expect(toHtml(pre!)).toBe('<pre><code class="language-ts">a &#x3C; b\n</code></pre>');
});

test("the tree places each block, heading, code block, and table in the source", () => {
  const tree = wordsTree(
    "# A\n\n- one\n- two\n\n  ```js\n  x\n  ```\n\n| a |\n|---|\n| 1 |\n\nEnd[^1]\n\n[^1]: Note\n",
    {},
  );
  expect(tree.children.map((node) => [tag(node), lines(node)])).toEqual([
    ["h1", [1, 1]],
    ["ul", [3, 8]],
    ["table", [10, 12]],
    ["p", [14, 14]],
    ["section", undefined],
  ]);
  expect(lines(find(tree, "pre")[0]!)).toEqual([6, 8]);
});

test("details fold the blocks between their tags, with the summary's Markdown", () => {
  const tree = wordsTree(
    "Before\n\n<details open>\n<summary>The **plan**</summary>\n\nInside\n\n- item\n\n</details>\n\n<div>raw</div>\n\nAfter\n",
    { plainDollars: true },
  );
  expect(tree.children.map((node) => [tag(node), lines(node)])).toEqual([
    ["p", [1, 1]],
    ["details", [3, 10]],
    ["p", [14, 14]],
  ]);
  const fold = tree.children[1] as Element;
  expect(fold.properties).toEqual({ open: true });
  expect(toHtml(fold.children[0]!)).toBe("<summary>The <strong>plan</strong></summary>");
  expect(fold.children.slice(1).map(tag)).toEqual(["p", "ul"]);
  // In a list item too, and a fold that does not close ends with its parent.
  const nested = wordsTree("- <details>\n  <summary>S</summary>\n\n  Hidden\n- next\n", {});
  const item = find(nested, "li")[0]!;
  expect(item.children.filter((node) => node.type === "element").map(tag)).toEqual(["details"]);
});

test("wiki links and images in a note, but not in code or after a backslash", () => {
  const tree = wordsTree(
    "See [[Plan|the plan]], ![[chart.png|200x100]], `[[code]]`, and \\[[escaped]].",
    { vault: true },
  );
  expect(toHtml(tree)).toBe(
    '<p>See <a href="med-vault:wiki:Plan">the plan</a>, <img src="med-vault:wiki:chart.png" alt="chart.png" width="200" height="100">, <code>[[code]]</code>, and [[escaped]].</p>',
  );
});
