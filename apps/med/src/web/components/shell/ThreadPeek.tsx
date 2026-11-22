import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef } from "react";
import type { Thread } from "../../../shared/threads";
import { relativeTime, useMinuteClock } from "../../data/relative-time";
import { needsYou } from "../../data/threads";
import { tokens, ui } from "../../theme.stylex";

/** What a thread is doing, in a word or three, as its dot would say it. */
export function peekState(thread: Thread, unread: boolean) {
  if (thread.halt) return "Stopped";
  if (thread.state === "working") return "Working";
  if (needsYou(thread)) return "Needs you";
  if (unread) return "New since you looked";
  return "Done";
}

/** What the thread said last, or does now: the card's one paragraph. */
export function peekSaid(thread: Thread) {
  if (thread.halt) return thread.halt.detail ?? thread.turn?.said;
  if (thread.state === "working") return thread.turn?.activity ?? thread.turn?.said;
  return thread.turn?.said;
}

/**
 * A look at a thread without opening it: the card beside its row while the
 * reader holds Space (SessionSidebar). It says what the thread's dot says, in
 * words, with its age; the last thing the agent said; and where the work is:
 * the branch and the size of its change. The thread stays as it was: a peek
 * does not mark it read.
 */
export function ThreadPeek({
  thread,
  unread,
  at,
}: {
  thread: Thread;
  unread: boolean;
  /** The row's box: the card goes at its end, level with it. */
  at: { top: number; right: number };
}) {
  const now = useMinuteClock(true);
  const card = useRef<HTMLDivElement>(null);
  // Inside the window: up from its foot, and in from its end.
  useLayoutEffect(() => {
    const node = card.current;
    if (!node) return;
    const top = Math.max(8, Math.min(at.top - 6, innerHeight - node.offsetHeight - 8));
    const left = Math.max(8, Math.min(at.right + 10, innerWidth - node.offsetWidth - 8));
    node.style.top = `${top}px`;
    node.style.left = `${left}px`;
  }, [at.top, at.right, thread]);
  const said = peekSaid(thread);
  const changes = thread.changes;
  return (
    <div ref={card} role="tooltip" data-thread-peek={thread.id} {...stylex.props(styles.card)}>
      <div {...stylex.props(styles.state)}>
        <b {...stylex.props(styles.stateWord)}>{peekState(thread, unread)}</b>
        {" · "}
        {relativeTime(thread.updatedAt, now)}
      </div>
      {said ? (
        <p {...stylex.props(styles.said)}>{said}</p>
      ) : (
        <p {...stylex.props(styles.said, styles.none)}>Nothing said yet.</p>
      )}
      {(thread.branch || changes) && (
        <div {...stylex.props(styles.foot)}>
          {thread.branch && (
            <span {...stylex.props(ui.truncate, styles.branch)}>{thread.branch}</span>
          )}
          {changes && (changes.additions > 0 || changes.deletions > 0) && (
            <span {...stylex.props(styles.counts)}>
              {changes.additions > 0 && (
                <span {...stylex.props(ui.added)}>+{changes.additions}</span>
              )}
              {changes.deletions > 0 && (
                <span {...stylex.props(ui.removed)}>−{changes.deletions}</span>
              )}
            </span>
          )}
          {changes && changes.files > 0 && (
            <span {...stylex.props(styles.files)}>
              {changes.files} {changes.files === 1 ? "file" : "files"}
            </span>
          )}
        </div>
      )}
      <div {...stylex.props(styles.keys)}>
        <span>↵ Open</span>
        <span>↑ ↓ Other threads</span>
        <span>Let go to close</span>
      </div>
    </div>
  );
}

const styles = stylex.create({
  // Over the workspace, beside the sidebar: a popup's ground and edge.
  card: {
    position: "fixed",
    top: 0,
    left: 0,
    zIndex: 80,
    display: "flex",
    flexDirection: "column",
    gap: 10,
    boxSizing: "border-box",
    width: 340,
    maxWidth: "calc(100vw - 16px)",
    paddingTop: 14,
    paddingInline: 16,
    paddingBottom: 12,
    borderRadius: `calc(12px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `${tokens.shadow}, inset 0 0 0 1px ${tokens.line}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    pointerEvents: "none",
  },
  state: { color: tokens.muted, fontSize: 11.5, lineHeight: "16px" },
  stateWord: { color: tokens.text, fontWeight: 550 },
  said: {
    margin: 0,
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 4,
    overflow: "hidden",
    fontSize: 13.5,
    lineHeight: "21px",
    overflowWrap: "anywhere",
  },
  none: { color: tokens.muted },
  foot: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    minWidth: 0,
    color: tokens.muted,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  branch: { minWidth: 0, fontFamily: tokens.code, fontSize: 11 },
  counts: { display: "inline-flex", flex: "none", gap: 5, fontFamily: tokens.code, fontSize: 11 },
  files: { flex: "none" },
  keys: {
    display: "flex",
    gap: 14,
    paddingTop: 9,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    color: tokens.faint,
    fontSize: 11.5,
    whiteSpace: "nowrap",
  },
});
