import * as stylex from "@stylexjs/stylex";
import { Popover } from "@base-ui/react/popover";
import { useState } from "react";
import type { ListedComment } from "../data/listed-comments";
import { relativeTime } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import { tooltip } from "./ToolButton";

// All of a thread's comments in one list, from a button with their count, as
// a page that people comment on with Claude has: the comments on the diff's
// lines and on files' lines, newest first. A comment opens at its lines.
// Resolved comments show on request.

const where = (comment: ListedComment) =>
  `${comment.path.split("/").at(-1)} ${
    comment.endLine && comment.endLine !== comment.line
      ? `L${comment.line}–${comment.endLine}`
      : `L${comment.line}`
  }`;

export function CommentsButton({
  comments,
  onOpen,
  onCopy,
  copied = false,
}: {
  comments: readonly ListedComment[];
  onOpen(comment: ListedComment): void;
  /** Copies the comments for an agent elsewhere; none while there are none.
   * False when the copy failed: the panel closes, so the error shows. */
  onCopy?(): Promise<boolean>;
  /** The copy has just reached the clipboard: the button shows a check. */
  copied?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [resolved, setResolved] = useState(false);
  const [now, setNow] = useState(Date.now);
  const unresolved = comments.filter((comment) => !comment.resolved);
  const shown = resolved ? comments : unresolved;
  const hidden = comments.length - unresolved.length;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setNow(Date.now());
      }}
    >
      <Popover.Trigger
        aria-label="All comments"
        {...tooltip("All comments")}
        {...stylex.props(ui.button, ui.pressable, styles.trigger, open && ui.active)}
      >
        <Icon name="note" size={14} />
        {unresolved.length > 0 && <span {...stylex.props(styles.count)}>{unresolved.length}</span>}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="end"
          sideOffset={6}
          {...stylex.props(styles.positioner, ui.instant)}
        >
          <Popover.Popup {...stylex.props(ui.popup, styles.panel, ui.instant)}>
            <div {...stylex.props(styles.head)}>
              <Popover.Title {...stylex.props(styles.title)}>All comments</Popover.Title>
              {hidden > 0 && (
                <button
                  type="button"
                  aria-pressed={resolved}
                  aria-label="Show resolved"
                  {...tooltip(resolved ? "Hide resolved" : `Show ${hidden} resolved`)}
                  onClick={() => setResolved((value) => !value)}
                  {...stylex.props(ui.button, ui.iconButton, resolved && ui.active)}
                >
                  <Icon name="filter" size={14} />
                </button>
              )}
              {onCopy && comments.length > 0 && (
                <button
                  type="button"
                  aria-label="Copy comments"
                  data-copied={copied}
                  {...tooltip(copied ? "Copied" : "Copy comments")}
                  onClick={() =>
                    void onCopy().then((done) => {
                      if (!done) setOpen(false);
                    })
                  }
                  {...stylex.props(ui.button, ui.iconButton)}
                >
                  <Icon name={copied ? "check" : "copy"} size={14} />
                </button>
              )}
              <Popover.Close
                aria-label="Close comments"
                {...tooltip("Close", "Esc")}
                {...stylex.props(ui.button, ui.iconButton)}
              >
                <Icon name="close" size={14} />
              </Popover.Close>
            </div>
            {shown.length ? (
              <ul aria-label="Comments" {...stylex.props(styles.list)}>
                {shown.map((comment) => {
                  const time = Date.parse(comment.createdAt);
                  return (
                    <li key={`${comment.kind}:${comment.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          setOpen(false);
                          onOpen(comment);
                        }}
                        {...stylex.props(styles.item, comment.resolved && styles.done)}
                      >
                        <span {...stylex.props(styles.where)}>
                          <span {...stylex.props(styles.path)}>{where(comment)}</span>
                          {comment.unsent && (
                            <span
                              aria-label="Not sent"
                              {...tooltip("Not sent")}
                              {...stylex.props(styles.dot)}
                            />
                          )}
                          <span {...stylex.props(styles.grow)} />
                          {Number.isFinite(time) && (
                            <span {...stylex.props(styles.time)}>{relativeTime(time, now)}</span>
                          )}
                        </span>
                        <span {...stylex.props(styles.text)}>{comment.text}</span>
                        {(comment.replies > 0 || comment.resolved) && (
                          <span {...stylex.props(styles.state)}>
                            {comment.resolved && (
                              <span {...stylex.props(styles.resolved)}>
                                <Icon name="check" size={12} />
                                Resolved
                              </span>
                            )}
                            {comment.replies > 0 && (
                              <span {...stylex.props(styles.replies)}>
                                <Icon name="reply" size={12} />
                                {comment.answeredBy ?? comment.replies}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div {...stylex.props(styles.empty)}>
                <p {...stylex.props(styles.emptyTitle)}>
                  {hidden ? "All resolved" : "No comments yet"}
                </p>
                <p {...stylex.props(styles.emptyNote)}>Select lines, then gc.</p>
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

const styles = stylex.create({
  trigger: { gap: 6, minWidth: 28, paddingInline: 7 },
  count: { fontSize: 12, fontVariantNumeric: "tabular-nums" },
  positioner: { zIndex: 60 },
  panel: {
    display: "flex",
    flexDirection: "column",
    width: 360,
    maxHeight: "min(560px, 70vh)",
    padding: 0,
    overflow: "hidden",
  },
  head: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    minHeight: 44,
    paddingInlineStart: 16,
    paddingInlineEnd: 8,
  },
  title: { flex: "1", margin: 0, fontSize: 13.5, fontWeight: 550 },
  list: {
    flex: "1",
    minHeight: 0,
    margin: 0,
    paddingInline: 6,
    paddingBottom: 6,
    overflowY: "auto",
    listStyle: "none",
  },
  item: {
    display: "grid",
    gap: 4,
    width: "100%",
    paddingBlock: 10,
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    font: "inherit",
    textAlign: "start",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  done: { color: tokens.muted },
  where: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, fontSize: 12 },
  path: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  dot: { flexShrink: 0, width: 6, height: 6, borderRadius: 3, backgroundColor: tokens.accent },
  grow: { flex: "1" },
  time: { flexShrink: 0, color: tokens.faint, fontSize: 12 },
  text: {
    display: "-webkit-box",
    overflow: "hidden",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    fontSize: 13,
    lineHeight: "19px",
    overflowWrap: "anywhere",
  },
  state: { display: "flex", alignItems: "center", gap: 10, color: tokens.faint, fontSize: 12 },
  resolved: { display: "inline-flex", alignItems: "center", gap: 4, color: tokens.green },
  replies: { display: "inline-flex", alignItems: "center", gap: 4 },
  empty: { display: "grid", gap: 6, paddingBlock: 28, paddingInline: 24, textAlign: "center" },
  emptyTitle: { margin: 0, color: tokens.muted, fontSize: 13.5 },
  emptyNote: { margin: 0, color: tokens.faint, fontSize: 12.5 },
});
