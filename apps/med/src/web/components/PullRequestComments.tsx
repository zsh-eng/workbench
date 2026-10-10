import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { CodexFinding, CodexReviewRun } from "../../shared/codex-review";
import type {
  PullRequestComment,
  PullRequestComments,
  PullRequestThread,
} from "../../shared/protocol";
import { relativeTime } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";

// Review comments that Med reads but does not write: GitHub pull request
// comments, and the findings of Codex reviews. Med shows them beside its own
// notes: to reply on GitHub, open the comment there.

export interface PullRequestState {
  data: PullRequestComments | null;
  error: string | null;
  loading: boolean;
  /** Increases only when the inline threads change, so the diff redraws them. */
  threadsRevision: number;
  refresh(force?: boolean): void;
}

interface Loaded {
  key: string | null;
  data: PullRequestComments | null;
  error: string | null;
  loading: boolean;
  threadsRevision: number;
}

/** Loads a saved review's pull request comments, again when the window gets focus. */
export function usePullRequestComments(
  load: (refresh: boolean) => Promise<PullRequestComments>,
  key: string | null,
): PullRequestState {
  const [state, setState] = useState<Loaded>({
    key: null,
    data: null,
    error: null,
    loading: false,
    threadsRevision: 0,
  });
  const request = useRef(0);
  // State changes only when a read ends, or from the event that asks again.
  const read = useCallback(
    (force: boolean) => {
      if (!key) return;
      const id = ++request.current;
      load(force).then(
        (data) => {
          if (request.current !== id) return;
          setState((current) => {
            const previous = current.key === key ? current : null;
            const same =
              previous?.data &&
              JSON.stringify(previous.data.threads) === JSON.stringify(data.threads);
            return {
              key,
              data: same ? { ...data, threads: previous.data!.threads } : data,
              error: null,
              loading: false,
              threadsRevision: (previous?.threadsRevision ?? 0) + (same ? 0 : 1),
            };
          });
        },
        (error: unknown) => {
          if (request.current !== id) return;
          setState((current) => ({
            key,
            data: current.key === key ? current.data : null,
            error: error instanceof Error ? error.message : "Could not read the pull request.",
            loading: false,
            threadsRevision: current.key === key ? current.threadsRevision : 0,
          }));
        },
      );
    },
    [key, load],
  );
  const refresh = useCallback(
    (force = false) => {
      setState((current) => (current.key === key ? { ...current, loading: true } : current));
      read(force);
    },
    [key, read],
  );
  useEffect(() => {
    read(false);
    if (!key) return;
    const focus = () => refresh();
    window.addEventListener("focus", focus);
    return () => window.removeEventListener("focus", focus);
  }, [key, read, refresh]);
  const current = state.key === key ? state : null;
  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    // Until the first read ends, the key has no state yet.
    loading: current ? current.loading : key !== null,
    threadsRevision: current?.threadsRevision ?? 0,
    refresh,
  };
}

function lineLabel(thread: PullRequestThread) {
  const side = thread.side === "old" ? "L" : "R";
  const line = thread.line ?? thread.originalLine;
  if (line === null) return "file";
  return thread.startLine && thread.startLine !== line
    ? `${side}${thread.startLine}–${side}${line}`
    : `${side}${line}`;
}

function quote(comment: PullRequestComment) {
  return `@${comment.author}:\n${comment.body
    .trim()
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n")}`;
}

/** Plain text for an agent or a note: where, who, what, and the link. */
export function threadText(thread: PullRequestThread) {
  return [
    `${thread.path}:${lineLabel(thread)}${thread.line === null ? " (outdated)" : ""}`,
    ...thread.comments.map(quote),
    thread.comments[0]?.url ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function commentText(comment: PullRequestComment) {
  return `${quote(comment)}\n\n${comment.url}`;
}

/** GitHub Markdown, shown as text: fenced code and inline code keep their
 * shape; HTML comments that bots leave are removed. */
function Body({ text }: { text: string }) {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "").trim();
  const long = clean.length > 900 || clean.split("\n").length > 14;
  const [open, setOpen] = useState(false);
  if (!clean) return <p {...stylex.props(styles.body, styles.empty)}>No text.</p>;
  const parts: ReactNode[] = [];
  const fence = /^(`{3,}|~{3,})[ \t]*([^\n]*)\n([\s\S]*?)^\1[ \t]*$/gm;
  let last = 0;
  for (const match of clean.matchAll(fence)) {
    if (match.index > last) parts.push(<Prose key={last} text={clean.slice(last, match.index)} />);
    const suggestion = match[2]!.trim() === "suggestion";
    parts.push(
      <figure key={match.index} {...stylex.props(styles.figure)}>
        {suggestion && <figcaption {...stylex.props(styles.caption)}>Suggested change</figcaption>}
        <pre {...stylex.props(styles.code)}>{match[3]!.replace(/\n$/, "")}</pre>
      </figure>,
    );
    last = match.index + match[0].length;
  }
  if (last < clean.length) parts.push(<Prose key={last} text={clean.slice(last)} />);
  return (
    <>
      <div {...stylex.props(styles.body, long && !open && styles.clamped)}>{parts}</div>
      {long && (
        <button
          type="button"
          {...stylex.props(styles.more)}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </>
  );
}

function Prose({ text }: { text: string }) {
  const trimmed = text.replace(/^\n+|\n+$/g, "");
  if (!trimmed) return null;
  return (
    <p {...stylex.props(styles.prose)}>
      {trimmed.split(/(`[^`\n]+`)/).map((part, index) =>
        index % 2 ? (
          <code key={index} {...stylex.props(styles.inlineCode)}>
            {part.slice(1, -1)}
          </code>
        ) : (
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </p>
  );
}

function CopyButton({ text, label }: { text: () => string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(timer);
  }, [state]);
  const title = state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : label;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      {...stylex.props(ui.button, ui.iconButton, styles.tool)}
      onClick={() =>
        void navigator.clipboard.writeText(text()).then(
          () => setState("copied"),
          () => setState("failed"),
        )
      }
    >
      <Icon name={state === "copied" ? "check" : "copy"} size={13} />
    </button>
  );
}

/** The agent session's next message, when the review has one: GitHub
 * comments can go into it. */
export interface AgentReplyTarget {
  agent: string;
  add(attachment: { label: string; text: string }): void;
}
export const AgentReplyContext = createContext<AgentReplyTarget | null>(null);

function AddToReplyButton({ label, text }: { label: string; text: () => string }) {
  const target = useContext(AgentReplyContext);
  const [added, setAdded] = useState(false);
  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(false), 1600);
    return () => clearTimeout(timer);
  }, [added]);
  if (!target) return null;
  const title = added
    ? `Added to the message for ${target.agent}`
    : `Add to the message for ${target.agent}`;
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      {...stylex.props(ui.button, ui.iconButton, styles.tool)}
      onClick={() => {
        target.add({ label, text: text() });
        setAdded(true);
      }}
    >
      <Icon name={added ? "check" : "reply"} size={13} />
    </button>
  );
}

const threadLabel = (thread: PullRequestThread) =>
  `${thread.path.split("/").at(-1)}:${lineLabel(thread)}`;

function OpenButton({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title="Open on GitHub to reply"
      aria-label="Open on GitHub"
      {...stylex.props(ui.button, ui.iconButton, styles.tool)}
    >
      <Icon name="external" size={13} />
    </a>
  );
}

type Tag = { label: string; tone?: "good" | "bad" | "quiet" };
const states: Record<string, Tag> = {
  APPROVED: { label: "Approved", tone: "good" },
  CHANGES_REQUESTED: { label: "Changes requested", tone: "bad" },
  DISMISSED: { label: "Dismissed", tone: "quiet" },
  COMMENTED: { label: "Reviewed" },
};

/** One GitHub comment: author, age, and text. Tools show on hover or focus. */
function Entry({
  comment,
  now,
  mark,
  state,
  tag,
  heading,
  tools,
}: {
  comment: Pick<PullRequestComment, "author" | "body" | "createdAt">;
  now: number;
  mark?: IconName;
  state?: string;
  /** A label beside the author, such as a finding's priority. */
  tag?: Tag;
  /** A finding's title, above its text. */
  heading?: string;
  tools?: ReactNode;
}) {
  const created = Date.parse(comment.createdAt);
  const review = tag ?? (state ? (states[state] ?? { label: state.toLowerCase() }) : null);
  return (
    <div {...stylex.props(styles.entry, stylex.defaultMarker())}>
      <div {...stylex.props(styles.byline)}>
        {mark && (
          <span {...stylex.props(styles.mark)}>
            <Icon name={mark} size={13} />
          </span>
        )}
        <span {...stylex.props(styles.author, ui.truncate)}>{comment.author}</span>
        {review && (
          <span
            {...stylex.props(
              styles.state,
              review.tone === "good" && styles.good,
              review.tone === "bad" && styles.bad,
              review.tone === "quiet" && styles.quiet,
            )}
          >
            {review.label}
          </span>
        )}
        {!Number.isNaN(created) && (
          <time
            dateTime={comment.createdAt}
            title={new Date(created).toLocaleString(undefined, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            {...stylex.props(styles.time)}
          >
            {relativeTime(created, now)}
          </time>
        )}
        <span {...stylex.props(ui.grow)} />
        {tools && <span {...stylex.props(styles.tools)}>{tools}</span>}
      </div>
      {heading && <p {...stylex.props(styles.heading2)}>{heading}</p>}
      {comment.body.trim() ? <Body text={comment.body} /> : null}
    </div>
  );
}

/** An inline GitHub thread in the diff. It has no reply, edit, or resolve:
 * Med reads GitHub and keeps its own notes local. */
export function PullRequestThreadCard({
  thread,
  now: fixedNow,
  embedded = false,
}: {
  thread: PullRequestThread;
  now?: number;
  /** In a list, without the card's own border. */
  embedded?: boolean;
}) {
  const [now] = useState(() => fixedNow ?? Date.now());
  const [first, ...replies] = thread.comments;
  if (!first) return null;
  return (
    <article
      data-comment-card
      data-pull-request-thread={thread.id}
      aria-label={`GitHub thread by ${first.author} at ${lineLabel(thread)}, read-only`}
      {...stylex.props(styles.card, embedded && styles.embedded)}
    >
      <Entry
        comment={first}
        now={now}
        mark="github"
        tools={
          <>
            <AddToReplyButton label={threadLabel(thread)} text={() => threadText(thread)} />
            <CopyButton label="Copy thread" text={() => threadText(thread)} />
            <OpenButton url={first.url} />
          </>
        }
      />
      {replies.map((reply) => (
        <div key={reply.id} {...stylex.props(styles.reply)}>
          <Entry comment={reply} now={now} />
        </div>
      ))}
    </article>
  );
}

/** Why the threads are not in the diff, for the panel. */
export type ThreadPlacement =
  | { kind: "inline"; ids: ReadonlySet<number> }
  | { kind: "elsewhere"; reason: string };

/** The pull request's conversation and the code comments that are not in the
 * diff, in a popover beside the pull request link. */
export function PullRequestPanel({
  state,
  placement,
}: {
  state: PullRequestState;
  placement: ThreadPlacement;
}) {
  const [open, setOpen] = useState(false);
  const { data, error, loading, refresh } = state;
  const count = data
    ? data.conversation.length +
      data.reviews.length +
      data.threads.reduce((sum, thread) => sum + thread.comments.length, 0)
    : null;
  const label = error
    ? "Pull request comments: could not load"
    : count === null
      ? "Pull request comments"
      : `${count} pull request ${count === 1 ? "comment" : "comments"}`;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) refresh();
      }}
    >
      <Popover.Trigger
        {...stylex.props(ui.button, ui.pressable, styles.trigger)}
        aria-label={label}
        title={label}
      >
        <Icon name="note" size={14} />
        <span {...stylex.props(styles.count, error ? styles.bad : null)}>
          {error ? "!" : (count ?? "…")}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          sideOffset={5}
          {...stylex.props(styles.positioner, ui.instant)}
        >
          <Popover.Popup
            aria-label="Pull request comments"
            {...stylex.props(ui.popup, styles.panel, ui.instant)}
          >
            <PanelContent
              data={data}
              error={error}
              loading={loading}
              placement={placement}
              onRefresh={() => refresh(true)}
            />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The panel's contents; the elements page shows them without the popover. */
export function PanelContent({
  data,
  error,
  loading,
  placement,
  now: fixedNow,
  onRefresh,
}: {
  data: PullRequestComments | null;
  error: string | null;
  loading: boolean;
  placement: ThreadPlacement;
  now?: number;
  onRefresh(): void;
}) {
  // The popover mounts its contents when it opens; ages count from then.
  const [openedAt] = useState(Date.now);
  const now = fixedNow ?? openedAt;
  const timeline = data
    ? [
        ...data.reviews.map((review) => ({ comment: review, state: review.state })),
        ...data.conversation.map((comment) => ({ comment, state: undefined })),
      ].sort((a, b) => a.comment.createdAt.localeCompare(b.comment.createdAt))
    : [];
  const others = data
    ? data.threads.filter((thread) => placement.kind !== "inline" || !placement.ids.has(thread.id))
    : [];
  const inline = data ? data.threads.length - others.length : 0;
  return (
    <div {...stylex.props(styles.content)}>
      <header {...stylex.props(styles.head)}>
        <h2 {...stylex.props(styles.title)}>Pull request comments</h2>
        <span {...stylex.props(ui.grow)} />
        {data && (
          <span {...stylex.props(styles.time)}>
            {loading
              ? "Updating…"
              : `Read ${relativeTime(data.fetchedAt, Math.max(now, data.fetchedAt))}`}
          </span>
        )}
        <button
          type="button"
          title="Read again from GitHub"
          aria-label="Read again from GitHub"
          aria-busy={loading}
          {...stylex.props(ui.button, ui.iconButton, styles.tool, styles.visible)}
          onClick={onRefresh}
        >
          <Icon name="refresh" size={13} />
        </button>
      </header>
      <p {...stylex.props(styles.lede)}>
        Read-only from GitHub. To reply, open a comment on GitHub. Med notes stay local.
      </p>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      {!data && !error && <p {...stylex.props(styles.lede)}>Reading comments…</p>}
      {data && (
        <>
          <section aria-label="Conversation" {...stylex.props(styles.section)}>
            <h3 {...stylex.props(ui.label, styles.heading)}>Conversation</h3>
            {timeline.length ? (
              timeline.map(({ comment, state }) => (
                <div key={comment.id} {...stylex.props(styles.item)}>
                  <Entry
                    comment={comment}
                    now={now}
                    state={state}
                    tools={
                      <>
                        {comment.body.trim() && (
                          <>
                            <AddToReplyButton
                              label={`@${comment.author}`}
                              text={() => commentText(comment)}
                            />
                            <CopyButton label="Copy comment" text={() => commentText(comment)} />
                          </>
                        )}
                        <OpenButton url={comment.url} />
                      </>
                    }
                  />
                </div>
              ))
            ) : (
              <p {...stylex.props(styles.lede)}>No conversation comments.</p>
            )}
          </section>
          <section aria-label="Code comments" {...stylex.props(styles.section)}>
            <div {...stylex.props(styles.headingRow)}>
              <h3 {...stylex.props(ui.label, styles.heading)}>Code comments</h3>
              <AddAllToReply threads={data.threads.filter((thread) => thread.line !== null)} />
            </div>
            {inline > 0 && (
              <p {...stylex.props(styles.lede)}>
                {inline} {inline === 1 ? "thread shows" : "threads show"} in the diff.
              </p>
            )}
            {placement.kind === "elsewhere" && others.length > 0 && (
              <p {...stylex.props(styles.lede)}>{placement.reason}</p>
            )}
            {others.map((thread) => (
              <div key={thread.id} {...stylex.props(styles.item)}>
                <div {...stylex.props(styles.where)}>
                  <span {...stylex.props(ui.truncate)} title={thread.path}>
                    {thread.path}
                  </span>
                  <span {...stylex.props(styles.line)}>{lineLabel(thread)}</span>
                  {thread.line === null && <span {...stylex.props(styles.state)}>Outdated</span>}
                </div>
                <PullRequestThreadCard thread={thread} now={now} embedded />
              </div>
            ))}
            {!data.threads.length && <p {...stylex.props(styles.lede)}>No code comments.</p>}
          </section>
        </>
      )}
    </div>
  );
}

/** Adds every current code thread to the agent's next message. */
function AddAllToReply({ threads }: { threads: PullRequestThread[] }) {
  return (
    <AddAll
      label={`${threads.length} GitHub ${threads.length === 1 ? "thread" : "threads"}`}
      texts={threads.map(threadText)}
    />
  );
}

function AddAll({ label, texts }: { label: string; texts: string[] }) {
  const target = useContext(AgentReplyContext);
  const [added, setAdded] = useState(false);
  if (!target || !texts.length) return null;
  return (
    <button
      type="button"
      {...stylex.props(ui.button, styles.addAll)}
      onClick={() => {
        target.add({ label, text: texts.join("\n\n---\n\n") });
        setAdded(true);
      }}
    >
      <Icon name={added ? "check" : "reply"} size={12} />
      {added ? "Added" : `Add all to ${target.agent}`}
    </button>
  );
}

export interface CodexReviewState {
  runs: CodexReviewRun[] | null;
  error: string | null;
  loading: boolean;
  /** Increases only when the findings change, so the diff redraws them. */
  revision: number;
  refresh(): void;
}

/** Loads the Codex reviews of a saved review, again when the window gets focus. */
export function useCodexReviews(
  load: () => Promise<CodexReviewRun[]>,
  key: string | null,
): CodexReviewState {
  const [state, setState] = useState<{
    key: string | null;
    runs: CodexReviewRun[] | null;
    error: string | null;
    revision: number;
  }>({ key: null, runs: null, error: null, revision: 0 });
  const request = useRef(0);
  const read = useCallback(() => {
    if (!key) return;
    const id = ++request.current;
    load().then(
      (runs) => {
        if (request.current !== id) return;
        setState((current) => {
          const previous = current.key === key ? current : null;
          const same = JSON.stringify(previous?.runs) === JSON.stringify(runs);
          return {
            key,
            runs: same ? previous!.runs : runs,
            error: null,
            revision: (previous?.revision ?? 0) + (same ? 0 : 1),
          };
        });
      },
      (error: unknown) => {
        if (request.current !== id) return;
        setState((current) => ({
          key,
          runs: current.key === key ? current.runs : null,
          error: error instanceof Error ? error.message : "Could not read Codex reviews.",
          revision: current.key === key ? current.revision : 0,
        }));
      },
    );
  }, [key, load]);
  useEffect(() => {
    read();
    if (!key) return;
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
  }, [key, read]);
  const current = state.key === key ? state : null;
  return {
    runs: current?.runs ?? null,
    error: current?.error ?? null,
    loading: !current && key !== null,
    revision: current?.revision ?? 0,
    refresh: read,
  };
}

const findingLines = (finding: CodexFinding) =>
  finding.startLine === finding.endLine
    ? `R${finding.endLine}`
    : `R${finding.startLine}–R${finding.endLine}`;

/** Plain text for an agent or a note: where, the priority, and what. */
export function findingText(finding: CodexFinding) {
  const priority = finding.priority === null ? "" : `[P${finding.priority}] `;
  return `${finding.path}:${findingLines(finding)}\n\nCodex: ${priority}${finding.title}\n\n${finding.body.trim()}`;
}

/** P0 and P1 must be fixed; P3 is a nit. */
const priorityTag = (priority: number | null): Tag | undefined =>
  priority === null
    ? undefined
    : { label: `P${priority}`, tone: priority <= 1 ? "bad" : priority === 3 ? "quiet" : undefined };

const verdictTag = (verdict: string): Tag | undefined =>
  !verdict
    ? undefined
    : {
        label: verdict.charAt(0).toUpperCase() + verdict.slice(1),
        tone: /incorrect/i.test(verdict) ? "bad" : /correct/i.test(verdict) ? "good" : undefined,
      };

/** A Codex finding in the diff, read-only, in the same card as a GitHub thread. */
export function CodexFindingCard({
  finding,
  run,
  now: fixedNow,
  embedded = false,
}: {
  finding: CodexFinding;
  run: CodexReviewRun;
  now?: number;
  embedded?: boolean;
}) {
  const [now] = useState(() => fixedNow ?? Date.now());
  const label = `${finding.path.split("/").at(-1)}:${findingLines(finding)}`;
  return (
    <article
      data-comment-card
      data-codex-finding={finding.id}
      aria-label={`Codex finding at ${findingLines(finding)}, read-only`}
      {...stylex.props(styles.card, embedded && styles.embedded)}
    >
      <Entry
        comment={{ author: "Codex", body: finding.body, createdAt: run.createdAt }}
        now={now}
        mark="codex"
        tag={priorityTag(finding.priority)}
        heading={finding.title}
        tools={
          <>
            <AddToReplyButton label={label} text={() => findingText(finding)} />
            <CopyButton label="Copy finding" text={() => findingText(finding)} />
          </>
        }
      />
    </article>
  );
}

/** Which findings show in the diff, and why each other run's do not. */
export interface FindingPlacement {
  inline: ReadonlySet<string>;
  /** By run: why its findings are listed here. */
  reasons: ReadonlyMap<string, string>;
}

/** The Codex reviews: each verdict, and the findings that are not in the diff,
 * in a popover beside the review title. */
export function CodexReviewPanel({
  state,
  placement,
}: {
  state: CodexReviewState;
  placement: FindingPlacement;
}) {
  const [open, setOpen] = useState(false);
  const count = state.runs?.reduce((sum, run) => sum + run.findings.length, 0) ?? 0;
  const label = state.error
    ? "Codex reviews: could not read"
    : `${count} Codex ${count === 1 ? "finding" : "findings"}`;
  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) state.refresh();
      }}
    >
      <Popover.Trigger
        {...stylex.props(ui.button, ui.pressable, styles.trigger)}
        aria-label={label}
        title={label}
      >
        <Icon name="codex" size={14} />
        <span {...stylex.props(styles.count, state.error ? styles.bad : null)}>
          {state.error ? "!" : count}
        </span>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner
          align="start"
          sideOffset={5}
          {...stylex.props(styles.positioner, ui.instant)}
        >
          <Popover.Popup
            aria-label="Codex reviews"
            {...stylex.props(ui.popup, styles.panel, ui.instant)}
          >
            <CodexPanelContent runs={state.runs} error={state.error} placement={placement} />
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The panel's contents; the elements page shows them without the popover. */
export function CodexPanelContent({
  runs,
  error,
  placement,
  now: fixedNow,
}: {
  runs: CodexReviewRun[] | null;
  error: string | null;
  placement: FindingPlacement;
  now?: number;
}) {
  const [openedAt] = useState(Date.now);
  const now = fixedNow ?? openedAt;
  return (
    <div {...stylex.props(styles.content)}>
      <header {...stylex.props(styles.head)}>
        <h2 {...stylex.props(styles.title)}>Codex reviews</h2>
      </header>
      <p {...stylex.props(styles.lede)}>
        Read-only from <code {...stylex.props(styles.inlineCode)}>codex review</code> and /review in
        this review&apos;s checkouts. To answer, resume the Codex session.
      </p>
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
      {runs?.map((run) => {
        const others = run.findings.filter((finding) => !placement.inline.has(finding.id));
        const inline = run.findings.length - others.length;
        const reason = placement.reasons.get(run.id);
        return (
          <section
            key={run.id}
            aria-label={`Codex review of ${run.target}`}
            {...stylex.props(styles.section)}
          >
            <div {...stylex.props(styles.headingRow)}>
              <h3 {...stylex.props(styles.runTitle)}>
                {run.target.charAt(0).toUpperCase() + run.target.slice(1)}
              </h3>
              <AddAll
                label={`${run.findings.length} Codex ${run.findings.length === 1 ? "finding" : "findings"}`}
                texts={run.findings.map(findingText)}
              />
            </div>
            <Entry
              comment={{ author: "Codex", body: run.explanation, createdAt: run.createdAt }}
              now={now}
              mark="codex"
              tag={verdictTag(run.verdict)}
              tools={
                <CopyButton
                  label="Copy resume command"
                  text={() => `codex resume ${run.threadId}`}
                />
              }
            />
            {inline > 0 && (
              <p {...stylex.props(styles.lede)}>
                {inline} {inline === 1 ? "finding shows" : "findings show"} in the diff.
              </p>
            )}
            {reason && others.length > 0 && <p {...stylex.props(styles.lede)}>{reason}</p>}
            {others.map((finding) => (
              <div key={finding.id} {...stylex.props(styles.item)}>
                <div {...stylex.props(styles.where)}>
                  <span {...stylex.props(ui.truncate)} title={finding.path}>
                    {finding.path}
                  </span>
                  <span {...stylex.props(styles.line)}>{findingLines(finding)}</span>
                </div>
                <CodexFindingCard finding={finding} run={run} now={now} embedded />
              </div>
            ))}
            {!run.findings.length && <p {...stylex.props(styles.lede)}>No findings.</p>}
          </section>
        );
      })}
      {runs && !runs.length && !error && <p {...stylex.props(styles.lede)}>No Codex reviews.</p>}
    </div>
  );
}

const styles = stylex.create({
  heading2: { margin: 0, marginBottom: 2, fontSize: 13, fontWeight: 600, lineHeight: "20px" },
  runTitle: { margin: 0, color: tokens.muted, fontSize: 12, fontWeight: 550 },
  headingRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 },
  addAll: { minHeight: 22, paddingInline: 6, fontSize: 11.5 },
  // The same card as a local note, so both read as one system; the GitHub
  // mark and the author line set it apart.
  card: {
    boxSizing: "border-box",
    marginBlock: 6,
    marginInline: 10,
    maxWidth: 600,
    paddingBlock: 8,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: { default: tokens.line, ":focus-within": tokens.lineStrong },
    borderRadius: `calc(10px * ${tokens.round})`,
    color: tokens.text,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    fontSize: 13,
  },
  embedded: {
    marginBlock: 0,
    marginInline: 0,
    maxWidth: "none",
    paddingInline: 0,
    paddingBlock: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  entry: { minWidth: 0 },
  byline: { display: "flex", alignItems: "center", gap: 6, minWidth: 0, minHeight: 26 },
  mark: { display: "inline-flex", color: tokens.muted, flexShrink: 0 },
  author: { fontSize: 12.5, fontWeight: 550, color: tokens.text },
  time: { color: tokens.faint, fontSize: 11, whiteSpace: "nowrap" },
  state: {
    flexShrink: 0,
    fontFamily: tokens.ui,
    fontSize: 10.5,
    lineHeight: "18px",
    paddingInline: 6,
    borderRadius: `calc(4px * ${tokens.round})`,
    color: tokens.muted,
    backgroundColor: tokens.fill,
  },
  good: { color: tokens.green },
  bad: { color: tokens.red },
  quiet: { color: tokens.faint },
  tools: {
    display: "inline-flex",
    gap: 2,
    marginInlineEnd: -6,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: { default: "120ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
  },
  tool: {
    width: 26,
    minWidth: 26,
    minHeight: 26,
    color: { default: tokens.faint, ":hover": tokens.text },
    textDecoration: "none",
  },
  visible: { opacity: 1 },
  body: {
    minWidth: 0,
    paddingBottom: 4,
    fontSize: 13,
    lineHeight: "20px",
    overflowWrap: "anywhere",
  },
  clamped: {
    maxHeight: 220,
    overflow: "hidden",
    maskImage: "linear-gradient(to bottom, black 75%, transparent)",
  },
  empty: { color: tokens.faint, margin: 0 },
  prose: { margin: 0, marginBottom: 6, whiteSpace: "pre-wrap" },
  inlineCode: {
    fontFamily: tokens.code,
    fontSize: "0.9em",
    paddingInline: 4,
    paddingBlock: 1,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.fill,
  },
  figure: { margin: 0, marginBottom: 6 },
  caption: { color: tokens.muted, fontSize: 11, marginBottom: 4 },
  code: {
    margin: 0,
    paddingBlock: 8,
    paddingInline: 10,
    overflowX: "auto",
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    fontFamily: tokens.code,
    fontSize: 12,
    lineHeight: "18px",
    whiteSpace: "pre",
  },
  more: {
    marginBottom: 4,
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.accent, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
  },
  reply: {
    marginTop: 4,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  trigger: { flexShrink: 0, gap: 5 },
  count: { fontVariantNumeric: "tabular-nums" },
  positioner: { zIndex: 60 },
  panel: {
    width: "min(460px, calc(100vw - 24px))",
    maxHeight: "min(600px, 75vh)",
    padding: 0,
  },
  content: { paddingBlock: 8, paddingInline: 14 },
  head: { display: "flex", alignItems: "center", gap: 6, minHeight: 28 },
  title: { margin: 0, fontSize: 13, fontWeight: 600 },
  lede: { marginBlock: 4, color: tokens.muted, fontSize: 12, lineHeight: 1.5 },
  error: { marginBlock: 6, color: tokens.red, fontSize: 12, lineHeight: 1.5 },
  section: { marginTop: 12 },
  heading: { margin: 0, marginBottom: 2 },
  item: {
    paddingBlock: 4,
    borderTopWidth: { default: 1, ":first-of-type": 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  where: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    minWidth: 0,
    paddingTop: 4,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  line: { flexShrink: 0, color: tokens.faint },
});
