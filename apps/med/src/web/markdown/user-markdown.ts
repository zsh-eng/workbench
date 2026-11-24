/**
 * Keeps the line breaks that the reader typed, as a comment or prompt box shows
 * them: a line followed by another non-empty line ends in a hard break. Code
 * fences stay as they are.
 */
export function keepLineBreaks(text: string): string {
  const lines = text.split("\n");
  let fence: string | undefined;
  return lines
    .map((line, index) => {
      if (fence) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
        if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined;
        return line;
      }
      fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence || !line.trim() || !lines[index + 1]?.trim() || / {2}$|\\$/.test(line)) return line;
      return `${line}  `;
    })
    .join("\n");
}

const MARKDOWN_SYNTAX =
  /(?:^|\n)\s*(?:#{1,6}\s+|(?:[-*+]|\d+\.)\s+|```|~~~|\|[^\n]+\|\s*\n\s*\|[-:| ]+\|)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<![\w\\])\*[^*\s][^*\n]*\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\)/;

/** True when a user-authored prompt contains Markdown constructs worth
 * rendering through the Markdown worker. */
export const hasPromptMarkdown = (text: string) => MARKDOWN_SYNTAX.test(text);

/** Closes an unclosed fenced code block when a long prompt is truncated for
 * folding, so the preview renders cleanly. */
export function closeOpenFence(text: string): string {
  let fence: string | undefined;
  for (const line of text.split("\n")) {
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined;
    } else {
      fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    }
  }
  return fence ? `${text}\n${fence}` : text;
}
