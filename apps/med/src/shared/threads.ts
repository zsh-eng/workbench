import { z } from "zod";
import { agentStatusSchema, threadTurnSchema } from "./agent-status";
import { attemptRefSchema } from "./attempts";
import { agentChoicesSchema } from "./owned-session";
import { agentSessionSchema } from "./saved-review";

/** The thread ID of a saved review, or of a session that Med found by itself. */
export const threadIdSchema = z
  .string()
  .regex(
    /^(?:r_[a-f0-9]{24}|found-(?:claude|codex)-[A-Za-z0-9_-]{1,128})$/,
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

/**
 * A thread: one task with its agent sessions and its changes. Each saved
 * review is a thread, and so is a session that Med found by itself. A thread
 * is a tab (open) or in history (closed); the host keeps which, and the
 * order of the tabs (src/host/thread-tabs.ts).
 */
export const threadSchema = z.object({
  /** The saved review's ID. */
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  /** The latest change to the review or to its lead session, in milliseconds. */
  updatedAt: z.number(),
  /** The registered repository; a worktree names its main checkout here. */
  repository: z.object({ id: z.string(), name: z.string(), path: z.string() }).optional(),
  /** The checkout the thread works in, such as a linked worktree. */
  checkout: z.string().optional(),
  /** The checkout is a linked worktree, which Git can remove. */
  linked: z.boolean().optional(),
  branch: z.string().optional(),
  /** The lead session's agent and state, when the thread has a session. */
  agent: agentStatusSchema.shape.agent.optional(),
  state: agentStatusSchema.shape.state.optional(),
  /** The agent sessions, oldest first, to resume one in a terminal. */
  sessions: z.array(agentSessionSchema).optional(),
  changes: z
    .object({
      files: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    })
    .optional(),
  pullRequestUrl: z.string().optional(),
  /** A session that Med found by itself (src/host/found-sessions.ts): no
   * saved review names it, and its ID is not a review's. */
  found: z.boolean().optional(),
  /** The lead session's last turn, from its transcript's tail. */
  turn: threadTurnSchema.optional(),
  /** The newest message that the user sent from Med to the thread's agents. */
  replied: z
    .object({
      at: z.number(),
      text: z.string().max(200),
      delivery: z.enum(["pending", "delivered", "queued", "failed"]),
    })
    .optional(),
  /** The checkout's work that its base branch does not have yet
   * (src/host/checkout-work.ts): commits ahead of the base, and, for a thread
   * on working changes, uncommitted changes. */
  unlanded: z
    .object({
      base: z.string(),
      ahead: z.number().int().nonnegative(),
      uncommitted: z.boolean(),
    })
    .optional(),
  /** One attempt at a task that several agents do; the sidebar shows a group together. */
  group: attemptRefSchema.optional(),
  /** A tab: the thread stays warm and shows in the sidebar. False in history. */
  open: z.boolean().optional(),
  /** When the thread went to history, in milliseconds. */
  closedAt: z.number().optional(),
  /** The first prompt of its lead session, which history searches. */
  prompt: z.string().max(400).optional(),
  /** History keeps only what lists and resumes the thread: its captures are gone. */
  stub: z.boolean().optional(),
  /** The subagents that its lead session runs, or ran lately, newest first. */
  subagents: z.array(threadSubagentSchema).max(8).optional(),
});
export type Thread = z.infer<typeof threadSchema>;

export const threadListSchema = z.object({
  /** The tabs, in the user's order. History is `GET /api/threads/history`. */
  threads: z.array(threadSchema),
  repositories: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
  /** Whether the list shows the sessions that Med finds by itself. */
  found: z.object({ shown: z.boolean() }).optional(),
});
export type ThreadList = z.infer<typeof threadListSchema>;

/** `GET /api/threads/history`: closed threads and found sessions that are
 * not tabs, newest first. */
export const threadHistorySchema = z.object({ threads: z.array(threadSchema) });

/** `POST /api/threads/:id/open`: `restore` puts a closed tab back at its
 * place, as Undo and Reopen closed tab do; otherwise it goes to the top of its
 * repository's tabs. */
export const threadOpenSchema = z.object({ restore: z.boolean().default(false) });
/** The tab that opened. A thread whose captures are gone opens as its
 * session, so the ID can change. */
export const threadOpenedSchema = z.object({ thread: threadSchema });

/** `POST /api/threads/:id/close`. `auto`: the work landed (the auto-close rule). */
export const threadCloseSchema = z.object({
  auto: z.boolean().default(false),
  /** Also removes the linked worktree that Med made; Git keeps one with changes. */
  removeWorktree: z.boolean().default(false),
});
/** Whether this request closed the tab; false when it was closed already. */
export const threadClosedSchema = z.object({ closed: z.boolean() });

/** `POST /api/threads/order`: the tabs in their new order. */
export const threadOrderSchema = z.object({ order: z.array(threadIdSchema).max(1000) });

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
  /** One attempt of several at this task: its branch ends in the attempt's letter. */
  group: attemptRefSchema.optional(),
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
