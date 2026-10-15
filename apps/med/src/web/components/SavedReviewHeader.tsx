import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import type { ReviewController, ReviewControllerSnapshot } from "../data/controller";
import { tokens, ui } from "../theme.stylex";
import { checkoutNameFor } from "../data/checkout-names";
import { ActionMenu, type MenuEntry } from "./Controls";
import { paneHandle } from "./PaneTree";
import { Icon, type IconName } from "./Icon";
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
  pickVersion = false,
  onTarget,
  sendTo,
  notesPickIteration,
  compact = false,
  more = [],
  ref,
}: {
  /**
   * The thread beside it names the review, so the header leaves the name out,
   * and its actions go in one menu with `more`, as a title bar keeps few.
   */
  compact?: boolean;
  /** The review pane's own actions, in groups after the compact header's own. */
  more?: MenuEntry[][];
  ref?: Ref<SavedReviewActions>;
  controller: ReviewController;
  /** The agent session that comments can go to, and how to open its message. */
  sendTo?: { name: string; icon: IconName; drafts: number; open(): void };
  state: ReviewControllerSnapshot;
  /** GitHub comments, when the review has a pull request. */
  pullRequest?: PullRequestState;
  threadPlacement?: ThreadPlacement;
  /** Codex reviews of the review's checkouts. */
  codexReviews?: CodexReviewState;
  findingPlacement?: FindingPlacement;
  /** The Review shows without its diff, such as on the Guide's overview, so
   * the header chooses the version. With the diff, its toolbar does. */
  pickVersion?: boolean;
  onTarget(id: string): void;
  /** The Notes tab shows, and its iteration keys show each iteration's comparison. */
  notesPickIteration?: boolean;
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
  const iterations = saved.iterations ?? [];
  const iterationOf = (id: string) =>
    iterations.find((iteration) => iteration.targetIds.includes(id))?.number;
  // With one comparison in each iteration, the Notes' iteration keys choose it,
  // and the header has no second picker.
  const pickTarget =
    pickVersion &&
    saved.targets.length > 1 &&
    !(
      notesPickIteration &&
      iterations.length > 1 &&
      iterations.every((iteration) => iteration.targetIds.length === 1) &&
      saved.targets.every((entry) => iterationOf(entry.id))
    );
  const option = (entry: (typeof saved.targets)[number]) => (
    <option key={entry.id} value={entry.id}>
      {iterations.length > 1 && iterationOf(entry.id) ? `#${iterationOf(entry.id)} · ` : ""}
      {entry.repo.split(/[\\/]/).at(-1)} · {entry.branch ?? "detached"} · {entry.label}
    </option>
  );
  const saving = target
    ? iterationOf(target.id)
      ? `Version ${iterationOf(target.id)} · ${target.label}`
      : target.label
    : "No Review yet";
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
      {compact && !saved.pullRequestUrl ? null : saved.pullRequestUrl ? (
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
      {saved.pullRequestUrl && pullRequest && threadPlacement && (
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
      {pickTarget && (
        <select
          aria-label="Review version"
          {...stylex.props(styles.select)}
          value={state.savedTargetId ?? ""}
          onChange={(event) => {
            setNotice(null);
            onTarget(event.target.value);
          }}
        >
          {!state.savedTargetId && <option value="">Select target</option>}
          {iterations.length > 1 ? (
            <>
              {[...iterations].reverse().map((iteration) => (
                <optgroup
                  key={iteration.number}
                  label={`Version ${iteration.number}${iteration === iterations.at(-1) ? " · latest" : ""}`}
                >
                  {saved.targets
                    .filter((entry) => iteration.targetIds.includes(entry.id))
                    .map(option)}
                </optgroup>
              ))}
              {saved.targets.some((entry) => !iterationOf(entry.id)) && (
                <optgroup label="Commented commits">
                  {saved.targets.filter((entry) => !iterationOf(entry.id)).map(option)}
                </optgroup>
              )}
            </>
          ) : (
            saved.targets.map(option)
          )}
        </select>
      )}
      <span {...stylex.props(styles.grow)} />
      {/* Beside the thread, Send shows when there are comments to send. */}
      {sendTo && (!compact || sendTo.drafts > 0) && (
        <button
          {...stylex.props(ui.button, ui.pressable, styles.fixed)}
          aria-label={`Send comments to ${sendTo.name}`}
          title="Write to the agent with your comments"
          onClick={sendTo.open}
        >
          {!compact && <Icon name={sendTo.icon} size={14} />}
          <span {...stylex.props(!compact && styles.desktop)}>Send to {sendTo.name}</span>
          {sendTo.drafts > 0 && <span {...stylex.props(styles.count)}>{sendTo.drafts}</span>}
        </button>
      )}
      {compact && (
        <ActionMenu
          label="More actions"
          trigger={[ui.button, ui.iconButton, styles.fixed]}
          sections={[
            [
              {
                label:
                  saved.commentCount > 0
                    ? `Copy ${saved.commentCount} ${saved.commentCount === 1 ? "comment" : "comments"}`
                    : "Copy comments",
                disabled: busy || saved.commentCount === 0,
                onClick: () =>
                  void run("copy", async () => {
                    const comments = await controller.copyFeedback();
                    setCopied({ count: comments.count });
                    return `Copied ${comments.count} ${comments.count === 1 ? "comment" : "comments"}`;
                  }),
              },
              {
                label: "Clear all comments…",
                disabled: busy || saved.commentCount === 0,
                onClick: () => setClearRevision(saved.revision),
              },
            ],
            ...more,
          ]}
        >
          <Icon name="more" size={15} />
        </ActionMenu>
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
          <span>{saved.commentCount}</span>
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
            // From the menu, the question opens below the header's end.
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

/** Both shapes stay mounted so the SVG can transition in place without a layout change. */
function CopyCommentsIcon({ copied }: { copied: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(styles.copyIcon)}
    >
      <g {...stylex.props(styles.copyShape, copied && styles.copyHidden)}>
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </g>
      <path
        d="m4 12 5 5 11-11"
        pathLength="1"
        {...stylex.props(styles.checkShape, copied && styles.checkVisible)}
      />
    </svg>
  );
}

const styles = stylex.create({
  copyIcon: { flexShrink: 0 },
  copyShape: {
    opacity: 1,
    transform: "scale(1)",
    transformOrigin: "12px 12px",
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
    flexShrink: 1,
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
    minWidth: 0,
    maxWidth: "min(420px, calc(100vw - 24px))",
    paddingBlock: 8,
    paddingInline: 12,
    overflowWrap: "anywhere",
  },
});
