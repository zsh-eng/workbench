/** Lines of context above and below each match, as Zed's project search shows. */
export const CONTEXT_LINES = 2;

/** One excerpt of a file: its first and last line, and the matches in it. */
export interface Excerpt {
  start: number;
  end: number;
  matches: number[];
}

/** Excerpts around the matched lines, in line order. Matches whose context
 * meets or overlaps share one excerpt. `total` clamps the last line when the
 * file's length is known. */
export function excerpts(lines: readonly number[], total?: number, context = CONTEXT_LINES) {
  const result: Excerpt[] = [];
  for (const line of [...new Set(lines)].sort((a, b) => a - b)) {
    const start = Math.max(1, line - context);
    const end =
      total === undefined ? line + context : Math.max(line, Math.min(total, line + context));
    const last = result.at(-1);
    if (last && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
      last.matches.push(line);
    } else result.push({ start, end, matches: [line] });
  }
  return result;
}

/** Whether a file's lines, as read, still hold each match's line: a working
 * file can change after the search. A long line's match text is a part of
 * it, cut with ellipses. */
export function agrees(
  lines: readonly string[],
  matches: readonly { line: number; text: string }[],
) {
  return matches.every(
    ({ line, text }) =>
      lines[line - 1]?.includes(text.replace(/^…/, "").replace(/…$/, "")) ?? false,
  );
}

/** Where `needle` occurs in `text`, as [start, end) offsets, in any case
 * unless `matchCase`. */
export function occurrences(text: string, needle: string, matchCase: boolean) {
  const found: [number, number][] = [];
  if (!needle) return found;
  const haystack = matchCase ? text : text.toLowerCase();
  const wanted = matchCase ? needle : needle.toLowerCase();
  // A letter whose lower case has another length would shift the offsets.
  if (haystack.length !== text.length || wanted.length !== needle.length) return found;
  for (
    let at = haystack.indexOf(wanted);
    at >= 0;
    at = haystack.indexOf(wanted, at + wanted.length)
  )
    found.push([at, at + wanted.length]);
  return found;
}

/** A run of text in one syntax color; no color is the theme's text color. */
export interface Token {
  text: string;
  color?: string;
}

interface Hast {
  type: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: Hast[];
}

/** The colored runs of one highlighted line from Pierre's worker (a `div`
 * of `span`s with `color:` styles), or undefined when its text is not `line`. */
export function tokensOf(row: unknown, line: string): Token[] | undefined {
  const tokens: Token[] = [];
  const walk = (node: Hast, color: string | undefined) => {
    if (node.type === "text") {
      if (node.value) tokens.push({ text: node.value, color });
      return;
    }
    if (node.type !== "element") return;
    const style = node.properties?.style;
    const own =
      typeof style === "string" ? /(?:^|;)\s*color:\s*([^;]+)/.exec(style)?.[1] : undefined;
    for (const child of node.children ?? []) walk(child, own?.trim() ?? color);
  };
  if (row && typeof row === "object") walk(row as Hast, undefined);
  const last = tokens.at(-1);
  if (last) last.text = last.text.replace(/\r?\n$/, "");
  return tokens.map((token) => token.text).join("") === line ? tokens : undefined;
}

/** A piece of a line to draw: its text, color, and the match that holds it (or -1). */
export interface Piece extends Token {
  mark: number;
}

/** Long lines start near their first match, as the search snippets do. */
const LEAD = 40;
const LONG = 120;

/** Splits a line's tokens at the matches. A line whose first match is far to
 * the right starts shortly before it, after an ellipsis. */
export function pieces(tokens: readonly Token[], marks: readonly [number, number][]) {
  const result: Piece[] = [];
  const first = marks[0]?.[0] ?? 0;
  const cut = first > LONG ? first - LEAD : 0;
  if (cut) result.push({ text: "…", mark: -1 });
  let offset = 0;
  for (const token of tokens) {
    const end = offset + token.text.length;
    let at = Math.max(offset, cut);
    while (at < end) {
      const index = marks.findIndex(([, stop]) => stop > at);
      const mark = index >= 0 && marks[index]![0] <= at ? index : -1;
      const next = Math.min(end, mark >= 0 ? marks[mark]![1] : index >= 0 ? marks[index]![0] : end);
      result.push({ text: token.text.slice(at - offset, next - offset), color: token.color, mark });
      at = next;
    }
    offset = end;
  }
  return result;
}
