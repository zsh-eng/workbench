import { z } from "zod";

/**
 * What the tail of a session's transcript says about its last turn
 * (src/host/thread-turns.ts): when it started and ended, what the agent does
 * now, and what it said last. The thread list shows it.
 */
export const threadTurnSchema = z.object({
  /** When the turn's prompt came, if the transcript's tail has it. */
  startedAt: z.number().optional(),
  /** When the turn ended; absent while it runs. */
  endedAt: z.number().optional(),
  /** What the agent does now, while the turn runs, such as "Editing README.md". */
  activity: z.string().max(200).optional(),
  /** The last paragraph of the agent's last message, as plain text. */
  said: z.string().max(400).optional(),
  /** The turn ended on a question to the user, or waits on one. */
  asks: z.boolean().optional(),
});
export type ThreadTurn = z.infer<typeof threadTurnSchema>;

/**
 * The state of a saved review's lead session, for the thread list:
 * working, waiting for the user, or idle since `updatedAt`. The lead is the
 * newest session that works or waits, else the newest session.
 */
export const agentStatusSchema = z.object({
  reviewId: z.string(),
  sessionId: z.string(),
  agent: z.enum(["claude", "codex", "acp"]),
  name: z.string().optional(),
  /** waiting: a permission request, or `med review wait`. */
  state: z.enum(["working", "waiting", "idle"]),
  /** The time of the session's last update, in milliseconds. */
  updatedAt: z.number(),
  turn: threadTurnSchema.optional(),
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;
