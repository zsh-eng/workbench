import * as stylex from "@stylexjs/stylex";
import type { TurnCheck } from "../../../shared/agent-status";
import { platform } from "../../data/keys";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

// The end of a turn that the reader did not see end (data/turn-recap.ts):
// one quiet line of facts, then Review and Reply. The reply itself is right
// above, so the recap does not repeat it.

/** What Med knows of the turn: the thread's changes, and the turn's checks. */
export interface TurnFacts {
  changes?: { files: number; additions: number; deletions: number };
  checks?: readonly TurnCheck[];
}

export interface TurnRecapProps {
  facts: TurnFacts;
  /** Seen: the recap keeps its place, out of sight, until the next turn. */
  hidden: boolean;
  /** Opens the Review at the Guide's first segment not viewed, or Changes. */
  onReview(): void;
  /** Puts the focus in the message box. */
  onReply(): void;
  onDismiss(): void;
}

/** The key that opens the review while a recap shows. */
export const REVIEW_KEY = "Alt+Enter";
const reviewHint = platform === "mac" ? "⌥↵" : "Alt+Enter";

/** "bun test 5 pass", "bun test 4 pass, 1 fail", "tsc pass", "tsc fail". */
function checkText(check: TurnCheck) {
  const counts = [
    check.pass !== undefined ? `${check.pass} pass` : "",
    check.fail ? `${check.fail} fail` : "",
  ].filter(Boolean);
  const failed = check.status === "failed";
  // A check that failed without a failed test says so in place of its counts.
  const result = failed && !check.fail ? "fail" : counts.join(", ") || "pass";
  return `${check.name} ${result}`;
}

export function TurnRecap({ facts, hidden, onReview, onReply, onDismiss }: TurnRecapProps) {
  const { changes, checks = [] } = facts;
  const parts = [
    ...(changes && changes.files > 0
      ? [
          <span key="files">
            {changes.files.toLocaleString()} {changes.files === 1 ? "file" : "files"}
          </span>,
          <span key="lines" {...stylex.props(styles.lines)}>
            <span {...stylex.props(ui.added)}>+{changes.additions.toLocaleString()}</span>
            <span {...stylex.props(ui.removed)}>−{changes.deletions.toLocaleString()}</span>
          </span>,
        ]
      : []),
    ...checks.map((check) => (
      <span
        key={check.name}
        data-check={check.status}
        {...stylex.props(check.status === "failed" && styles.failed)}
      >
        {checkText(check)}
      </span>
    )),
  ];
  return (
    // Esc from any of the recap's buttons hides it, as × does.
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-label="Turn recap"
      aria-hidden={hidden || undefined}
      inert={hidden}
      data-recap={hidden ? "hidden" : "shown"}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented) return;
        event.preventDefault();
        event.stopPropagation();
        onDismiss();
      }}
      {...stylex.props(styles.recap, hidden && styles.hidden)}
    >
      {parts.length > 0 && (
        <p {...stylex.props(styles.facts)}>
          {parts.flatMap((part, index) =>
            index === 0
              ? [part]
              : [
                  <span key={`dot-${index}`} aria-hidden="true" {...stylex.props(styles.dot)}>
                    ·
                  </span>,
                  part,
                ],
          )}
        </p>
      )}
      <div {...stylex.props(styles.actions)}>
        <button
          type="button"
          aria-keyshortcuts={REVIEW_KEY}
          onClick={onReview}
          {...stylex.props(ui.button, ui.pressable, ui.primary, styles.button)}
        >
          Review
          <span aria-hidden="true" {...stylex.props(styles.hint)}>
            {reviewHint}
          </span>
        </button>
        <button
          type="button"
          onClick={onReply}
          {...stylex.props(ui.button, ui.pressable, styles.button, styles.reply)}
        >
          Reply
        </button>
        <button
          type="button"
          aria-label="Hide the recap"
          title="Hide until the next turn (Esc)"
          onClick={onDismiss}
          {...stylex.props(ui.button, ui.pressable, ui.iconButton, styles.button, styles.close)}
        >
          <Icon name="close" size={13} />
        </button>
      </div>
    </section>
  );
}

const styles = stylex.create({
  recap: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    fontFamily: tokens.ui,
  },
  // Seen: out of sight, in the same place, so nothing in the thread moves.
  hidden: { visibility: "hidden" },
  facts: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    columnGap: 7,
    rowGap: 2,
    margin: 0,
    color: tokens.muted,
    fontSize: 12,
    lineHeight: 1.5,
    fontVariantNumeric: "tabular-nums",
  },
  lines: { display: "inline-flex", gap: 5 },
  dot: { color: tokens.faint },
  failed: { color: tokens.red },
  actions: { display: "flex", alignItems: "center", gap: 4 },
  button: { minHeight: 26, fontSize: 12 },
  hint: {
    marginInlineStart: 2,
    opacity: 0.6,
    fontWeight: 400,
    fontVariantNumeric: "tabular-nums",
  },
  reply: { color: { default: tokens.text, ":hover:not(:disabled)": tokens.text } },
  close: { width: 26, minWidth: 26, marginInlineStart: "auto", color: tokens.faint },
});
