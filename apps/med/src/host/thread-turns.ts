import type { SessionEvent, SessionUpdate } from "../shared/agent-session";
import type { ThreadTurn } from "../shared/agent-status";
import { turnChecks } from "./session-checks";

// The thread list tells three things of each thread: what does its agent do now,
// what did it say last, and did its turn end on a question to the user. The
// host already reads the tail of each transcript to know whether a turn is
// open (agent-status.ts, found-sessions.ts); this module reads the same
// updates once more, in memory.
//
// The rules are simple on purpose:
//
// - Activity: the newest tool call without a result, as a present
//   participle ("Editing README.md", "Running bun test"); else "Thinking".
//   A command shows as the command, without a leading `cd <dir> &&`.
// - Said: the last paragraph of the agent's last message in the turn, as
//   plain text. A longer one keeps its end, where a question usually is.
// - Asks: the turn ended, and the last paragraph of its last message, without
//   code, ends with a question mark. When that paragraph is a list of
//   choices, the paragraph before it counts. A turn that waits on Claude
//   Code's AskUserQuestion tool asks too.
// - Checks: the tests, type checks, linters, and builds that finished in the
//   turn, the last run of each (session-checks.ts). A subagent's do not count.

const MAX_SAID = 280;
const MAX_COMMAND = 72;

type ToolCall = Extract<SessionUpdate, { sessionUpdate: "tool_call" }>;

/** Tool titles start with a verb; the activity uses its present participle. */
const PARTICIPLES: Record<string, string> = {
  Read: "Reading",
  Edit: "Editing",
  Write: "Writing",
  Search: "Searching",
  Find: "Finding",
  Fetch: "Fetching",
  Run: "Running",
  Use: "Using",
  Ask: "Asking",
  Update: "Updating",
  Add: "Adding",
  Mark: "Marking",
  Stop: "Stopping",
  Send: "Sending",
  View: "Viewing",
};

const cut = (text: string, limit: number) =>
  text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;

/** A command's first line, without a leading `cd <dir> &&`. */
function shortCommand(command: string) {
  const line = command.trim().split("\n")[0]!.trim();
  return cut(line.replace(/^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*/, ""), MAX_COMMAND);
}

/** What a running tool call does, in a few words. */
export function toolActivity(tool: Pick<ToolCall, "title" | "rawInput">) {
  const input = tool.rawInput as { command?: unknown } | undefined;
  if (typeof input?.command === "string" && input.command.trim())
    return `Running ${shortCommand(input.command)}`;
  const title = tool.title.trim();
  const space = title.indexOf(" ");
  const verb = space < 0 ? title : title.slice(0, space);
  const participle = PARTICIPLES[verb];
  return cut(participle ? `${participle}${title.slice(verb.length)}` : title, 120);
}

/** Markdown to one line of plain text: no emphasis, code marks, or link targets. */
function plain(markdown: string) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|\s)[*_]([^*_\n]+)[*_](?=\s|[.,;:!?]|$)/g, "$1$2")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

const paragraphsOf = (text: string) =>
  text
    .replace(/```[\s\S]*?(?:```|$)/g, "\n\n")
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

const isList = (paragraph: string) =>
  paragraph.split("\n").every((line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line));

/** The paragraph that a turn's last message ends on: a list of choices
 * counts with the question before it. */
function lastParagraphs(text: string) {
  const paragraphs = paragraphsOf(text);
  const last = paragraphs.at(-1);
  if (!last) return [];
  return isList(last) && paragraphs.length > 1 ? paragraphs.slice(-2) : [last];
}

/** Whether a turn's last message asks the user something (the rule above). */
export function asksUser(text: string) {
  const [first, list] = lastParagraphs(text);
  if (!first) return false;
  // Inline code can end with a question mark, as in `a?.b`; it never asks.
  const ends = (paragraph: string) =>
    /\?["'”’)*_]*$/.test(paragraph.replace(/`[^`\n]*`/g, "code").trim());
  return list ? ends(first) || ends(list) : ends(first);
}

/** The last paragraph of a message, as plain text; a long one keeps its end. */
export function lastSaid(text: string) {
  const said = plain(lastParagraphs(text).join("\n"));
  if (said.length <= MAX_SAID) return said || undefined;
  const end = said.slice(-MAX_SAID);
  // Start at a sentence where one starts near the cut.
  const sentence = /[.!?]\s+(?=\S)/.exec(end.slice(0, 120));
  return `…${sentence ? end.slice(sentence.index + sentence[0].length) : end.replace(/^\S*\s/, "")}`;
}

/**
 * The state of a session's last turn from the updates in its transcript's
 * tail, oldest first, and whether the transcript says the turn ended.
 */
export function summarizeTurn(events: readonly SessionEvent[], idle: boolean): ThreadTurn {
  let startedAt: number | undefined;
  let lastAt: number | undefined;
  let message: { id: string | null | undefined; text: string } | undefined;
  const open = new Map<string, ToolCall>();
  // The turn's own updates, for its checks.
  let own: SessionEvent[] = [];
  for (const event of events) {
    const { at, update } = event;
    // A subagent's updates belong to its call.
    if (update._meta?.med?.parentToolCallId) continue;
    lastAt = at;
    own.push(event);
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        const text = update.content.type === "text" ? update.content.text.trim() : "";
        // A message queued while the agent works does not start a turn.
        if (!text || text.startsWith("<") || update._meta?.med?.queued) break;
        startedAt = at;
        message = undefined;
        open.clear();
        own = [event];
        break;
      }
      case "agent_message_chunk": {
        if (update.content.type !== "text") break;
        const id = update.messageId;
        message =
          message && id && message.id === id
            ? { id, text: message.text + update.content.text }
            : { id, text: update.content.text };
        break;
      }
      case "tool_call":
        open.set(update.toolCallId, update);
        break;
      case "tool_call_update":
        // A background shell or agent returns at once; the turn goes on.
        if (
          update.status === "completed" ||
          update.status === "failed" ||
          update._meta?.med?.background
        )
          open.delete(update.toolCallId);
        break;
      default:
        break;
    }
  }
  const turn: ThreadTurn = {};
  if (startedAt !== undefined) turn.startedAt = startedAt;
  const said = message ? lastSaid(message.text) : undefined;
  if (said) turn.said = said;
  const checks = turnChecks(own);
  if (checks.length) turn.checks = checks;
  if (idle) {
    if (lastAt !== undefined) turn.endedAt = lastAt;
    if (message && asksUser(message.text)) turn.asks = true;
    return turn;
  }
  const running = [...open.values()];
  const question = running.find((tool) => tool._meta?.med?.tool === "AskUserQuestion");
  if (question) {
    turn.asks = true;
    turn.activity = "Asks you a question";
    const input = question.rawInput as { questions?: { question?: unknown }[] } | undefined;
    const asked = input?.questions?.[0]?.question;
    if (typeof asked === "string" && asked.trim()) turn.said = cut(plain(asked), MAX_SAID);
    return turn;
  }
  const newest = running.at(-1);
  turn.activity = newest ? toolActivity(newest) : "Thinking";
  return turn;
}
