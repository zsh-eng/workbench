import type { Element, ElementContent, Properties, Root, RootContent } from "hast";

// Words' HTML as a hast tree, for the worker's own steps (links, headings,
// code, tables, KaTeX), in the markup that the page's styles expect. Words
// writes well-formed tags and escapes `<`, `>`, `&`, and `"` in text and
// attribute values, so a tag ends at the first `>`.

const VOID = new Set(["br", "hr", "img", "input", "wbr"]);
const TOKEN = /<(\/?)([a-zA-Z][\w-]*)([^>]*)>|[^<]+/g;
const ATTRIBUTE = /([^\s"'=/]+)(?:="([^"]*)")?/g;
const ENTITY = /&(?:(amp|lt|gt|quot|apos)|#(\d+)|#x([\da-f]+));/gi;
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export const decodeHtml = (text: string) =>
  text.includes("&")
    ? text.replace(ENTITY, (whole, name: string | undefined, decimal?: string, hex?: string) => {
        if (name) return NAMED[name.toLowerCase()]!;
        const code = Number.parseInt(decimal ?? hex!, decimal ? 10 : 16);
        return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      })
    : text;

const camel = (name: string) =>
  name.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());

/** An attribute as hast's property: `class` is a list, `data-*` and `aria-*` are camel case. */
function property(properties: Properties, name: string, value: string | undefined) {
  if (name === "class") properties.className = (value ?? "").split(/\s+/).filter(Boolean);
  else if (name === "checked" || name === "disabled") properties[name] = true;
  else if (name === "start") properties.start = Number(value);
  else if (name.startsWith("data-") || name.startsWith("aria-"))
    properties[camel(name)] = decodeHtml(value ?? "");
  else properties[name] = decodeHtml(value ?? "");
}

const point = (line: number) => ({ line, column: 1 });

/**
 * The nodes of a piece of Words' HTML. An element that names its source lines
 * in `data-source-line` and `data-source-end` takes them as its position,
 * which the worker writes back as those attributes.
 */
export function parseWords(html: string): ElementContent[] {
  const root: Element = { type: "element", tagName: "root", properties: {}, children: [] };
  const open: Element[] = [root];
  for (const match of html.matchAll(TOKEN)) {
    const parent = open.at(-1)!;
    if (match[2] === undefined) {
      parent.children.push({ type: "text", value: decodeHtml(match[0]) });
      continue;
    }
    const tagName = match[2].toLowerCase();
    if (match[1]) {
      // Words closes what it opens; a stray end tag closes nothing.
      const at = open.findLastIndex((element) => element.tagName === tagName);
      if (at > 0) open.length = at;
      continue;
    }
    const properties: Properties = {};
    for (const [, name, value] of match[3]!.matchAll(ATTRIBUTE)) property(properties, name!, value);
    const element: Element = { type: "element", tagName, properties, children: [] };
    const first = Number(properties.dataSourceLine);
    if (first) {
      element.position = {
        start: point(first),
        end: point(Number(properties.dataSourceEnd) || first),
      };
      delete properties.dataSourceLine;
      delete properties.dataSourceEnd;
    }
    parent.children.push(element);
    if (!VOID.has(tagName) && !match[3]!.endsWith("/")) open.push(element);
  }
  return root.children;
}

/**
 * Words' output for a document, as hast: each top-level block, with the lines
 * that its mark after it names. The footnotes, after the last mark, have none.
 */
export function wordsRoot(html: string): Root {
  const parts = html.split("\0");
  const children: RootContent[] = [];
  let last = 0;
  for (let at = 0; at < parts.length; at += 2) {
    const [start, end] = (parts[at + 1] ?? "").split(",").map(Number);
    for (const node of parseWords(parts[at]!)) {
      if (node.type === "text" && !node.value.trim()) continue;
      if (node.type === "element") {
        if (start) node.position = { start: point(start), end: point(end || start) };
        // The footnotes follow the last block, as the worker places them.
        pageMarkup(node, last + 1);
      }
      children.push(node);
    }
    last = end || last;
  }
  return { type: "root", children };
}

const elements = (node: Element) =>
  node.children.filter((child): child is Element => child.type === "element");
const isCheckbox = (node: Element | undefined) =>
  node?.tagName === "input" && node.properties.type === "checkbox";
/** Words' `#fn-1` and `fnref-1` as GitHub's, which the worker keeps. */
const footnoteId = (value: unknown) =>
  String(value).replace(/^(#?)(fn|fnref)-/, "$1user-content-$2-");

/**
 * GitHub's markup where Words' differs: task lists' classes, and footnotes
 * with GitHub's ids, as the page's styles and links expect.
 */
function pageMarkup(node: Element, line: number) {
  for (const child of elements(node)) pageMarkup(child, line);
  const [first] = elements(node);
  if (node.tagName === "li") {
    const box = isCheckbox(first) ? first : first?.tagName === "p" ? elements(first)[0] : undefined;
    if (box && isCheckbox(box)) {
      node.properties.className = ["task-list-item"];
      box.properties = {
        type: "checkbox",
        checked: box.properties.checked === true,
        disabled: true,
      };
    }
  } else if (node.tagName === "ul" || node.tagName === "ol") {
    if (elements(node).some((item) => String(item.properties.className) === "task-list-item"))
      node.properties.className = ["contains-task-list"];
  } else if (node.tagName === "sup" && String(node.properties.className) === "footnote-ref") {
    delete node.properties.className;
    if (first?.tagName === "a")
      first.properties = {
        href: footnoteId(first.properties.href),
        id: footnoteId(first.properties.id),
        dataFootnoteRef: true,
        ariaDescribedBy: "footnote-label",
      };
  } else if (node.tagName === "a" && "dataFootnoteBackref" in node.properties) {
    node.properties = {
      href: footnoteId(node.properties.href),
      dataFootnoteBackref: "",
      ariaLabel: node.properties.ariaLabel,
      className: ["data-footnote-backref"],
    };
  } else if (node.tagName === "section" && "dataFootnotes" in node.properties) {
    node.properties = { dataFootnotes: true, className: ["footnotes"] };
    for (const list of elements(node)) {
      for (const item of elements(list)) item.properties.id = footnoteId(item.properties.id);
      // Words places no note, so the list follows the last block, and the
      // worker gives the heading its line.
      list.position = { start: point(line), end: point(line) };
    }
    node.children.unshift({
      type: "element",
      tagName: "h2",
      properties: { className: ["sr-only"], id: "footnote-label" },
      children: [{ type: "text", value: "Footnotes" }],
    });
  }
}
