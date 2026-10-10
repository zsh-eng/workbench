import * as stylex from "@stylexjs/stylex";
import { useState, type KeyboardEvent } from "react";
import type { AgentMessage, DraftComment } from "../../../shared/agent-inbox";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

export interface ComposerAttachment {
  id: string;
  label: string;
  text: string;
}

const AGENTS = { claude: "Claude", codex: "Codex" } as const;

/**
 * Writes to the agent from the review: the user's text, the comments not yet
 * sent, and other text such as GitHub comments. A Claude session takes the
 * message when it runs `med review wait`; a Codex session reads its queue.
 */
export function SessionComposer({
  agent,
  waiting,
  drafts,
  attachments,
  onRemoveAttachment,
  onSend,
}: {
  agent: AgentMessage["agent"];
  /** The agent waits in `med review wait` now. */
  waiting: boolean;
  drafts: DraftComment[];
  attachments: ComposerAttachment[];
  onRemoveAttachment(id: string): void;
  onSend(message: {
    text: string;
    noteIds: string[];
    attachments: { label: string; text: string }[];
  }): Promise<unknown>;
}) {
  const [text, setText] = useState("");
  const [left, setLeft] = useState<ReadonlySet<string>>(new Set());
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = AGENTS[agent];
  const chosen = drafts.filter((draft) => !left.has(draft.id));
  const empty = !text.trim() && !chosen.length && !attachments.length;

  const send = async () => {
    if (empty || sending) return;
    setSending(true);
    setError(null);
    try {
      await onSend({
        text: text.trim(),
        noteIds: chosen.map((draft) => draft.id),
        attachments: attachments.map(({ label, text }) => ({ label, text })),
      });
      setText("");
      setLeft(new Set());
      setOpen(false);
      for (const attachment of attachments) onRemoveAttachment(attachment.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The message was not sent.");
    } finally {
      setSending(false);
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      void send();
    }
  };

  return (
    <form
      aria-label={`Message ${name}`}
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      {...stylex.props(styles.box)}
    >
      {(drafts.length > 0 || attachments.length > 0) && (
        <div {...stylex.props(styles.chips)}>
          {drafts.length > 0 && (
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              {...stylex.props(styles.chip, chosen.length > 0 && styles.chipOn)}
            >
              <Icon name="note" size={12} />
              {chosen.length === drafts.length
                ? `${drafts.length} ${drafts.length === 1 ? "comment" : "comments"}`
                : `${chosen.length} of ${drafts.length} comments`}
            </button>
          )}
          {attachments.map((attachment) => (
            <span key={attachment.id} {...stylex.props(styles.chip, styles.chipOn)}>
              <Icon name="github" size={12} />
              <span {...stylex.props(styles.chipLabel)}>{attachment.label}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.label}`}
                onClick={() => onRemoveAttachment(attachment.id)}
                {...stylex.props(styles.chipRemove)}
              >
                <Icon name="close" size={10} />
              </button>
            </span>
          ))}
        </div>
      )}
      {open && drafts.length > 0 && (
        <ul aria-label="Comments to send" {...stylex.props(styles.drafts)}>
          {drafts.map((draft) => {
            const on = !left.has(draft.id);
            const lines =
              draft.endLine && draft.endLine !== draft.line
                ? `${draft.line}–${draft.endLine}`
                : `${draft.line}`;
            return (
              <li key={draft.id}>
                <label {...stylex.props(styles.draft)}>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = new Set(left);
                      if (on) next.add(draft.id);
                      else next.delete(draft.id);
                      setLeft(next);
                    }}
                    {...stylex.props(styles.check)}
                  />
                  <span {...stylex.props(styles.draftPath)}>
                    {draft.path.split("/").at(-1)}:{lines}
                  </span>
                  <span {...stylex.props(styles.draftText)}>{draft.text}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
      <textarea
        aria-label={`Message ${name}`}
        placeholder={`Message ${name}…`}
        value={text}
        rows={2}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        {...stylex.props(styles.input)}
      />
      <div {...stylex.props(styles.footer)}>
        <span role="status" {...stylex.props(styles.status, error !== null && styles.error)}>
          {error ? (
            error
          ) : agent === "codex" ? (
            "Codex reads this at its next turn"
          ) : waiting ? (
            <>
              <span {...stylex.props(styles.live)} />
              {name} is waiting for your review
            </>
          ) : (
            <>
              {name} gets this when it runs{" "}
              <code {...stylex.props(styles.code)}>med review wait</code>
            </>
          )}
        </span>
        <button
          type="submit"
          aria-label="Send"
          title="Send (⌘↩)"
          disabled={empty || sending}
          {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.send)}
        >
          <Icon name="arrowUp" size={14} />
        </button>
      </div>
    </form>
  );
}

const styles = stylex.create({
  box: {
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    marginInline: 12,
    marginBottom: 12,
    paddingTop: 8,
    paddingBottom: 6,
    paddingInline: 10,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.line}`,
      ":focus-within": `inset 0 0 0 1px ${tokens.accentLine}`,
    },
  },
  chips: { display: "flex", flexWrap: "wrap", gap: 4 },
  chip: {
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    maxWidth: "100%",
    height: 22,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
  },
  chipOn: { backgroundColor: tokens.accentSoft, color: tokens.accent },
  chipLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  chipRemove: {
    display: "inline-flex",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: "inherit",
    cursor: "pointer",
    opacity: { default: 0.7, ":hover": 1 },
  },
  drafts: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    maxHeight: 160,
    overflowY: "auto",
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
  draft: {
    display: "flex",
    alignItems: "baseline",
    gap: 7,
    paddingBlock: 3,
    color: tokens.muted,
    fontSize: 12,
    cursor: "pointer",
  },
  check: { margin: 0, accentColor: tokens.accent, transform: "translateY(1px)" },
  draftPath: { flexShrink: 0, color: tokens.text, fontFamily: tokens.code, fontSize: 11 },
  draftText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 40,
    maxHeight: 200,
    padding: 0,
    borderWidth: 0,
    resize: "none",
    fieldSizing: "content",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: "var(--med-font-prose)",
    fontSize: 13.5,
    lineHeight: 1.55,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  footer: { display: "flex", alignItems: "center", gap: 8 },
  status: {
    flex: "1",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 6,
    overflow: "hidden",
    color: tokens.faint,
    fontSize: 11.5,
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  error: { color: tokens.red, whiteSpace: "normal" },
  live: { width: 6, height: 6, flexShrink: 0, borderRadius: "50%", backgroundColor: tokens.green },
  code: { fontFamily: tokens.code, fontSize: 10.5 },
  send: {
    width: 26,
    minWidth: 26,
    minHeight: 26,
    borderRadius: 999,
    color: { default: tokens.primaryText, ":hover:not(:disabled)": tokens.primaryText },
    backgroundColor: {
      default: tokens.primary,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.primary} 86%, ${tokens.canvas})`,
    },
  },
});
