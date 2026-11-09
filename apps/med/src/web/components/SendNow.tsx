import * as stylex from "@stylexjs/stylex";
import { useViewSetting, viewSettings } from "../data/view-settings";
import { tokens } from "../theme.stylex";

/** Whether a new comment goes to the agent as it is saved. */
export const sendsNow = () => viewSettings.commentsSendNow.get() === "on";

/**
 * "Send to Claude now" under a new comment, as in Claude Design: ticked, the
 * comment goes to the agent that Med runs as you save it, at its next step
 * while it works; not ticked, it waits in the message box with the others.
 * Med keeps the choice (`comments.sendNow`).
 */
export function SendNow({ agent }: { agent: string }) {
  const on = useViewSetting(viewSettings.commentsSendNow) === "on";
  return (
    <label {...stylex.props(styles.label)}>
      <input
        type="checkbox"
        checked={on}
        onChange={(event) => viewSettings.commentsSendNow.set(event.target.checked ? "on" : "off")}
        {...stylex.props(styles.check)}
      />
      {`Send to ${agent} now`}
    </label>
  );
}

const styles = stylex.create({
  label: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12,
    lineHeight: "16px",
    whiteSpace: "nowrap",
    cursor: "pointer",
    userSelect: "none",
  },
  check: { flexShrink: 0, margin: 0, accentColor: tokens.accent, cursor: "pointer" },
});
