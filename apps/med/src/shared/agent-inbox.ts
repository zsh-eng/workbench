import { z } from "zod";

/**
 * Messages from the review to an agent session: the user's text and the
 * comments they chose. A Claude session takes them through `med review wait`;
 * Med queues them for a Codex session with `codex queue`.
 */
export const MAX_AGENT_MESSAGE_TEXT = 100_000;
/** An image's size, as the Claude API takes it: 5 MB. */
export const MAX_PROMPT_IMAGE_BYTES = 5 * 1024 * 1024;
export const PROMPT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;

/** An image in a prompt, in base64, for a session that Med runs. */
export const promptImageSchema = z.object({
  mimeType: z.enum(PROMPT_IMAGE_TYPES),
  data: z
    .string()
    .max(Math.ceil(MAX_PROMPT_IMAGE_BYTES / 3) * 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
});
export type PromptImage = z.infer<typeof promptImageSchema>;

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
  /** Images, for a session that Med runs. */
  images: z.array(promptImageSchema).max(10).default([]),
});
export type AgentMessageInput = z.input<typeof agentMessageInputSchema>;

export const agentMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agent: z.enum(["claude", "codex", "acp"]),
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
  /** A file, or "Notes" for a comment on a passage of the Notes. */
  path: z.string(),
  line: z.number().optional(),
  endLine: z.number().optional(),
  /** The passage of the Notes. */
  quote: z.string().optional(),
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
