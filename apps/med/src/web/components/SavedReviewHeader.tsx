import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import type { PullRequestSummary } from "../../shared/protocol";
import type { ReviewController, ReviewControllerSnapshot } from "../data/controller";
import { tokens, ui } from "../theme.stylex";
import { checkoutNameFor } from "../data/checkout-names";
import { paneHandle } from "./PaneTree";
import { CommentsButton } from "./CommentsPanel";
import type { ListedComment } from "../data/listed-comments";
import { Icon, IconShapes } from "./Icon";
import {
  CodexReviewPanel,
  PullRequestPanel,
  type CodexReviewState,
  type FindingPlacement,
  type PullRequestState,
  type ThreadPlacement,
} from "./PullRequestComments";

/** The header's actions for ⌘K. */
export interface SavedReviewActions {
  /** Asks to clear every comment, under the header's end. */
  clearComments(): void;
}

export function SavedReviewHeader({
  controller,
  state,
  pullRequest,
  threadPlacement,
  codexReviews,
  findingPlacement,
  compact = false,
  comments,
  onOpenComment,
  ref,
}: {
  /** The thread's comments for All comments, and where one opens. */
  comments?: readonly ListedComment[];
  onOpenComment?(comment: ListedComment): void;
  /**
   * The thread beside it names the review, so the header leaves the name out
   * and keeps one action, All comments, which copies them too: comments go
   * to an agent from its session, and the rest is in ⌘K.
   */
  compact?: boolean;
  ref?: Ref<SavedReviewActions>;
  controller: ReviewController;
  state: ReviewControllerSnapshot;
  /** GitHub comments, when the review has a pull request. */
  pullRequest?: PullRequestState;
  threadPlacement?: ThreadPlacement;
  /** Codex reviews of the review's checkouts. */
  codexReviews?: CodexReviewState;
  findingPlacement?: FindingPlacement;
}) {
  const saved = state.savedReview!;
  const header = useRef<HTMLElement>(null);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [operation, setOperation] = useState<"copy" | "clear" | null>(null);
  const inFlight = useRef(false);
  const busy = operation !== null;
  const [copied, setCopied] = useState<{ count: number } | null>(null);
  const [clearRevision, setClearRevision] = useState<number | null>(null);
  useImperativeHandle(
    ref,
    () => ({
      clearComments: () => {
        if (!busy && saved.commentCount > 0) setClearRevision(saved.revision);
      },
    }),
    [busy, saved.commentCount, saved.revision],
  );
  const target = saved.targets.find((entry) => entry.id === state.savedTargetId);
  const saving = target ? target.label : "No Review yet";
  // The workspace list keeps the short title; a PR's own title names it here.
  const heading = (saved.pullRequestUrl && saved.pullRequestTitle) || saved.title;
  const details = [
    heading,
    ...(heading !== saved.title ? [`Workspace: ${saved.title}`] : []),
    `${saving} · ${new Date(saved.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}`,
    ...(target ? [checkoutNameFor(state.repositories, target.repo)] : []),
  ].join("\n");
  useEffect(() => {
    if (!notice || notice.error) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  const run = async (kind: "copy" | "clear", action: () => Promise<string | void>) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setOperation(kind);
    setNotice(null);
    try {
      const text = await action();
      if (text) setNotice({ text, error: false });
    } catch (error) {
      setCopied(null);
      setNotice({
        text: error instanceof Error ? error.message : "The request failed.",
        error: true,
      });
    } finally {
      inFlight.current = false;
      setOperation(null);
    }
  };
  return (
    <section
      ref={header}
      aria-label="Saved review"
      {...(compact ? {} : paneHandle)}
      {...stylex.props(styles.header, compact && styles.inline)}
    >
      {/* Beside a thread, the pull request is the window's title (PullRequestTitle). */}
      {compact ? null : saved.pullRequestUrl ? (
        <a
          href={saved.pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open pull request: ${heading}`}
          title={details}
          {...stylex.props(styles.reviewTitle, styles.prLink)}
        >
          <Icon name="github" size={14} />
          <span {...stylex.props(styles.ellipsis)}>{heading}</span>
          <Icon name="external" size={12} />
        </a>
      ) : (
        <span title={details} {...stylex.props(styles.reviewTitle)}>
          <span {...stylex.props(styles.ellipsis)}>{saved.title}</span>
        </span>
      )}
      {!compact && saved.pullRequestUrl && pullRequest && threadPlacement && (
        <PullRequestPanel state={pullRequest} placement={threadPlacement} />
      )}
      {codexReviews && findingPlacement && (codexReviews.runs?.length || codexReviews.error) && (
        <CodexReviewPanel state={codexReviews} placement={findingPlacement} />
      )}
      {target && saved.targets.length === 1 && !compact && (
        <span
          title={checkoutNameFor(state.repositories, target.repo)}
          {...stylex.props(styles.comparison)}
        >
          {target.branch ?? "Detached HEAD"} · {target.label}
        </span>
      )}
      {/* With one comparison, the toolbar below shows the same totals. */}
      {saved.totals && saved.totals.comparisons > 1 && (
        <span
          {...stylex.props(ui.row, styles.fixed)}
          role="group"
          aria-label={`Whole review: ${saved.totals.additions} lines added, ${saved.totals.deletions} lines deleted`}
          title={`All ${saved.totals.comparisons} saved comparisons · ${saved.totals.files} files. Totals use the captured comparison endpoints, including the resolved merge base.`}
        >
          <span {...stylex.props(styles.totalLabel)}>Total</span>
          <span {...stylex.props(ui.added)}>+{saved.totals.additions.toLocaleString()}</span>
          <span {...stylex.props(ui.removed)}>−{saved.totals.deletions.toLocaleString()}</span>
        </span>
      )}
      <span {...stylex.props(styles.grow)} />
      {comments && onOpenComment && (
        <CommentsButton
          comments={comments}
          onOpen={onOpenComment}
          onCopy={
            busy || saved.commentCount === 0
              ? undefined
              : () =>
                  void run("copy", async () => {
                    const comments = await controller.copyFeedback();
                    setCopied({ count: comments.count });
                  })
          }
        />
      )}
      {/* During copy, handlers block actions without native disabled dimming both buttons. */}
      {!compact && (
        <button
          {...stylex.props(ui.button, ui.pressable, styles.fixed)}
          aria-label="Copy comments"
          data-copied={copied !== null}
          disabled={operation === "clear" || saved.commentCount === 0}
          aria-disabled={busy || saved.commentCount === 0}
          aria-busy={operation === "copy"}
          onClick={() =>
            void run("copy", async () => {
              const comments = await controller.copyFeedback();
              setCopied({ count: comments.count });
            })
          }
        >
          <CopyCommentsIcon copied={copied !== null} />
          <span {...stylex.props(styles.desktop)}>Copy comments</span>
          <span {...stylex.props(styles.count)}>{saved.commentCount}</span>
        </button>
      )}
      <Popover.Root
        open={clearRevision !== null}
        onOpenChange={(open) => {
          if (!busy) setClearRevision(open ? saved.revision : null);
        }}
      >
        {!compact && (
          <Popover.Trigger
            {...stylex.props(ui.button, ui.pressable, styles.fixed)}
            aria-label="Clear all comments"
            disabled={operation === "clear" || saved.commentCount === 0}
            aria-disabled={busy || saved.commentCount === 0}
          >
            <Icon name="trash" size={14} />
            <span {...stylex.props(styles.desktop)}>Clear</span>
          </Popover.Trigger>
        )}
        <Popover.Portal>
          <Popover.Positioner
            // From ⌘K, the question opens below the header's end.
            anchor={compact ? header : undefined}
            align="end"
            sideOffset={5}
            {...stylex.props(styles.positioner, ui.instant)}
          >
            <Popover.Popup {...stylex.props(ui.popup, styles.details, ui.instant)}>
              <Popover.Title {...stylex.props(styles.title)}>Clear all comments?</Popover.Title>
              <div role="alert">
                <p {...stylex.props(styles.detailText)}>
                  Clear all comments across every target in this review?
                </p>
                <div {...stylex.props(ui.row)}>
                  <button
                    {...stylex.props(ui.button)}
                    disabled={busy}
                    onClick={() =>
                      void run("clear", async () => {
                        await controller.clearSavedComments(clearRevision!);
                        setClearRevision(null);
                        setCopied(null);
                        return "Comments cleared";
                      })
                    }
                  >
                    Confirm clear
                  </button>
                  <button
                    {...stylex.props(ui.button)}
                    disabled={busy}
                    onClick={() => setClearRevision(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      <span aria-live="polite" {...stylex.props(styles.srOnly)}>
        {copied ? `Copied ${copied.count} ${copied.count === 1 ? "comment" : "comments"}` : ""}
      </span>
      {notice && (
        <div role={notice.error ? "alert" : "status"} {...stylex.props(ui.popup, styles.notice)}>
          <span>{notice.text}</span>
          {notice.error && (
            <button
              {...stylex.props(ui.button, ui.iconButton)}
              aria-label="Dismiss message"
              onClick={() => setNotice(null)}
            >
              <Icon name="close" size={12} />
            </button>
          )}
        </div>
      )}
    </section>
  );
}

/** Both shapes stay mounted so the SVG can transition in place without a
 * layout change. Copy is the app's copy icon; the check draws over it. */
function CopyCommentsIcon({ copied }: { copied: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      aria-hidden="true"
      {...stylex.props(styles.copyIcon)}
    >
      <g fill="currentColor" {...stylex.props(styles.copyShape, copied && styles.copyHidden)}>
        <IconShapes name="copy" />
      </g>
      <path
        d="M2.5 8.5l3.5 3.5L13.5 4.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        pathLength="1"
        {...stylex.props(styles.checkShape, copied && styles.checkVisible)}
      />
    </svg>
  );
}

const PULL_STATES: Record<PullRequestSummary["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

/**
 * A pull request as its thread's title, in the window's title band
 * (InTitleBand): its number and title, which open it on GitHub, its state,
 * and its author. The title gives way first, cut at its end; the author goes
 * in a narrow band.
 */
export function PullRequestTitle({
  url,
  title,
  pull,
}: {
  url: string;
  /** The title that Med saved, until GitHub's arrives. */
  title: string;
  pull?: PullRequestSummary;
}) {
  const number = pull?.number ?? /\/pull\/(\d+)/.exec(url)?.[1];
  const heading = pull?.title ?? title;
  return (
    <>
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Open pull request #${number}: ${heading}`}
        title={`#${number} ${heading}`}
        {...stylex.props(styles.pullLink)}
      >
        <Icon name="github" size={14} />
        <span {...stylex.props(styles.pullNumber)}>#{number}</span>
        <span {...stylex.props(styles.ellipsis, styles.pullTitle)}>{heading}</span>
        <Icon name="external" size={12} />
      </a>
      {pull && (
        <span {...stylex.props(styles.pullState, styles[pull.state])}>
          {PULL_STATES[pull.state]}
        </span>
      )}
      {pull && (
        <span title={`Opened by ${pull.author}`} {...stylex.props(styles.pullAuthor)}>
          {pull.author}
        </span>
      )}
    </>
  );
}

const styles = stylex.create({
  pullLink: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 1,
    color: tokens.text,
    fontSize: 13,
    fontWeight: 500,
    whiteSpace: "nowrap",
    textDecoration: { default: "none", ":hover": "underline" },
  },
  pullNumber: { flexShrink: 0, color: tokens.muted, fontVariantNumeric: "tabular-nums" },
  /** A long title stops at about 48 characters of text; the link's tooltip has all of it. */
  pullTitle: { maxWidth: "36ch" },
  pullAuthor: {
    display: { default: "block", "@container (max-width: 520px)": "none" },
    flexShrink: 0,
    minWidth: 0,
    maxWidth: 160,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  pullState: {
    flexShrink: 0,
    paddingInline: 6,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    fontSize: 11,
    lineHeight: "18px",
    fontWeight: 500,
  },
  open: { color: tokens.green },
  draft: { color: tokens.muted },
  merged: { color: tokens.accent },
  closed: { color: tokens.red },
  copyIcon: { flexShrink: 0 },
  copyShape: {
    opacity: 1,
    transform: "scale(1)",
    transformOrigin: "8px 8px",
    transitionProperty: "opacity, transform",
    transitionTimingFunction: "ease-in-out",
    transitionDuration: {
      default: "180ms",
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
  },
  copyHidden: { opacity: 0, transform: "scale(0.85)" },
  checkShape: {
    opacity: 0,
    strokeDasharray: "1",
    strokeDashoffset: "1",
    transitionProperty: "opacity, stroke-dashoffset",
    transitionTimingFunction: "ease-in-out",
    transitionDuration: {
      default: "220ms",
      "@media (prefers-reduced-motion: reduce)": "0ms",
    },
  },
  checkVisible: { opacity: 1, strokeDashoffset: "0" },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    padding: 0,
    margin: -1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  // The first row of the review card: the height of the sidebar's identity
  // row beside it, and the tab row's rule below.
  // In the tab row beside a thread: no row of its own.
  inline: {
    containerType: "normal",
    height: "auto",
    minHeight: 0,
    paddingInline: 0,
    borderBottomWidth: 0,
    // Its buttons keep their room; the review's title shortens instead.
    flexShrink: 0,
  },
  header: {
    position: "relative",
    containerType: "inline-size",
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 0,
    height: 38,
    minHeight: 38,
    boxSizing: "border-box",
    color: tokens.text,
    paddingInline: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  totalLabel: { color: tokens.muted, fontSize: 12, whiteSpace: "nowrap" },
  fixed: { flexShrink: 0 },
  // Labels give way to the title when the review pane is narrow.
  desktop: {
    display: { default: "inline", "@container (max-width: 640px)": "none" },
  },
  count: { color: tokens.muted, fontVariantNumeric: "tabular-nums" },
  reviewTitle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    maxWidth: 360,
    paddingInlineStart: 6,
    color: tokens.text,
    fontSize: 13,
    fontWeight: 500,
  },
  ellipsis: {
    minWidth: 0,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  comparison: {
    display: { default: "block", "@media (max-width: 900px)": "none" },
    minWidth: 0,
    flexShrink: 1000,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.faint,
    fontSize: 12,
  },
  prLink: {
    color: tokens.accent,
    textDecoration: { default: "none", ":hover": "underline" },
  },
  grow: { flexGrow: 1 },
  select: {
    minWidth: 0,
    maxWidth: "min(280px, 30vw)",
    height: 26,
    color: tokens.text,
    backgroundColor: tokens.canvas,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: `calc(4px * ${tokens.round})`,
    paddingInline: 4,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  positioner: { zIndex: 60 },
  details: { width: "min(360px, calc(100vw - 24px))", padding: 12 },
  title: {
    fontSize: 13,
    fontWeight: 600,
    marginBlock: 0,
    overflowWrap: "anywhere",
  },
  detailText: {
    marginBlock: 10,
    color: tokens.muted,
    lineHeight: 1.5,
    overflowWrap: "anywhere",
  },
  notice: {
    position: "absolute",
    top: "calc(100% + 6px)",
    right: 8,
    display: "flex",
    alignItems: "center",
    gap: 8,
    // Its own width: beside a thread, this header is only as wide as its menu button.
    width: "max-content",
    maxWidth: "min(420px, calc(100vw - 24px))",
    paddingBlock: 8,
    paddingInline: 12,
    overflowWrap: "anywhere",
  },
});
