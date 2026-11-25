import { stat } from "node:fs/promises";
import type { SessionEvent } from "../shared/agent-session";
import type { AgentSession } from "../shared/saved-review";
import { readTranscriptPage } from "./agent-transcripts";

// A thread as text, for another agent (`med thread read`, docs/usage/threads.md):
// the user's prompts, the agent's replies, and one line of each turn's tools.
// It reads the same updates as the thread's view, whatever agent wrote them:
// Claude Code's transcript, Codex's rollout, Pi's session, or Med's file of
// an ACP session. A subagent's work stays in the call that started it, and
// thinking stays out.
//
// Without a choice it prints the newest turns that fit in BUDGET characters,
// at least one, and says how many it left out.

/** About 10,000 tokens. */
const BUDGET = 40_000;
/** The tool titles that a turn lists before "and N more". */
const TOOLS = 12;

export interface ReadTurn {
  at: number;
  prompt: string;
  replies: string[];
  tools: string[];
  compacted: boolean;
}

/** Text that is Med's or the agent's, not the user's: a system reminder, a
 * command's echo, a local command's output. A quote is the user's. */
const machine = (text: string) => text.startsWith("<") && !text.startsWith("<quote>");

/** The updates as turns, oldest first. A turn starts at a prompt of the user's. */
export function readTurns(events: readonly SessionEvent[]): ReadTurn[] {
  const turns: ReadTurn[] = [];
  let turn: ReadTurn | undefined;
  let message: { id: string | null | undefined; index: number } | undefined;
  let prompting = false;
  for (const { at, update } of events) {
    if (update._meta?.med?.parentToolCallId) continue;
    switch (update.sessionUpdate) {
      case "user_message_chunk": {
        if (update.content.type !== "text") break;
        const text = update.content.text.trim();
        if (!text || machine(text)) break;
        // The chunks of one prompt come together; a later one starts a turn.
        if (turn && prompting) turn.prompt += `\n\n${text}`;
        else {
          turn = { at, prompt: text, replies: [], tools: [], compacted: false };
          turns.push(turn);
          message = undefined;
        }
        prompting = true;
        break;
      }
      case "agent_message_chunk": {
        if (update.content.type !== "text" || !turn) break;
        prompting = false;
        const id = update.messageId;
        if (message && id && message.id === id) turn.replies[message.index] += update.content.text;
        else message = { id, index: turn.replies.push(update.content.text) - 1 };
        break;
      }
      case "tool_call":
        if (!turn) break;
        prompting = false;
        message = undefined;
        if (update.title) turn.tools.push(update.title.split("\n")[0]!.trim());
        break;
      case "compaction_update":
        if (turn && update.status === "completed") turn.compacted = true;
        break;
      default:
        break;
    }
  }
  return turns;
}

const pad = (value: number) => String(value).padStart(2, "0");
/** A time as 2026-11-25 14:02, the Mac's. */
const when = (at: number) => {
  const date = new Date(at);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function turnText(turn: ReadTurn, agent: string) {
  const parts = [`## You · ${when(turn.at)}`, turn.prompt];
  const replies = turn.replies.map((reply) => reply.trim()).filter(Boolean);
  if (replies.length || turn.tools.length || turn.compacted) parts.push(`## ${agent}`);
  if (turn.tools.length) {
    const shown = turn.tools.slice(0, TOOLS).map((title) => title.replaceAll("\n", " "));
    const more = turn.tools.length - shown.length;
    parts.push(`Tools: ${shown.join(" · ")}${more > 0 ? ` · and ${more} more` : ""}`);
  }
  if (turn.compacted) parts.push("(The context was compacted here.)");
  parts.push(...replies);
  return parts.join("\n\n");
}

export interface ReadChoice {
  /** The last this many turns, whatever their length. */
  last?: number;
  /** Every turn. */
  all?: boolean;
}

/**
 * The thread as Markdown: a heading, a line that says what it is, and its
 * turns. `command` is how to read more, such as `med thread read <id>`.
 */
export function threadText(
  turns: readonly ReadTurn[],
  thread: { title: string; agent: string; cwd?: string; command: string },
  choice: ReadChoice = {},
  /** The turns start at the session's start; else earlier ones were not read. */
  complete = true,
) {
  const texts = turns.map((turn) => turnText(turn, thread.agent));
  let from = 0;
  if (choice.last !== undefined) from = Math.max(0, texts.length - choice.last);
  else if (!choice.all) {
    let size = 0;
    from = texts.length;
    while (from > 0 && (from === texts.length || size + texts[from - 1]!.length <= BUDGET))
      size += texts[--from]!.length;
  }
  const where = thread.cwd ? ` in ${thread.cwd}` : "";
  const shown = texts.length - from;
  const count = `${shown} ${shown === 1 ? "turn" : "turns"}`;
  const partial = from > 0 || !complete;
  const head = [
    `# ${thread.title}`,
    partial
      ? `A ${thread.agent} session${where}: its last ${count}. \`${thread.command} --all\` prints every turn, and \`--last <n>\` the last n.`
      : `A ${thread.agent} session${where}, ${count}.`,
  ];
  if (!turns.length) head.push("It has no prompts yet.");
  return `${[...head, ...texts.slice(from)].join("\n\n")}\n`;
}

/** A transcript's updates, oldest first, read from its end in pages until
 * `enough` says the turns suffice. */
export async function transcriptEvents(
  session: Pick<AgentSession, "agent" | "id">,
  path: string,
  enough: (events: SessionEvent[]) => boolean = () => false,
) {
  const pages: SessionEvent[][] = [];
  let before = (await stat(path)).size;
  while (before > 0) {
    const page = await readTranscriptPage(session, path, before);
    pages.unshift(page.events);
    if (page.start >= before) break;
    before = page.start;
    if (enough(pages.flat())) break;
  }
  return { events: pages.flat(), complete: before <= 0 };
}

/** Whether the updates hold more than the turns that the choice prints: the
 * turn before them starts a turn of its own. */
export function readEnough(events: SessionEvent[], choice: ReadChoice) {
  if (choice.all) return false;
  const turns = readTurns(events);
  if (choice.last !== undefined) return turns.length > choice.last;
  let size = 0;
  for (const turn of [...turns].reverse()) {
    size += turnText(turn, "").length;
    if (size > BUDGET) return true;
  }
  return false;
}
