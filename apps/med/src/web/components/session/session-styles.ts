import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../theme.stylex";

const reduced = "@media (prefers-reduced-motion: reduce)";

const shine = stylex.keyframes({
  from: { backgroundPosition: "100% 0" },
  to: { backgroundPosition: "-100% 0" },
});
const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "none" },
});

/** Motion for work in progress: a light that passes over a label, and a spinner. */
export const motion = stylex.create({
  shimmer: {
    backgroundImage: `linear-gradient(90deg, ${tokens.muted} 0%, ${tokens.muted} 40%, ${tokens.text} 50%, ${tokens.muted} 60%, ${tokens.muted} 100%)`,
    backgroundSize: "200% 100%",
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    color: "transparent",
    animationName: { default: shine, [reduced]: "none" },
    animationDuration: "1.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  spinner: {
    display: "inline-block",
    boxSizing: "border-box",
    width: 11,
    height: 11,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.muted,
    animationName: { default: spin, [reduced]: "none" },
    animationDuration: "0.8s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  // New rows rise in once; rows that were there already do not move.
  enter: {
    animationName: { default: enter, [reduced]: "none" },
    animationDuration: "220ms",
    animationTimingFunction: tokens.easeOut,
  },
});

/** The shared row of tool calls, thoughts, and groups. */
export const rowStyles = stylex.create({
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    minWidth: 0,
    minHeight: 28,
    paddingBlock: 3,
    paddingInline: 0,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: "transparent",
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    lineHeight: 1.5,
    textAlign: "left",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  icon: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 16,
    flexShrink: 0,
    color: tokens.faint,
  },
});

/**
 * The thread's readable column. In a wide pane a reply's lines ran the pane's
 * width, past 150 characters. The thread, its docks, and the message box
 * keep to a column in the middle of the pane, as Claude Desktop's transcript
 * does; code blocks and tool output keep to it too. Its text is 768 pixels
 * wide, Claude Desktop's default transcript measure
 * (`--max-content-width: var(--chat-column-measure, 768px)` in its styles of
 * October 2026; its wider settings are 960 and 1280), and the column adds the
 * thread's 18 pixel sides. That holds about 120 characters of 13.5 pixel
 * prose in the sans themes. A narrower pane, or one with the side panel,
 * narrows the column. The room beside the column stays empty: a pane cannot
 * have a maximum width in Med's layout, whose splits are shares of the
 * window (pane-tree.ts).
 */
const COLUMN = 804; // 768 + 2 × 18
export const column = stylex.create({
  /** The thread's content, with its sides inside the column. */
  thread: { boxSizing: "border-box", width: "100%", maxWidth: COLUMN, marginInline: "auto" },
  /** A card or bar under the thread: 12 pixels in from the column's sides,
   * as from the pane's sides in a narrow pane. */
  bar: { marginInline: `max(12px, calc((100% - ${COLUMN}px) / 2 + 12px))` },
});
