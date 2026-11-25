/** A passage cited from a session message to reply to directly. */
export interface ReplyQuote {
  id: string;
  /** The thread unit key (or item ID) to scroll back to when clicked. */
  sourceId: string;
  /** Who wrote the cited passage, e.g. "Claude" or "You". */
  speaker: string;
  /** The cited passage text. */
  text: string;
}

const INLINE_QUOTE_PATTERN = /<quote>([\s\S]*?)<\/quote>/g;

/** Shortens a full reply into a clean excerpt for a one-click message quote. */
export function summarizeQuote(text: string, maxChars = 220): string {
  const cleaned = text
    .replace(/```[\s\S]*?```/g, (block) => {
      const first = block
        .replace(/^```[^\n]*\n?/, "")
        .replace(/```$/, "")
        .trim()
        .split("\n")[0];
      return first ? `\`${first.slice(0, 60)}\`` : "";
    })
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length <= maxChars) return cleaned;
  const cut = cleaned.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Wraps a cited passage in `<quote>...</quote>` tags so its position relative
 * to surrounding user text is preserved for both the editor and the agent. */
export function encodeInlineQuote(text: string): string {
  const cleaned = text.trim().replace(/<\/quote>/gi, "<\\/quote>");
  return cleaned ? `<quote>${cleaned}</quote>` : "";
}

/** Decodes an encoded `<quote>` body back into readable text. */
export function decodeInlineQuote(raw: string): string {
  return raw.replace(/<\\\/quote>/gi, "</quote>").trim();
}

/** Single-line truncated preview label for an inline quote badge. */
export function quotePreview(raw: string, maxChars = 48): string {
  const oneLine = decodeInlineQuote(raw).replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  const cut = oneLine.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars * 0.55 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

export interface InlineQuoteMatch {
  from: number;
  to: number;
  fullText: string;
  preview: string;
}

/** Finds every non-empty `<quote>...</quote>` span in `text` without shared
 * mutable regex state. */
export function matchInlineQuotes(text: string): InlineQuoteMatch[] {
  if (!text.includes("<quote>")) return [];
  const matches: InlineQuoteMatch[] = [];
  for (const match of text.matchAll(INLINE_QUOTE_PATTERN)) {
    const from = match.index ?? 0;
    const to = from + match[0].length;
    const fullText = decodeInlineQuote(match[1] ?? "");
    if (!fullText) continue;
    matches.push({ from, to, fullText, preview: quotePreview(fullText) });
  }
  return matches;
}

/** Inserts an inline `<quote>...</quote>` tag at `caret` with smart spacing so
 * the user can continue typing naturally before or after the badge. */
export function insertInlineQuote(
  value: string,
  caret: number,
  quotedText: string,
): { value: string; caret: number } {
  const tag = encodeInlineQuote(quotedText);
  if (!tag) return { value, caret };
  const at = Math.max(0, Math.min(caret, value.length));
  const before = value.slice(0, at);
  const after = value.slice(at);
  const lead = before.length > 0 && !/\s$/.test(before) ? " " : "";
  const trail = after.length === 0 || !/^\s/.test(after) ? " " : "";
  const inserted = `${lead}${tag}${trail}`;
  return { value: before + inserted + after, caret: at + inserted.length };
}

export type InlineQuoteSegment =
  | { kind: "text"; text: string }
  | { kind: "quote"; text: string; preview: string };

/** Whether `text` contains at least one non-empty `<quote>...</quote>` tag. */
export const hasInlineQuotes = (text: string) => matchInlineQuotes(text).length > 0;

/** Removes `<quote>...</quote>` spans so Markdown syntax inside a quote does
 * not force surrounding plain text through the Markdown block worker. */
export const stripInlineQuotes = (text: string) => text.replace(INLINE_QUOTE_PATTERN, "");

/** Closes an unclosed `<quote>` tag when a long prompt is truncated for folding. */
export function closeOpenQuote(text: string): string {
  const lastOpen = text.lastIndexOf("<quote>");
  if (lastOpen < 0) return text;
  const lastClose = text.lastIndexOf("</quote>");
  return lastClose < lastOpen ? `${text}</quote>` : text;
}

/** Splits prompt text into alternating plain text and inline quote segments. */
export function splitInlineQuotes(text: string): InlineQuoteSegment[] {
  const parts: InlineQuoteSegment[] = [];
  let last = 0;
  for (const match of matchInlineQuotes(text)) {
    if (match.from > last) parts.push({ kind: "text", text: text.slice(last, match.from) });
    parts.push({ kind: "quote", text: match.fullText, preview: match.preview });
    last = match.to;
  }
  if (last < text.length) parts.push({ kind: "text", text: text.slice(last) });
  return parts;
}

/** Replaces `<quote>...</quote>` spans with plain alphanumeric tokens before
 * Markdown parsing so `rawHtml` never strips them and Markdown never parses
 * inside the quoted body. */
export function protectInlineQuotes(text: string): {
  text: string;
  quotes: ReadonlyMap<string, { full: string; preview: string }>;
} {
  const found = matchInlineQuotes(text);
  if (!found.length) return { text, quotes: new Map() };
  let prefix = "MEDINLINEQUOTE";
  while (text.includes(prefix)) prefix += "X";
  const quotes = new Map<string, { full: string; preview: string }>();
  let out = "";
  let last = 0;
  found.forEach((match, index) => {
    out += text.slice(last, match.from);
    const token = `${prefix}${index}END`;
    quotes.set(token, { full: match.fullText, preview: match.preview });
    out += token;
    last = match.to;
  });
  out += text.slice(last);
  return { text: out, quotes };
}
