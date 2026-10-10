import { z } from "zod";

/**
 * The state of a saved review's lead session, for the workspace list:
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
});
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export const agentStatusesSchema = z.object({ statuses: z.array(agentStatusSchema) });
