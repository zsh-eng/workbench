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

/** Formats cited quotes as Markdown blockquotes above the user's reply so both
 * the agent and Med's prompt renderer (prompt-blocks.ts) understand them natively. */
export function formatQuotedPrompt(quotes: readonly ReplyQuote[], body: string): string {
  if (!quotes.length) return body;
  const blocks = quotes
    .map((quote) =>
      quote.text
        .trim()
        .split("\n")
        .map((line) => (line.trim() ? `> ${line}` : ">"))
        .join("\n"),
    )
    .filter(Boolean);
  if (!blocks.length) return body;
  const prefix = blocks.join("\n\n");
  return body.trim() ? `${prefix}\n\n${body}` : prefix;
}
