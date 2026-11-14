import type { NoteAuthor } from "./protocol";
import { agentName } from "./saved-review";

/** What a sent comment shows: the user's newest words in its thread, and the
 * agent's answer that they reply to. */
export interface LastSaid {
  text: string;
  inReplyTo?: { author: string; text: string };
}

/**
 * The user's newest words in a comment's thread: their entries after the
 * last answer, and that answer. A thread that no agent answered is its
 * comment and the user's own replies. A thread whose answer came last, as
 * after the user edited the comment, is the comment.
 */
export function lastSaid(
  comment: { text: string },
  replies: readonly { text: string; author?: NoteAuthor }[],
): LastSaid {
  // The comment is the user's own, as its replies without an author are.
  const entries: { text: string; author?: NoteAuthor }[] = [{ text: comment.text }, ...replies];
  let start = entries.length;
  while (start > 0 && !entries[start - 1]!.author) start--;
  if (start === entries.length) return { text: comment.text };
  const text = entries
    .slice(start)
    .map((entry) => entry.text)
    .join("\n\n");
  const answer = entries[start - 1];
  if (!answer?.author) return { text };
  return { text, inReplyTo: { author: agentName(answer.author), text: answer.text } };
}
