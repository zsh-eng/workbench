import { z } from "zod";

/**
 * Agent sessions that Med finds by itself: Claude Code and Codex sessions in
 * a registered repository or one of its worktrees, which no saved review
 * names. The thread list shows each one as a thread with `found: true`.
 */
export type FoundAgent = "claude" | "codex";

/** The thread list shows a found session when its transcript changed in the
 * last `FOUND_DAYS` days. `med thread find` and `med thread adopt` reach
 * sessions of any age. */
export const FOUND_DAYS = 7;

const FOUND_ID = /^found-(claude|codex)-([A-Za-z0-9_-]{1,128})$/;

/** A found session's thread ID. It is not a saved review's ID (`r_…`), and
 * the session routes of `/api/reviews/:id` accept it. */
export const foundThreadId = (agent: FoundAgent, sessionId: string) =>
  `found-${agent}-${sessionId}`;

/** The agent and the session of a found thread's ID. */
export function parseFoundThreadId(id: string) {
  const match = FOUND_ID.exec(id);
  return match ? { agent: match[1] as FoundAgent, id: match[2]! } : undefined;
}

/** Whether the thread list shows found sessions, and the ones the reader hid. */
export const foundSettingsSchema = z.object({
  shown: z.boolean(),
  hidden: z.array(z.string()).max(500),
});
export type FoundSettings = z.infer<typeof foundSettingsSchema>;

/** `POST /api/found`: show or hide all found sessions, or hide one thread. */
export const foundUpdateSchema = z.object({
  shown: z.boolean().optional(),
  hide: z
    .object({ id: z.string().regex(FOUND_ID, "Choose a found thread."), hidden: z.boolean() })
    .optional(),
});
export type FoundUpdate = z.infer<typeof foundUpdateSchema>;

/** `POST /api/sessions/find`: the sessions whose title, first prompt, folder,
 * or ID has each word of `text`, newest first; or the sessions that `session`
 * names, by ID, by the start of an ID, or by transcript path. */
export const sessionFindSchema = z.object({
  text: z.string().max(1000).optional(),
  session: z.string().trim().min(1).max(4096).optional(),
  limit: z.number().int().min(1).max(500).optional(),
});
export type SessionFind = z.infer<typeof sessionFindSchema>;

/** A Claude Code or Codex session on this computer, at any age. */
export const sessionEntrySchema = z.object({
  agent: z.enum(["claude", "codex"]),
  id: z.string(),
  title: z.string(),
  /** The start of the user's first prompt, on one line. */
  prompt: z.string().optional(),
  /** The directory that the session runs in. */
  cwd: z.string().optional(),
  /** The transcript file. */
  path: z.string(),
  createdAt: z.string(),
  /** When the transcript last changed. */
  updatedAt: z.string(),
  /** Codex keeps the rollouts of archived sessions in another folder. */
  archived: z.boolean().optional(),
  /** The registered repository that holds the session's directory. */
  repository: z.string().optional(),
  /** The saved thread that names the session. */
  thread: z.object({ id: z.string(), archived: z.boolean().optional() }).optional(),
});
export type SessionEntry = z.infer<typeof sessionEntrySchema>;

/** `POST /api/sessions/adopt`: makes one session a saved thread, as Keep in
 * Med does. `repo` gives the checkout when the session's folder is not one. */
export const sessionAdoptSchema = z.object({
  session: z.string().trim().min(1).max(4096),
  /** An Antigravity conversation, which Med continues: `session` is its ID,
   * and `repo` the folder that it runs in. */
  agent: z.literal("agy").optional(),
  repo: z.string().min(1).max(4096).optional(),
  title: z.string().trim().min(1).max(200).optional(),
});
export type SessionAdopt = z.infer<typeof sessionAdoptSchema>;

/** The answer to `POST /api/sessions/adopt`. */
export const sessionAdoptedSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]+$/),
  title: z.string(),
  /** False when a saved thread named the session already. */
  created: z.boolean(),
  /** The Claude Code or Codex session; an agy conversation has none. */
  session: sessionEntrySchema.optional(),
});
export type SessionAdopted = z.infer<typeof sessionAdoptedSchema>;

/**
 * `GET /api/sessions/running`: an agent session that runs on this computer
 * now. Med's own show while they work on a turn; another process's while it
 * has the session open, as a terminal or the agent's app does.
 */
export const runningSessionSchema = z.object({
  agent: z.enum(["claude", "codex", "agy", "acp"]),
  id: z.string(),
  title: z.string(),
  cwd: z.string().optional(),
  /** Where it runs: in Med, a terminal, the Claude app, or another app. */
  place: z.enum(["med", "terminal", "claude-app", "other-app"]),
  /** The saved thread that has it. */
  thread: z.string().optional(),
});
export type RunningSession = z.infer<typeof runningSessionSchema>;
export const runningSessionsSchema = z.object({ sessions: z.array(runningSessionSchema) });
