import { z } from "zod";
import { agentStatusSchema } from "./agent-status";

/**
 * A thread: one task with its agent sessions and its changes. Each saved
 * review is a thread; the window's thread list shows every one the host keeps.
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
  branch: z.string().optional(),
  /** The lead session's agent and state, when the thread has a session. */
  agent: agentStatusSchema.shape.agent.optional(),
  state: agentStatusSchema.shape.state.optional(),
  changes: z
    .object({
      files: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    })
    .optional(),
  pullRequestUrl: z.string().optional(),
});
export type Thread = z.infer<typeof threadSchema>;

export const threadListSchema = z.object({
  threads: z.array(threadSchema),
  repositories: z.array(z.object({ id: z.string(), name: z.string(), path: z.string() })),
});
export type ThreadList = z.infer<typeof threadListSchema>;
