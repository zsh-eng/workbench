import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { FileComment, FileCommentMutation } from "../../shared/saved-review";
import { agentName } from "../../shared/saved-review";
import { relativeTime } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { CommentEditor, CommentText } from "./NoteCard";
import { SendNow, sendsNow } from "./SendNow";
import { tooltip } from "./ToolButton";
import "./FileComments.css";

// Comments on lines of a file, not of a change (`gc`). As on a page that
// people comment on with Claude: a comment waits until you send it, goes to
// the thread's agent with its lines, and the agent answers in its thread and
// resolves it when done. You can open it again.

/** How a new comment goes: to the agent now (at its next step while it
 * works), or into the message box with the others. */
export type FileCommentSend = "send" | "keep";

/** The agent that Med runs for the thread, which takes a comment from here. */
export interface FileCommentAgent {
  name: string;
  mark: IconName;
}

const lines = (line: number, endLine: number) =>
  line === endLine ? `line ${line}` : `lines ${line}–${endLine}`;

/** The box under the lines that `gc` opens. Comment saves it, and sends it
 * to the agent too while "Send to … now" is ticked (SendNow). */
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
  const submit = async () => {
    if (!text.trim() || busy) return;
    const how = agent && sendsNow() ? "send" : "keep";
    setBusy(how);
    setError("");
    try {
      await onSubmit(text.trim(), how);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the comment.");
      setBusy(null);
    }
  };
  const disabled = !text.trim() || !!busy;
  return (
    <form
      ref={form}
      data-comment-card
      data-file-comment-box
      aria-label={`Comment on ${lines(line, endLine)}`}
      {...stylex.props(styles.card)}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={input}
        value={text}
        readOnly={!!busy}
        rows={1}
        aria-label="Comment text"
        placeholder={agent ? `Comment for ${agent.name}` : "Comment"}
        onChange={(event) => {
          setText(event.target.value);
          onTextChange?.(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            void submit();
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
      <div {...stylex.props(styles.bar)}>
        {agent && <SendNow agent={agent.name} />}
        <span {...stylex.props(styles.grow)} />
        <button
          type="button"
          disabled={!!busy}
          {...tooltip("Cancel", "Esc")}
          onClick={onCancel}
          {...stylex.props(ui.button, ui.pressable, styles.comment, styles.cancel)}
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={disabled}
          aria-busy={busy !== null}
          {...tooltip("Comment", "⌘↵")}
          {...stylex.props(ui.button, ui.primary, ui.pressable, styles.comment)}
        >
          Comment
        </button>
      </div>
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
  onSend(): Promise<void>;
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
  const sendable = unsent && !comment.resolved && agent;
  return (
    <article
      data-comment-card
      data-file-comment={comment.id}
      data-resolved={comment.resolved ? "" : undefined}
      aria-label={`Comment on ${lines(comment.line, end)}`}
      {...stylex.props(styles.card, styles.thread, comment.resolved && styles.resolved)}
    >
      <div data-comment-actions="" {...stylex.props(styles.actions)}>
        {!replying && (
          <button
            type="button"
            aria-label="Reply"
            {...tooltip("Reply")}
            onClick={() => setReplying(true)}
            {...stylex.props(ui.button, ui.iconButton, styles.icon)}
          >
            <Icon name="reply" size={13} />
          </button>
        )}
        <button
          type="button"
          disabled={busy}
          aria-label={comment.resolved ? "Reopen" : "Resolve"}
          {...tooltip(comment.resolved ? "Reopen" : "Resolve")}
          onClick={() =>
            void run(() =>
              onMutate(comment.resolved ? { reopen: comment.id } : { resolve: comment.id }),
            )
          }
          {...stylex.props(ui.button, ui.iconButton, styles.icon)}
        >
          <Icon name={comment.resolved ? "refresh" : "check"} size={13} />
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label="Delete comment"
          {...tooltip("Delete")}
          onClick={() => void run(() => onMutate({ remove: comment.id }))}
          {...stylex.props(ui.button, ui.iconButton, styles.icon)}
        >
          <Icon name="trash" size={13} />
        </button>
      </div>
      <div {...stylex.props(styles.message)}>
        <p {...stylex.props(styles.byline)}>
          <span {...stylex.props(styles.who)}>You</span>
          <When at={comment.createdAt} />
          {comment.resolved ? (
            <span {...stylex.props(styles.done)}>
              <Icon name="check" size={12} />
              {`Resolved by ${resolver}`}
            </span>
          ) : (
            !unsent &&
            agent && (
              <span
                aria-label={`Sent to ${agent.name}`}
                {...tooltip(`Sent to ${agent.name}`)}
                {...stylex.props(styles.sent)}
              >
                <Icon name={agent.mark} size={11} />
              </span>
            )
          )}
        </p>
        <CommentText text={comment.text} />
      </div>
      {comment.replies.map((reply) => (
        <div key={reply.id} {...stylex.props(styles.reply)}>
          <p {...stylex.props(styles.byline)}>
            {reply.author && (
              <Icon name={reply.author.agent === "acp" ? "agent" : reply.author.agent} size={12} />
            )}
            <span {...stylex.props(styles.who)}>
              {reply.author ? agentName(reply.author) : "You"}
            </span>
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
      {sendable && (
        <div {...stylex.props(styles.bar)}>
          <span {...stylex.props(styles.grow)} />
          <button
            type="button"
            disabled={busy}
            aria-label={`Send to ${agent.name}`}
            {...tooltip(`Send to ${agent.name}`)}
            onClick={() => void run(onSend)}
            {...stylex.props(ui.button, styles.send)}
          >
            <Icon name="arrowUp" size={13} />
          </button>
        </div>
      )}
    </article>
  );
}

// Quiet, as a comment on a page: the text, who and when, and the actions
// at the card's top right while the pointer or the focus is on it.
const styles = stylex.create({
  card: {
    position: "relative",
    boxSizing: "border-box",
    display: "grid",
    gap: 8,
    marginBlock: 8,
    marginInline: 10,
    maxWidth: 560,
    paddingBlock: 10,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":focus-within": tokens.lineStrong },
    borderRadius: `calc(10px * ${tokens.round})`,
    color: tokens.text,
    backgroundColor: tokens.raised,
    boxShadow: "0 1px 2px #0000000f",
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: "20px",
    whiteSpace: "normal",
  },
  thread: { paddingTop: 8 },
  resolved: { backgroundColor: tokens.canvas, boxShadow: "none" },
  textarea: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 40,
    resize: "none",
    fieldSizing: "content",
    maxHeight: 240,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: "20px",
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  bar: { display: "flex", alignItems: "center", gap: 4, marginInlineEnd: -4, marginBottom: -2 },
  comment: { height: 26, paddingBlock: 0, paddingInline: 10, fontSize: 12 },
  cancel: { color: tokens.muted },
  grow: { flex: "1" },
  icon: { width: 26, height: 26, color: tokens.muted },
  send: {
    justifyContent: "center",
    width: 26,
    height: 26,
    marginInlineStart: 4,
    padding: 0,
    borderRadius: 13,
    color: tokens.primaryText,
    backgroundColor: tokens.primary,
    opacity: { default: 1, ":hover": 0.85, ":disabled": 0.3 },
  },
  // Over the card's top right, shown while the card is pointed at or focused
  // (FileEditor.css).
  actions: {
    position: "absolute",
    top: 4,
    right: 4,
    display: "flex",
    gap: 0,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.raised,
  },
  message: { display: "grid", gap: 2 },
  byline: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minHeight: 20,
    margin: 0,
    color: tokens.faint,
    fontSize: 12,
  },
  who: { color: tokens.muted, fontWeight: 550 },
  sent: { display: "inline-flex", color: tokens.faint },
  done: { display: "inline-flex", alignItems: "center", gap: 4, color: tokens.green },
  meta: { color: tokens.faint, fontSize: 12, fontWeight: 400, whiteSpace: "nowrap" },
  reply: {
    display: "grid",
    gap: 2,
    paddingInlineStart: 12,
    borderInlineStartWidth: 2,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: tokens.line,
  },
  error: { margin: 0, color: tokens.red, fontSize: 12 },
});
