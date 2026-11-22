import * as stylex from "@stylexjs/stylex";
import { tokens } from "../theme.stylex";

/**
 * What the end of Changes says: how many changed files the stream showed, and
 * of how many when a filter hides some. It is true of a saved review, a
 * branch, working changes, a commit, and a range alike.
 */
export function streamEndLabel(shown: number, total: number) {
  if (shown < total) return `${shown} of ${total} changed files`;
  return `${shown} changed ${shown === 1 ? "file" : "files"}`;
}

/**
 * The end of the Changes stream: one quiet line with the count of files, so
 * that the reader knows nothing more is to load. No colour and no motion.
 */
export function StreamEnd({ shown, total }: { shown: number; total: number }) {
  return (
    <p data-stream-end="" {...stylex.props(styles.root)}>
      {streamEndLabel(shown, total)}
    </p>
  );
}

const styles = stylex.create({
  root: {
    margin: 0,
    // Room after the last file, so the end does not crowd its diff.
    paddingTop: 40,
    paddingBottom: 32,
    paddingInline: 24,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    lineHeight: "16px",
    fontVariantNumeric: "tabular-nums",
    textAlign: "center",
    whiteSpace: "nowrap",
  },
});
