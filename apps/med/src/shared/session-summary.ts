import { z } from "zod";
import type { SessionEvent, ToolCallContent } from "./agent-session";
import { agentStatusSchema } from "./agent-status";
import { ownedPermissionSchema } from "./owned-session";
import { agentSessionSchema } from "./saved-review";

/** A tool call in a turn, as one line: its kind, its title, and how it went. */
export const sessionStepSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  status: z.enum(["running", "done", "failed"]),
  /** Lines that an edit added and removed. */
  added: z.number().int().nonnegative().optional(),
  removed: z.number().int().nonnegative().optional(),
});
export type SessionStep = z.infer<typeof sessionStepSchema>;

/**
 * What a review's lead session does now, for the Sessions page: its state,
 * the turn's prompt and latest steps, the reply that ended it, and what it
 * waits for. The thread itself streams from the session's own route.
 */
export const sessionSummarySchema = agentStatusSchema.extend({
  /** The review's title. */
  title: z.string(),
  /** The first target's repository folder name and branch. */
  repository: z.string().optional(),
  branch: z.string().optional(),
  /** The repository's path, to open absolute links to its files. */
  root: z.string().optional(),
  /** The review's sessions, for the Session pane. */
  sessions: z.array(agentSessionSchema),
  prompt: z.string().optional(),
  steps: z.array(sessionStepSchema),
  reply: z.string().optional(),
  /** When the turn's prompt arrived, in milliseconds. */
  turnStartedAt: z.number().optional(),
  /** A permission request (sessions that Med runs), or `med review wait`. */
  ask: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("permission"), permission: ownedPermissionSchema }),
      z.object({ kind: z.literal("review") }),
    ])
    .optional(),
  changes: z
    .object({
      files: z.number().int().nonnegative(),
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    })
    .optional(),
});
export type SessionSummary = z.infer<typeof sessionSummarySchema>;
export const sessionSummariesSchema = z.object({ sessions: z.array(sessionSummarySchema) });

/** Steps that a summary keeps: the last ones of the turn. */
const STEPS = 6;
const PROMPT_CHARACTERS = 240;
const REPLY_CHARACTERS = 600;

/** Markdown and markers as plain text, on one line. */
export function plainText(text: string, limit: number) {
  const plain = text
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^\s{0,3}(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/(\*\*|__|`)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > limit ? `${plain.slice(0, limit - 1).trimEnd()}…` : plain;
}

/** Added and removed lines of a diff, by matching equal lines. */
function lineChanges(content: ToolCallContent[] | undefined) {
  let added = 0;
  let removed = 0;
  let diff = false;
  for (const part of content ?? []) {
    if (part.type !== "diff") continue;
    diff = true;
    const before = new Map<string, number>();
    for (const line of (part.oldText ?? "").split("\n").filter(Boolean))
      before.set(line, (before.get(line) ?? 0) + 1);
    for (const line of part.newText.split("\n").filter(Boolean)) {
      const left = before.get(line) ?? 0;
      if (left) before.set(line, left - 1);
      else added++;
    }
    for (const left of before.values()) removed += left;
  }
  return diff ? { added, removed } : {};
}

/**
 * The current turn of a session from its updates: the prompt that started
 * it, its last steps, and its last reply. Subagents' updates stay in their
 * calls, so they are left out.
 */
export function summarizeTurn(events: SessionEvent[]) {
  let prompt = "";
  let turnStartedAt: number | undefined;
  let reply = "";
  let replyId: string | null | undefined;
  let steps = new Map<string, SessionStep>();
  let previous: string | undefined;
  for (const { at, update } of events) {
    if (update._meta?.med?.parentToolCallId) continue;
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        if (update._meta?.med?.queued) break;
        const text = update.content.type === "text" ? update.content.text : "";
        if (previous === "user_message_chunk") prompt += text;
        else {
          prompt = text;
          turnStartedAt = at;
          reply = "";
          replyId = undefined;
          steps = new Map();
        }
        break;
      }
      case "agent_message_chunk": {
        const text = update.content.type === "text" ? update.content.text : "";
        const same =
          previous === "agent_message_chunk" && (update.messageId ?? null) === (replyId ?? null);
        reply = same ? reply + text : text;
        replyId = update.messageId;
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        const known = steps.get(update.toolCallId);
        if (!known && update.sessionUpdate === "tool_call_update") break;
        const status = update.status ?? (known ? undefined : "pending");
        steps.set(update.toolCallId, {
          id: update.toolCallId,
          kind: update.kind ?? known?.kind ?? "other",
          title: update.title || known?.title || "Tool call",
          status: status
            ? status === "completed"
              ? "done"
              : status === "failed"
                ? "failed"
                : "running"
            : known!.status,
          ...(known && { added: known.added, removed: known.removed }),
          ...lineChanges(update.content),
        });
        break;
      }
    }
    previous = update.sessionUpdate;
  }
  const plainPrompt = plainText(prompt, PROMPT_CHARACTERS);
  const plainReply = plainText(reply, REPLY_CHARACTERS);
  return {
    ...(plainPrompt && { prompt: plainPrompt }),
    steps: [...steps.values()].slice(-STEPS),
    ...(plainReply && { reply: plainReply }),
    ...(turnStartedAt !== undefined && { turnStartedAt }),
  };
}
