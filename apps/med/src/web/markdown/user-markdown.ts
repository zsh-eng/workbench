import { hasMathSyntax } from "./words/math";

/**
 * Keeps the line breaks that the reader typed, as a comment or prompt box shows
 * them: a line followed by another non-empty line ends in a hard break. Code
 * fences, display math blocks, and inline quotes stay as they are.
 */
export function keepLineBreaks(text: string): string {
  const lines = text.split("\n");
  let fence: string | undefined;
  let mathBlock: "$$" | "\\[" | undefined;
  let inQuote = false;
  return lines
    .map((line, index) => {
      if (fence) {
        const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
        if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined;
        return line;
      }
      if (mathBlock) {
        if (
          (mathBlock === "$$" && /^\s*\$\$\s*$/.test(line)) ||
          (mathBlock === "\\[" && /(?<!\\)(?:\\\\)*\\\]\s*$/.test(line))
        ) {
          mathBlock = undefined;
        }
        return line;
      }
      const startedInQuote = inQuote;
      let cursor = 0;
      while (cursor < line.length) {
        if (!inQuote) {
          const open = line.indexOf("<quote>", cursor);
          if (open < 0) break;
          inQuote = true;
          cursor = open + 7;
        } else {
          const close = line.indexOf("</quote>", cursor);
          if (close < 0) break;
          inQuote = false;
          cursor = close + 8;
        }
      }
      if (startedInQuote || inQuote) return line;
      fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (!fence) {
        if (/^\s*\$\$\s*$/.test(line)) mathBlock = "$$";
        else if (/^\s*\\\[\s*$/.test(line)) mathBlock = "\\[";
      }
      if (fence || mathBlock || !line.trim() || !lines[index + 1]?.trim() || / {2}$|\\$/.test(line))
        return line;
      return `${line}  `;
    })
    .join("\n");
}

const MARKDOWN_SYNTAX =
  /(?:^|\n)\s*(?:#{1,6}\s+|(?:[-*+]|\d+\.)\s+|```|~~~|\|[^\n]+\|\s*\n\s*\|[-:| ]+\|)|`[^`\n]+`|\*\*[^*\n]+\*\*|__[^_\n]+__|(?<![\w\\])\*[^*\s][^*\n]*\*|~~[^~\n]+~~|\[[^\]\n]+\]\([^)\n]+\)/;

/** True when a user-authored prompt contains Markdown or LaTeX constructs worth
 * rendering through the Markdown worker. */
export const hasPromptMarkdown = (text: string) =>
  MARKDOWN_SYNTAX.test(text) || hasMathSyntax(text);

/** Closes an unclosed fenced code block or display math block when a long prompt
 * is truncated for folding, so the preview renders cleanly. */
export function closeOpenFence(text: string): string {
  let fence: string | undefined;
  let mathBlock: "$$" | "\\[" | undefined;
  for (const line of text.split("\n")) {
    if (fence) {
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) fence = undefined;
    } else if (mathBlock) {
      if (
        (mathBlock === "$$" && /^\s*\$\$\s*$/.test(line)) ||
        (mathBlock === "\\[" && /(?<!\\)(?:\\\\)*\\\]\s*$/.test(line))
      ) {
        mathBlock = undefined;
      }
    } else {
      fence = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (!fence) {
        if (/^\s*\$\$\s*$/.test(line)) mathBlock = "$$";
        else if (/^\s*\\\[\s*$/.test(line)) mathBlock = "\\[";
      }
    }
  }
  if (fence) return `${text}\n${fence}`;
  if (mathBlock === "$$") return `${text}\n$$`;
  if (mathBlock === "\\[") return `${text}\n\\]`;
  return text;
}
