import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import { dirname, posix } from "node:path";

interface Node {
  type: string;
  url?: string;
  identifier?: string;
  children?: Node[];
  position?: { start: { offset?: number; line: number }; end: { offset?: number } };
}
export interface NoteLink {
  destination: string;
  fragment: string;
  line: number;
  offset: number;
  embed: boolean;
  syntax: "wiki" | "markdown";
}
// GFM table/strikethrough rendering is not needed to extract links.
// Keep the Markdown parser for escapes, definitions, code/HTML exclusions and positions.
const parser = unified().use(remarkParse).use(remarkMath);
const external = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;

/** Parse Markdown once, without rendering, highlighting, math, or diagrams. */
export function noteLinks(input: string): NoteLink[] {
  if (!input.includes("[")) return [];
  // YAML frontmatter is metadata, not visible note text. Preserve all source offsets.
  const source = input.replace(
    /^(?:\uFEFF)?---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)(?:\r?\n|$)/,
    (match) => match.replace(/[^\r\n]/g, " "),
  );
  const tree = parser.parse(source) as Node;
  const definitions = new Map<string, string>();
  const links: NoteLink[] = [];
  const define = (node: Node) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier.toLowerCase(), node.url);
    node.children?.forEach(define);
  };
  define(tree);
  const add = (
    raw: string,
    line: number,
    offset: number,
    embed: boolean,
    syntax: NoteLink["syntax"],
  ) => {
    if (external.test(raw.trim())) return;
    const target = syntax === "wiki" ? raw.split("|")[0]!.trim() : raw.trim();
    const hash = target.indexOf("#");
    let destination = hash < 0 ? target : target.slice(0, hash);
    try {
      destination = decodeURIComponent(destination);
    } catch {
      /* Keep literal invalid escapes. */
    }
    links.push({
      destination,
      fragment: hash < 0 ? "" : target.slice(hash + 1),
      line,
      offset,
      embed,
      syntax,
    });
  };
  const visit = (node: Node) => {
    const start = node.position?.start;
    if (
      node.type === "link" ||
      node.type === "image" ||
      node.type === "linkReference" ||
      node.type === "imageReference"
    ) {
      const url = node.url ?? definitions.get(node.identifier?.toLowerCase() ?? "");
      if (url !== undefined && start)
        add(url, start.line, start.offset ?? 0, node.type.startsWith("image"), "markdown");
      return;
    }
    if (node.type === "text" && start?.offset !== undefined) {
      const text = source.slice(start.offset, node.position!.end.offset);
      for (const match of text.matchAll(/!?\[\[([^\]\r\n]+)\]\]/g)) {
        let slash = match.index - 1;
        while (slash >= 0 && text[slash] === "\\") slash--;
        if ((match.index - 1 - slash) % 2) continue;
        add(
          match[1]!,
          start.line + text.slice(0, match.index).split("\n").length - 1,
          start.offset + match.index,
          match[0].startsWith("!"),
          "wiki",
        );
      }
    }
    // Code, math, raw HTML and definitions have no traversable visible text children.
    if (node.type !== "definition") node.children?.forEach(visit);
  };
  visit(tree);
  return links;
}

export function resolver(paths: Iterable<string>) {
  const exact = new Set(paths);
  const names = new Map<string, string[]>();
  for (const path of exact) {
    const name = posix.basename(path);
    names.set(name, [...(names.get(name) ?? []), path]);
  }
  return (
    source: string,
    link: Pick<NoteLink, "destination" | "syntax">,
  ): { target: string | null; reason: string | null } => {
    if (!link.destination) return { target: source, reason: null };
    const destination = link.destination.replace(/\\/g, "/");
    if (destination.startsWith("/") || destination.includes("\0"))
      return { target: null, reason: "outside-vault" };
    const candidates = /\.(?:md|markdown)$/i.test(destination)
      ? [destination]
      : [destination, `${destination}.md`];
    for (const candidate of candidates) {
      const relative = posix.normalize(posix.join(dirname(source), candidate));
      const root = posix.normalize(candidate);
      const choices = link.syntax === "markdown" ? [relative, root] : [root, relative];
      for (const choice of choices)
        if (!choice.startsWith("../") && exact.has(choice)) return { target: choice, reason: null };
    }
    if (destination.includes("/")) return { target: null, reason: "missing" };
    for (const candidate of candidates) {
      const matches = names.get(candidate) ?? [];
      if (matches.length === 1) return { target: matches[0]!, reason: null };
      if (matches.length > 1) return { target: null, reason: "ambiguous" };
    }
    return { target: null, reason: "missing" };
  };
}
