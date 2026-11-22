import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

/** Lines added and removed, as +12 −3; nothing for a change without lines. */
export function LineCounts({ additions, deletions }: { additions: number; deletions: number }) {
  if (!additions && !deletions) return null;
  return (
    <span {...stylex.props(styles.counts)}>
      {additions > 0 && <span {...stylex.props(styles.plus)}>+{additions}</span>}
      {deletions > 0 && <span {...stylex.props(styles.minus)}>−{deletions}</span>}
    </span>
  );
}

const styles = stylex.create({
  counts: {
    display: "inline-flex",
    gap: 5,
    flexShrink: 0,
    fontFamily: tokens.code,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  plus: { color: tokens.green },
  minus: { color: tokens.red },
});
