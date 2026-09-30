import { useEffect, useRef, useState } from "react";
import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import type { ReviewController, ReviewControllerSnapshot } from "../data/controller";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

export function SavedReviewHeader({
  controller,
  state,
  browsing,
  browsingSourceLabel,
  onReturn,
  onTarget,
}: {
  controller: ReviewController;
  state: ReviewControllerSnapshot;
  browsing?: boolean;
  browsingSourceLabel?: string;
  onReturn(): void;
  onTarget(id: string): void;
}) {
  const saved = state.savedReview!;
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [operation, setOperation] = useState<"copy" | "clear" | null>(null);
  const inFlight = useRef(false);
  const busy = operation !== null;
  const [copied, setCopied] = useState<{ count: number } | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clearRevision, setClearRevision] = useState<number | null>(null);
  const repositoryCount = new Set(saved.targets.map((entry) => entry.repositoryId)).size;
  const target = saved.targets.find((entry) => entry.id === state.savedTargetId);
  const outside = !state.savedView || browsing;
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
    <section aria-label="Saved review" {...stylex.props(styles.header)}>
      <Popover.Root
        open={detailsOpen}
        onOpenChange={(open) => {
          setDetailsOpen(open);
        }}
      >
        <Popover.Trigger
          {...stylex.props(ui.button, ui.pressable, styles.fixed)}
          aria-label="Review details"
        >
          <span {...stylex.props(styles.desktop)}>Review</span>
          <Icon name="note" size={14} />
          <Icon name="chevron" size={10} />
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
            align="start"
            sideOffset={5}
            {...stylex.props(styles.positioner, ui.instant)}
          >
            <Popover.Popup {...stylex.props(ui.popup, styles.details, ui.instant)}>
              <Popover.Title {...stylex.props(styles.title)}>{saved.title}</Popover.Title>
              {saved.pullRequestUrl && (
                <a
                  href={saved.pullRequestUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  {...stylex.props(styles.prLink)}
                >
                  Open pull request <Icon name="external" size={12} />
                </a>
              )}
              <p {...stylex.props(styles.detailText)}>
                {repositoryCount} {repositoryCount === 1 ? "repository" : "repositories"} ·{" "}
                {saved.commentCount} comments
              </p>
              {target && (
                <p {...stylex.props(styles.detailText)}>
                  {target.repo}
                  <br />
                  {target.branch ?? "Detached HEAD"} · {target.label}
                </p>
              )}
              <p {...stylex.props(styles.detailText)}>
                {target?.captured ? "Captured working changes" : "Saved commit comparison"}
                <br />
                {new Date(saved.createdAt).toLocaleString()}
              </p>
              {outside && (
                <p {...stylex.props(styles.detailText)}>
                  {browsing
                    ? `Browsing files · ${browsingSourceLabel ?? "Current files"}.`
                    : "Browsing outside the saved comparison."}{" "}
                  Comments across all tabs and comparisons in this review are copied.
                </p>
              )}
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {saved.pullRequestUrl ? (
        <a
          href={saved.pullRequestUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open pull request: ${saved.title}`}
          {...stylex.props(styles.reviewTitle, styles.prLink)}
        >
          {saved.title} <Icon name="external" size={12} />
        </a>
      ) : (
        <span title={saved.title} {...stylex.props(styles.reviewTitle)}>
          {saved.title}
        </span>
      )}
      {saved.targets.length > 1 && (
        <select
          aria-label="Review target"
          {...stylex.props(styles.select)}
          value={state.savedTargetId ?? ""}
          onChange={(event) => {
            setNotice(null);
            onTarget(event.target.value);
          }}
        >
          {!state.savedTargetId && <option value="">Select target</option>}
          {saved.targets.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.repo.split(/[\\/]/).at(-1)} · {entry.branch ?? "detached"} · {entry.label}
            </option>
          ))}
        </select>
      )}
      <span {...stylex.props(styles.grow)} />
      {outside && (
        <button
          {...stylex.props(ui.button, ui.active, styles.fixed)}
          aria-label="Return to review"
          title="Return to the original saved comparison."
          onClick={onReturn}
        >
          Return<span {...stylex.props(styles.desktop)}>to review</span>
        </button>
      )}
      {/* During copy, handlers block actions without native disabled dimming both buttons. */}
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
      <Popover.Root
        open={clearRevision !== null}
        onOpenChange={(open) => {
          if (!busy) setClearRevision(open ? saved.revision : null);
        }}
      >
        <Popover.Trigger
          {...stylex.props(ui.button, ui.pressable, styles.fixed)}
          aria-label="Clear all comments"
          disabled={operation === "clear" || saved.commentCount === 0}
          aria-disabled={busy || saved.commentCount === 0}
        >
          <Icon name="trash" size={14} />
          <span {...stylex.props(styles.desktop)}>Clear</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner
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
    transitionDuration: { default: "180ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
  },
  copyHidden: { opacity: 0, transform: "scale(0.85)" },
  checkShape: {
    opacity: 0,
    strokeDasharray: "1",
    strokeDashoffset: "1",
    transitionProperty: "opacity, stroke-dashoffset",
    transitionTimingFunction: "ease-in-out",
    transitionDuration: { default: "220ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
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
  header: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    flexShrink: 0,
    backgroundColor: tokens.panel,
    color: tokens.text,
    paddingBlock: 3,
    paddingInline: 8,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  fixed: { flexShrink: 0 },
  desktop: { display: { default: "inline", "@media (max-width: 600px)": "none" } },
  reviewTitle: {
    display: { default: "block", "@media (max-width: 900px)": "none" },
    minWidth: 0,
    maxWidth: 320,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.muted,
    fontSize: 12,
  },
  prLink: { color: tokens.accent, textDecoration: { default: "none", ":hover": "underline" } },
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
    borderRadius: 4,
    paddingInline: 4,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  positioner: { zIndex: 60 },
  details: { width: "min(360px, calc(100vw - 24px))", padding: 12 },
  title: { fontSize: 13, fontWeight: 600, marginBlock: 0, overflowWrap: "anywhere" },
  detailText: { marginBlock: 10, color: tokens.muted, lineHeight: 1.5, overflowWrap: "anywhere" },
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
