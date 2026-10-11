/** A part of a prompt: quoted lines, such as a reply to the agent, or text
 * as written. */
export interface PromptBlock {
  quote: boolean;
  text: string;
}

/**
 * A prompt's text in blocks, as Claude shows it: each run of quoted lines is
 * one quote, and the other lines stay as written. HTML comments, such as reply
 * markers, do not show. Blank lines between blocks become the space between
 * them.
 */
export function promptBlocks(text: string): PromptBlock[] {
  const blocks: PromptBlock[] = [];
  let current: PromptBlock | undefined;
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const quote = /^ {0,3}>/.test(line);
    const body = quote ? line.replace(/^ {0,3}> ?/, "") : line;
    if (current?.quote === quote) current.text += `\n${body}`;
    else blocks.push((current = { quote, text: body }));
  }
  return blocks
    .map((block) => ({ ...block, text: block.text.replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, "") }))
    .filter((block) => block.text.trim() !== "");
}
