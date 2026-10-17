import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { answering, type QuestionView } from "../data/questions";
import { tokens, ui } from "../theme.stylex";
import { FileRefsContext, type FileRefs } from "./FileRefs";
import { Icon } from "./Icon";
import { PaneHeader } from "./PaneTree";
import { ShortcutKeys } from "./ShortcutKeys";
import { motion } from "./session/session-styles";
import { SessionMarkdown } from "./session/SessionMarkdown";
import { sessionLink } from "./session/SessionPanel";
import "./session/SessionThread.css";
import "./QuestionPane.css";

const lineLabel = (note: QuestionView["target"]["note"]) =>
  note.line === note.endLine ? `L${note.line}` : `L${note.line}–${note.endLine}`;

/**
 * The Question pane: a box that names the file and lines, the agent's answer
 * as it streams, and Keep as comment. The answer never goes into the thread.
 * The pane's Close discards the question.
 */
export default function QuestionPane({
  view,
  controls,
  onSend,
  onStop,
  onKeep,
  root,
  onOpenPath,
  fileRefs,
}: {
  view: QuestionView;
  /** The pane's own controls: Restore and Close. */
  controls: ReactNode;
  onSend(question: string): void;
  onStop(): void;
  onKeep(): Promise<void>;
  /** The checkout, for file links in the answer. */
  root?: string;
  onOpenPath(path: string, line?: number): void;
  /** The checkout's files: paths in the answer that name one link to it. */
  fileRefs?: FileRefs;
}) {
  const { target, asked, state } = view;
  const [text, setText] = useState("");
  const [keeping, setKeeping] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const streaming = answering(view);
  const lines = lineLabel(target.note);
  const name = target.note.path.split("/").at(-1) ?? target.note.path;
  const answer = state?.answer ?? "";
  const ended = !!state && !streaming;

  // Each Ask mounts a new pane (its key), with an empty box and the focus in it.
  useEffect(() => {
    const frame = requestAnimationFrame(() => box.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, []);
  // Once sent, the pane keeps the focus, so Esc stops the answer.
  useEffect(() => {
    if (asked) pane.current?.focus({ preventScroll: true });
  }, [asked]);
  useEffect(() => {
    const node = pane.current;
    if (!node || !streaming) return;
    const stop = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onStop();
    };
    node.addEventListener("keydown", stop);
    return () => node.removeEventListener("keydown", stop);
  }, [streaming, onStop]);

  const keep = async () => {
    setKeeping(true);
    try {
      await onKeep();
    } finally {
      setKeeping(false);
    }
  };
  const status = !state
    ? view.sending
      ? `Asking ${target.agent}`
      : null
    : state.status === "starting"
      ? `Asking ${target.agent}`
      : state.status === "answering"
        ? (state.activity ?? `${target.agent} is answering`)
        : state.status === "stopped"
          ? "Stopped"
          : state.status === "failed"
            ? null
            : "Answered";
  const error = view.error ?? (state?.status === "failed" ? state.error : undefined);

  return (
    <div ref={pane} tabIndex={-1} {...stylex.props(styles.pane)}>
      <PaneHeader title="Question" detail={`${name} · ${lines}`} controls={controls} />
      <div {...stylex.props(styles.body)}>
        <div {...stylex.props(styles.box, !asked && styles.boxOpen)}>
          <div {...stylex.props(styles.about)}>
            <span {...stylex.props(styles.path)} title={target.note.path}>
              {target.note.path}
            </span>
            <span {...stylex.props(styles.lines)}>
              {lines}
              {target.note.side === "old" ? " before the change" : ""}
            </span>
          </div>
          {asked ? (
            <p {...stylex.props(styles.asked)}>{asked}</p>
          ) : (
            <textarea
              ref={box}
              data-pane-autofocus=""
              aria-label={`Question about ${target.note.path} ${lines}`}
              placeholder={`Ask ${target.agent} about these lines`}
              value={text}
              disabled={view.sending}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  onSend(text);
                }
              }}
              {...stylex.props(styles.input)}
            />
          )}
        </div>
        {state?.context === "excerpt" && (
          <p {...stylex.props(styles.note)}>
            {target.agent} answers from the excerpt, without the thread's context
          </p>
        )}
        {answer && (
          <div aria-live="polite" className="med-question-answer">
            <FileRefsContext.Provider value={fileRefs ?? null}>
              <SessionMarkdown
                text={answer}
                streaming={streaming}
                onOpenLink={(href) => {
                  const link = sessionLink(href, root);
                  if (link) onOpenPath(link.path, link.line);
                }}
              />
            </FileRefsContext.Provider>
          </div>
        )}
      </div>
      <footer {...stylex.props(styles.footer)}>
        <span
          role={error ? "alert" : "status"}
          {...stylex.props(styles.status, !!error && styles.error)}
        >
          {streaming && <span {...stylex.props(motion.spinner)} />}
          <span {...stylex.props(styles.statusText)}>
            {error ?? status ?? (asked ? "" : `${target.agent}'s thread gets nothing`)}
          </span>
        </span>
        {!asked ? (
          <button
            type="button"
            aria-label="Send"
            aria-keyshortcuts="Meta+Enter Control+Enter"
            disabled={!text.trim() || view.sending}
            onClick={() => onSend(text)}
            {...stylex.props(ui.button, ui.pressable, styles.submit)}
          >
            Send
            <ShortcutKeys value="Mod+Enter" />
          </button>
        ) : streaming ? (
          <button
            type="button"
            aria-label="Stop"
            aria-keyshortcuts="Escape"
            onClick={onStop}
            {...stylex.props(ui.button, ui.outlined, ui.pressable, styles.action)}
          >
            <Icon name="stop" size={13} />
            Stop
            <ShortcutKeys value="Esc" />
          </button>
        ) : (
          <button
            type="button"
            disabled={!ended || !answer.trim() || keeping}
            onClick={() => void keep()}
            {...stylex.props(ui.button, ui.pressable, styles.submit)}
          >
            Keep as comment
          </button>
        )}
      </footer>
    </div>
  );
}

const styles = stylex.create({
  pane: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    outline: "none",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  body: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    scrollbarWidth: "thin",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    paddingBlock: 14,
    paddingInline: 14,
  },
  // A hairline box, as the review's comment composer has.
  box: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    paddingBlock: 9,
    paddingInline: 11,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(10px * ${tokens.round})`,
  },
  boxOpen: {
    borderColor: { default: tokens.line, ":focus-within": tokens.lineStrong },
  },
  about: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    minWidth: 0,
    fontFamily: tokens.code,
    fontSize: 11.5,
    lineHeight: 1.5,
  },
  path: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    direction: "rtl",
    textAlign: "left",
    color: tokens.muted,
  },
  lines: { flexShrink: 0, color: tokens.accent, fontVariantNumeric: "tabular-nums" },
  input: {
    boxSizing: "border-box",
    width: "100%",
    minHeight: 60,
    maxHeight: 220,
    margin: 0,
    padding: 0,
    borderWidth: 0,
    resize: "none",
    fieldSizing: "content",
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    lineHeight: "20px",
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  asked: {
    margin: 0,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    fontSize: 13,
    lineHeight: "20px",
  },
  note: { margin: 0, color: tokens.muted, fontSize: 12, lineHeight: 1.5 },
  footer: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: 8,
    minHeight: 44,
    paddingInlineStart: 14,
    paddingInlineEnd: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  status: {
    flex: "1",
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    color: tokens.muted,
    fontSize: 12,
  },
  statusText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  error: { color: tokens.red },
  action: { flexShrink: 0, gap: 6, minHeight: 28, paddingInline: 10 },
  // The comment composer's Save: text on the reading color.
  submit: {
    flexShrink: 0,
    gap: 6,
    minHeight: 28,
    paddingInline: 10,
    borderRadius: `calc(7px * ${tokens.round})`,
    fontWeight: 550,
    color: { default: tokens.canvas, ":hover:not(:disabled)": tokens.canvas },
    backgroundColor: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
    opacity: { default: 1, ":hover:not(:disabled)": 0.85, ":disabled": 0.35 },
  },
});
