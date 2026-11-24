import { keepLineBreaks } from "../markdown/user-markdown";
import { SessionMarkdown } from "./session/SessionMarkdown";
import "./session/prose-styles";
import "./CommentMarkdown.css";

/**
 * A comment's text as Markdown, rendered as the thread renders a reply, in
 * the card's type. The stored text stays as the reader wrote it.
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
