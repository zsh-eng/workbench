/** A part of a prompt: quoted lines, such as a reply to the agent, or text
 * as written. */
export interface PromptBlock {
  quote: boolean;
  text: string;
}

/**
 * A prompt's text in blocks, as Claude shows it: each run of quoted lines is
 * one quote, and the other lines stay as written. HTML comments, such as reply
 * markers, do not show. Multi-line `<quote>...</quote>` spans stay intact in
 * their surrounding text block even if a quoted line starts with `>`.
 */
export function promptBlocks(text: string): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  let current: PromptBlock | undefined;
  let inInlineQuote = false;
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const quote = !inInlineQuote && /^ {0,3}>/.test(line);
    const body = quote ? line.replace(/^ {0,3}> ?/, "") : line;
    if (current?.quote === quote) current.text += `\n${body}`;
    else blocks.push((current = { quote, text: body }));
    // Track open `<quote>` tags across lines so inner `>` lines stay inside it.
    let cursor = 0;
    while (cursor < line.length) {
      if (!inInlineQuote) {
        const open = line.indexOf("<quote>", cursor);
        if (open < 0) break;
        inInlineQuote = true;
        cursor = open + 7;
      } else {
        const close = line.indexOf("</quote>", cursor);
        if (close < 0) break;
        inInlineQuote = false;
        cursor = close + 8;
      }
    }
  }
  return blocks
    .map((block) => ({ ...block, text: block.text.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "") }))
    .filter((block) => block.text.trim() !== "");
}
