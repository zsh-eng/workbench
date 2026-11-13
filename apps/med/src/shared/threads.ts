import { z } from "zod";
import { agentStatusSchema, sessionHaltSchema, threadTurnSchema } from "./agent-status";
import { agentChoicesSchema } from "./owned-session";
import { agentSessionSchema, pullRequestStateSchema, type PullRequestState } from "./saved-review";

/** The agent of a session, as its key starts. */
export const SESSION_AGENTS = ["claude", "codex", "acp"] as const;
export type SessionAgent = (typeof SESSION_AGENTS)[number];

/** A session's key: its agent and the agent's own session ID, such as
 * `claude-3e2eb502-…`. A session is a thread whatever folder it works in. */
export const sessionKey = (session: { agent: SessionAgent; id: string }) =>
  `${session.agent}-${session.id}`;
/** The thread of a review: its session's, or its own row without one. */
export const threadOfReview = (review: {
  id: string;
  session?: { agent: SessionAgent; id: string };
}) => (review.session ? sessionKey(review.session) : review.id);
const SESSION_KEY = /^(claude|codex|acp)-([A-Za-z0-9_-]{1,128})$/;
/** The agent and the session ID of a session's key. */
export function parseSessionKey(key: string) {
  const match = SESSION_KEY.exec(key);
  return match ? { agent: match[1] as SessionAgent, id: match[2]! } : undefined;
}
export const REVIEW_ID = /^r_[a-f0-9]{24}$/;

/** A thread's ID: an agent session's key, or a saved review's ID for a
 * review that no session handed off. */
export const threadIdSchema = z
  .string()
  .regex(
    /^(?:r_[a-f0-9]{24}|(?:claude|codex|acp)-[A-Za-z0-9_-]{1,128})$/,
    "Choose a thread by its ID.",
  );

/**
 * A subagent that a thread's session started (Claude Code's
 * `subagents/agent-*.jsonl`), as the thread list shows it under its tab.
 */
export const threadSubagentSchema = z.object({
  /** The tool call that started it; the Session pane has a tab for each. */
  id: z.string().max(200),
  description: z.string().max(200),
  state: z.enum(["working", "idle"]),
  /** What it does now, while it works. */
  activity: z.string().max(200).optional(),
  /** The last change to its transcript, in milliseconds. */
  updatedAt: z.number(),
});
export type ThreadSubagent = z.infer<typeof threadSubagentSchema>;

const count = z.number().int().nonnegative();
const changesSchema = z.object({ files: count, additions: count, deletions: count });

const repositorySchema = z.object({ id: z.string(), name: z.string(), path: z.string() });

/** The place of a review: the checkout whose change it captured, as that
 * checkout is now. The review on screen projects its place: Review, Changes,
 * Commit, and the files are that checkout's. */
export const threadReviewPlaceSchema = z.object({
  /** The registered repository of the checkout; a worktree names its main checkout here. */
  repository: repositorySchema.optional(),
  checkout: z.string(),
  /** The checkout's branch now; none on a detached HEAD. */
  branch: z.string().optional(),
  /** The base branch that the review's comparison names, such as main for
   * `main..week-view`, while the repository has it: its Changes start there. */
  base: z.string().optional(),
  /** The checkout is a linked worktree, such as a pull request's. */
  linked: z.boolean().optional(),
});
export type ThreadReviewPlace = z.infer<typeof threadReviewPlaceSchema>;

/** The pull request of a review. */
export const reviewPullRequestSchema = z.object({
  url: z.string(),
  number: z.number().int().positive(),
  /** The pull request's own title. */
  title: z.string().optional(),
  /** What GitHub said of it last, once a read by this host asked. The thread
   * list asks GitHub nothing itself. */
  state: pullRequestStateSchema.optional(),
});
export type ReviewPullRequest = z.infer<typeof reviewPullRequestSchema>;

/**
 * A review of a thread: a captured change, the place that it projects, and
 * its pull request. A thread lists many and shows one at a time: selecting a
 * review moves the workspace to its place.
 */
export const threadReviewSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  /** Its latest change, in milliseconds. */
  updatedAt: z.number(),
  /** None when Med no longer has its repository. */
  place: threadReviewPlaceSchema.optional(),
  pullRequest: reviewPullRequestSchema.optional(),
  /** Med captured it from the pull request's link: it is the pull request's
   * own change, not a hand-off of the session. The thread lists it with its
   * pull requests. */
  fromPull: z.boolean().optional(),
  changes: changesSchema.optional(),
});
export type ThreadReview = z.infer<typeof threadReviewSchema>;

/** The pull request of a link, as a review names it. */
export function reviewPullRequest(
  url: string,
  details: { title?: string; state?: PullRequestState } = {},
): ReviewPullRequest | undefined {
  const number = Number(/\/pull\/([1-9]\d*)/.exec(url)?.[1]);
  if (!number) return undefined;
  return {
    url,
    number,
    ...(details.title && { title: details.title }),
    ...(details.state && { state: details.state }),
  };
}

/**
 * A thread: an agent session, or a review that no session handed off. A
 * session is not tied to a folder: its checkout is where it works now. Its
 * reviews are the ones it handed off and the pull requests added to it. The
 * workspace shows one review at a time, at that review's place, or a place
 * that the reader chose; what it shows does not follow the session's moves. A thread is a tab (open) or archived; the host keeps
 * which (src/host/thread-store.ts).
 */
export const threadSchema = z.object({
  /** The session's key, or the review's ID. */
  id: z.string(),
  kind: z.enum(["session", "review"]),
  /** The name that shows: the reader's name for the thread, else the agent's title. */
  title: z.string(),
  /** The agent's title, when the reader named the thread in Med (`POST
   * /api/threads/:id/name`): `title` is the reader's name then. */
  agentTitle: z.string().optional(),
  createdAt: z.string(),
  /** The latest change to the session or to one of its reviews, in milliseconds. */
  updatedAt: z.number(),
  /** The registered repository of the checkout; a worktree names its main checkout here. */
  repository: repositorySchema.optional(),
  /** Where the session works now (its latest folder in a checkout), or the
   * review's checkout. */
  checkout: z.string().optional(),
  /** The checkout is a linked worktree, which Git can remove. */
  linked: z.boolean().optional(),
  branch: z.string().optional(),
  /** The branch that its Changes start from, when the reader chose one. */
  base: z.string().optional(),
  /** The session's agent and state. */
  agent: agentStatusSchema.shape.agent.optional(),
  state: agentStatusSchema.shape.state.optional(),
  /** The agent session, with the folder it works in now. A review thread has none. */
  session: agentSessionSchema.optional(),
  /** Its reviews, newest first, each with its place and its pull request. A
   * review thread lists itself. */
  reviews: z.array(threadReviewSchema),
  /** The counts of the newest review, or of the checkout's live Changes. */
  changes: changesSchema.optional(),
  /** The newest review's pull request; `reviews` has each review's. */
  pullRequestUrl: z.string().optional(),
  /** Its place among the pins, from 1, when the reader pinned it: the
   * sidebar lists the pinned threads first, in the order they were pinned. */
  pinned: z.number().int().positive().optional(),
  /** Med runs the session (or resumes it), so a message goes to it from Med. */
  owned: z.boolean().optional(),
  /** The session's last turn, from its transcript's tail: what it does or
   * said, and its checks. With `changes`, the facts of the turn recap. */
  turn: threadTurnSchema.optional(),
  /** What stopped the session's work until the reader acts. */
  halt: sessionHaltSchema.optional(),
  /** The newest message that the user sent from Med to the session. */
  replied: z
    .object({
      at: z.number(),
      text: z.string().max(200),
      delivery: z.enum(["pending", "delivered", "queued", "failed"]),
    })
    .optional(),
  /** The checkout's work that its base branch does not have yet
   * (src/host/checkout-work.ts): commits ahead of the base, and uncommitted
   * changes. */
  unlanded: z
    .object({
      base: z.string(),
      ahead: z.number().int().nonnegative(),
      uncommitted: z.boolean(),
    })
    .optional(),
  /** Other work can be in the checkout: it is a repository's main checkout,
   * or more than one session works in it. Changes then offer "Only this
   * session's files". */
  shared: z.boolean().optional(),
  /** The newest change that the reader has seen, by `updatedAt`: the host
   * keeps it for each tab, so every window and the CLI agree on what is new.
   * A tab's change from before Med kept marks counts as seen. */
  seen: z.number().optional(),
  /** A tab: the thread stays warm and shows in the sidebar. False when archived. */
  open: z.boolean().optional(),
  /** When the thread was archived, in milliseconds. */
  closedAt: z.number().optional(),
  /** The session's first prompt, which the archive searches. */
  prompt: z.string().max(400).optional(),
  /** The subagents that the session runs, or ran lately, newest first. */
  subagents: z.array(threadSubagentSchema).max(8).optional(),
});
export type Thread = z.infer<typeof threadSchema>;

export const threadListSchema = z.object({
  /** The tabs; the sidebar puts the pinned ones first (src/web/data/threads.ts).
   * History is `GET /api/threads/history`. */
  threads: z.array(threadSchema),
  repositories: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      /** The branch of the main checkout, which New thread's Checkout works on. */
      branch: z.string().optional(),
    }),
  ),
  /** Whether the list shows the sessions that Med found by itself, not only
   * the ones that it runs or keeps (`POST /api/found`). */
  found: z.object({ shown: z.boolean() }).optional(),
});
export type ThreadList = z.infer<typeof threadListSchema>;

/** `GET /api/threads/history`: archived threads, newest first. */
export const threadHistorySchema = z.object({ threads: z.array(threadSchema) });

/** The user sent a message from Med after the turn ended. */
const answered = (thread: Thread) =>
  !!thread.replied && thread.replied.at > (thread.turn?.endedAt ?? 0);

/** A permission request, a question that waits for an answer, or work that
 * stopped until the reader acts (`halt`). */
export const needsYou = (thread: Thread) =>
  thread.state === "waiting" || !!thread.halt || (!!thread.turn?.asks && !answered(thread));

/** The thread's work finished, or its agent stopped, after the change that
 * the reader saw last. A thread without marks, such as one in history, has
 * nothing new. */
export const finishedUnseen = (thread: Thread) =>
  thread.state !== "working" && thread.seen !== undefined && thread.updatedAt > thread.seen;

/**
 * What a thread asks of the reader, most first: it needs them (a permission
 * request, a question, or stopped work); its work finished since they looked
 * (done); it works; or nothing (idle). ⌘0, the sidebar's marks, and `med
 * thread list` follow it, as herdr ranks blocked, done, working, and idle.
 */
export type ThreadAttention = "needs-you" | "done" | "working" | "idle";
export const ATTENTION_ORDER: readonly ThreadAttention[] = ["needs-you", "done", "working", "idle"];

export function threadAttention(thread: Thread): ThreadAttention {
  if (needsYou(thread)) return "needs-you";
  if (thread.state === "working") return "working";
  return finishedUnseen(thread) ? "done" : "idle";
}

/** `POST /api/threads/:id/seen`: the reader saw the thread's changes up to
 * `at` (its `updatedAt`); a lower mark makes the later ones new again. */
export const threadSeenSchema = z.object({ at: z.number().nonnegative() });
/** `POST /api/threads/seen`: the marks that a browser kept before the host
 * kept them. A mark the host has already stays when it is newer. */
export const threadMarksSchema = z.object({
  marks: z.record(threadIdSchema, z.number().nonnegative()),
});

/** `POST /api/threads/next`: the tabs once they differ from the list of
 * `version`, or as they are after `waitMs`. `med thread wait` asks again
 * until what it waits for happens. */
export const threadNextSchema = z.object({
  version: z.string().max(80).optional(),
  waitMs: z.number().int().min(0).max(25_000).default(20_000),
});
export const threadNextListSchema = z.object({
  version: z.string(),
  list: threadListSchema,
});

/** What `med thread wait` waits for. */
export const THREAD_WAITS = ["needs-you", "done", "idle"] as const;
export type ThreadWait = (typeof THREAD_WAITS)[number] | "stopped";

/** A thread's state as a wait sees it. A message that Med sent after its
 * turn ended counts as work until the turn that reads it ends; a thread that
 * left the tabs is closed. */
export type WaitState = "needs-you" | "working" | "finished" | "closed";
export function waitState(thread: Thread | undefined): WaitState {
  if (!thread) return "closed";
  if (needsYou(thread)) return "needs-you";
  const sent =
    !!thread.replied &&
    thread.replied.delivery !== "failed" &&
    thread.replied.at > (thread.turn?.endedAt ?? 0);
  return thread.state === "working" || sent ? "working" : "finished";
}

/**
 * Whether a wait is over, from the threads' states in the list before and in
 * this one; `before` is undefined for the first list. Only a change counts,
 * so a thread that needed the reader already does not end the next wait: one
 * that comes to need them ends `needs-you`; one whose work finishes ends
 * `done`; either ends `stopped` (the default). `idle` ends when none of them
 * works. With no work under way when the wait begins, nothing can change, and
 * it ends at once.
 */
export function waitOver(
  until: ThreadWait,
  before: ReadonlyMap<string, WaitState> | undefined,
  now: ReadonlyMap<string, WaitState>,
) {
  const working = [...now.values()].includes("working");
  if (until === "idle" || !before) return !working;
  return [...now].some(([id, state]) => {
    const was = before.get(id);
    if (state === was) return false;
    const needs = state === "needs-you";
    // A thread that closes while the wait runs is done with, as one that finishes.
    const done = (state === "finished" && was === "working") || (state === "closed" && !!was);
    return until === "needs-you" ? needs : until === "done" ? done : needs || done;
  });
}

/** `POST /api/threads/:id/open`: an archived thread is a tab again. */
export const threadOpenSchema = z.object({});
/** The tab that opened. */
export const threadOpenedSchema = z.object({ thread: threadSchema });

/** `POST /api/threads/:id/close`. `auto`: the work landed (the auto-close rule). */
export const threadCloseSchema = z.object({
  auto: z.boolean().default(false),
  /** Also removes the linked worktree that Med made; Git keeps one with changes. */
  removeWorktree: z.boolean().default(false),
});
/** Whether this request closed the tab; false when it was closed already. */
export const threadClosedSchema = z.object({ closed: z.boolean() });

/** `POST /api/threads/:id/name`: a name for the thread, which Med keeps (not
 * the agent). An empty name gives the thread its agent's title again. */
export const threadNameSchema = z.object({ name: z.string().max(120) });
export const threadPinSchema = z.object({
  pinned: z.boolean(),
  /** Its place among the pins, from 0; without it, under the others. */
  at: z.number().int().min(0).optional(),
});

/** A new thread: the task, where the agent works, and which agent. */
export const threadStartSchema = z.object({
  repositoryId: z.string().min(1).max(200),
  prompt: z.string().trim().min(1).max(100_000),
  /** The agent preset, as `/api/agents` lists them. */
  preset: z.string().min(1).max(80),
  /** Work on a new branch in a new linked worktree; otherwise in the repository's checkout. */
  worktree: z.boolean().default(true),
  title: z.string().trim().min(1).max(120).optional(),
  choices: agentChoicesSchema.optional(),
});
export type ThreadStart = z.infer<typeof threadStartSchema>;

const SMALL_WORDS = new Set([
  "a",
  "an",
  "the",
  "to",
  "of",
  "for",
  "and",
  "in",
  "on",
  "with",
  "please",
]);

/** A short name for a task: its first line, cut at a word near 48 characters. */
export function threadTitle(prompt: string) {
  const line = prompt
    .trim()
    .split("\n")[0]!
    .replace(/[.!?:;,]+$/, "")
    .trim();
  if (line.length <= 52) return line || "New thread";
  // A clause that ends early enough makes the best name.
  const clause = /^(.{16,52}?)[,;:(—–]/.exec(line)?.[1]?.trim();
  if (clause) return clause;
  const cut = line.slice(0, 48);
  const space = cut.lastIndexOf(" ");
  return (space > 24 ? cut.slice(0, space) : cut).replace(/[.,;:]+$/, "");
}

/** A branch-safe name from a title: lowercase words joined by hyphens. */
export function threadSlug(title: string) {
  const words = title
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/[\s-]+/)
    .filter((word) => word && !SMALL_WORDS.has(word));
  let slug = "";
  for (const word of words) {
    if (slug.length + word.length + 1 > 40) break;
    slug = slug ? `${slug}-${word}` : word;
  }
  return slug || "thread";
}
