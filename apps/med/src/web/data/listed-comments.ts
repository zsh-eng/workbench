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
  /** When the agent's answer came, while it is the thread's newest entry. */
  answeredAt?: string;
  /** That answer. */
  answer?: string;
  /** The thread's newest entry: the comment, or its newest reply. */
  activity?: string;
  /** The agent's answer came after the reader last opened the comment. */
  unread?: boolean;
  resolved: boolean;
  /** Waits to be sent to the thread's agent. */
  unsent: boolean;
}

/** The newest answer the reader has seen, by comment (comment-reads.ts). */
export type CommentReads = Readonly<Record<string, string>>;

const time = (value: string | undefined) => (value ? Date.parse(value) || 0 : 0);

/**
 * The list's comments: the diff's top-level comments with their replies'
 * count, and the comments on files. Those with an answer that the reader has
 * not opened come first, newest answer first; the others follow by their
 * newest entry, so an answer is at the top of the list.
 */
export function listComments(
  notes: readonly Note[],
  files: readonly FileComment[],
  unsent: ReadonlySet<string>,
  reads: CommentReads = {},
): ListedComment[] {
  const replies = new Map<string, Note[]>();
  for (const note of notes)
    if (note.parentId) replies.set(note.parentId, [...(replies.get(note.parentId) ?? []), note]);
  const thread = (
    id: string,
    createdAt: string,
    last: { author?: Note["author"]; text: string; createdAt: string } | undefined,
  ) => {
    const answeredAt = last?.author ? last.createdAt : undefined;
    return {
      answeredBy: last?.author ? agentName(last.author) : undefined,
      answeredAt,
      answer: last?.author ? last.text : undefined,
      activity: last?.createdAt ?? createdAt,
      unread: !!answeredAt && time(reads[id]) < time(answeredAt),
    };
  };
  const listed: ListedComment[] = [
    ...notes
      .filter((note) => !note.parentId)
      .map((note) => {
        const answers = replies.get(note.id) ?? [];
        return {
          id: note.id,
          kind: "diff" as const,
          path: note.path,
          line: note.line,
          endLine: note.endLine,
          text: note.text,
          createdAt: note.createdAt,
          replies: answers.length,
          ...thread(note.id, note.createdAt, answers.at(-1)),
          resolved: false,
          unsent: unsent.has(note.id),
        };
      }),
    ...files.map((comment) => ({
      id: comment.id,
      kind: "file" as const,
      path: comment.path,
      line: comment.line,
      endLine: comment.endLine,
      text: comment.text,
      createdAt: comment.createdAt,
      replies: comment.replies.length,
      ...thread(comment.id, comment.createdAt, comment.replies.at(-1)),
      resolved: !!comment.resolved,
      unsent: unsent.has(comment.id),
    })),
  ];
  return listed.sort(
    (a, b) =>
      Number(!!b.unread) - Number(!!a.unread) ||
      time(b.activity ?? b.createdAt) - time(a.activity ?? a.createdAt),
  );
}
