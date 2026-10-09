import { Popover } from "@base-ui/react/popover";
import * as stylex from "@stylexjs/stylex";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type {
  PullRequestComment,
  PullRequestComments,
  PullRequestThread,
} from "../../shared/protocol";
import { relativeTime } from "../data/relative-time";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

// GitHub pull request comments, read-only. Med shows them beside its own
// notes but never writes to GitHub: to reply, open the comment on GitHub.

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

const states: Record<string, { label: string; tone?: "good" | "bad" | "quiet" }> = {
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
  tools,
}: {
  comment: PullRequestComment;
  now: number;
  mark?: boolean;
  state?: string;
  tools?: ReactNode;
}) {
  const created = Date.parse(comment.createdAt);
  const review = state ? (states[state] ?? { label: state.toLowerCase() }) : null;
  return (
    <div {...stylex.props(styles.entry, stylex.defaultMarker())}>
      <div {...stylex.props(styles.byline)}>
        {mark && (
          <span {...stylex.props(styles.mark)}>
            <Icon name="github" size={13} />
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
        mark
        tools={
          <>
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
            <h3 {...stylex.props(styles.heading)}>Conversation</h3>
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
                          <CopyButton label="Copy comment" text={() => commentText(comment)} />
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
            <h3 {...stylex.props(styles.heading)}>Code comments</h3>
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

const styles = stylex.create({
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
    borderRadius: 10,
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
    borderRadius: 4,
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
    borderRadius: 4,
    backgroundColor: tokens.fill,
  },
  figure: { margin: 0, marginBottom: 6 },
  caption: { color: tokens.muted, fontSize: 11, marginBottom: 4 },
  code: {
    margin: 0,
    paddingBlock: 8,
    paddingInline: 10,
    overflowX: "auto",
    borderRadius: 6,
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
  heading: {
    margin: 0,
    marginBottom: 2,
    color: tokens.faint,
    fontSize: 11,
    fontWeight: 550,
    letterSpacing: "0.02em",
  },
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
