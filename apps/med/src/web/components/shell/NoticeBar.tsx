import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../theme.stylex";

/** A short message to act on, such as an error. */
export interface TabNotice {
  text: string;
  actions?: { label: string; run(): void }[];
  /** Something failed; it shows longer, as an alert. */
  problem?: boolean;
  /** A question: it stays until the reader answers. */
  stays?: boolean;
}

/** The notice in the sidebar, or over the workspace while the sidebar hides. */
export function NoticeBar({
  notice,
  onDismiss,
  floating = false,
}: {
  notice: TabNotice;
  onDismiss(): void;
  floating?: boolean;
}) {
  return (
    <div
      role={notice.problem ? "alert" : "status"}
      {...stylex.props(
        styles.notice,
        notice.problem && styles.problem,
        floating && styles.floating,
      )}
    >
      <span {...stylex.props(styles.text)}>{notice.text}</span>
      {notice.actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.run}
          {...stylex.props(styles.action)}
        >
          {action.label}
        </button>
      ))}
      {!notice.actions?.length && floating && (
        <button type="button" onClick={onDismiss} {...stylex.props(styles.action)}>
          OK
        </button>
      )}
    </div>
  );
}

const styles = stylex.create({
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    marginBottom: 8,
    paddingBlock: 7,
    paddingInline: 10,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontSize: 12,
    lineHeight: 1.45,
  },
  problem: { color: tokens.text },
  floating: {
    position: "absolute",
    zIndex: 30,
    left: 12,
    bottom: 12,
    maxWidth: "min(380px, calc(100% - 24px))",
    marginBottom: 0,
    boxShadow: `0 0 0 1px ${tokens.line}, ${tokens.shadow}`,
  },
  text: { flex: "1", minWidth: 0 },
  action: {
    flexShrink: 0,
    paddingInline: 6,
    height: 22,
    borderWidth: 0,
    borderRadius: tokens.buttonRound,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
});
