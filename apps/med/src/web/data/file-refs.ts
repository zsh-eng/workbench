import type { BrowseEntry } from "../../shared/browse";

// File references in an agent's text: `src/a.ts:12`, `src/a.ts:12-20`,
// `path#L12-L20`, an absolute path, a file:// or editor URL, or a GitHub blob
// link. A reference that names a file of the thread's checkout renders as a
// link that opens the file at its lines (`decorateFileRefs`); other text stays
// as it is. The Session pane and Notes use the same rules.

/** A file reference: a path and an optional line range. */
export interface FileTarget {
  path: string;
  line?: number;
  endLine?: number;
}
/** A reference that names a file of the checkout, by its path in the checkout. */
export type FileRef = FileTarget;

export function lineTarget(path: string, line?: string, end?: string): FileTarget {
  const start = line ? Number(line) : undefined;
  const last = end ? Number(end) : undefined;
  return {
    path,
    ...(start ? { line: start } : {}),
    ...(start && last && last > start ? { endLine: last } : {}),
  };
}

/** Read a path and lines from `path:12`, `path:12-20`, `path:12:4`, or `path#L12-L20`. */
function splitLines(value: string): FileTarget | null {
  // A query goes; a fragment after it, as in GitHub's `?plain=1#L12`, stays.
  let path = value.replace(/\?[^#]*/, "");
  const hash = path.indexOf("#");
  if (hash >= 0) {
    const fragment = path.slice(hash + 1);
    path = path.slice(0, hash);
    const github = /^L(\d+)(?:C\d+)?(?:-L?(\d+)(?:C\d+)?)?$/i.exec(fragment);
    if (github) return path ? lineTarget(path, github[1], github[2]) : null;
  }
  const suffix = /:(\d+)(?:[-–](\d+)|:\d+)?$/.exec(path);
  if (suffix) return lineTarget(path.slice(0, suffix.index), suffix[1], suffix[2]);
  return path ? { path } : null;
}

/** Read a link target. Accepts relative and absolute paths, file and editor
 * URLs, and GitHub blob links. Other web links are not file references. */
export function parseBriefHref(raw: string): FileTarget | null {
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
export function parseCodeTarget(text: string): FileTarget | null {
  const value = text.trim();
  if (!value || value.length > 300 || /\s/.test(value)) return null;
  const target = splitLines(value);
  if (!target || !(target.path.includes("/") || /\.[a-z][\w]{0,9}$/i.test(target.path)))
    return null;
  return target;
}

/** The lines of a reference as the app writes them: L12, or L12–20. */
export const lineLabel = (ref: Pick<FileTarget, "line" | "endLine">) =>
  ref.line ? `L${ref.line}${ref.endLine && ref.endLine > ref.line ? `–${ref.endLine}` : ""}` : "";

const basename = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** A path without `.` and `..` parts; null when it leaves its root. */
function clean(path: string) {
  const parts: string[] = [];
  for (const part of path.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return null;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

/** The checkout's files, to find the file that a reference names. */
export interface FileIndex {
  readonly root: string;
  /** The list holds every file, so a reference that it lacks names none. */
  readonly complete: boolean;
  /** The file of the checkout that a reference names, from the folder that
   * the agent worked in. */
  resolve(target: FileTarget, cwd?: string): FileRef | null;
}

/**
 * An index of a checkout's files. A reference resolves when it names a file
 * exactly: relative to the agent's folder, relative to the checkout, or as an
 * absolute path inside it. Otherwise a unique file whose path ends with it
 * wins, as `App.tsx:42` does in the brief.
 */
export function createFileIndex(
  root: string,
  entries: readonly BrowseEntry[],
  complete = true,
): FileIndex {
  const base = root.replace(/\/+$/, "");
  const files = new Set<string>();
  const byName = new Map<string, string[]>();
  for (const entry of entries) {
    if (entry.kind !== "file" && entry.kind !== "symlink") continue;
    files.add(entry.path);
    const name = basename(entry.path);
    const list = byName.get(name);
    if (list) list.push(entry.path);
    else byName.set(name, [entry.path]);
  }
  /** A path in the checkout, from an absolute one, or null outside it. */
  const inside = (path: string) => {
    for (const prefix of [base, base.replace(/^\/private(?=\/)/, "")])
      if (prefix && path.startsWith(`${prefix}/`)) return path.slice(prefix.length + 1);
    return null;
  };
  return {
    root: base,
    complete,
    resolve(target, cwd) {
      const raw = target.path.trim();
      if (!raw) return null;
      const range = {
        ...(target.line ? { line: target.line } : {}),
        ...(target.line && target.endLine ? { endLine: target.endLine } : {}),
      };
      const found = (path: string | null | undefined) =>
        path && files.has(path) ? { path, ...range } : null;
      if (raw.startsWith("/")) {
        const relative = inside(raw);
        return relative === null ? null : found(clean(relative));
      }
      const folder = cwd ? inside(cwd) : null;
      const fromCwd = folder ? clean(`${folder}/${raw}`) : null;
      const fromRoot = clean(raw);
      const exact = found(fromCwd) ?? found(fromRoot);
      if (exact || !fromRoot) return exact;
      // Agents write paths from other folders too: a unique file wins.
      const matches = (byName.get(basename(fromRoot)) ?? []).filter((path) =>
        path.endsWith(`/${fromRoot}`),
      );
      return matches.length === 1 ? found(matches[0]) : null;
    },
  };
}

const FILE_REF = "med-file-ref";
const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The names that a message's links show: a file's name, with its folders
 * when another file of the message has the same name. */
export function refLabels(paths: readonly string[]) {
  const unique = [...new Set(paths)];
  const labels = new Map<string, string>();
  for (const path of unique) {
    const parts = path.split("/");
    let size = 1;
    while (
      size < parts.length &&
      unique.some(
        (other) =>
          other !== path &&
          other.split("/").slice(-size).join("/") === parts.slice(-size).join("/"),
      )
    )
      size++;
    labels.set(path, parts.slice(-size).join("/"));
  }
  return labels;
}

/** What a link to a file says when the pointer rests on it. */
export const refTitle = (ref: FileRef) =>
  `${ref.path}${ref.line ? `:${ref.line}${ref.endLine ? `–${ref.endLine}` : ""}` : ""}`;

/** The attributes and parts of a link to a file, as HTML. */
export function fileRefHtml(ref: FileRef, label: string) {
  const lines = lineLabel(ref);
  return (
    `<a href="#" class="${FILE_REF}" data-file-path="${escape(ref.path)}"` +
    (ref.line ? ` data-file-line="${ref.line}"` : "") +
    (ref.endLine ? ` data-file-end="${ref.endLine}"` : "") +
    ` data-tooltip="${escape(refTitle(ref))}"` +
    ` aria-label="${escape(`Open ${ref.path}${lines ? ` at ${lines}` : ""}`)}">` +
    `<span class="${FILE_REF}-name">${escape(label)}</span>` +
    (lines ? `<span class="${FILE_REF}-lines">${lines}</span>` : "") +
    `</a>`
  );
}

/** The file that a rendered link names, from its attributes. */
export function fileRefOf(element: Element): FileRef | null {
  const link = element.closest<HTMLElement>(`a.${FILE_REF}`);
  const path = link?.dataset.filePath;
  if (!link || !path) return null;
  const line = Number(link.dataset.fileLine) || undefined;
  const endLine = Number(link.dataset.fileEnd) || undefined;
  return { path, ...(line ? { line } : {}), ...(line && endLine ? { endLine } : {}) };
}

/** A pull request's repository, `owner/name`, and its head commit. */
export interface PullRequestHead {
  repo: string;
  head: string;
}
/** How a comment links files, beyond what a reply links. */
export interface RefOptions {
  /** Paths in the text itself link too, as in a prompt. */
  text?: boolean;
  /** GitHub links to a file of this repository at this head link to the file. */
  github?: PullRequestHead;
}

/** A GitHub link to a file of the pull request's repository at its head
 * commit; a link to another repository or commit is a web link. */
function headBlob(href: string, github: PullRequestHead) {
  const link = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/blob\/([0-9a-f]{7,40})\//i.exec(href);
  if (!link || link[1]!.toLowerCase() !== github.repo.toLowerCase()) return null;
  if (!github.head.toLowerCase().startsWith(link[2]!.toLowerCase())) return null;
  return parseBriefHref(href);
}

/**
 * Links in rendered Markdown blocks: inline code and links that name a file
 * of the checkout become links to the file, which show its name and lines.
 * A relative link that names no file loses its link, when the index has
 * every file. Web links, code blocks, and other text stay as they are; with
 * `options`, a comment's paths in its text and its GitHub links to the head
 * link too.
 */
export function decorateFileRefs<T extends { html: string }>(
  blocks: readonly T[],
  index: FileIndex,
  cwd?: string,
  options: RefOptions = {},
): T[] {
  const templates = blocks.map((block) => {
    if (!options.text && !/<code|data-brief-href/.test(block.html)) return null;
    const template = document.createElement("template");
    template.innerHTML = block.html;
    return template;
  });
  const found: { node: Element; ref: FileRef; keepText: boolean }[] = [];
  const dead: Element[] = [];
  for (const template of templates) {
    if (!template) continue;
    for (const node of template.content.querySelectorAll("a[data-brief-href], code")) {
      if (node.tagName === "CODE") {
        if (node.closest("pre, a")) continue;
        const target = parseCodeTarget(node.textContent ?? "");
        const ref = target && index.resolve(target, cwd);
        if (ref) found.push({ node, ref, keepText: false });
        continue;
      }
      const href = (node as HTMLElement).dataset.briefHref ?? "";
      // Web links stay web links, GitHub's too unless they name the head's files.
      const web = /^https?:/i.test(href);
      if (web && !options.github) continue;
      const target = web ? headBlob(href, options.github!) : parseBriefHref(href);
      const ref = target && index.resolve(target, cwd);
      if (ref) {
        // A link whose text is its path shows the file's name; other words stay.
        const text = (node.textContent ?? "").trim();
        const named = parseCodeTarget(text);
        const same = !text || (named && basename(named.path) === basename(ref.path));
        found.push({ node, ref, keepText: !same });
      } else if (index.complete && !web) dead.push(node);
    }
  }
  // Paths in the text, outside code and links.
  const texts: { node: Text; parts: NonNullable<ReturnType<typeof textFileRefs>> }[] = [];
  if (options.text)
    for (const template of templates) {
      if (!template) continue;
      const walker = document.createTreeWalker(template.content, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.parentElement?.closest("pre, code, a")) continue;
        const parts = textFileRefs(node.textContent ?? "", index, cwd);
        if (parts) texts.push({ node: node as Text, parts });
      }
    }
  if (!found.length && !dead.length && !texts.length) return [...blocks];
  const labels = refLabels([
    ...found.map((entry) => entry.ref.path),
    ...texts.flatMap(({ parts }) =>
      parts.flatMap((part) => (typeof part === "string" ? [] : [part.ref.path])),
    ),
  ]);
  const linkTo = (ref: FileRef) => {
    const holder = document.createElement("template");
    holder.innerHTML = fileRefHtml(ref, labels.get(ref.path)!);
    return holder.content.firstElementChild!;
  };
  for (const { node, parts } of texts)
    node.replaceWith(...parts.map((part) => (typeof part === "string" ? part : linkTo(part.ref))));
  for (const { node, ref, keepText } of found) {
    const link = linkTo(ref);
    if (keepText) {
      // The author's words, with the file's lines after them.
      link.querySelector(`.${FILE_REF}-name`)!.replaceChildren(...node.childNodes);
      link.classList.add(`${FILE_REF}-text`);
    }
    node.replaceWith(link);
  }
  // A relative link to no file of the checkout is text.
  for (const node of dead) node.replaceWith(...node.childNodes);
  return blocks.map((block, at) =>
    templates[at] ? { ...block, html: templates[at].innerHTML } : block,
  );
}

const PATH_WORD = /[^\s"'`()<>[\]{}]+/g;
/** The parts of plain text, such as a prompt, with the words that name a file
 * of the checkout as references. */
export function textFileRefs(text: string, index: FileIndex, cwd?: string) {
  const parts: (string | { text: string; ref: FileRef })[] = [];
  let last = 0;
  for (const match of text.matchAll(PATH_WORD)) {
    // A sentence's last stop or comma is not part of the path.
    const word = match[0].replace(/[.,;:!?]+$/, "");
    if (!word.includes("/") && !/\.[a-z][\w]{0,9}(?::\d+(?:[-–]\d+)?)?$/i.test(word)) continue;
    const target = word.startsWith("file://") ? parseBriefHref(word) : parseCodeTarget(word);
    const ref = target && index.resolve(target, cwd);
    if (!ref) continue;
    if (match.index > last) parts.push(text.slice(last, match.index));
    parts.push({ text: word, ref });
    last = match.index + word.length;
  }
  if (!parts.length) return null;
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

/** What a path that names a file shows in its place, for height estimates:
 * its name and lines, with room for the icon. The estimate does not know the
 * checkout's files, so it takes every path with a folder for a file. */
export function refEstimate(word: string) {
  if (!word.includes("/")) return null;
  const target = word.startsWith("file://") ? parseBriefHref(word) : parseCodeTarget(word);
  if (!target) return null;
  const lines = lineLabel(target);
  return `  ${basename(target.path)}${lines ? ` ${lines}` : ""}`;
}

/** Plain text with each path that has a folder in its estimated place. */
export const textEstimate = (text: string) =>
  text.includes("/")
    ? text.replace(PATH_WORD, (match) => {
        const word = match.replace(/[.,;:!?]+$/, "");
        const shown = refEstimate(word);
        return shown ? shown + match.slice(word.length) : match;
      })
    : text;
