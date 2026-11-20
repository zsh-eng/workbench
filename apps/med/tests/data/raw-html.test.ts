import type { Element, Root, RootContent } from "hast";
import { expect, test } from "vitest";
import { wordsTree } from "../../src/web/markdown/words/tree";

const read = (markdown: string, htmlImages = true) => wordsTree(markdown, { htmlImages });
/** What shows, in order. */
const shown = (node: Root | RootContent): string[] => {
  if (node.type === "element" && node.tagName === "img")
    return [`image ${node.properties.src} ${node.properties.alt}`.trim()];
  if (node.type === "text") return node.value.trim() ? [node.value.trim()] : [];
  return "children" in node ? node.children.flatMap(shown) : [];
};
const tags = (node: Root | Element) =>
  node.children.flatMap((child) => (child.type === "element" ? [child.tagName] : []));

test("an image that HTML holds shows where it stands", () => {
  const list = read('1. Before\n   <img alt="a" src="a.png">\n2. After');
  expect(tags(list)).toEqual(["ol"]);
  expect(tags(list.children[0] as Element)).toEqual(["li", "li"]);
  expect(shown(list)).toEqual(["Before", "image a.png a", "After"]);
  const quote = read('> <p align="center"><img src="q.png"></p>');
  expect(tags(quote)).toEqual(["blockquote"]);
  expect(shown(quote)).toEqual(["image q.png"]);
  expect(shown(read('Text <img src="in.png"> text'))).toEqual(["Text", "image in.png", "text"]);
  // In a tight list, an item's image is not a paragraph of its own.
  expect(tags(read('- <img src="t.png">').children[0] as Element)).toEqual(["li"]);
  expect(tags((read('- <img src="t.png">').children[0] as Element).children[1] as Element)).toEqual(
    ["img"],
  );
});

test("the words beside an image stay, in their order", () => {
  expect(shown(read('<img src="a.png">\nA caption **as written**'))).toEqual([
    "image a.png",
    "A caption **as written**",
  ]);
  expect(
    shown(
      read(
        '<details>\n<summary>Shots</summary>\n<img src="a.png">\nnotes here\n<img src="b.png">\n</details>',
      ),
    ),
  ).toEqual(["Shots", "image a.png", "notes here", "image b.png"]);
  // One block, which keeps one place in the rendered list.
  const one = read('<img src="a.png">\nA caption');
  expect(tags(one)).toEqual(["p"]);
  expect([one.children[0]!.position!.start.line, one.children[0]!.position!.end.line]).toEqual([
    1, 2,
  ]);
});

test("a comment hides its images, also one that never ends", () => {
  expect(shown(read('<!-- <img src="hidden.png"> -->'))).toEqual([]);
  expect(shown(read('<!-- Template\n<img src="hidden.png">\n\nmore'))).toEqual([]);
  expect(shown(read('<!-- note -->\n<img src="seen.png">'))).toEqual(["image seen.png"]);
  expect(shown(read('Text <!-- <img src="hidden.png"> --> text'))).toEqual(["Text", "text"]);
});

test("a tag's values can have any quotes, or a > inside them", () => {
  expect(shown(read('<img alt="a > b" src="x.png">'))).toEqual(["image x.png a > b"]);
  expect(shown(read("<IMG SRC='x.png' ALT='y'>"))).toEqual(["image x.png y"]);
  expect(shown(read("<img src=x.png>"))).toEqual(["image x.png"]);
  expect(shown(read('<img data-src="no.png" src="yes.png?a=1&amp;b=2">'))).toEqual([
    "image yes.png?a=1&b=2",
  ]);
  expect(shown(read('<img data-src="no.png">'))).toEqual([]);
});

test("code keeps its text, and HTML with no image shows nothing", () => {
  expect(shown(read('`<img src="a.png">`'))).toEqual(['<img src="a.png">']);
  expect(shown(read('```html\n<img src="a.png">\n```'))).toEqual(['<img src="a.png">']);
  expect(shown(read('    <img src="a.png">'))).toEqual(['<img src="a.png">']);
  expect(read("<div>words</div>").children).toEqual([]);
  expect(shown(read("Some <b>bold</b> words"))).toEqual(["Some", "bold", "words"]);
});

test("a document that is not a description shows none of its HTML", () => {
  const text = 'Text <img src="a.png">\n\n<img src="b.png">\nCaption\n\n- <img src="c.png">';
  expect(shown(read(text, false))).toEqual(["Text"]);
  expect(JSON.stringify(read(text, false))).not.toContain("template");
});
