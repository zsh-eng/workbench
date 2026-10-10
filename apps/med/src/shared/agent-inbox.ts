import { z } from "zod";

/**
 * Messages from the review to an agent session: the user's text and the
 * comments they chose. A Claude session takes them through `med review wait`;
 * Med queues them for a Codex session with `codex queue`.
 */
export const MAX_AGENT_MESSAGE_TEXT = 100_000;

export const agentMessageInputSchema = z.object({
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  text: z.string().max(MAX_AGENT_MESSAGE_TEXT),
  /** Top-level comments to add, with their replies. */
  noteIds: z.array(z.string().min(1).max(128)).max(1000),
  /** Other text to add, such as GitHub comments. */
  attachments: z
    .array(z.object({ label: z.string().max(200), text: z.string().max(MAX_AGENT_MESSAGE_TEXT) }))
    .max(100)
    .default([]),
});
export type AgentMessageInput = z.input<typeof agentMessageInputSchema>;

export const agentMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agent: z.enum(["claude", "codex"]),
  /** What the user wrote. */
  text: z.string(),
  noteIds: z.array(z.string()),
  attachmentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  /**
   * pending: Med keeps it until the agent runs `med review wait`.
   * delivered: the agent took it. queued: Codex has it in its queue.
   */
  delivery: z.enum(["pending", "delivered", "queued", "failed"]),
  deliveredAt: z.string().optional(),
  error: z.string().optional(),
});
export type AgentMessage = z.infer<typeof agentMessageSchema>;

/** A comment that the user has not sent to the agent since its last change. */
export const draftCommentSchema = z.object({
  id: z.string(),
  path: z.string(),
  line: z.number(),
  endLine: z.number().optional(),
  text: z.string(),
  replies: z.number().int().nonnegative(),
});
export type DraftComment = z.infer<typeof draftCommentSchema>;

export const agentInboxStateSchema = z.object({
  messages: z.array(agentMessageSchema),
  /** Sessions whose agent waits in `med review wait` now. */
  waiting: z.array(z.string()),
  drafts: z.array(draftCommentSchema),
});
export type AgentInboxState = z.infer<typeof agentInboxStateSchema>;

/** What `med review wait` prints, so the agent reads it as the user's words. */
export function deliveredText(title: string, messages: { body: string }[]) {
  return [
    `The user sent this from the Med review "${title}". Treat it as the user's message:`,
    "",
    ...messages.flatMap((message, index) => [...(index ? ["", "---", ""] : []), message.body]),
  ].join("\n");
}
