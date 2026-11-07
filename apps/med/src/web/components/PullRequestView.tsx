import * as stylex from "@stylexjs/stylex";
import { memo, useContext, useEffect, useMemo, useRef, useState } from "react";
import type {
  LivePullRequest,
  PullRequestCheck,
  PullRequestCheckLog,
  PullRequestThread,
} from "../../shared/protocol";
import {
  checkCounts,
  checkTime,
  checkWord,
  descriptionImageUrl,
  lowBudget,
  mergeLines,
  useLivePullRequest,
} from "../data/live-pull-request";
import { fileRefOf } from "../data/file-refs";
import type { ThreadPlacement } from "../data/pull-request";
import { useMinuteClock } from "../data/relative-time";
import { renderBrief, renderedBrief } from "../markdown/brief-render";
import { loadMarkdownImages, markdownImageUrl } from "../markdown/images";
import type { MarkdownResult } from "../markdown/model";
import { scrollPaneTo } from "../markdown/scroll";
import { tokens, ui } from "../theme.stylex";
import { useTheme } from "../themes";
import { DiagramBlock } from "./DiagramBlock";
import { Icon, type IconName } from "./Icon";
import { CommentRefsContext, FileRefsContext, useFileRefBlocks, useFileRefs } from "./FileRefs";
import {
  AddToReplyButton,
  CopyButton,
  Discussion,
  reviewTag,
  StateTag,
  type PullRequestState,
} from "./PullRequestComments";
import { useWorkspaceShown } from "./Workspaces";
import "./MarkdownPreview.css";
import "./PullRequestView.css";

/** Passed and skipped checks fold behind one line beyond this many. */

/** "lee wants to merge feature into main". */
const MERGE_VERBS: Record<LivePullRequest["state"], string> = {
  open: "wants to merge",
  draft: "wants to merge",
  merged: "merged",
  closed: "wanted to merge",
};
const STATE_WORDS: Record<LivePullRequest["state"], string> = {
  open: "Open",
  draft: "Draft",
  merged: "Merged",
  closed: "Closed",
};

const OUTCOMES: Record<
  PullRequestCheck["outcome"],
  { icon: IconName; tone: "good" | "bad" | "warn" | "quiet" }
> = {
  failed: { icon: "close", tone: "bad" },
  pending: { icon: "clock", tone: "warn" },
  cancelled: { icon: "stop", tone: "quiet" },
  passed: { icon: "check", tone: "good" },
  skipped: { icon: "arrowDown", tone: "quiet" },
};

/** The description in Med's Markdown. Each block is the renderer's HTML, which
 * never holds raw HTML from the description; it links to files as a comment
 * does. */
const Description = memo(function Description(props: {
  body: string;
  reviewId: string;
  root?: string;
}) {
  const refs = useContext(CommentRefsContext);
  return (
    <FileRefsContext.Provider value={refs}>
      <DescriptionText {...props} />
    </FileRefsContext.Provider>
  );
});

function DescriptionText({
  body,
  reviewId,
  root,
}: {
  body: string;
  reviewId: string;
  root?: string;
}) {
  const { active: theme } = useTheme();
  const [result, setResult] = useState<MarkdownResult | undefined>(() =>
    renderedBrief(theme.pierreTheme, body, "description"),
  );
  const [failed, setFailed] = useState(false);
  const host = useRef<HTMLDivElement>(null);
  const refs = useFileRefs();
  const blocks = useFileRefBlocks(result?.blocks);
  useEffect(() => {
    let current = true;
    renderBrief(theme.pierreTheme, body, true, { cache: "description" }).then(
      (rendered) => {
        if (!current) return;
        setResult(rendered);
        setFailed(false);
      },
      () => {
        if (current) setFailed(true);
      },
    );
    return () => {
      current = false;
    };
  }, [theme.pierreTheme, body]);
  // A web image comes through the host, as this page loads none from other
  // sites; a relative path starts at the repository root, as in a draft.
  useEffect(() => {
    const source = root
      ? { kind: "worktree" as const, repo: root }
      : { kind: "drop" as const, id: "brief" };
    if (!host.current) return;
    loadMarkdownImages(host.current, (raw) =>
      /^https?:\/\//i.test(raw)
        ? descriptionImageUrl(reviewId, raw)
        : markdownImageUrl(raw, source, "BRIEF.md"),
    );
  }, [blocks, reviewId, root]);
  // A web link opens by itself, from the worker's HTML. A heading's link stays
  // in this tab: the address is the app's.
  useEffect(() => {
    const prose = host.current;
    if (!prose) return;
    const follow = (event: MouseEvent) => {
      const file = fileRefOf(event.target as Element);
      if (file) {
        event.preventDefault();
        refs?.open(file, event.metaKey || event.ctrlKey);
        return;
      }
      const href = (event.target as Element).closest("a")?.getAttribute("href");
      if (!href?.startsWith("#")) return;
      event.preventDefault();
      let id: string;
      try {
        id = decodeURIComponent(href.slice(1));
      } catch {
        return;
      }
      const heading = id && prose.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
      const pane = prose.closest<HTMLElement>(".med-md-scroll");
      if (heading && pane) scrollPaneTo(pane, heading);
    };
    prose.addEventListener("click", follow);
    return () => prose.removeEventListener("click", follow);
  }, [refs, result]);
  if (failed && !result)
    return <p {...stylex.props(styles.note)}>Med could not render this description.</p>;
  return (
    <div ref={host} className="med-md-prose med-pull-prose">
      {blocks?.map((block) =>
        block.diagram !== undefined ? (
          <DiagramBlock key={block.start} block={block} />
        ) : (
          <div
            key={block.start}
            className="med-md-block"
            data-block-line={block.start}
            data-block-end={block.end}
            dangerouslySetInnerHTML={{ __html: block.html }}
          />
        ),
      )}
    </div>
  );
}

/** A failed job's log, as gh gives it: GitHub's ##[…] marks become colour,
 * and the log opens at the last error, not at the clean-up after it. */
function CheckLog({ name, log }: { name: string; log: PullRequestCheckLog }) {
  const lines = useMemo(
    () =>
      log.text.split("\n").flatMap((line) => {
        const mark = /^##\[(\w+)\]/.exec(line);
        if (mark?.[1] === "endgroup") return [];
        return [{ kind: mark?.[1], text: mark ? line.slice(mark[0].length) : line }];
      }),
    [log.text],
  );
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const element = box.current;
    const errors = element?.querySelectorAll<HTMLElement>("[data-log-error]");
    const last = errors?.[errors.length - 1];
    if (element) element.scrollTop = last ? last.offsetTop - 48 : element.scrollHeight;
  }, [lines]);
  const plain = () => `The failed log of ${name}:\n\n${log.text}`;
  if (!log.text.trim())
    return <p {...stylex.props(styles.note)}>GitHub gave no failed steps for this job.</p>;
  return (
    <div {...stylex.props(styles.log)}>
      <div {...stylex.props(styles.logBar)}>
        <span>
          {log.skipped
            ? `The last ${lines.length} lines of ${log.skipped + lines.length}`
            : `${lines.length} lines`}
        </span>
        <span {...stylex.props(ui.grow)} />
        <AddToReplyButton label={`${name} log`} text={plain} />
        <CopyButton label="Copy log" text={plain} />
      </div>
      <pre ref={box} aria-label={`Failed log of ${name}`} {...stylex.props(styles.logText)}>
        {lines.map((line, index) => (
          <span
            key={index}
            data-log-error={line.kind === "error" ? "" : undefined}
            {...stylex.props(
              styles.logLine,
              line.kind === "error" && styles.logError,
              line.kind === "warning" && styles.logWarning,
              line.kind === "group" && styles.logGroup,
            )}
          >
            {line.text || " "}
          </span>
        ))}
      </pre>
    </div>
  );
}

type LogState =
  | { step: "closed" }
  | { step: "reading" }
  | { step: "shown"; log: PullRequestCheckLog }
  | { step: "failed"; message: string };

/** One check. Med asks GitHub for a failed job's log only on the reader's click. */
function CheckRow({
  check,
  now,
  loadLog,
}: {
  check: PullRequestCheck;
  now: number;
  loadLog(job: number): Promise<PullRequestCheckLog>;
}) {
  const [log, setLog] = useState<LogState>({ step: "closed" });
  // One read for the row: opening the log again never asks GitHub again,
  // also while gh still reads. Only a failed read goes again.
  const read = useRef<Promise<PullRequestCheckLog> | null>(null);
  const { icon, tone } = OUTCOMES[check.outcome];
  const word = checkWord(check);
  const time = checkTime(check, now);
  const open = log.step !== "closed";
  const label = check.event ? `${check.name} (${check.event})` : check.name;
  const source = [check.workflow, check.event].filter(Boolean).join(" · ");
  const show = (next: LogState) =>
    setLog((current) => (current.step === "closed" ? current : next));
  const toggle = () => {
    if (open) {
      setLog({ step: "closed" });
      return;
    }
    setLog({ step: "reading" });
    read.current ??= loadLog(check.job!);
    read.current.then(
      (result) => show({ step: "shown", log: result }),
      (error: unknown) => {
        read.current = null;
        show({
          step: "failed",
          message: error instanceof Error ? error.message : "Could not read the log.",
        });
      },
    );
  };
  return (
    <li {...stylex.props(styles.check)}>
      <div {...stylex.props(styles.checkRow)}>
        <span
          role="img"
          aria-label={word}
          title={word}
          {...stylex.props(styles.checkIcon, tones[tone])}
        >
          <Icon name={icon} size={12} />
        </span>
        <span {...stylex.props(ui.truncate, styles.checkName)} title={check.name}>
          {check.name}
        </span>
        {source && (
          <span {...stylex.props(ui.truncate, styles.checkWorkflow)} title={source}>
            {source}
          </span>
        )}
        <span {...stylex.props(ui.grow)} />
        {check.outcome !== "passed" && (
          <span {...stylex.props(styles.checkWord, tones[tone])}>{word}</span>
        )}
        {time && <span {...stylex.props(styles.checkTime)}>{time}</span>}
        {check.url && (
          <a
            href={check.url}
            target="_blank"
            rel="noopener noreferrer"
            title={`Open ${label}`}
            aria-label={`Open ${label}`}
            {...stylex.props(ui.button, ui.iconButton, styles.tool)}
          >
            <Icon name="external" size={12} />
          </a>
        )}
      </div>
      {check.job !== undefined && (
        <button
          type="button"
          aria-expanded={open}
          aria-label={`${open ? "Hide" : "Show"} the failed log of ${label}`}
          {...stylex.props(styles.logToggle)}
          onClick={toggle}
        >
          {open ? "Hide failed log" : "Show failed log"}
        </button>
      )}
      {log.step === "reading" && <p {...stylex.props(styles.note)}>Reading the log…</p>}
      {log.step === "failed" && (
        <p role="alert" {...stylex.props(styles.problem)}>
          {log.message}
        </p>
      )}
      {log.step === "shown" && <CheckLog name={check.name} log={log.log} />}
    </li>
  );
}

function Checks({
  checks,
  now,
  loadLog,
}: {
  checks: PullRequestCheck[];
  now: number;
  loadLog(job: number): Promise<PullRequestCheckLog>;
}) {
  const [all, setAll] = useState(false);
  const urgent = checks.filter(({ outcome }) => outcome !== "passed" && outcome !== "skipped");
  const rest = checks.slice(urgent.length);
  // A failing or running check shows; those that passed are a count.
  return (
    <section aria-label="Checks" {...stylex.props(styles.part)}>
      {checks.length ? (
        <ul {...stylex.props(styles.list)}>
          {(all ? checks : urgent).map((check) => (
            <CheckRow key={check.id} check={check} now={now} loadLog={loadLog} />
          ))}
        </ul>
      ) : (
        <p {...stylex.props(styles.note)}>No checks on this commit.</p>
      )}
      {rest.length > 0 && (
        <button
          type="button"
          aria-expanded={all}
          {...stylex.props(styles.passed)}
          onClick={() => setAll(!all)}
        >
          <Icon name="check" size={13} />
          {all ? "Hide the checks that passed" : `Checks: ${checkCounts(rest)}`}
        </button>
      )}
    </section>
  );
}

function Merge({ pull }: { pull: LivePullRequest }) {
  return (
    <section aria-label="Merge" {...stylex.props(styles.part, styles.first)}>
      <ul {...stylex.props(styles.list)}>
        {mergeLines(pull).map(({ tone, text }) => (
          <li key={text} {...stylex.props(styles.mergeLine)}>
            <span {...stylex.props(styles.dot, dots[tone])} aria-hidden="true" />
            {text}
          </li>
        ))}
      </ul>
    </section>
  );
}

function Reviewers({ pull }: { pull: LivePullRequest }) {
  if (!pull.reviewers.length) return null;
  return (
    <section aria-label="Reviewers" {...stylex.props(styles.part)}>
      {pull.reviewers.length ? (
        <ul {...stylex.props(styles.list)}>
          {pull.reviewers.map((reviewer) => (
            <li key={reviewer.name} {...stylex.props(styles.reviewer)}>
              <span {...stylex.props(ui.truncate)} title={reviewer.name}>
                {reviewer.name}
              </span>
              <span {...stylex.props(ui.grow)} />
              <StateTag tag={reviewTag(reviewer.state)} />
            </li>
          ))}
        </ul>
      ) : (
        <p {...stylex.props(styles.note)}>Nobody yet.</p>
      )}
    </section>
  );
}

/**
 * The Pull request tab once the review has a real pull request: GitHub's
 * state of it, which Med reads while this tab is on screen, then the
 * description and the discussion. The status goes in a column beside them
 * when the pane has room, and above them when it has not (PullRequestView.css).
 * The only writes are the pending review's, as in the comments panel.
 */
export default function PullRequestView({
  reviewId,
  url,
  title,
  active,
  comments,
  placement,
  root,
  load,
  loadLog,
  refreshes,
  onShowThread,
  onShowDraft,
  left,
  onDismissLeft,
}: {
  reviewId: string;
  url: string;
  /** What to call it until GitHub answers. */
  title: string;
  active: boolean;
  comments: PullRequestState;
  placement: ThreadPlacement;
  root?: string;
  load(refresh: boolean): Promise<LivePullRequest>;
  loadLog(job: number): Promise<PullRequestCheckLog>;
  /** Increases to read GitHub now, as the ⌘K command asks. */
  refreshes: number;
  onShowThread(thread: PullRequestThread): void;
  /** Shows the agent's draft, for a review that has one. */
  onShowDraft?(): void;
  /** The local images that Create left out, for the reader to add on GitHub. */
  left?: readonly string[];
  onDismissLeft?(): void;
}) {
  const onScreen = useWorkspaceShown();
  const {
    data: pull,
    error,
    loading,
    refresh,
  } = useLivePullRequest(load, active, onScreen, comments.refresh);
  const now = useMinuteClock(active);
  const asked = useRef(refreshes);
  useEffect(() => {
    if (refreshes === asked.current) return;
    asked.current = refreshes;
    refresh();
  }, [refreshes, refresh]);
  const shownTitle = pull?.title ?? comments.data?.pull?.title ?? title;
  return (
    <section aria-label="Pull request" {...stylex.props(styles.root)}>
      <div className="med-md-scroll med-pull-scroll">
        <div className="med-pull">
          <header className="med-pull-head">
            <div {...stylex.props(styles.titleRow)}>
              <h1 className="med-pull-title">{shownTitle}</h1>
              <span {...stylex.props(styles.actions)}>
                {onShowDraft && (
                  <button type="button" {...stylex.props(ui.button)} onClick={onShowDraft}>
                    Draft
                  </button>
                )}
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  {...stylex.props(ui.button, styles.outLink)}
                >
                  <Icon name="github" size={13} />
                  Open on GitHub
                </a>
              </span>
            </div>
            {pull && (
              <p {...stylex.props(styles.meta)}>
                <span {...stylex.props(styles.pullState, states[pull.state])}>
                  {STATE_WORDS[pull.state]}
                </span>
                <span>
                  {pull.author} {MERGE_VERBS[pull.state]}{" "}
                  <code {...stylex.props(styles.refs)}>{pull.head}</code> into{" "}
                  <code {...stylex.props(styles.refs)}>{pull.base}</code>
                </span>
                <span {...stylex.props(styles.number)}>#{pull.number}</span>
              </p>
            )}
            {error && (
              <p role="alert" {...stylex.props(styles.problem)}>
                {pull ? `${error} This is what Med read last.` : error}{" "}
                <button
                  type="button"
                  aria-label="Read the pull request again"
                  aria-busy={loading}
                  {...stylex.props(styles.retry)}
                  onClick={refresh}
                >
                  Try again
                </button>
              </p>
            )}
            {pull && lowBudget(pull) && (
              <p {...stylex.props(styles.note)}>
                GitHub&apos;s limit for this sign-in is low, so Med reads less often.
              </p>
            )}
            {left && left.length > 0 && (
              <p role="status" {...stylex.props(styles.notice)}>
                <span {...stylex.props(ui.grow)}>
                  Add {left.join(", ")} on GitHub: drag {left.length === 1 ? "it" : "them"} into the
                  description.
                </span>
                <button
                  type="button"
                  aria-label="Dismiss"
                  {...stylex.props(ui.button, ui.iconButton, styles.tool)}
                  onClick={onDismissLeft}
                >
                  <Icon name="close" size={12} />
                </button>
              </p>
            )}
          </header>
          {/* One box: only what stands between the pull request and merging. */}
          {pull && (
            <div className="med-pull-side">
              <section aria-label="Status" {...stylex.props(styles.status)}>
                <Merge pull={pull} />
                <Checks
                  checks={pull.checks}
                  now={Math.max(now, pull.fetchedAt)}
                  loadLog={loadLog}
                />
                <Reviewers pull={pull} />
              </section>
            </div>
          )}
          <div className="med-pull-main">
            {!pull && !error && <p {...stylex.props(styles.note)}>Reading the pull request…</p>}
            {pull &&
              (pull.body.trim() ? (
                <Description body={pull.body} reviewId={reviewId} root={root} />
              ) : (
                <p {...stylex.props(styles.note)}>No description.</p>
              ))}
            {comments.error && !comments.data && (
              <p role="alert" {...stylex.props(styles.problem)}>
                {comments.error}
              </p>
            )}
            {comments.data && (
              <Discussion
                data={comments.data}
                placement={placement}
                now={now}
                onShowThread={onShowThread}
              />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

const states = stylex.create({
  open: { color: tokens.green },
  draft: { color: tokens.muted },
  merged: { color: tokens.accent },
  closed: { color: tokens.red },
});
const tones = stylex.create({
  good: { color: tokens.green },
  bad: { color: tokens.red },
  warn: { color: tokens.warning },
  quiet: { color: tokens.faint },
});
const dots = stylex.create({
  good: { backgroundColor: tokens.green },
  bad: { backgroundColor: tokens.red },
  warn: { backgroundColor: tokens.warning },
  quiet: { backgroundColor: tokens.faint },
});

const styles = stylex.create({
  root: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    minHeight: 0,
    height: "100%",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
  },
  // The title, and beside it the way to GitHub.
  titleRow: { display: "flex", alignItems: "flex-start", gap: 12 },
  actions: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: 2,
    marginTop: 16,
    marginInlineStart: "auto",
  },
  number: { color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  retry: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.accent, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    cursor: "pointer",
  },
  status: {
    display: "flex",
    flexDirection: "column",
    paddingBlock: 4,
    paddingInline: 14,
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  // A part of the status box, ruled off from the one above.
  part: {
    paddingBlock: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  passed: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    minHeight: 24,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    cursor: "pointer",
  },
  outLink: { textDecoration: "none" },
  meta: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    columnGap: 10,
    rowGap: 4,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  pullState: {
    paddingInline: 6,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    fontSize: 11.5,
    fontWeight: 550,
    lineHeight: "20px",
  },
  refs: { fontFamily: tokens.code, fontSize: 12, overflowWrap: "anywhere" },
  dot: { flexShrink: 0, width: 7, height: 7, borderRadius: "50%" },
  problem: { marginBlock: 8, color: tokens.red, fontSize: 12.5, lineHeight: 1.5 },
  note: { marginBlock: 6, color: tokens.muted, fontSize: 12.5, lineHeight: 1.5 },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginBlock: 8,
    paddingBlock: 6,
    paddingInline: 10,
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.text,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  first: { borderTopWidth: 0 },
  list: { margin: 0, padding: 0, listStyle: "none" },
  mergeLine: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    minHeight: 24,
    lineHeight: "20px",
  },
  reviewer: { display: "flex", alignItems: "center", gap: 8, minHeight: 26, minWidth: 0 },
  check: { minWidth: 0 },
  checkRow: { display: "flex", alignItems: "center", gap: 7, minHeight: 26, minWidth: 0 },
  checkIcon: { display: "inline-flex", flexShrink: 0, width: 14 },
  checkName: { flexShrink: 1, minWidth: 40, fontSize: 12.5 },
  checkWorkflow: { flexShrink: 100, minWidth: 0, color: tokens.faint, fontSize: 11.5 },
  checkWord: { flexShrink: 0, fontSize: 11.5 },
  checkTime: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
  },
  tool: {
    width: 24,
    minWidth: 24,
    minHeight: 24,
    marginInlineEnd: -6,
    color: { default: tokens.faint, ":hover": tokens.text },
    textDecoration: "none",
  },
  logToggle: {
    padding: 0,
    marginBottom: 4,
    marginInlineStart: 21,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.accent, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
  },
  log: {
    marginBlock: 4,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    overflow: "hidden",
  },
  logBar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    minHeight: 26,
    paddingInline: 10,
    color: tokens.faint,
    fontSize: 11.5,
  },
  logText: {
    position: "relative",
    margin: 0,
    maxHeight: 320,
    paddingInline: 10,
    paddingBottom: 8,
    overflow: "auto",
    fontFamily: tokens.code,
    fontSize: 11.5,
    lineHeight: "17px",
    color: tokens.text,
    outline: "none",
  },
  // A line wraps: the column beside the description is narrow for a log.
  logLine: { display: "block", whiteSpace: "pre-wrap", overflowWrap: "anywhere" },
  logError: { color: tokens.red },
  logWarning: { color: tokens.warning },
  logGroup: { color: tokens.muted },
});
