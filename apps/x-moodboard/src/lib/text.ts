/** Lowercase and remove diacritics so "Café" matches "cafe". */
export function fold(value: string): string {
  return value.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const TCO = /https?:\/\/t\.co\/[A-Za-z0-9]+/g;

/** Short excerpt for a card: no t.co links, collapsed spaces, at most two blank lines. */
export function cardText(text: string): string {
  return text
    .replace(TCO, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function firstLine(text: string): string {
  const clean = cardText(text);
  const line = clean.split("\n").find((l) => l.trim()) ?? "";
  return line.trim();
}

/** Text for an article preview card: the body after "Article" and the title lines. */
export function articleBody(text: string, title: string | null): string {
  if (!title) return text;
  const lines = text.split("\n");
  return lines[0].trim() === "Article" && lines[1]?.trim() === title ? lines.slice(2).join("\n") : text;
}

/** Domain named by a link card ("From example.com") at the end of the saved text. */
export function linkDomain(text: string): string | null {
  const match = /(?:^|\n)From ([a-z0-9.-]+\.[a-z]{2,})\s*$/i.exec(text.trim());
  return match ? match[1].toLowerCase() : null;
}

export type Segment = { kind: "text"; value: string } | { kind: "link"; value: string; href: string } | { kind: "mark"; value: string };

/** Split post text into plain text, links and search-term marks. */
export function segments(text: string, terms: string[]): Segment[] {
  const out: Segment[] = [];
  const link = /https?:\/\/[^\s]+/g;
  let last = 0;
  for (const match of text.matchAll(link)) {
    if (match.index! > last) pushMarked(out, text.slice(last, match.index), terms);
    const raw = match[0].replace(/[).,;!?]+$/, "");
    out.push({ kind: "link", value: raw.replace(/^https?:\/\//, ""), href: raw });
    last = match.index! + raw.length;
  }
  if (last < text.length) pushMarked(out, text.slice(last), terms);
  return out;
}

function pushMarked(out: Segment[], value: string, terms: string[]) {
  const useful = terms.filter((t) => t.length > 1);
  if (!useful.length) {
    out.push({ kind: "text", value });
    return;
  }
  const folded = fold(value);
  // Only mark when folding keeps string length, so positions stay aligned.
  if (folded.length !== value.length) {
    out.push({ kind: "text", value });
    return;
  }
  const ranges: [number, number][] = [];
  for (const term of useful) {
    let from = 0;
    for (;;) {
      const at = folded.indexOf(term, from);
      if (at < 0) break;
      ranges.push([at, at + term.length]);
      from = at + term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let cursor = 0;
  for (const [start, end] of ranges) {
    if (start < cursor) continue;
    if (start > cursor) out.push({ kind: "text", value: value.slice(cursor, start) });
    out.push({ kind: "mark", value: value.slice(start, end) });
    cursor = end;
  }
  if (cursor < value.length) out.push({ kind: "text", value: value.slice(cursor) });
}

/** Search terms: words and "quoted phrases", folded. */
export function searchTerms(query: string): string[] {
  const terms: string[] = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  for (const match of fold(query).matchAll(pattern)) {
    const term = (match[1] ?? match[2]).trim();
    if (term) terms.push(term);
  }
  return terms;
}
