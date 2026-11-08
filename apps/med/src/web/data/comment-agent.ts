import { createContext } from "react";
import type { NoteAuthor } from "../../shared/protocol";
import { agentName } from "../../shared/saved-review";

/** The agent that Med started for this review and runs: a comment goes to
 * it from the comment, in one click. */
export interface CommentAgent {
  name: string;
  mark: "claude" | "codex" | "agent";
  /** Whether the agent has the comment as it reads now. */
  sent(noteId: string): boolean;
  /** Rejects with Med's reason. */
  send(noteId: string): Promise<void>;
}
export const CommentAgentContext = createContext<CommentAgent | null>(null);

/** The mark and name of the agent that wrote a reply. */
export function noteAuthor(author: NoteAuthor) {
  return {
    name: agentName(author),
    mark: author.agent === "acp" ? ("agent" as const) : author.agent,
  };
}
