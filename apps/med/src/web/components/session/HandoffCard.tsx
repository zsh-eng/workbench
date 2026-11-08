import * as stylex from "@stylexjs/stylex";
import { createContext, useContext } from "react";
import { tokens, ui } from "../../theme.stylex";
import { MedMark } from "../ReviewHeader";
import type { ToolItem } from "./thread-model";

/** The review that the session hands off, and how to open it and the
 * session's other reviews, by id. */
export const HandoffContext = createContext<{
  title: string;
  open(): void;
  id?: string;
  /** The session's other reviews' titles, by id. */
  titles?: ReadonlyMap<string, string>;
  openReview?(id: string): void;
} | null>(null);

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
    <ReviewCard
      title={title}
      meta={writing ? "Handing off a review…" : "Review handed off"}
      writing={writing}
      onOpen={review?.open}
      label={writing ? `Handing off ${title}` : `Open the review: ${title}`}
    />
  );
}

/**
 * A link to a review of Med's in a reply, such as the agent's "Review changes
 * here" after a hand-off: the review's card, which opens it in Med.
 */
export function ReviewLinkCard({ id, href, text }: { id: string; href: string; text: string }) {
  const review = useContext(HandoffContext);
  const own = review?.id === id;
  const title = own ? review.title : (review?.titles?.get(id) ?? text);
  const open = own
    ? review.open
    : review?.openReview && review.titles?.has(id)
      ? () => review.openReview!(id)
      : () => window.open(href, "_blank", "noopener,noreferrer");
  return (
    <ReviewCard
      title={title}
      meta={own || review?.titles?.has(id) ? "Review in Med" : "Review in Med · new tab"}
      onOpen={open}
      label={`Open the review: ${title}`}
    />
  );
}

function ReviewCard({
  title,
  meta,
  writing = false,
  onOpen,
  label,
}: {
  title: string;
  meta: string;
  writing?: boolean;
  onOpen?(): void;
  label: string;
}) {
  return (
    <button
      type="button"
      data-handoff=""
      disabled={writing || !onOpen}
      onClick={() => onOpen?.()}
      aria-label={label}
      {...stylex.props(ui.pressable, styles.card, writing && styles.writing)}
    >
      <MedMark size={16} />
      <span {...stylex.props(styles.text)}>
        <span {...stylex.props(styles.title)}>{title}</span>
        <span {...stylex.props(styles.meta)}>{meta}</span>
      </span>
      {!writing && onOpen && <span {...stylex.props(styles.open)}>Open</span>}
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
    // Its icon keeps to the thread's edge; the card reaches 10 pixels past.
    width: "calc(100% + 20px)",
    maxWidth: 440,
    boxSizing: "border-box",
    marginBlock: 6,
    marginInline: -10,
    paddingBlock: 10,
    paddingInline: 10,
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
