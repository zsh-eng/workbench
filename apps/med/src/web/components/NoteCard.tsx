import { ShortcutKeys } from "./ShortcutKeys";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState } from "react";
import type { Note, NoteInput, NoteMutation } from "../../shared/protocol";
import { relativeTime } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

export interface NoteTarget {
  path: string;
  side: "old" | "new";
  line: number;
  endLine?: number;
}

function lineLabel(target: NoteTarget) {
  const side = target.side === "old" ? "L" : "R";
  return target.endLine && target.endLine !== target.line
    ? `lines ${side}${target.line} to ${side}${target.endLine}`
    : `line ${side}${target.line}`;
}

function Timestamp({ note }: { note: Note }) {
  // Read once per card; the age shown updates when the card mounts again.
  const [now] = useState(Date.now);
  const created = Date.parse(note.createdAt);
  if (Number.isNaN(created)) return null;
  const edited = Date.parse(note.updatedAt) - created > 1000;
  return (
    <time
      dateTime={note.createdAt}
      title={new Date(created).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })}
      {...stylex.props(styles.meta)}
    >
      {relativeTime(created, now)}
      {edited && " · edited"}
    </time>
  );
}

function CommentEditor({
  label,
  formLabel,
  initialText = "",
  initialError = "",
  closeOnSave = true,
  submitLabel,
  onSave,
  onCancel,
}: {
  label: string;
  formLabel?: string;
  initialText?: string;
  initialError?: string;
  closeOnSave?: boolean;
  submitLabel: string;
  onSave(text: string): Promise<void>;
  onCancel(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const visibleError = error ?? initialError;
  useEffect(() => {
    input.current?.focus({ preventScroll: true });
  }, []);
  const submit = async () => {
    if (!text.trim() || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    setError("");
    try {
      await onSave(text.trim());
      if (closeOnSave) onCancel();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save comment");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  };
  return (
    <form
      aria-label={formLabel}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div {...stylex.props(styles.editorBody)}>
        <div aria-hidden="true" {...stylex.props(styles.content, styles.mirror)}>
          {text + "\n"}
        </div>
        <textarea
          ref={input}
          value={text}
          readOnly={saving}
          rows={1}
          aria-label={label}
          placeholder={label === "Reply text" ? "Reply…" : "Add a comment…"}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              event.stopPropagation();
              void submit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              if (!inFlight.current) onCancel();
            }
          }}
          {...stylex.props(styles.content, styles.textarea)}
        />
      </div>
      {visibleError && (
        <p role="alert" {...stylex.props(styles.error)}>
          {visibleError}
        </p>
      )}
      <div {...stylex.props(styles.actions)}>
        <span {...stylex.props(styles.hint)}>
          <ShortcutKeys value={/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘ ↵" : "Ctrl ↵"} />
        </span>
        <span {...stylex.props(ui.grow)} />
        <button
          type="button"
          {...stylex.props(ui.button, ui.pressable, styles.smallButton)}
          aria-disabled={saving}
          onClick={() => {
            if (!inFlight.current) onCancel();
          }}
        >
          Cancel
        </button>
        <button
          type="submit"
          {...stylex.props(ui.button, ui.pressable, styles.submit)}
          disabled={!text.trim()}
          aria-disabled={saving || !text.trim()}
          aria-label={submitLabel}
        >
          {submitLabel === "Save note" ? "Comment" : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function NoteComposer({
  target,
  parentId,
  initialText,
  initialError,
  closeOnSave,
  onSave,
  onCancel,
}: {
  target: NoteTarget;
  parentId?: string;
  initialText?: string;
  initialError?: string;
  closeOnSave?: boolean;
  onSave(note: NoteInput): Promise<void>;
  onCancel(): void;
}) {
  return (
    <div data-comment-card {...stylex.props(styles.card, !!parentId && styles.embedded)}>
      <CommentEditor
        label={parentId ? "Reply text" : "Review note text"}
        formLabel={parentId ? "Reply" : `Local comment on ${lineLabel(target)}`}
        submitLabel={parentId ? "Reply" : "Save note"}
        initialText={initialText}
        initialError={initialError}
        closeOnSave={closeOnSave}
        onSave={(text) => onSave({ ...target, text, ...(parentId ? { parentId } : {}) })}
        onCancel={onCancel}
      />
    </div>
  );
}

function ThreadMessage({
  note,
  reply = false,
  onReply,
  onMutate,
}: {
  note: Note;
  reply?: boolean;
  onReply?: () => void;
  onMutate(mutation: NoteMutation): Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(note.text);
  const editSession = useRef(0);
  const removeInFlight = useRef(false);
  const [error, setError] = useState("");
  const remove = async () => {
    if (removeInFlight.current) return;
    removeInFlight.current = true;
    setError("");
    try {
      await onMutate({ type: "remove", id: note.id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not delete comment");
    } finally {
      removeInFlight.current = false;
    }
  };
  return (
    <div {...stylex.props(reply && styles.reply, stylex.defaultMarker())}>
      {note.resolution && note.resolution !== "active" && (
        <p {...stylex.props(styles.stale)}>
          {note.resolution === "orphaned"
            ? "Original location no longer exists. Note preserved for review."
            : "Source changed since this note was written."}
        </p>
      )}
      {editing ? (
        <CommentEditor
          label={reply ? "Edit reply text" : "Edit note text"}
          initialText={editText}
          submitLabel="Save"
          closeOnSave={false}
          onSave={async (text) => {
            const session = editSession.current;
            setEditing(false);
            setError("");
            try {
              await onMutate({ type: "edit", id: note.id, text });
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : "Could not save comment");
              if (editSession.current === session) {
                setEditText(text);
                setEditing(true);
              }
              throw cause;
            }
          }}
          onCancel={() => {
            setEditing(false);
            editSession.current++;
          }}
        />
      ) : (
        <>
          <p {...stylex.props(styles.content)}>{note.text}</p>
          <div {...stylex.props(styles.actions)}>
            <Timestamp note={note} />
            <span {...stylex.props(ui.grow)} />
            <span {...stylex.props(styles.tools)}>
              {onReply && (
                <button
                  type="button"
                  title="Reply"
                  {...stylex.props(ui.button, ui.iconButton, styles.tool)}
                  aria-label="Reply"
                  onClick={onReply}
                >
                  <Icon name="reply" size={14} />
                </button>
              )}
              <button
                type="button"
                title="Edit"
                {...stylex.props(ui.button, ui.iconButton, styles.tool)}
                aria-label={reply ? "Edit reply" : "Edit"}
                onClick={() => {
                  editSession.current++;
                  setEditText(note.text);
                  setEditing(true);
                }}
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                title="Delete"
                {...stylex.props(ui.button, ui.iconButton, styles.tool, styles.danger)}
                aria-label={reply ? "Delete reply" : "Delete review note"}
                onClick={() => void remove()}
              >
                <Icon name="trash" size={14} />
              </button>
            </span>
          </div>
        </>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </div>
  );
}

export function NoteCard({
  note,
  replies,
  onMutate,
}: {
  note: Note;
  replies: Note[];
  onMutate(mutation: NoteMutation): Promise<void>;
}) {
  const [replying, setReplying] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replyError, setReplyError] = useState("");
  const replySession = useRef(0);
  return (
    <article
      data-comment-card
      aria-label={`Comment thread at ${lineLabel(note)}`}
      {...stylex.props(styles.card)}
    >
      <ThreadMessage
        key={note.id}
        note={note}
        onMutate={onMutate}
        onReply={
          replying
            ? undefined
            : () => {
                replySession.current++;
                setReplyText("");
                setReplyError("");
                setReplying(true);
              }
        }
      />
      {replies.map((reply) => (
        <ThreadMessage key={reply.id} note={reply} reply onMutate={onMutate} />
      ))}
      {replying && (
        <NoteComposer
          target={note}
          parentId={note.id}
          initialText={replyText}
          initialError={replyError}
          closeOnSave={false}
          onSave={async (reply) => {
            const session = replySession.current;
            setReplying(false);
            try {
              await onMutate({ type: "add", note: reply });
            } catch (error) {
              if (replySession.current === session) {
                setReplyText(reply.text);
                setReplyError(error instanceof Error ? error.message : "Could not save reply");
                setReplying(true);
              }
              throw error;
            }
          }}
          onCancel={() => {
            replySession.current++;
            setReplying(false);
          }}
        />
      )}
    </article>
  );
}

const styles = stylex.create({
  // A quiet card: the text leads, the time is faint, and the actions show on
  // hover or keyboard focus.
  card: {
    boxSizing: "border-box",
    marginBlock: 6,
    marginInline: 10,
    maxWidth: 600,
    paddingBlock: 10,
    paddingInline: 12,
    paddingBottom: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":focus-within": tokens.lineStrong },
    borderRadius: 10,
    color: tokens.text,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 13,
  },
  embedded: {
    borderWidth: 0,
    borderTopWidth: 1,
    borderRadius: 0,
    margin: 0,
    marginTop: 6,
    paddingInline: 0,
    paddingTop: 10,
    paddingBottom: 0,
    backgroundColor: "transparent",
  },
  // Use identical text geometry for drafts, edits, and saved comments.
  content: {
    boxSizing: "border-box",
    minWidth: 0,
    width: "100%",
    margin: 0,
    padding: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontFamily: tokens.ui,
    fontSize: 13,
    fontWeight: 400,
    lineHeight: "20px",
    letterSpacing: "normal",
  },
  editorBody: { display: "grid", minHeight: 40 },
  mirror: { gridRowStart: 1, gridColumnStart: 1, visibility: "hidden", pointerEvents: "none" },
  textarea: {
    gridRowStart: 1,
    gridColumnStart: 1,
    height: "100%",
    resize: "none",
    overflow: "hidden",
    borderWidth: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  actions: { display: "flex", alignItems: "center", gap: 4, minHeight: 28, marginTop: 4 },
  meta: { color: tokens.faint, fontSize: 11, whiteSpace: "nowrap" },
  hint: { opacity: 0.7 },
  tools: {
    display: "inline-flex",
    gap: 2,
    marginInlineEnd: -6,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: { default: "120ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
  },
  tool: { width: 26, minWidth: 26, minHeight: 26, color: tokens.faint },
  danger: { color: { default: tokens.faint, ":hover": tokens.red } },
  smallButton: { minHeight: 26, paddingBlock: 2, fontSize: 12 },
  submit: {
    minHeight: 26,
    paddingBlock: 2,
    paddingInline: 10,
    borderRadius: 7,
    fontSize: 12,
    fontWeight: 550,
    color: tokens.canvas,
    backgroundColor: tokens.text,
    opacity: { default: 1, ":hover": 0.85, ":disabled": 0.35 },
  },
  reply: {
    marginTop: 6,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  stale: { color: tokens.warning, fontSize: 11, lineHeight: 1.6, marginTop: 0, marginBottom: 6 },
  error: { color: tokens.red, fontSize: 11, marginBlock: 5 },
});
