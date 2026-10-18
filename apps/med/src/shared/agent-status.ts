import { z } from "zod";

/**
 * A check that finished in a turn (src/host/session-checks.ts): the last run
 * of a test, type check, linter, or build, such as `bun test`.
 */
export const turnCheckSchema = z.object({
  /** The program and its check, without a runner: "bun test", "tsc". */
  name: z.string().max(80),
  status: z.enum(["passed", "failed"]),
  /** Test counts, when the check's output tells them. */
  pass: z.number().int().nonnegative().optional(),
  fail: z.number().int().nonnegative().optional(),
});
export type TurnCheck = z.infer<typeof turnCheckSchema>;

/**
 * What the tail of a session's transcript says about its last turn
 * (src/host/thread-turns.ts): when it started and ended, what the agent does
 * now, what it said last, and the checks that it ran. The thread list shows
 * it, and the turn recap at the end of the session thread.
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
  /** The checks that finished in the turn, the last run of each. */
  checks: z.array(turnCheckSchema).max(6).optional(),
});
export type ThreadTurn = z.infer<typeof threadTurnSchema>;

/** What stopped a session's work until the reader acts: a turn that a
 * restart cut, an agent that exited, a login that the agent needs, or an
 * agent that keeps stopping. The Elements page's Agent states draw each. */
export const sessionHaltSchema = z.object({
  kind: z.enum(["interrupted", "stopped", "login", "crashing"]),
  /** The reason in a few words, such as "Exited with code 1". */
  detail: z.string().max(200).optional(),
});
export type SessionHalt = z.infer<typeof sessionHaltSchema>;

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
  halt: sessionHaltSchema.optional(),
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;
