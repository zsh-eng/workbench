import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { FileComment, FileCommentMutation } from "../../shared/saved-review";
import { agentName } from "../../shared/saved-review";
import { relativeTime } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { CommentEditor, CommentText } from "./NoteCard";
import { ShortcutKeys } from "./ShortcutKeys";

// Comments on lines of a file, not of a change (`gc`). As on a page that
// people comment on with Claude: a comment waits until you send it, goes to
// the thread's agent with its lines, and the agent answers in its thread and
// resolves it when done. You can open it again.

/** How a new comment goes: to the agent now (at its next step while it
 * works), after its turn, or into the message box with the others. */
export type FileCommentSend = "send" | "queue" | "keep";

/** The agent that Med runs for the thread, which takes a comment from here. */
export interface FileCommentAgent {
  name: string;
  mark: IconName;
}

const lines = (line: number, endLine: number) =>
  line === endLine ? `line ${line}` : `lines ${line}–${endLine}`;

/** The box under the lines that `gc` opens. */
export function FileCommentBox({
  line,
  endLine,
  agent,
  initialText = "",
  onTextChange,
  onSubmit,
  onCancel,
}: {
  line: number;
  endLine: number;
  agent: FileCommentAgent | null;
  /** The text written so far, for a box drawn again. */
  initialText?: string;
  onTextChange?(text: string): void;
  onSubmit(text: string, how: FileCommentSend): Promise<void>;
  onCancel(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState(initialText);
  const [busy, setBusy] = useState<FileCommentSend | null>(null);
  const [error, setError] = useState("");
  const form = useRef<HTMLFormElement>(null);
  useEffect(() => {
    // `gc` on the last lines in view opens the box below them.
    form.current?.scrollIntoView({ block: "nearest" });
    input.current?.focus({ preventScroll: true });
  }, []);
  const submit = async (how: FileCommentSend) => {
    if (!text.trim() || busy) return;
    setBusy(how);
    setError("");
    try {
      await onSubmit(text.trim(), how);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the comment.");
      setBusy(null);
    }
  };
  return (
    <form
      ref={form}
      data-comment-card
      data-file-comment-box
      aria-label={`Comment on ${lines(line, endLine)}`}
      {...stylex.props(styles.card)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit(agent ? "send" : "keep");
      }}
    >
      <p {...stylex.props(styles.head)}>
        <span>Comment on {lines(line, endLine)}</span>
      </p>
      <textarea
        ref={input}
        value={text}
        readOnly={!!busy}
        rows={2}
        aria-label="Comment text"
        placeholder={agent ? `What should ${agent.name} change or explain?` : "Add a comment…"}
        onChange={(event) => {
          setText(event.target.value);
          onTextChange?.(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            void submit(agent ? "send" : "keep");
          } else if (event.key === "Enter" && event.altKey && agent) {
            event.preventDefault();
            event.stopPropagation();
            void submit("queue");
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (!busy) onCancel();
          }
        }}
        {...stylex.props(styles.textarea)}
      />
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      <div {...stylex.props(styles.actions)}>
        {agent ? (
          <>
            <button
              type="submit"
              disabled={!text.trim() || !!busy}
              {...stylex.props(ui.button, styles.primary)}
            >
              <Icon name={agent.mark} size={13} />
              {busy === "send" ? "Sending…" : `Send to ${agent.name}`}
              <ShortcutKeys value="⌘↵" />
            </button>
            <button
              type="button"
              disabled={!text.trim() || !!busy}
              onClick={() => void submit("queue")}
              {...stylex.props(ui.button, styles.small)}
            >
              Queue <ShortcutKeys value="⌥↵" />
            </button>
            <button
              type="button"
              disabled={!text.trim() || !!busy}
              onClick={() => void submit("keep")}
              {...stylex.props(ui.button, styles.small)}
            >
              Add to message
            </button>
          </>
        ) : (
          <button
            type="submit"
            disabled={!text.trim() || !!busy}
            {...stylex.props(ui.button, styles.primary)}
          >
            Add to message <ShortcutKeys value="⌘↵" />
          </button>
        )}
        <button
          type="button"
          disabled={!!busy}
          onClick={onCancel}
          {...stylex.props(ui.button, styles.small, styles.quiet)}
        >
          Cancel
        </button>
      </div>
      <p {...stylex.props(styles.hint)}>
        {agent
          ? `Send reaches ${agent.name} now, or at its next step while it works. Queue waits for its turn to end. Add to message keeps it with the thread's other comments.`
          : "It waits in the thread's message box with the other comments, to send or copy."}
      </p>
    </form>
  );
}

function When({ at }: { at: string }) {
  const [now] = useState(Date.now);
  const time = Date.parse(at);
  if (Number.isNaN(time)) return null;
  return (
    <time dateTime={at} {...stylex.props(styles.meta)}>
      {relativeTime(time, now)}
    </time>
  );
}

/** A saved comment on a file, with its replies, under its last line. */
export function FileCommentThread({
  comment,
  agent,
  unsent,
  onMutate,
  onSend,
}: {
  comment: FileComment;
  agent: FileCommentAgent | null;
  /** Not sent since its last change. */
  unsent: boolean;
  onMutate(mutation: FileCommentMutation): Promise<void>;
  onSend(how: Exclude<FileCommentSend, "keep">): Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not change the comment.");
    } finally {
      setBusy(false);
    }
  };
  const end = comment.endLine ?? comment.line;
  const resolver = comment.resolved?.by ? agentName(comment.resolved.by) : "you";
  return (
    <article
      data-comment-card
      data-file-comment={comment.id}
      data-resolved={comment.resolved ? "" : undefined}
      aria-label={`Comment on ${lines(comment.line, end)}`}
      {...stylex.props(styles.card, comment.resolved && styles.resolved)}
    >
      {comment.resolved && (
        <p {...stylex.props(styles.resolvedLine)}>
          <Icon name="check" size={13} />
          <span>Resolved by {resolver}</span>
          <When at={comment.resolved.at} />
        </p>
      )}
      <div {...stylex.props(styles.message)}>
        <CommentText text={comment.text} />
        <p {...stylex.props(styles.byline)}>
          <span>You</span>
          <When at={comment.createdAt} />
          {!unsent && !comment.resolved && agent && <span>· sent to {agent.name}</span>}
        </p>
      </div>
      {comment.replies.map((reply) => (
        <div key={reply.id} {...stylex.props(styles.reply)}>
          <p {...stylex.props(styles.replier)}>
            {reply.author && (
              <Icon name={reply.author.agent === "acp" ? "agent" : reply.author.agent} size={12} />
            )}
            {reply.author ? agentName(reply.author) : "You"}
            <When at={reply.createdAt} />
          </p>
          <CommentText text={reply.text} />
        </div>
      ))}
      {replying && (
        <div {...stylex.props(styles.reply)}>
          <CommentEditor
            label="Reply text"
            formLabel="Reply"
            submitLabel="Reply"
            onSave={(text) => onMutate({ reply: { id: comment.id, text } })}
            onCancel={() => setReplying(false)}
          />
        </div>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      <div {...stylex.props(styles.actions)}>
        {unsent && !comment.resolved && agent && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => onSend("send"))}
            {...stylex.props(ui.button, styles.primary)}
          >
            <Icon name={agent.mark} size={13} />
            Send to {agent.name}
          </button>
        )}
        {!replying && (
          <button
            type="button"
            onClick={() => setReplying(true)}
            {...stylex.props(ui.button, styles.small)}
          >
            Reply
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void run(() =>
              onMutate(comment.resolved ? { reopen: comment.id } : { resolve: comment.id }),
            )
          }
          {...stylex.props(ui.button, styles.small)}
        >
          {comment.resolved ? "Reopen" : "Resolve"}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label="Delete comment"
          onClick={() => void run(() => onMutate({ remove: comment.id }))}
          {...stylex.props(ui.button, styles.small, styles.quiet)}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
    </article>
  );
}

const styles = stylex.create({
  card: {
    boxSizing: "border-box",
    display: "grid",
    gap: 6,
    marginBlock: 6,
    marginInline: 10,
    maxWidth: 620,
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":focus-within": tokens.lineStrong },
    borderRadius: `calc(10px * ${tokens.round})`,
    color: tokens.text,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: "20px",
    whiteSpace: "normal",
  },
  resolved: { backgroundColor: tokens.canvas },
  resolvedLine: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    color: tokens.green,
    fontSize: 12,
    fontWeight: 550,
  },
  head: { margin: 0, color: tokens.muted, fontSize: 12 },
  textarea: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 48,
    resize: "vertical",
    paddingBlock: 6,
    paddingInline: 8,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: "20px",
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  actions: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 },
  primary: {
    minHeight: 26,
    paddingBlock: 2,
    paddingInline: 10,
    gap: 6,
    fontSize: 12,
    fontWeight: 550,
    color: tokens.canvas,
    backgroundColor: tokens.text,
    opacity: { default: 1, ":hover": 0.85, ":disabled": 0.35 },
  },
  small: { minHeight: 26, paddingBlock: 2, gap: 6, fontSize: 12 },
  quiet: { color: tokens.muted },
  hint: { margin: 0, color: tokens.faint, fontSize: 11, lineHeight: "16px" },
  message: { display: "grid", gap: 2 },
  byline: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    color: tokens.faint,
    fontSize: 11,
  },
  meta: { color: tokens.faint, fontSize: 11, fontWeight: 400, whiteSpace: "nowrap" },
  reply: {
    display: "grid",
    gap: 2,
    marginInlineStart: 6,
    paddingInlineStart: 12,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.lineStrong,
  },
  replier: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    margin: 0,
    color: tokens.muted,
    fontSize: 12,
    fontWeight: 550,
  },
  error: { margin: 0, color: tokens.red, fontSize: 11 },
});
