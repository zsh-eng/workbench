import { z } from "zod";

/**
 * Messages from the review to an agent session: the user's text and the
 * comments they chose. A Claude session that Med runs, or resumes because no
 * process runs it, gets them as its next prompt; one that another process
 * runs takes them through `med review wait`, or gets them when that process
 * ends. Med queues them for a Codex session with `codex queue`.
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
  /** The client's ID for the message, so its own copy and Med's are one row,
   * and sending it again does not send it twice. */
  id: z.string().uuid().optional(),
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

/** A comment as it read when the user sent it. */
export const sentCommentSchema = z.object({
  /** A file, or "Notes" for a comment on a passage of the Notes. */
  path: z.string(),
  line: z.number().optional(),
  endLine: z.number().optional(),
  /** The passage of the Notes. */
  quote: z.string().optional(),
  text: z.string(),
});
export type SentComment = z.infer<typeof sentCommentSchema>;

export const agentMessageSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  agent: z.enum(["claude", "codex", "acp"]),
  /** What the user wrote. */
  text: z.string(),
  noteIds: z.array(z.string()),
  /** The comments, so the thread can show what was sent. */
  comments: z.array(sentCommentSchema).optional(),
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
  /**
   * Claude sessions that another process runs, such as Claude Code in a
   * terminal, and that do not take messages with `med review wait`. Med
   * cannot type there: a message waits until that process ends, and
   * Continue in Med forks the session.
   */
  elsewhere: z.array(z.string()).default([]),
  /** Claude sessions that no process runs: a message resumes the session,
   * which Med then runs. */
  resumable: z.array(z.string()).default([]),
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
