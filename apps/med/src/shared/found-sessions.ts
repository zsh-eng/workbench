import { z } from "zod";

/**
 * Agent sessions that Med finds by itself: Claude Code and Codex sessions in
 * a registered repository or one of its worktrees, which no saved review
 * names. The thread list shows each one as a thread with `found: true`.
 */
export type FoundAgent = "claude" | "codex";

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
