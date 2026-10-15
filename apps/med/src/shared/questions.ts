import { z } from "zod";
import type { RouteContract } from "./routes";

/**
 * A question about lines of a review, for the thread's agent. The answer goes
 * to the reader only: the agent's thread gets nothing, because a question is
 * not an instruction. Claude Code answers in a fork of the lead session, with
 * its context; Codex answers in a fork when `codex exec fork` is installed,
 * else from the excerpt only.
 */

/** Lines in a selection, at most. */
export const MAX_QUESTION_LINES = 400;

/** The lines that a question is about: one side of one file in the review. */
export const questionExcerptSchema = z.object({
  path: z.string().min(1).max(4096),
  side: z.enum(["old", "new"]),
  start: z.number().int().positive(),
  end: z.number().int().positive(),
  /** The lines that the review shows; `mark` is + or - for a changed line. */
  lines: z
    .array(
      z.object({
        number: z.number().int().positive(),
        mark: z.enum([" ", "+", "-"]),
        text: z.string().max(4000),
      }),
    )
    .max(MAX_QUESTION_LINES),
});
export type QuestionExcerpt = z.infer<typeof questionExcerptSchema>;

export const questionAskSchema = z.object({
  /** A saved thread's ID, or a found thread's (`found-claude-…`). */
  thread: z.string().min(1).max(200),
  question: z.string().trim().min(1).max(8000),
  excerpt: questionExcerptSchema,
});
export type QuestionAsk = z.infer<typeof questionAskSchema>;

export const questionStateSchema = z.object({
  id: z.string(),
  agent: z.enum(["claude", "codex"]),
  /** `thread`: a fork of the lead session, which has the thread's context.
   * `excerpt`: a new read-only session with the question and the excerpt only. */
  context: z.enum(["thread", "excerpt"]),
  status: z.enum(["starting", "answering", "done", "stopped", "failed"]),
  answer: z.string(),
  /** What the agent does now, such as a file that it reads. */
  activity: z.string().optional(),
  error: z.string().optional(),
});
export type QuestionState = z.infer<typeof questionStateSchema>;

const idSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) });

export const questionRoutes = {
  /** Starts the agent on a question; the answer streams from
   * `GET /api/questions/:id/events` as `state` events. */
  ask: {
    method: "POST",
    path: "/api/questions",
    input: questionAskSchema,
    output: questionStateSchema,
  },
  /** Ends the agent's process; the answer so far stays. */
  stop: {
    method: "POST",
    path: "/api/questions/stop",
    input: idSchema,
    output: questionStateSchema,
  },
  /** Discards the question: Med keeps no record of it. */
  close: {
    method: "POST",
    path: "/api/questions/close",
    input: idSchema,
    output: z.object({ closed: z.boolean() }),
  },
} satisfies Record<string, RouteContract>;

/** A fence longer than any run of backticks in the text. */
function fence(text: string) {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(longest + 1);
}

/**
 * The user's message to the agent: the question, then the excerpt with its
 * path and line numbers. Med adds nothing else.
 */
export function questionPrompt(question: string, excerpt: QuestionExcerpt) {
  const range =
    excerpt.start === excerpt.end
      ? `line ${excerpt.start}`
      : `lines ${excerpt.start}–${excerpt.end}`;
  const version = excerpt.side === "old" ? "before the change" : "after the change";
  const width = String(Math.max(0, ...excerpt.lines.map((line) => line.number))).length;
  const body = excerpt.lines
    .map((line) => `${String(line.number).padStart(width)} ${line.mark} ${line.text}`.trimEnd())
    .join("\n");
  const marks = fence(body);
  return `${question.trim()}\n\n${excerpt.path}, ${range} ${version}:\n\n${marks}\n${body}\n${marks}\n`;
}

/** A question and its answer as a review comment, within the comment limit. */
export function questionComment(question: string, agent: string, answer: string, limit = 16_000) {
  const head = `Question: ${question.trim()}\n\n${agent}: `;
  const body = answer.trim();
  const encoder = new TextEncoder();
  if (encoder.encode(head + body).length <= limit) return head + body;
  // Cut by characters until the UTF-8 bytes fit, and say so.
  const tail = "\n\n(The answer was longer; Med kept its start.)";
  let cut = Math.max(0, limit - encoder.encode(head + tail).length);
  let text = body.slice(0, cut);
  while (encoder.encode(head + text + tail).length > limit) {
    cut = Math.floor(cut * 0.95);
    text = body.slice(0, cut);
  }
  return head + text.trimEnd() + tail;
}
