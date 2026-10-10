import type { FileDiffMetadata } from "@pierre/diffs";
import { parseReviewPatch, type ParsedReviewFile } from "../../shared/review";
import type { MarkdownBlock } from "../markdown/model";

/** A file reference in a brief: a path and an optional line range. */
export interface BriefTarget {
  path: string;
  line?: number;
  endLine?: number;
}
export interface ExcerptRange {
  side: "old" | "new";
  start: number;
  end: number;
}
export interface BriefExcerpt {
  key: string;
  fileId: string;
  range: ExcerptRange;
}
export interface AnnotatedBrief {
  blocks: MarkdownBlock[];
  excerpts: BriefExcerpt[];
  /** Changed files that the brief links to, in first-mention order. */
  cited: string[];
}

const MAX_EXCERPTS = 40;

function lines(path: string, line?: string, end?: string): BriefTarget {
  const start = line ? Number(line) : undefined;
  const last = end ? Number(end) : undefined;
  return {
    path,
    ...(start ? { line: start } : {}),
    ...(start && last && last > start ? { endLine: last } : {}),
  };
}

/** Read a path and lines from `path:12`, `path:12-20`, `path:12:4`, or `path#L12-L20`. */
function splitLines(value: string): BriefTarget | null {
  let path = value.split("?")[0]!;
  const hash = path.indexOf("#");
  if (hash >= 0) {
    const fragment = path.slice(hash + 1);
    path = path.slice(0, hash);
    const github = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i.exec(fragment);
    if (github) return path ? lines(path, github[1], github[2]) : null;
  }
  const suffix = /:(\d+)(?:[-–](\d+)|:\d+)?$/.exec(path);
  if (suffix) return lines(path.slice(0, suffix.index), suffix[1], suffix[2]);
  return path ? { path } : null;
}

/** Read a link target. Accepts relative and absolute paths, file and editor
 * URLs, and GitHub blob links. Other web links are not file references. */
export function parseBriefHref(raw: string): BriefTarget | null {
  let href = raw.trim();
  if (!href || href.startsWith("#") || /^mailto:/i.test(href)) return null;
  try {
    href = decodeURI(href);
  } catch {
    return null;
  }
  const github = /^https?:\/\/github\.com\/[^/]+\/[^/]+\/(?:blob|tree)\/[^/]+\/(.+)$/i.exec(href);
  if (github) return splitLines(github[1]!);
  if (/^https?:/i.test(href)) return null;
  // file:///path and editor links such as vscode://file/path:12.
  href = href.replace(/^file:\/\//i, "").replace(/^[a-z][\w+.-]*:\/\/file(?=\/)/i, "");
  if (/^[a-z][\w+.-]*:\/\//i.test(href)) return null;
  return splitLines(href);
}

/** Inline code names a file only when it looks like a path or file name. */
export function parseCodeTarget(text: string): BriefTarget | null {
  const value = text.trim();
  if (!value || value.length > 300 || /\s/.test(value)) return null;
  const target = splitLines(value);
  if (!target || !(target.path.includes("/") || /\.[a-z][\w]{0,9}$/i.test(target.path)))
    return null;
  return target;
}

function normalize(path: string) {
  return path
    .replace(/\\/g, "/")
    .replace(/^(?:\.{1,2}\/)+/, "")
    .replace(/\/{2,}/g, "/");
}

/** Match a reference to one changed file: exactly, then by a unique path suffix
 * in either direction. Agents write paths relative to different folders. */
export function matchReviewFile(
  target: BriefTarget,
  files: ParsedReviewFile[],
  root?: string,
): ParsedReviewFile | undefined {
  let path = normalize(target.path);
  if (root && path.startsWith(`${root.replace(/\/$/, "")}/`))
    path = path.slice(root.replace(/\/$/, "").length + 1);
  path = path.replace(/^\//, "");
  if (!path) return;
  const names = (file: ParsedReviewFile) =>
    file.info.previousPath ? [file.path, file.info.previousPath] : [file.path];
  const exact = files.filter((file) => names(file).includes(path));
  if (exact.length) return exact[0];
  const suffix = files.filter((file) =>
    names(file).some((name) => path.endsWith(`/${name}`) || name.endsWith(`/${path}`)),
  );
  return suffix.length === 1 ? suffix[0] : undefined;
}

interface Row {
  kind: " " | "-" | "+";
  text: string;
  old: number;
  new: number;
  hunk: number;
}
/** Every patch row with its line numbers. Removed rows carry the next new line;
 * added rows carry the next old line, so a range on one side selects both. */
function patchRows(metadata: FileDiffMetadata): Row[] {
  const rows: Row[] = [];
  metadata.hunks.forEach((hunk, index) => {
    let oldLine = hunk.deletionCount ? hunk.deletionStart : hunk.deletionStart + 1;
    let newLine = hunk.additionCount ? hunk.additionStart : hunk.additionStart + 1;
    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        for (let i = 0; i < content.lines; i++)
          rows.push({
            kind: " ",
            text: metadata.additionLines[content.additionLineIndex + i] ?? "",
            old: oldLine++,
            new: newLine++,
            hunk: index,
          });
        continue;
      }
      for (let i = 0; i < content.deletions; i++)
        rows.push({
          kind: "-",
          text: metadata.deletionLines[content.deletionLineIndex + i] ?? "",
          old: oldLine++,
          new: newLine,
          hunk: index,
        });
      for (let i = 0; i < content.additions; i++)
        rows.push({
          kind: "+",
          text: metadata.additionLines[content.additionLineIndex + i] ?? "",
          old: oldLine,
          new: newLine++,
          hunk: index,
        });
    }
  });
  return rows;
}

function toPatch(metadata: FileDiffMetadata, rows: Row[]) {
  const before = metadata.prevName ?? metadata.name;
  const groups: Row[][] = [];
  for (const row of rows) {
    const group = groups.at(-1);
    if (group && group[0]!.hunk === row.hunk) group.push(row);
    else groups.push([row]);
  }
  return [
    `diff --git a/${before} b/${metadata.name}`,
    metadata.type === "new" ? "--- /dev/null" : `--- a/${before}`,
    metadata.type === "deleted" ? "+++ /dev/null" : `+++ b/${metadata.name}`,
    ...groups.flatMap((group) => {
      const old = group.filter((row) => row.kind !== "+");
      const next = group.filter((row) => row.kind !== "-");
      // A side without rows names the line before the change, as Git does.
      const oldStart = old.length ? old[0]!.old : group[0]!.old - 1;
      const newStart = next.length ? next[0]!.new : group[0]!.new - 1;
      return [
        `@@ -${oldStart},${old.length} +${newStart},${next.length} @@`,
        ...group.map((row) => row.kind + row.text.replace(/\r?\n$/, "")),
      ];
    }),
    "",
  ].join("\n");
}

export interface Excerpt {
  metadata: FileDiffMetadata;
  rows: number;
  additions: number;
  deletions: number;
  /** Rows of the cited range left out to keep the excerpt short. */
  hidden: number;
  /** Line numbers shown on each side, for notes on those lines. */
  lines: { old: number[]; new: number[] };
}
function excerptFrom(metadata: FileDiffMetadata, rows: Row[], hidden: number): Excerpt | null {
  const parsed = parseReviewPatch(toPatch(metadata, rows))[0];
  if (!parsed) return null;
  return {
    metadata: parsed,
    rows: rows.length,
    additions: rows.filter((row) => row.kind === "+").length,
    deletions: rows.filter((row) => row.kind === "-").length,
    hidden,
    lines: {
      old: rows.filter((row) => row.kind !== "+").map((row) => row.old),
      new: rows.filter((row) => row.kind !== "-").map((row) => row.new),
    },
  };
}

/** The changed rows of a cited range, with a little context from the same hunk.
 * Returns null when no changed hunk covers the range. */
export function diffExcerpt(
  file: ParsedReviewFile,
  range: ExcerptRange,
  { context = 3, maxRows = 20 } = {},
): Excerpt | null {
  if (!file.metadata) return null;
  const rows = patchRows(file.metadata);
  const at = (row: Row) => (range.side === "new" ? row.new : row.old);
  const first = rows.findIndex((row) => at(row) >= range.start && at(row) <= range.end);
  if (first < 0) return null;
  let last = first;
  for (let index = first; index < rows.length; index++)
    if (at(rows[index]!) >= range.start && at(rows[index]!) <= range.end) last = index;
  let from = first;
  let to = last;
  for (let n = 0; n < context && from > 0 && rows[from - 1]!.hunk === rows[first]!.hunk; n++)
    from--;
  for (
    let n = 0;
    n < context && to < rows.length - 1 && rows[to + 1]!.hunk === rows[last]!.hunk;
    n++
  )
    to++;
  const selected = rows.slice(from, to + 1);
  return excerptFrom(
    file.metadata,
    selected.slice(0, maxRows),
    Math.max(0, selected.length - maxRows),
  );
}

/** Unchanged cited lines, read from the captured file text. Line numbers on the
 * other side shift by the size of earlier hunks. */
export function sourceExcerpt(
  file: ParsedReviewFile,
  range: ExcerptRange,
  text: string,
  { context = 2, maxRows = 20 } = {},
): Excerpt | null {
  if (!file.metadata) return null;
  const source = text.split("\n");
  if (source.at(-1) === "") source.pop();
  const from = Math.max(1, range.start - context);
  const to = Math.min(source.length, range.end + context);
  if (from > to) return null;
  const shift = (line: number) =>
    file.metadata!.hunks.reduce((total, hunk) => {
      const end =
        range.side === "new"
          ? hunk.additionStart + Math.max(hunk.additionCount, 1) - 1
          : hunk.deletionStart + Math.max(hunk.deletionCount, 1) - 1;
      return end < line ? total + hunk.additionCount - hunk.deletionCount : total;
    }, 0);
  const rows: Row[] = [];
  for (let line = from; line <= to && rows.length < maxRows; line++) {
    const other = range.side === "new" ? line - shift(line) : line + shift(line);
    rows.push({
      kind: " ",
      text: source[line - 1] ?? "",
      old: range.side === "new" ? other : line,
      new: range.side === "new" ? line : other,
      hunk: 0,
    });
  }
  return excerptFrom(file.metadata, rows, Math.max(0, to - from + 1 - rows.length));
}

// `:203` or `L203` after a file reference cites more lines of that file.
const continuation = /^(?::|L)(\d+)(?:[-–](?::|L)?(\d+))?$/;

/**
 * The notes as one Markdown text, so they render in one pass with unique
 * heading IDs, and the line where each note after the first starts.
 */
export function joinNotes(texts: readonly string[]): { text: string; starts: number[] } {
  let text = "";
  let line = 1;
  const starts: number[] = [];
  texts.forEach((value, index) => {
    let body = value.trim();
    // An open code fence would take in the notes after it.
    if ((body.match(/^ {0,3}(?:```|~~~)/gm)?.length ?? 0) % 2) body += "\n```";
    if (index > 0) {
      text += "\n\n";
      line += 2;
      starts.push(line);
    }
    text += body;
    line += body.split("\n").length - 1;
  });
  return { text, starts };
}

/** Mark resolved references in rendered Markdown and place excerpt slots after
 * the paragraph or list item that first cites each range. With `starts`, the
 * lines where later notes begin, each note shows its own excerpts. */
export function annotateBrief(
  blocks: MarkdownBlock[],
  files: ParsedReviewFile[],
  root?: string,
  starts: readonly number[] = [],
): AnnotatedBrief {
  const excerpts: BriefExcerpt[] = [];
  const placed = new Set<string>();
  const cited: string[] = [];
  let section = 0;
  const annotated = blocks.map((block) => {
    const next = starts.filter((start) => start <= block.start).length;
    if (next !== section) {
      section = next;
      placed.clear();
    }
    if (block.diagram !== undefined) return block;
    const template = document.createElement("template");
    template.innerHTML = block.html;
    const lastSlot = new Map<Element, Element>();
    let previous: ParsedReviewFile | undefined;
    for (const node of template.content.querySelectorAll<HTMLElement>("a[data-brief-href], code")) {
      const isCode = node.tagName === "CODE";
      if (isCode && node.closest("pre, a")) continue;
      let target: BriefTarget | null;
      const text = node.textContent ?? "";
      const more = isCode ? continuation.exec(text.trim()) : null;
      if (more && previous) target = lines(previous.path, more[1], more[2]);
      else target = isCode ? parseCodeTarget(text) : parseBriefHref(node.dataset.briefHref ?? "");
      const file = target && matchReviewFile(target, files, root);
      if (!file || !target) {
        if (isCode || /^https?:/i.test(node.dataset.briefHref ?? "")) continue;
        if (target && !target.path.startsWith("/")) {
          // A relative path outside the changed files opens the current file.
          node.dataset.briefPath = normalize(target.path);
          if (target.line) node.dataset.briefLine = String(target.line);
          node.setAttribute("href", "#");
          node.title = `${node.dataset.briefPath} · Open file`;
        } else {
          node.removeAttribute("href");
          node.title = "This link is not part of the review.";
        }
        continue;
      }
      previous = file;
      if (!cited.includes(file.id)) cited.push(file.id);
      const range: ExcerptRange | undefined = target.line
        ? {
            side: file.metadata?.type === "deleted" ? "old" : "new",
            start: target.line,
            end: target.endLine ?? target.line,
          }
        : undefined;
      const key =
        (section ? `${section}/` : "") +
        (range ? `${file.id}:${range.side}:${range.start}-${range.end}` : file.id);
      let link = node;
      if (isCode) {
        link = document.createElement("a");
        node.replaceWith(link);
        link.append(node);
      }
      link.setAttribute("href", "#");
      link.className = "med-brief-ref";
      link.dataset.briefRef = key;
      link.dataset.briefFile = file.id;
      if (range) {
        link.dataset.briefSide = range.side;
        link.dataset.briefStart = String(range.start);
        link.dataset.briefEnd = String(range.end);
      }
      link.title = `${file.path}${range ? `:${range.start}${range.end > range.start ? `–${range.end}` : ""}` : ""} · Open in Changes`;
      if (!range || placed.has(key) || excerpts.length >= MAX_EXCERPTS) continue;
      placed.add(key);
      excerpts.push({ key, fileId: file.id, range });
      const slot = document.createElement("div");
      slot.dataset.briefSlot = key;
      const item = link.closest("li");
      const container = item ?? link.closest("p, h1, h2, h3, h4, h5, h6, blockquote");
      const after = container && lastSlot.get(container);
      if (after) after.after(slot);
      else if (item) {
        // Excerpts sit under the item's own text, above any nested list.
        const nested = [...item.children].find(
          (child) => (child.tagName === "UL" || child.tagName === "OL") && !child.contains(link),
        );
        item.insertBefore(slot, nested ?? null);
      } else if (container) container.after(slot);
      else template.content.append(slot);
      if (container) lastSlot.set(container, slot);
    }
    return { ...block, html: template.innerHTML };
  });
  return { blocks: annotated, excerpts, cited };
}

function inlineMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
  if (!(node instanceof HTMLElement)) return "";
  const inner = () => [...node.childNodes].map(inlineMarkdown).join("");
  switch (node.tagName) {
    case "A": {
      const href = node.getAttribute("href");
      return href ? `[${inner()}](${href.replace(/[()]/g, encodeURIComponent)})` : inner();
    }
    case "CODE":
      return `\`${node.textContent ?? ""}\``;
    case "STRONG":
    case "B":
      return `**${inner()}**`;
    case "EM":
    case "I":
      return `_${inner()}_`;
    case "BR":
      return "\n";
    default:
      return inner();
  }
}
function blockMarkdown(node: Node, depth = 0): string {
  if (!(node instanceof HTMLElement)) return inlineMarkdown(node).trim();
  const children = () =>
    [...node.childNodes]
      .map((child) => blockMarkdown(child, depth))
      .filter(Boolean)
      .join("\n\n");
  const heading = /^H([1-6])$/.exec(node.tagName);
  if (heading) return `${"#".repeat(Number(heading[1]))} ${inlineMarkdown(node).trim()}`;
  switch (node.tagName) {
    case "PRE":
      return `\`\`\`\n${(node.textContent ?? "").replace(/\n$/, "")}\n\`\`\``;
    case "UL":
    case "OL":
      return [...node.children]
        .filter((child) => child.tagName === "LI")
        .map((item, index) => {
          const marker = node.tagName === "OL" ? `${index + 1}.` : "-";
          const parts = [...item.childNodes];
          const text = parts
            .filter((part) => !(part instanceof HTMLElement && /^(UL|OL)$/.test(part.tagName)))
            .map(inlineMarkdown)
            .join("")
            .trim();
          const nested = parts
            .filter((part) => part instanceof HTMLElement && /^(UL|OL)$/.test(part.tagName))
            .map((part) => blockMarkdown(part, depth + 1))
            .join("\n");
          return `${"  ".repeat(depth)}${marker} ${text}${nested ? `\n${nested}` : ""}`;
        })
        .join("\n");
    case "BLOCKQUOTE":
      return children()
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    case "P":
    case "TR":
      return inlineMarkdown(node).trim();
    case "DIV":
    case "SECTION":
    case "ARTICLE":
    case "BODY":
    case "TABLE":
    case "TBODY":
    case "THEAD":
      return children();
    default:
      return /^(SPAN|A|CODE|STRONG|B|EM|I)$/.test(node.tagName)
        ? inlineMarkdown(node).trim()
        : children();
  }
}

/** Convert copied rich text to Markdown, keeping link targets. */
export function htmlToMarkdown(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");
  return blockMarkdown(document.body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Copy buttons put Markdown in plain text. A copied selection keeps link
 * targets only in its HTML, so prefer that when the plain text lost them. */
export function clipboardBrief(data: DataTransfer | null): string {
  const plain = data?.getData("text/plain") ?? "";
  const html = data?.getData("text/html") ?? "";
  if (html && /<a\s[^>]*href=/i.test(html) && !/\]\([^)\s]+\)/.test(plain))
    return htmlToMarkdown(html);
  return plain.trim();
}

/** A review title from the brief's first heading or first line. */
export function briefTitle(text: string): string {
  const heading = /^#{1,6}\s+(.+)$/m.exec(text)?.[1];
  const line = text.split("\n").find((entry) => entry.trim()) ?? "";
  const plain = (heading ?? line)
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "Review brief";
  return plain.length > 80 ? `${plain.slice(0, 79).trimEnd()}…` : plain;
}

/** Changed files that a brief's links and inline code name, without rendering it. */
export function countCitedFiles(text: string, files: ParsedReviewFile[], root?: string): number {
  const cited = new Set<string>();
  for (const [, href] of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = parseBriefHref(href!);
    const file = target && matchReviewFile(target, files, root);
    if (file) cited.add(file.id);
  }
  for (const [, code] of text.matchAll(/`([^`\n]+)`/g)) {
    const target = parseCodeTarget(code!);
    const file = target && matchReviewFile(target, files, root);
    if (file) cited.add(file.id);
  }
  return cited.size;
}
