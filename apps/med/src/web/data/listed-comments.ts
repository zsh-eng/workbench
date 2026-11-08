import type { Note } from "../../shared/protocol";
import type { FileComment } from "../../shared/saved-review";
import { agentName } from "../../shared/saved-review";

// The comments that All comments lists (components/CommentsPanel.tsx).

/** One comment in the list, from the diff or from a file. */
export interface ListedComment {
  id: string;
  kind: "diff" | "file";
  path: string;
  line: number;
  endLine?: number;
  text: string;
  createdAt: string;
  replies: number;
  /** Who answered last, when an agent did. */
  answeredBy?: string;
  resolved: boolean;
  /** Waits to be sent to the thread's agent. */
  unsent: boolean;
}

/** The list's comments: the diff's top-level comments with their replies'
 * count, and the comments on files. */
export function listComments(
  notes: readonly Note[],
  files: readonly FileComment[],
  unsent: ReadonlySet<string>,
): ListedComment[] {
  const replies = new Map<string, Note[]>();
  for (const note of notes)
    if (note.parentId) replies.set(note.parentId, [...(replies.get(note.parentId) ?? []), note]);
  const listed: ListedComment[] = [
    ...notes
      .filter((note) => !note.parentId)
      .map((note) => {
        const answers = replies.get(note.id) ?? [];
        const last = answers.at(-1);
        return {
          id: note.id,
          kind: "diff" as const,
          path: note.path,
          line: note.line,
          endLine: note.endLine,
          text: note.text,
          createdAt: note.createdAt,
          replies: answers.length,
          answeredBy: last?.author ? agentName(last.author) : undefined,
          resolved: false,
          unsent: unsent.has(note.id),
        };
      }),
    ...files.map((comment) => {
      const last = comment.replies.at(-1);
      return {
        id: comment.id,
        kind: "file" as const,
        path: comment.path,
        line: comment.line,
        endLine: comment.endLine,
        text: comment.text,
        createdAt: comment.createdAt,
        replies: comment.replies.length,
        answeredBy: last?.author ? agentName(last.author) : undefined,
        resolved: !!comment.resolved,
        unsent: unsent.has(comment.id),
      };
    }),
  ];
  return listed.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
