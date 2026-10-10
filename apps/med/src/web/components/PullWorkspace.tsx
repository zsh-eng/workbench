import * as stylex from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { parsePullUrl, type PullJob, type PullStep } from "../../shared/pull-workspace";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import { formatSeconds } from "./session/ToolCall";
import { motion } from "./session/session-styles";

/** What a pull request's workspace knows about its job. */
export interface PullState {
  job?: PullJob;
  /** The host refused the link, or lost the job when it restarted. */
  error?: string;
}

const MARKS: Record<PullStep["state"], string> = {
  pending: "○",
  running: "◐",
  done: "●",
  skipped: "●",
  failed: "✕",
};

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Text that settles into place when it changes, as a placeholder title
 * becomes the pull request's title. */
export function SettlingText({ text, shimmer }: { text: string; shimmer?: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(text);
  useLayoutEffect(() => {
    if (shown.current === text) return;
    shown.current = text;
    if (!reducedMotion())
      ref.current?.animate(
        [
          { opacity: 0, transform: "translateY(4px)", filter: "blur(3px)" },
          { opacity: 1, transform: "none", filter: "none" },
        ],
        { duration: 320, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
      );
  }, [text]);
  return (
    <span ref={ref} {...stylex.props(styles.settling, shimmer && motion.shimmer)}>
      {text}
    </span>
  );
}

/** The workspace's title: the pull request's own once the host reads it. */
export function pullTitle(url: string, job?: PullJob) {
  const address = parsePullUrl(url);
  if (job?.title) return `#${job.number} ${job.title}`;
  return address ? `${address.owner}/${address.name} #${address.number}` : url;
}

function useNow(running: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return now;
}

/** Each step of opening the pull request, as the session's task list shows
 * an agent's steps, with what went wrong and a retry. */
export function PullProgress({
  url,
  state,
  now: fixedNow,
  onRetry,
}: {
  url: string;
  state: PullState;
  /** A fixed clock, for the Elements page. */
  now?: number;
  onRetry?(): void;
}) {
  const { job, error } = state;
  const failed = !!error || job?.status === "failed";
  const running = !failed && job?.status !== "done";
  const clock = useNow(running && fixedNow === undefined);
  const now = fixedNow ?? clock;
  const address = parsePullUrl(url);
  const steps: PullStep[] = job?.steps ?? [
    { id: "repository", label: "Send the link to Med", state: error ? "failed" : "running" },
  ];
  const finished = steps.filter((step) => step.state === "done" || step.state === "skipped");
  return (
    <section aria-label="Opening the pull request" {...stylex.props(styles.card)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.badge)}>
          <Icon name="pullRequest" size={16} />
        </span>
        <div {...stylex.props(styles.heading)}>
          <h1 {...stylex.props(styles.title)}>
            <SettlingText
              text={
                job?.title || !address ? pullTitle(url, job) : `Pull request #${address.number}`
              }
              shimmer={running && !job?.title}
            />
          </h1>
          <a href={url} target="_blank" rel="noreferrer" {...stylex.props(styles.link)}>
            {address ? `${address.owner}/${address.name} #${address.number}` : url}
            <Icon name="external" size={11} />
          </a>
        </div>
      </header>
      <div {...stylex.props(styles.steps)}>
        <div {...stylex.props(styles.stepsHead)}>
          <span {...stylex.props(styles.stepsTitle)}>
            {failed ? "Could not open it" : running ? "Opening" : "Opening the review"}
          </span>
          <span {...stylex.props(styles.count)}>
            {finished.length} of {steps.length}
          </span>
        </div>
        <ol {...stylex.props(styles.list)}>
          {steps.map((step) => {
            const elapsed = (step.endedAt ?? now) - (step.startedAt ?? now);
            return (
              <li
                key={step.id}
                data-state={step.state}
                {...stylex.props(
                  styles.step,
                  (step.state === "done" || step.state === "skipped") && styles.stepDone,
                  step.state === "running" && styles.stepRunning,
                )}
              >
                <span
                  aria-hidden="true"
                  {...stylex.props(styles.mark, step.state === "failed" && styles.failedText)}
                >
                  {MARKS[step.state]}
                </span>
                <span
                  {...stylex.props(
                    styles.label,
                    step.state === "running" && motion.shimmer,
                    (step.state === "done" || step.state === "skipped") && styles.struck,
                  )}
                >
                  {step.label}
                </span>
                {step.detail && (
                  <span title={step.detail} {...stylex.props(styles.detail)}>
                    {step.detail}
                  </span>
                )}
                <span {...stylex.props(styles.state, step.state === "failed" && styles.failedText)}>
                  {step.state === "running"
                    ? elapsed >= 1000
                      ? formatSeconds(elapsed)
                      : "Running"
                    : step.state === "failed"
                      ? "Failed"
                      : step.state === "skipped"
                        ? "Skipped"
                        : step.state === "done" && step.startedAt
                          ? formatSeconds(Math.max(elapsed, 100))
                          : ""}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      {failed && (
        <div role="alert" {...stylex.props(styles.problem)}>
          <p {...stylex.props(styles.problemText)}>
            {error ?? job?.error ?? "Med could not open this pull request."}
          </p>
          <div {...stylex.props(styles.actions)}>
            {onRetry && (
              <button type="button" onClick={onRetry} {...stylex.props(ui.button, ui.primary)}>
                <Icon name="refresh" size={13} />
                Retry
              </button>
            )}
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              {...stylex.props(ui.button, ui.outlined, styles.anchor)}
            >
              Open on GitHub
            </a>
          </div>
        </div>
      )}
      {job?.worktree && (
        <p {...stylex.props(styles.footnote)}>
          Worktree <code {...stylex.props(styles.code)}>{job.worktree}</code>
        </p>
      )}
    </section>
  );
}

/** A pull request's workspace while the host opens it: the window's
 * workspace list, and the progress in place of the review. */
export function PullWorkspaceView({
  url,
  state,
  list,
  onRetry,
}: {
  url: string;
  state: PullState;
  /** The window's workspace list. */
  list: ReactNode;
  onRetry(): void;
}) {
  return (
    <div {...stylex.props(styles.frame)}>
      <div {...stylex.props(styles.workspace)}>
        <aside {...stylex.props(styles.sidebar)}>
          <div {...stylex.props(styles.sidebarHeader)} />
          {list}
        </aside>
        <main aria-label="Pull request" {...stylex.props(styles.main)}>
          <PullProgress url={url} state={state} onRetry={onRetry} />
        </main>
      </div>
    </div>
  );
}

const styles = stylex.create({
  frame: {
    position: "fixed",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    color: tokens.text,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 12,
    WebkitFontSmoothing: "antialiased",
  },
  workspace: { display: "flex", flex: "1", minHeight: 0, gap: 6, padding: 6 },
  // As the review's sidebar: 300 pixels, and narrower in a narrow window.
  sidebar: { display: "flex", flexDirection: "column", flexShrink: 1, width: 300, minWidth: 180 },
  sidebarHeader: { height: 38, flexShrink: 0 },
  main: {
    minWidth: 0,
    flex: "1",
    display: "flex",
    justifyContent: "center",
    alignItems: "flex-start",
    overflow: "auto",
    paddingBlock: { default: 56, "@media (max-width: 640px)": 24 },
    paddingInline: { default: 24, "@media (max-width: 640px)": 14 },
    backgroundColor: tokens.canvas,
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  card: {
    width: "100%",
    maxWidth: 560,
    display: "flex",
    flexDirection: "column",
    gap: 16,
  },
  header: { display: "flex", alignItems: "flex-start", gap: 12 },
  badge: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    flexShrink: 0,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
  },
  heading: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
  title: {
    margin: 0,
    fontSize: 17,
    fontWeight: 560,
    lineHeight: 1.3,
    letterSpacing: "-0.01em",
    overflowWrap: "anywhere",
  },
  settling: { display: "inline-block" },
  link: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    color: { default: tokens.faint, ":hover": tokens.accent },
    fontFamily: tokens.code,
    fontSize: 11.5,
    textDecoration: "none",
  },
  steps: {
    paddingInline: 12,
    paddingBlock: 4,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  stepsHead: { display: "flex", alignItems: "center", gap: 8, minHeight: 32 },
  stepsTitle: { fontWeight: 500 },
  count: { color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  list: {
    listStyle: "none",
    margin: 0,
    paddingTop: 0,
    paddingBottom: 8,
    paddingInline: 0,
    display: "flex",
    flexDirection: "column",
    gap: 3,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  step: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, color: tokens.muted },
  stepDone: { color: tokens.faint },
  stepRunning: { color: tokens.text },
  mark: { width: 16, flexShrink: 0, textAlign: "center", color: tokens.accent, fontSize: 11 },
  label: { flexShrink: 0 },
  struck: { textDecoration: "line-through", textDecorationColor: tokens.lineStrong },
  detail: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 11.5,
  },
  state: {
    marginInlineStart: "auto",
    flexShrink: 0,
    paddingInlineStart: 8,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  failedText: { color: tokens.red },
  problem: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 12,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: `color-mix(in srgb, ${tokens.red} 9%, transparent)`,
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.red} 28%, transparent)`,
  },
  problemText: {
    margin: 0,
    whiteSpace: "pre-wrap",
    fontSize: 12.5,
    lineHeight: 1.5,
    color: tokens.text,
  },
  actions: { display: "flex", gap: 8 },
  anchor: { textDecoration: "none" },
  footnote: { margin: 0, color: tokens.faint, fontSize: 11.5 },
  code: { fontFamily: tokens.code, fontSize: 11 },
});
