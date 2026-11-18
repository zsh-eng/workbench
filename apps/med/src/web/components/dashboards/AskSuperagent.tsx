import * as stylex from "@stylexjs/stylex";
import { useState, type FormEvent } from "react";
import { sendToThread, useSuperagent } from "../../data/superagent";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { Shimmer } from "../Shimmer";
import { tooltip } from "../ToolButton";

// The reader asks the Superagent about the dashboard on screen, in words, and
// stays on the page: "staging, yesterday afternoon", "why did 5xx jump at
// 14:10?". The message carries what the page shows and how to change it
// (`med dashboard open`), so the Superagent changes the page in place, or
// answers from `med dashboard check`. Its answer shows here, from its
// thread's last turn; the thread has the whole of it.

export interface PageContext {
  /** What the page shows, and how an agent changes it. */
  text: string;
}

export function AskSuperagent({ context }: { context: () => PageContext }) {
  const link = useSuperagent();
  const [draft, setDraft] = useState("");
  const [asked, setAsked] = useState<{ text: string; at: number } | null>(null);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  if (!link) return null;
  const thread = link.thread;
  const turn = thread?.turn;
  const answered = !!asked && turn?.endedAt !== undefined && turn.endedAt >= asked.at;
  const stopped = !!asked && !!thread?.halt;

  const send = async (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError("");
    try {
      const made = thread ? { thread: thread.id, created: false } : await link.start();
      const at = Date.now();
      await sendToThread(made.thread, {
        text,
        noteIds: [],
        attachments: [{ label: "The dashboard on the reader's screen", text: context().text }],
        // A Superagent made just now answers its brief first.
        ...(made.created ? { afterTurn: true } : {}),
      });
      setAsked({ text, at });
      setDismissed(false);
      setDraft("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The Superagent did not get the message.",
      );
    } finally {
      setSending(false);
    }
  };

  const shows = !!asked && !dismissed;
  return (
    <div {...stylex.props(styles.dock)}>
      <div data-ask-superagent="" {...stylex.props(styles.bar)}>
        {(shows || error) && (
          <div role="status" aria-live="polite" {...stylex.props(styles.reply)}>
            {error ? (
              <p {...stylex.props(styles.replyText, styles.error)}>{error}</p>
            ) : stopped ? (
              <p {...stylex.props(styles.replyText, styles.muted)}>
                The Superagent stopped: {thread?.halt?.detail ?? "open its thread to see why"}.
              </p>
            ) : answered ? (
              <p data-superagent-said="" {...stylex.props(styles.replyText)}>
                {turn?.said ?? "Done."}
              </p>
            ) : (
              <p {...stylex.props(styles.replyText, styles.muted)}>
                <Shimmer on>{turn?.activity ?? "Asking the Superagent…"}</Shimmer>
              </p>
            )}
            <div {...stylex.props(styles.replyTools)}>
              {thread && (
                <button
                  type="button"
                  onClick={link.open}
                  {...stylex.props(ui.button, styles.textButton)}
                >
                  Open thread
                </button>
              )}
              <button
                type="button"
                aria-label="Hide the answer"
                onClick={() => {
                  setDismissed(true);
                  setError("");
                }}
                {...stylex.props(ui.button, ui.iconButton, styles.close)}
              >
                <Icon name="close" size={13} />
              </button>
            </div>
          </div>
        )}
        <form onSubmit={(event) => void send(event)} {...stylex.props(styles.form)}>
          <span {...stylex.props(styles.mark)}>
            <Icon name="superagent" size={15} />
          </span>
          <input
            type="text"
            value={draft}
            spellCheck={false}
            aria-label="Ask the Superagent about this dashboard"
            placeholder="Ask the Superagent: “staging, yesterday afternoon”, “why did 5xx jump?”"
            onChange={(event) => setDraft(event.target.value)}
            {...stylex.props(styles.input)}
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!draft.trim() || sending}
            {...tooltip("Send to the Superagent")}
            {...stylex.props(ui.button, ui.iconButton, styles.send)}
          >
            <Icon name="arrowUp" size={14} />
          </button>
        </form>
      </div>
    </div>
  );
}

const styles = stylex.create({
  dock: {
    position: "sticky",
    bottom: 16,
    zIndex: 5,
    display: "flex",
    justifyContent: "center",
    marginTop: 28,
    pointerEvents: "none",
  },
  bar: {
    width: "min(680px, 100%)",
    overflow: "hidden",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderRadius: `calc(14px * ${tokens.round})`,
    backgroundColor: tokens.menu,
    boxShadow: tokens.shadow,
    pointerEvents: "auto",
  },
  reply: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    paddingBlock: 10,
    paddingInlineStart: 14,
    paddingInlineEnd: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  replyText: {
    flex: "1",
    minWidth: 0,
    margin: 0,
    paddingTop: 4,
    color: tokens.text,
    fontSize: 13,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
  },
  muted: { color: tokens.muted },
  error: { color: tokens.warning },
  replyTools: { display: "flex", alignItems: "center", gap: 2, flexShrink: 0 },
  textButton: { minHeight: 26, fontSize: 12 },
  close: { width: 26, minWidth: 26, minHeight: 26 },
  form: { display: "flex", alignItems: "center", gap: 10, height: 46, paddingInline: 12 },
  mark: { display: "inline-flex", color: tokens.accent },
  input: {
    flex: "1",
    minWidth: 0,
    height: "100%",
    padding: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    font: "inherit",
    fontSize: 13.5,
  },
  send: {
    width: 28,
    minWidth: 28,
    borderRadius: 999,
    backgroundColor: { default: tokens.primary, ":disabled": tokens.fill },
    color: { default: tokens.primaryText, ":disabled": tokens.faint },
  },
});
