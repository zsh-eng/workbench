import type { Note, NoteMutation } from "../../../shared/protocol";
import { answersGuideNote, type GuideNote } from "../../data/guide";
import type { IconName } from "../Icon";
import { NoteCard, NoteComposer, ReplyRail, useReplyBox } from "../NoteCard";
import { GuideNoteCard } from "../PullRequestComments";

/** An agent's comment with the reader's replies to it, in one card and in the
 * order they were written. A reply is the reader's own note on the same
 * lines, which remembers what it answers. */
export function GuideThread({
  note,
  agent,
  notes,
  embedded,
  onMutate,
  onOpenLink,
}: {
  note: GuideNote;
  agent: { name: string; mark: IconName; at: string };
  /** The notes of the comparison on screen. */
  notes: readonly Note[];
  embedded?: boolean;
  onMutate(mutation: NoteMutation): Promise<void>;
  onOpenLink?(href: string): void;
}) {
  const box = useReplyBox(onMutate);
  const replies = notes.filter((item) => !item.parentId && answersGuideNote(item, note));
  return (
    <GuideNoteCard
      note={note}
      author={agent.name}
      mark={agent.mark}
      createdAt={agent.at}
      embedded={embedded}
      // One Reply in the card, on its last message: here until the reader has
      // answered, then on their thread. A note sits on lines, so a comment on
      // a whole file takes no reply.
      onReply={note.line === undefined || box.replying || replies.length ? undefined : box.open}
    >
      {replies.map((reply, index) => (
        <NoteCard
          key={reply.id}
          note={reply}
          replies={notes.filter((item) => item.parentId === reply.id)}
          embedded
          canReply={index === replies.length - 1}
          onMutate={onMutate}
          onOpenLink={onOpenLink}
        />
      ))}
      {box.replying && note.line !== undefined && (
        <ReplyRail>
          <NoteComposer
            target={{
              path: note.path,
              side: note.side,
              line: note.line,
              ...(note.endLine ? { endLine: note.endLine } : {}),
            }}
            guideComment={{ id: note.id, author: agent.name, text: note.body }}
            sendable
            {...box.composer}
          />
        </ReplyRail>
      )}
    </GuideNoteCard>
  );
}
