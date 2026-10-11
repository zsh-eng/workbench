import { clearCache, layout, prepare, type PreparedText } from "@chenglou/pretext";
import {
  measureRichInlineStats,
  prepareRichInline,
  walkRichInlineLineRanges,
  type PreparedRichInline,
  type RichInlineItem,
} from "@chenglou/pretext/rich-inline";
import type { SessionItem } from "../../data/session-store";
import type { ToolItem, Unit } from "./thread-model";

// The height of a thread unit before it renders. Pretext measures text with
// the browser's own font engine through a canvas, and lays out its lines with
// arithmetic, so a long session gets a height for every unit without layout.
// The browser still renders each unit; a rendered unit's own height replaces
// the estimate (see SessionThread's virtual list).
//
// Pretext counts lines. The boxes around them (margins that collapse, list
// gaps, table cells, code blocks) are this file's model of the thread's CSS;
// every size in it is read from a hidden sample of the parts, so a theme or
// a style change moves the estimates with it.

/** A text style as a canvas and Pretext read it. */
export interface TextStyle {
  font: string;
  lineHeight: number;
  letterSpacing: number;
}
/** Inline code: its font, and the padding and border on each side. */
interface InlineStyle {
  font: string;
  letterSpacing: number;
  extra: number;
}
/** The thread's sizes in the current theme and width, read from a hidden
 * sample of each part (`ThreadProbe` in SessionThread). */
export interface ThreadMetrics {
  /** The width of a unit. */
  width: number;
  /** Space below each unit. */
  gap: number;
  /** A tool call, thought, or group row. */
  row: number;
  /** A compaction mark, with its margins. */
  compaction: number;
  reply: {
    body: TextStyle;
    bold: string;
    italic: string;
    code: InlineStyle;
    /** How much taller a line with inline code is. */
    codeLine: number;
    heading: TextStyle;
    minor: TextStyle;
    paragraph: number;
    headingMargin: readonly [number, number];
    minorMargin: readonly [number, number];
    listIndent: number;
    listMargin: number;
    itemMargin: number;
    /** Paragraphs in the items of a list with blank lines between them. */
    looseMargin: number;
    block: { margin: number; line: number; chrome: number };
    quote: { margin: number; inset: number; chrome: number };
    rule: { margin: number; height: number };
    table: {
      margin: number;
      head: TextStyle;
      cell: TextStyle;
      headChrome: number;
      cellChrome: number;
      inline: number;
      extra: number;
    };
    /** The reply's own margin, above and below. */
    edge: number;
    /** Copy and Pin, under the reply that ends a turn. */
    bar: number;
  };
  user: {
    text: TextStyle;
    /** The widest line of a prompt. */
    width: number;
    /** The bubble's padding and the row's margins. */
    chrome: number;
  };
  /** Diffs in an edit: one line of code, the width of one character, the
   * indent of a call's details, and the space before a diff's code. */
  diff: {
    line: number;
    advance: number;
    gutter: number;
    inset: number;
    chrome: number;
  };
}

const px = (value: string) => Number.parseFloat(value) || 0;
const fontOf = (style: CSSStyleDeclaration) =>
  `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;

export function textStyle(element: Element): TextStyle {
  const style = getComputedStyle(element);
  const size = px(style.fontSize);
  return {
    font: fontOf(style),
    lineHeight: style.lineHeight === "normal" ? size * 1.2 : px(style.lineHeight),
    letterSpacing: style.letterSpacing === "normal" ? 0 : px(style.letterSpacing),
  };
}

/** Reads the metrics from the probe's samples, marked with data-probe. */
export function readMetrics(probe: HTMLElement): ThreadMetrics {
  const part = (name: string) => probe.querySelector<HTMLElement>(`[data-probe="${name}"]`)!;
  const style = (name: string) => getComputedStyle(part(name));
  const height = (name: string) => part(name).getBoundingClientRect().height;
  const heading = style("h");
  const minor = style("h4");
  const list = style("ul");
  const quote = style("quote");
  const table = style("table");
  const cell = style("td");
  const code = style("code");
  const bubble = style("bubble");
  const userRow = style("user");
  const bar = part("bar");
  const compaction = style("compaction");
  const body = textStyle(part("p"));
  const head = textStyle(part("th"));
  const data = textStyle(part("td"));
  const edge = px(style("reply").marginTop);
  const blockLine = (height("pre3") - height("pre1")) / 2;
  const diff = textStyle(part("diff"));
  const canvas = document.createElement("canvas").getContext("2d")!;
  canvas.font = diff.font;
  return {
    width: probe.clientWidth,
    gap: px(style("unit").paddingBottom),
    row: height("row"),
    compaction: height("compaction") + px(compaction.marginTop) + px(compaction.marginBottom),
    reply: {
      body,
      bold: fontOf(style("strong")),
      italic: fontOf(style("em")),
      code: {
        font: fontOf(code),
        letterSpacing: code.letterSpacing === "normal" ? 0 : px(code.letterSpacing),
        extra:
          px(code.paddingLeft) +
          px(code.paddingRight) +
          px(code.borderLeftWidth) +
          px(code.borderRightWidth),
      },
      codeLine: Math.max(0, height("pcode") - body.lineHeight),
      heading: textStyle(part("h")),
      minor: textStyle(part("h4")),
      paragraph: px(style("p").marginBottom),
      headingMargin: [px(heading.marginTop), px(heading.marginBottom)],
      minorMargin: [px(minor.marginTop), px(minor.marginBottom)],
      listIndent: px(list.paddingLeft),
      listMargin: px(list.marginBottom),
      itemMargin: px(style("li").marginTop),
      looseMargin: px(style("lip").marginTop),
      block: {
        margin: px(style("pre1").marginTop),
        line: blockLine,
        chrome: height("pre1") - blockLine,
      },
      quote: {
        margin: px(quote.marginTop),
        inset: px(quote.paddingLeft) + px(quote.borderLeftWidth),
        chrome:
          px(quote.paddingTop) +
          px(quote.paddingBottom) +
          px(quote.borderTopWidth) +
          px(quote.borderBottomWidth),
      },
      rule: { margin: px(style("hr").marginTop), height: height("hr") },
      table: {
        margin: px(table.marginTop),
        head,
        cell: data,
        headChrome: height("th") - head.lineHeight,
        cellChrome: height("td") - data.lineHeight,
        inline: px(cell.paddingLeft) + px(cell.paddingRight),
        extra: height("table") - height("th") - height("td"),
      },
      edge,
      // The bar's margin and the reply's collapse into one.
      bar: bar.offsetHeight + Math.max(0, px(getComputedStyle(bar).marginTop) - edge),
    },
    user: {
      text: textStyle(part("userText")),
      width: part("userText").getBoundingClientRect().width,
      chrome:
        px(bubble.paddingTop) +
        px(bubble.paddingBottom) +
        px(userRow.marginTop) +
        px(userRow.marginBottom),
    },
    diff: {
      line: diff.lineHeight,
      advance: canvas.measureText("0".repeat(100)).width / 100,
      gutter: 24,
      // The details indent and the diff's line numbers and markers.
      inset: 24 + 7 * (canvas.measureText("0").width || 7),
      chrome: 2,
    },
  };
}

// Pretext's prepared text is the costly part: segments and their widths.
// Each unit keeps its own, by font, until its text changes.
let prepared = new WeakMap<object, Map<string, PreparedText | PreparedRichInline>>();

/** Forgets measured text, as when a font finishes loading: Pretext keeps
 * widths by font name, and the name does not change when the font arrives. */
export function resetHeights() {
  prepared = new WeakMap();
  clearCache();
}

function cached<T extends PreparedText | PreparedRichInline>(
  owner: object,
  key: string,
  make: () => T,
): T {
  let byKey = prepared.get(owner);
  if (!byKey) prepared.set(owner, (byKey = new Map()));
  let entry = byKey.get(key) as T | undefined;
  if (!entry) byKey.set(key, (entry = make()));
  return entry;
}

/** Lines of plain text, as in a prompt or a console. */
function lineCount(owner: object, text: string, style: TextStyle, width: number, pre = false) {
  if (!text) return 0;
  const entry = cached(owner, `${style.font}\0${style.letterSpacing}\0${pre}\0${text}`, () =>
    prepare(text, style.font, {
      ...(pre ? { whiteSpace: "pre-wrap" as const } : {}),
      ...(style.letterSpacing ? { letterSpacing: style.letterSpacing } : {}),
    }),
  );
  return Math.max(1, layout(entry, Math.max(1, width), style.lineHeight).lineCount);
}

type Run = { text: string; kind: "text" | "code" | "bold" | "italic" };
// Code spans, strong and emphasis, links and images, autolinks, and HTML tags.
const INLINE =
  /(`+)(.+?)\1|\*\*(.+?)\*\*|__(.+?)__|\*(\S(?:.*?\S)?)\*|(?<!\w)_(\S(?:.*?\S)?)_(?!\w)|!?\[([^\]]*)\]\([^)]*\)|<(https?:[^>\s]+)>|<\/?[a-z][^>]*>/gi;

/** The runs of Markdown inline text, as the renderer styles them. */
function runs(source: string): Run[] {
  const result: Run[] = [];
  let last = 0;
  const push = (text: string, kind: Run["kind"]) => {
    if (text) result.push({ text, kind });
  };
  for (const match of source.matchAll(INLINE)) {
    push(source.slice(last, match.index), "text");
    last = match.index + match[0].length;
    if (match[1]) push(match[2]!.trim() || match[2]!, "code");
    else if (match[3] ?? match[4]) push((match[3] ?? match[4])!.replace(/`/g, ""), "bold");
    else if (match[5] ?? match[6]) push((match[5] ?? match[6])!.replace(/`/g, ""), "italic");
    else if (match[7] !== undefined) push(match[7], "text");
    else if (match[8]) push(match[8], "text");
  }
  push(source.slice(last), "text");
  return result;
}

/** Lines of Markdown inline text in a block of this width, and how many of
 * them hold inline code, which can stand taller. */
function inlineLines(
  owner: object,
  source: string,
  m: ThreadMetrics,
  style: TextStyle,
  width: number,
) {
  const parts = runs(source);
  if (parts.every((part) => part.kind === "text"))
    return {
      count: lineCount(owner, parts.map((part) => part.text).join(""), style, width),
      withCode: 0,
    };
  const r = m.reply;
  // Bold and italic keep the block's size; only their weight or style changes.
  const size = /\S+px/.exec(style.font)?.[0] ?? "";
  const resize = (font: string) => font.replace(/\S+px/, size);
  const items: RichInlineItem[] = parts.map((part) =>
    part.kind === "code"
      ? {
          text: part.text,
          font: r.code.font,
          letterSpacing: r.code.letterSpacing,
          extraWidth: r.code.extra,
        }
      : {
          text: part.text,
          font:
            part.kind === "bold"
              ? resize(r.bold)
              : part.kind === "italic"
                ? resize(r.italic)
                : style.font,
          ...(style.letterSpacing ? { letterSpacing: style.letterSpacing } : {}),
        },
  );
  const entry = cached(owner, `rich\0${style.font}\0${r.code.font}\0${source}`, () =>
    prepareRichInline(items),
  );
  const limit = Math.max(1, width);
  if (r.codeLine < 0.01)
    return { count: Math.max(1, measureRichInlineStats(entry, limit).lineCount), withCode: 0 };
  let count = 0;
  let withCode = 0;
  walkRichInlineLineRanges(entry, limit, (line) => {
    count++;
    if (line.fragments.some((fragment) => parts[fragment.itemIndex]?.kind === "code")) withCode++;
  });
  return { count: Math.max(1, count), withCode };
}

let measureCanvas: CanvasRenderingContext2D | null = null;
/** The widest line of a table cell, and its longest word. */
function cellWidths(text: string, style: TextStyle) {
  measureCanvas ??= document.createElement("canvas").getContext("2d")!;
  measureCanvas.font = style.font;
  const plain = runs(text)
    .map((part) => part.text)
    .join("");
  let word = 0;
  for (const piece of plain.split(/\s+/))
    word = Math.max(word, measureCanvas.measureText(piece).width);
  return { max: measureCanvas.measureText(plain).width, min: word };
}

type Block =
  | { kind: "p"; text: string }
  | { kind: "h"; text: string; level: number }
  | { kind: "li"; text: string; depth: number; first: boolean; last: boolean; loose: boolean }
  | { kind: "code"; lines: number }
  | { kind: "table"; rows: string[][] }
  | { kind: "quote"; lines: string[] }
  | { kind: "hr" };
type Item = Extract<Block, { kind: "li" }>;

const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;

/** The blocks of a reply, as the Markdown renderer makes them. Inline
 * Markdown stays in their text, for `inlineLines`. */
export function markdownBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.split("\n");
  let paragraph: string[] = [];
  let item: { text: string[]; depth: number } | null = null;
  // The items of the list being read, and whether blank lines part them.
  let list: Item[] = [];
  let loose = false;
  const flush = () => {
    if (paragraph.length) blocks.push({ kind: "p", text: paragraph.join(" ") });
    paragraph = [];
    if (item) {
      const entry: Item = {
        kind: "li",
        text: item.text.join(" "),
        depth: item.depth,
        first: list.length === 0,
        last: false,
        loose: false,
      };
      list.push(entry);
      blocks.push(entry);
    }
    item = null;
  };
  const endList = () => {
    flush();
    if (list.length) list.at(-1)!.last = true;
    if (loose) for (const entry of list) entry.loose = true;
    list = [];
    loose = false;
  };
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index]!;
    const fence = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      endList();
      let count = 0;
      while (++index < lines.length && !lines[index]!.trimStart().startsWith(fence[1]!)) count++;
      blocks.push({ kind: "code", lines: Math.max(1, count) });
      continue;
    }
    if (!line.trim()) {
      if (item && BULLET.test(lines[index + 1] ?? "")) {
        flush();
        loose = true;
      } else endList();
      continue;
    }
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      endList();
      blocks.push({ kind: "h", text: heading[2]!, level: heading[1]!.length });
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet) {
      if (paragraph.length) endList();
      else flush();
      item = { text: [bullet[3]!], depth: Math.floor(bullet[1]!.length / 2) };
      continue;
    }
    if (/^\s*\|/.test(line)) {
      endList();
      const rows: string[][] = [];
      for (; index < lines.length && /^\s*\|/.test(lines[index]!); index++)
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(lines[index]!))
          rows.push(
            lines[index]!.trim()
              .replace(/^\||\|$/g, "")
              .split("|")
              .map((cell) => cell.trim()),
          );
      index--;
      blocks.push({ kind: "table", rows });
      continue;
    }
    if (/^\s*>/.test(line)) {
      endList();
      const quoted: string[] = [];
      for (; index < lines.length && /^\s*>/.test(lines[index]!); index++)
        quoted.push(lines[index]!.replace(/^\s*>\s?/, ""));
      index--;
      blocks.push({ kind: "quote", lines: quoted });
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      endList();
      blocks.push({ kind: "hr" });
      continue;
    }
    if (item) item.text.push(line.trim());
    else paragraph.push(line.trim());
  }
  endList();
  return blocks;
}

function tableHeight(owner: object, rows: string[][], m: ThreadMetrics) {
  const t = m.reply.table;
  const columns = Math.max(1, ...rows.map((row) => row.length));
  // The browser's automatic table layout: each column takes its widest
  // line when all fit, else its longest word and a share of the rest.
  const max = Array.from({ length: columns }, () => 0);
  const min = Array.from({ length: columns }, () => 0);
  rows.forEach((row, index) =>
    row.forEach((text, column) => {
      const widths = cellWidths(text, index === 0 ? t.head : t.cell);
      max[column] = Math.max(max[column]!, widths.max + t.inline);
      min[column] = Math.max(min[column]!, widths.min + t.inline);
    }),
  );
  const sum = (list: number[]) => list.reduce((total, value) => total + value, 0);
  const room = m.width;
  const spare = Math.max(1, sum(max) - sum(min));
  const widths =
    sum(max) <= room
      ? max
      : sum(min) >= room
        ? min
        : min.map((value, column) => value + ((max[column]! - value) * (room - sum(min))) / spare);
  let height = t.extra;
  rows.forEach((row, index) => {
    const style = index === 0 ? t.head : t.cell;
    const lines = Math.max(
      1,
      ...row.map(
        (text, column) => inlineLines(owner, text, m, style, widths[column]! - t.inline).count,
      ),
    );
    height += lines * style.lineHeight + (index === 0 ? t.headChrome : t.cellChrome);
  });
  return height;
}

function replyHeight(owner: object, text: string, m: ThreadMetrics) {
  const r = m.reply;
  const prose = (source: string, width: number, style = r.body) => {
    const lines = inlineLines(owner, source, m, style, width);
    return lines.count * style.lineHeight + lines.withCode * r.codeLine;
  };
  let height = 0;
  // The margin above the next block; adjacent margins collapse.
  let margin = r.edge;
  const add = (top: number, size: number, bottom: number) => {
    height += Math.max(margin, top) + size;
    margin = bottom;
  };
  for (const block of markdownBlocks(text))
    switch (block.kind) {
      case "p":
        add(0, prose(block.text, m.width), r.paragraph);
        break;
      case "h": {
        const minor = block.level > 3;
        const [top, bottom] = minor ? r.minorMargin : r.headingMargin;
        add(top, prose(block.text, m.width, minor ? r.minor : r.heading), bottom);
        break;
      }
      case "li": {
        // The paragraphs of a loose list's items collapse their margins with the item's.
        const between = block.loose ? Math.max(r.itemMargin, r.looseMargin) : r.itemMargin;
        add(
          between,
          prose(block.text, m.width - r.listIndent * (block.depth + 1)),
          block.last ? Math.max(between, r.listMargin) : between,
        );
        break;
      }
      case "code":
        add(r.block.margin, block.lines * r.block.line + r.block.chrome, r.block.margin);
        break;
      case "table":
        add(r.table.margin, tableHeight(owner, block.rows, m), r.table.margin);
        break;
      case "quote": {
        const width = m.width - r.quote.inset;
        const inner = block.lines
          .join("\n")
          .split(/\n\s*\n/)
          .reduce(
            (sum, part, index) =>
              sum + prose(part.replace(/\n/g, " "), width) + (index > 0 ? r.paragraph : 0),
            0,
          );
        add(r.quote.margin, inner + r.quote.chrome, r.quote.margin);
        break;
      }
      case "hr":
        add(r.rule.margin, r.rule.height, r.rule.margin);
        break;
    }
  // The last block keeps no margin of its own; the reply's margin follows.
  return height + r.edge;
}

/** The rows of a diff once its lines wrap at `columns` characters: the
 * changed lines and up to three lines of context on each side. */
export function diffRows(oldText: string, newText: string, columns: number) {
  const before = oldText.split("\n");
  const after = newText.split("\n");
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++;
  const wrapped = (line: string) => Math.max(1, Math.ceil(line.length / Math.max(1, columns)));
  let rows = 1;
  for (const line of before.slice(Math.max(0, start - 3), before.length - end + Math.min(3, end)))
    rows += wrapped(line);
  for (const line of after.slice(start, after.length - end)) rows += wrapped(line);
  return rows;
}

const DIFF_MAX_HEIGHT = 360;
const CONSOLE_MAX_HEIGHT = 220;
/** A console shows about a dozen lines; more text only scrolls. */
const CONSOLE_TEXT = 4000;

function toolHeight(item: ToolItem, m: ThreadMetrics, open = false) {
  const { call } = item;
  if (!open) return m.row;
  const diffs = call.content.filter((block) => block.type === "diff");
  const parts: number[] = [];
  const input = call.rawInput as { command?: unknown } | undefined;
  const command = typeof input?.command === "string" ? input.command : "";
  const output = call.content
    .map((block) =>
      block.type === "content" && block.content.type === "text" ? block.content.text : "",
    )
    .filter(Boolean)
    .join("\n");
  if (command || (output && item.items.length === 0)) {
    const text = (command ? `$ ${command}${output ? `\n${output}` : ""}` : output).slice(
      0,
      CONSOLE_TEXT,
    );
    const style = { ...m.reply.body, font: m.reply.code.font, lineHeight: m.reply.block.line };
    const lines = lineCount(item, text, style, m.width - m.diff.gutter - 22, true);
    parts.push(Math.min(CONSOLE_MAX_HEIGHT, lines * style.lineHeight + 18));
  }
  // Diffs wrap by characters here: Pierre's hunks and separators, not the
  // wrapping, are what this estimate misses (see docs/SESSIONS.md).
  const columns = Math.floor((m.width - m.diff.inset) / m.diff.advance);
  for (const diff of diffs)
    parts.push(
      Math.min(
        DIFF_MAX_HEIGHT,
        diffRows(diff.oldText ?? "", diff.newText, columns) * m.diff.line + m.diff.chrome,
      ),
    );
  // A subagent's own thread: about one row for each of its steps.
  if (item.items.length) parts.push(item.items.length * (m.row + m.gap));
  if (!parts.length) return m.row;
  return m.row + 8 + parts.reduce((sum, part) => sum + part, 0) + 8 * (parts.length - 1);
}

function userHeight(item: Extract<SessionItem, { kind: "user" }>, m: ThreadMetrics) {
  let height = m.user.chrome;
  for (const block of item.content)
    if (block.type === "text")
      height +=
        lineCount(item, block.text, m.user.text, m.user.width, true) * m.user.text.lineHeight;
    else if (block.type === "image") height += 160;
  if (item.queued || item.sent) height += 19;
  return height;
}

/** An estimate of a unit's height, with the space below it. `open` is the
 * reader's choice for a row that opens; `final` marks a turn's last reply. */
export function estimateUnit(
  unit: Unit,
  m: ThreadMetrics,
  options: { open?: boolean; final?: boolean } = {},
) {
  if ("explore" in unit) return m.row + m.gap;
  const { item } = unit;
  switch (item.kind) {
    case "user":
      return userHeight(item, m) + m.gap;
    case "agent":
      return replyHeight(item, item.text, m) + (options.final ? m.reply.bar : 0) + m.gap;
    case "tool":
      return toolHeight(item, m, options.open) + m.gap;
    case "compaction":
      return m.compaction + m.gap;
    default:
      return m.row + m.gap;
  }
}

/** A quick height without Pretext, for a unit far from the view until there
 * is idle time to measure its text: characters per line from the font size. */
export function roughUnit(
  unit: Unit,
  m: ThreadMetrics,
  options: { open?: boolean; final?: boolean } = {},
) {
  if ("explore" in unit) return m.row + m.gap;
  const { item } = unit;
  const lines = (text: string, style: TextStyle, width: number) => {
    const size = Number.parseFloat(/([\d.]+)px/.exec(style.font)?.[1] ?? "13");
    const perLine = Math.max(1, Math.floor(width / (size * 0.55)));
    let count = 0;
    for (const line of text.split("\n")) count += Math.max(1, Math.ceil(line.length / perLine));
    return count;
  };
  const r = m.reply;
  switch (item.kind) {
    case "user":
      return (
        m.user.chrome +
        item.content.reduce(
          (sum, block) =>
            sum +
            (block.type === "text"
              ? lines(block.text, m.user.text, m.user.width) * m.user.text.lineHeight
              : block.type === "image"
                ? 160
                : 0),
          0,
        ) +
        (item.queued || item.sent ? 19 : 0) +
        m.gap
      );
    case "agent": {
      const text = item.text.trim();
      const blocks = text.split(/\n\s*\n/).length;
      const rows = lines(text.replace(/\n\s*\n/g, "\n"), r.body, m.width);
      return (
        2 * r.edge +
        rows * r.body.lineHeight +
        (blocks - 1) * r.paragraph +
        (options.final ? r.bar : 0) +
        m.gap
      );
    }
    default:
      return estimateUnit(unit, m, options);
  }
}
