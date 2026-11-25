import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../theme.stylex";

const reduced = "@media (prefers-reduced-motion: reduce)";

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const enter = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(4px)" },
  to: { opacity: 1, transform: "none" },
});

/** Motion for work in progress: a spinner (and Shimmer, the light that
 * passes over a label). */
export const motion = stylex.create({
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
 * thread's 22 pixel sides. That holds about 116 characters of the thread's
 * 14.5 pixel prose in the sans themes (READING.thread in themes.ts). A narrower pane, or one with the side panel,
 * narrows the column. The room beside the column stays empty: a pane cannot
 * have a maximum width in Med's layout, whose splits are shares of the
 * window (pane-tree.ts).
 */
const COLUMN = 812; // 768 + 2 × 22
export const column = stylex.create({
  /** The thread's content, with its sides inside the column. */
  thread: { boxSizing: "border-box", width: "100%", maxWidth: COLUMN, marginInline: "auto" },
  /** A card or bar under the thread: 12 pixels in from the column's sides,
   * as from the pane's sides in a narrow pane, so with its 10 pixel padding
   * its text keeps to the thread's edge, as a card in Settings does. */
  bar: { marginInline: `max(12px, calc((100% - ${COLUMN}px) / 2 + 12px))` },
});

/** A pill that floats over the thread: Latest, Quote, the request in view,
 * and Loading earlier work. One surface, one height, one type. */
export const floating = stylex.create({
  pill: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    boxSizing: "border-box",
    paddingInline: 12,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.menu,
    boxShadow: `${tokens.shadow}, inset 0 0 0 1px ${tokens.lineStrong}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 500,
    lineHeight: 1,
    whiteSpace: "nowrap",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  button: {
    cursor: "pointer",
    backgroundColor: {
      default: tokens.menu,
      ":hover": `color-mix(in srgb, ${tokens.text} 7%, ${tokens.menu})`,
    },
    transitionProperty: "background-color",
    transitionDuration: "140ms",
    transitionTimingFunction: tokens.easeOut,
  },
  // An icon before the label: the pill's left edge is as far from the icon
  // as the label's right edge is from the pill's.
  withIcon: { paddingInlineStart: 10 },
  icon: { display: "flex", flexShrink: 0, color: tokens.muted },
});

/** The message box: the thread's and the new thread's. A card above the
 * page, a hairline that firms while it has the focus, and a soft shadow
 * under it. Its tools sit in its own bottom bar. */
export const composer = stylex.create({
  card: {
    borderRadius: `calc(16px * ${tokens.round})`,
    // Lifted in both: the raised surface in a dark theme, the page's own
    // white in a light one, where a grey would read as a well.
    backgroundColor: tokens.menu,
    boxShadow: {
      default: `0 0 0 1px ${tokens.line}, 0 1px 2px #0000001a, 0 10px 28px -16px #00000066`,
      ":focus-within": `0 0 0 1px ${tokens.lineStrong}, 0 1px 2px #0000001a, 0 10px 28px -16px #00000066`,
    },
    transitionProperty: "box-shadow",
    transitionDuration: "160ms",
    transitionTimingFunction: tokens.easeOut,
  },
  // A quiet control in the bar: an icon, or a picker's name.
  tool: {
    minHeight: 30,
    height: 30,
    borderRadius: 999,
    fontSize: 12.5,
  },
  icon: { width: 30, minWidth: 30, paddingInline: 0 },
  send: {
    width: 30,
    minWidth: 30,
    minHeight: 30,
    height: 30,
    borderRadius: 999,
    color: { default: tokens.primaryText, ":hover:not(:disabled)": tokens.primaryText },
    backgroundColor: {
      default: tokens.primary,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.primary} 86%, ${tokens.canvas})`,
    },
  },
});
