import { z } from "zod";
import type { RouteContract } from "./routes";

// Attempts: one task that two or three agents do at once, each in its own
// worktree. Each attempt is a thread (a saved review) with the same group.
// The Attempts page compares them, and Keep makes one of them the thread.

/** At most this many attempts at one task. */
export const MAX_ATTEMPTS = 3;

/** Attempt 1 is A, 2 is B, 3 is C. */
export const attemptLetter = (attempt: number) => String.fromCharCode(64 + attempt);

export const attemptGroupIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][\w.-]{0,79}$/, "Name a group with letters, digits, and . _ -.");

/** A saved review that is one attempt at a task. */
export const attemptRefSchema = z.object({
  id: attemptGroupIdSchema,
  attempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  /** The agent and model as chosen at the start, such as "Claude Code · Opus". */
  label: z.string().trim().min(1).max(80).optional(),
});
export type AttemptRef = z.infer<typeof attemptRefSchema>;

/** A check that the agent ran, as its transcript records it. */
export const attemptCheckSchema = z.object({
  command: z.string(),
  status: z.enum(["passed", "failed", "running", "unknown"]),
  /** Counts from the output, such as "5 pass · 1 fail", or the exit code. */
  summary: z.string().optional(),
  at: z.number(),
});
export type AttemptCheck = z.infer<typeof attemptCheckSchema>;

const count = z.number().int().nonnegative();

export const attemptSchema = z.object({
  threadId: z.string(),
  attempt: z.number().int().min(1).max(MAX_ATTEMPTS),
  title: z.string(),
  /** The lead session's agent: "Claude", "Codex", or an ACP agent's name. */
  agent: z.string().optional(),
  kind: z.enum(["claude", "codex", "acp"]).optional(),
  model: z.string().optional(),
  label: z.string().optional(),
  state: z.enum(["working", "waiting", "idle"]).optional(),
  branch: z.string().optional(),
  checkout: z.string(),
  /** The first prompt and the last update, in milliseconds. */
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
  changes: z.object({ files: count, additions: count, deletions: count }),
  checks: z.array(attemptCheckSchema),
  lastMessage: z.string().optional(),
  /** Why Med could not read its changes, such as a missing worktree. */
  problem: z.string().optional(),
});
export type Attempt = z.infer<typeof attemptSchema>;

export const attemptFileChangeSchema = z.object({
  status: z.enum(["added", "modified", "deleted", "renamed"]),
  previousPath: z.string().optional(),
  additions: count,
  deletions: count,
  /** The file's diff against the shared base; left out when it is too large or binary. */
  patch: z.string().optional(),
  binary: z.boolean().optional(),
  tooLarge: z.boolean().optional(),
});
export type AttemptFileChange = z.infer<typeof attemptFileChangeSchema>;

export const attemptFileSchema = z.object({
  path: z.string(),
  /** One entry for each attempt, in the order of `attempts`; null where it did not change the file. */
  changes: z.array(attemptFileChangeSchema.nullable()),
});
export type AttemptFile = z.infer<typeof attemptFileSchema>;

export const attemptCompareSchema = z.object({
  group: z.string(),
  title: z.string(),
  repository: z.object({ id: z.string(), name: z.string(), path: z.string() }).optional(),
  /** The commit that the attempts started from, and a branch that points at it. */
  base: z.object({ sha: z.string(), branch: z.string().optional() }).optional(),
  /** The attempts that are not archived, by letter. */
  attempts: z.array(attemptSchema),
  /** Files that more attempts changed come first. */
  files: z.array(attemptFileSchema),
  /** Changed files that the page leaves out. */
  moreFiles: count.optional(),
  /** The attempt that the reader kept, while Undo can still bring back the others. */
  kept: z.object({ threadId: z.string(), attempt: z.number().int() }).optional(),
});
export type AttemptCompare = z.infer<typeof attemptCompareSchema>;

export const attemptKeptSchema = z.object({
  group: z.string(),
  threadId: z.string(),
  attempt: z.number().int(),
  title: z.string(),
  archived: z.array(
    z.object({
      threadId: z.string(),
      attempt: z.number().int(),
      /** Med removed its worktree, after it saved the work as a commit on its branch. */
      removed: z.boolean(),
      /** Med stopped its agent. */
      stopped: z.boolean(),
    }),
  ),
  /** What stayed, and why, such as a worktree that Git kept. */
  notes: z.array(z.string()),
});
export type AttemptKept = z.infer<typeof attemptKeptSchema>;

export const attemptUndoSchema = z.object({ restored: z.array(z.string()) });
export type AttemptUndo = z.infer<typeof attemptUndoSchema>;

const threadIdSchema = z.string().regex(/^r_[a-f0-9]{24}$/);

export const attemptRoutes = {
  compare: {
    method: "GET",
    path: "/api/attempts",
    input: z.object({ group: attemptGroupIdSchema }),
    output: attemptCompareSchema,
  },
  keep: {
    method: "POST",
    path: "/api/attempts/keep",
    input: z.object({ group: attemptGroupIdSchema, threadId: threadIdSchema }),
    output: attemptKeptSchema,
  },
  undo: {
    method: "POST",
    path: "/api/attempts/undo",
    input: z.object({ group: attemptGroupIdSchema }),
    output: attemptUndoSchema,
  },
} as const satisfies Record<string, RouteContract>;

/** A model as people name it: claude-opus-5-5 is "Opus 5.5". Other names stay. */
export function modelName(model: string) {
  const claude = /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(model);
  const family = claude?.[1] ?? /^(opus|sonnet|haiku)$/.exec(model)?.[1];
  if (!family) return model;
  const name = family[0]!.toUpperCase() + family.slice(1);
  return claude ? `${name} ${claude[2]}${claude[3] ? `.${claude[3]}` : ""}` : name;
}
