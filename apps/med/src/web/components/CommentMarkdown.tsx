import { SessionMarkdown } from "./session/SessionMarkdown";
// After the renderer's own styles, as in the Question pane.
import "./session/SessionThread.css";
import "./CommentMarkdown.css";

/**
 * Keeps the line breaks that the reader typed, as the comment box shows them:
 * a line that another line follows ends in a hard break. Code fences stay as
 * they are.
 */
function keepLineBreaks(text: string) {
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

/**
 * A comment's text as Markdown, rendered as the Question pane renders an
 * answer, in the card's type. The stored text stays as the reader wrote it.
 */
export default function CommentMarkdown({
  text,
  onOpenLink,
}: {
  text: string;
  onOpenLink?(href: string): void;
}) {
  return <SessionMarkdown text={keepLineBreaks(text)} streaming={false} onOpenLink={onOpenLink} />;
}
