import { z } from "zod";

/**
 * Messages from the review to an agent session: the user's text and the
 * comments they chose. A session that Med runs, or resumes because no other
 * process has it open, gets them as its next prompt. Med does not send to a
 * session that another app has open.
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
  /** While the agent that Med runs works: wait for its turn's end, not its
   * next step (queued-messages.ts). */
  afterTurn: z.boolean().optional(),
});
export type AgentMessageInput = z.input<typeof agentMessageInputSchema>;

const inReplyToSchema = z.object({ author: z.string(), text: z.string() });

/** A comment as it read when the user sent it. */
export const sentCommentSchema = z.object({
  /** A file, or "Notes" for a comment on a passage of the Notes. */
  path: z.string(),
  line: z.number().optional(),
  endLine: z.number().optional(),
  /** The passage of the Notes. */
  quote: z.string().optional(),
  /** What the user said last in the comment's thread (comment-thread.ts). */
  text: z.string(),
  /** The agent's answer that the text replies to. */
  inReplyTo: inReplyToSchema.optional(),
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
  /** The version of each comment that the message holds, by ID: the
   * comment's `updatedAt` when Med read it. A later change is a draft. */
  noteVersions: z.record(z.string(), z.string()).optional(),
  attachmentCount: z.number().int().nonnegative(),
  /** The images that went with it. */
  imageCount: z.number().int().positive().optional(),
  createdAt: z.string(),
  /**
   * pending: it waits for the agent that Med runs (queued). delivered: the
   * agent took it. queued: an older Med put it in Codex's queue.
   */
  delivery: z.enum(["pending", "delivered", "queued", "failed"]),
  /** A pending message that came while the agent that Med runs worked. Med
   * gives it at the agent's next step: when Claude Code runs tools, after
   * which it reads the message in the same turn, into Codex's turn
   * (`turn/steer`), or at the turn's end. Until then the user can take it
   * back (`/agent/take`). */
  queued: z.boolean().optional(),
  /** A queued message that waits for the turn's end, not the next step
   * (Queue); Send now (`/agent/send-now`) clears it. */
  afterTurn: z.boolean().optional(),
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
  /** What the user said last in the comment's thread (comment-thread.ts). */
  text: z.string(),
  inReplyTo: inReplyToSchema.optional(),
  replies: z.number().int().nonnegative(),
});
export type DraftComment = z.infer<typeof draftCommentSchema>;

/**
 * Where another process has a Claude session open, by the `entrypoint` of
 * Claude Code's process record: `cli` is a terminal, `claude-desktop` and
 * `claude-desktop-3p` are the Claude app, and the others (an IDE, the SDK, a
 * record without one, or a process found only by its arguments) are another
 * app.
 */
export const sessionPlaceSchema = z.enum(["terminal", "claude-app", "other-app"]);
export type SessionPlace = z.infer<typeof sessionPlaceSchema>;

export const agentInboxStateSchema = z.object({
  messages: z.array(agentMessageSchema),
  /**
   * Sessions that another process has open, such as Claude Code in a
   * terminal or a thread in Codex Desktop, with where each is open. Med
   * cannot type there: the reader sees the thread, copies the comments, or
   * forks the session with Continue in Med.
   */
  elsewhere: z.record(z.string(), sessionPlaceSchema).default({}),
  /** Claude sessions that no process runs: a message resumes the session,
   * which Med then runs. */
  resumable: z.array(z.string()).default([]),
  /** Sessions that Med started, or took over, and runs: a comment goes to
   * one at once, from the comment. */
  owned: z.array(z.string()).default([]),
  /** The saved review's revision: a newer one, as after an agent's reply,
   * has comments that the page reads again. */
  revision: z.number().int().nonnegative().optional(),
  drafts: z.array(draftCommentSchema),
});
export type AgentInboxState = z.infer<typeof agentInboxStateSchema>;
