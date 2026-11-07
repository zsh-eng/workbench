import * as stylex from "@stylexjs/stylex";
import { createContext, useContext } from "react";
import { tokens, ui } from "../../theme.stylex";
import { MedMark } from "../ReviewHeader";
import type { ToolItem } from "./thread-model";

/** The review that the session hands off, and how to open it. */
export const HandoffContext = createContext<{ title: string; open(): void } | null>(null);

/**
 * A hand-off in the conversation: the agent's `med review create` as one card
 * with the review's mark, which opens the review. One still being written is
 * a dashed card that shimmers.
 */
export function HandoffCard({ item }: { item: ToolItem }) {
  const review = useContext(HandoffContext);
  const writing = item.call.status === "pending" || item.call.status === "in_progress";
  const title = review?.title ?? "Review";
  return (
    <button
      type="button"
      data-handoff=""
      disabled={writing || !review}
      onClick={() => review?.open()}
      aria-label={writing ? `Handing off ${title}` : `Open the review: ${title}`}
      {...stylex.props(ui.pressable, styles.card, writing && styles.writing)}
    >
      <MedMark size={16} />
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.title)}>{title}</span>
        <span {...stylex.props(styles.meta)}>
          {writing ? "Handing off a review…" : "Review handed off"}
        </span>
      </span>
      {!writing && review && <span {...stylex.props(styles.open)}>Open</span>}
    </button>
  );
}

const shimmer = stylex.keyframes({
  "0%": { backgroundPosition: "100% 0" },
  "100%": { backgroundPosition: "-100% 0" },
});

const styles = stylex.create({
  card: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    width: "100%",
    maxWidth: 420,
    boxSizing: "border-box",
    marginBlock: 6,
    paddingBlock: 10,
    paddingInline: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: { default: tokens.raised, ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "start",
    cursor: { default: "pointer", ":disabled": "default" },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  writing: {
    borderStyle: "dashed",
    backgroundColor: tokens.canvas,
    backgroundImage: `linear-gradient(90deg, transparent, ${tokens.fill}, transparent)`,
    backgroundSize: "200% 100%",
    animationName: shimmer,
    animationDuration: "1.6s",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  text: { display: "flex", flexDirection: "column", gap: 2, flex: "1", minWidth: 0 },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13.5,
    fontWeight: 500,
  },
  meta: { color: tokens.muted, fontSize: 12 },
  open: { flexShrink: 0, color: tokens.accent, fontSize: 12.5, fontWeight: 500 },
});
