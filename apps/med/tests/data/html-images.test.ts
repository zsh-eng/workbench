import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { expect, test } from "vitest";
import { htmlImages } from "../../src/web/markdown/html-images";

interface Node {
  type: string;
  value?: string;
  url?: string;
  alt?: string;
  children?: Node[];
}

const parser = unified().use(remarkParse).use(remarkGfm);
const read = (markdown: string) => {
  const tree = parser.parse(markdown) as Node;
  htmlImages(tree);
  return tree;
};
/** What shows, in order. HTML that is left shows nothing. */
const shown = (node: Node): string[] => {
  if (node.type === "image") return [`image ${node.url} ${node.alt}`.trim()];
  if (node.type === "text" || node.type === "inlineCode" || node.type === "code")
    return [node.value!.trim()];
  return (node.children ?? []).flatMap(shown);
};

test("an image that HTML holds shows where it stands", () => {
  const list = read('1. Before\n   <img alt="a" src="a.png">\n2. After');
  expect(list.children!.map(({ type }) => type)).toEqual(["list"]);
  expect(list.children![0]!.children).toHaveLength(2);
  expect(shown(list)).toEqual(["Before", "image a.png a", "After"]);
  const quote = read('> <p align="center"><img src="q.png"></p>');
  expect(quote.children![0]!.type).toBe("blockquote");
  expect(shown(quote)).toEqual(["image q.png"]);
  expect(shown(read('Text <img src="in.png"> text'))).toEqual(["Text", "image in.png", "text"]);
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
  expect(read('<img src="a.png">\nA caption').children).toHaveLength(1);
});

test("a comment hides its images, also one that never ends", () => {
  expect(shown(read('<!-- <img src="hidden.png"> -->'))).toEqual([]);
  expect(shown(read('<!-- Template\n<img src="hidden.png">\n\nmore'))).toEqual([]);
  expect(shown(read('<!-- note -->\n<img src="seen.png">'))).toEqual(["image seen.png"]);
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

test("code keeps its text, and HTML with no image stays out", () => {
  expect(shown(read('`<img src="a.png">`'))).toEqual(['<img src="a.png">']);
  expect(shown(read('```html\n<img src="a.png">\n```'))).toEqual(['<img src="a.png">']);
  expect(shown(read('    <img src="a.png">'))).toEqual(['<img src="a.png">']);
  expect(read("<div>words</div>").children![0]!.type).toBe("html");
});
