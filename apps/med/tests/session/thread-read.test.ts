import { expect, test } from "vitest";
import type { SessionEvent } from "../../src/shared/agent-session";
import { readEnough, readTurns, threadText } from "../../src/host/thread-read";

const at = Date.UTC(2026, 10, 25, 6, 0);
let next = 0;
const event = (update: Record<string, unknown>): SessionEvent =>
  ({ at: at + next++ * 60_000, update }) as unknown as SessionEvent;
const prompt = (text: string) =>
  event({ sessionUpdate: "user_message_chunk", content: { type: "text", text } });
const reply = (text: string, messageId?: string) =>
  event({ sessionUpdate: "agent_message_chunk", messageId, content: { type: "text", text } });
const tool = (title: string, meta?: unknown) =>
  event({ sessionUpdate: "tool_call", toolCallId: title, title, ...(meta ? { _meta: meta } : {}) });

test("a thread reads as turns: the prompt, its tools, and its replies, without machine text or subagents", () => {
  const turns = readTurns([
    prompt("<system-reminder>Not the user's.</system-reminder>"),
    prompt("Explain the tides."),
    prompt("And the moon."),
    tool("Read README.md"),
    tool("Grep moon", { med: { parentToolCallId: "Task" } }),
    reply("The tide ", "m1"),
    reply("follows the moon.", "m1"),
    event({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "Hmm." } }),
    reply("Done.", "m2"),
    prompt("<quote>follows the moon</quote> Why?"),
    event({ sessionUpdate: "compaction_update", status: "completed" }),
  ]);
  expect(
    turns.map(({ prompt, replies, tools, compacted }) => ({ prompt, replies, tools, compacted })),
  ).toEqual([
    {
      prompt: "Explain the tides.\n\nAnd the moon.",
      replies: ["The tide follows the moon.", "Done."],
      tools: ["Read README.md"],
      compacted: false,
    },
    { prompt: "<quote>follows the moon</quote> Why?", replies: [], tools: [], compacted: true },
  ]);
});

test("the text says what it left out and how to read more", () => {
  const turns = Array.from({ length: 3 }, (_, index) => ({
    at,
    prompt: `Prompt ${index + 1}`,
    replies: [index === 0 ? "x".repeat(45_000) : `Reply ${index + 1}`],
    tools: Array.from({ length: index === 2 ? 14 : 0 }, (_, tool) => `Tool ${tool + 1}`),
    compacted: false,
  }));
  const thread = { title: "Tides", agent: "Codex", cwd: "/repo", command: "med thread read t1" };
  const text = threadText(turns, thread);
  // The first turn is past the budget: the newest two fit.
  expect(text.split("\n\n").slice(0, 2)).toEqual([
    "# Tides",
    "A Codex session in /repo: its last 2 turns. `med thread read t1 --all` prints every turn, and `--last <n>` the last n.",
  ]);
  expect(text).not.toContain("Prompt 1");
  expect(text).toContain("Tools: Tool 1 · Tool 2");
  expect(text).toContain("Tool 12 · and 2 more");
  expect(threadText(turns, thread, { all: true })).toContain("A Codex session in /repo, 3 turns.");
  expect(threadText(turns, thread, { last: 1 })).toContain("its last 1 turn.");
  // Turns from a transcript's end that did not reach its start say so too.
  expect(threadText(turns.slice(1), thread, { all: true }, false)).toContain("its last 2 turns.");
  expect(threadText([], thread)).toContain("It has no prompts yet.");
});

test("a transcript's end is enough once it holds a turn more than the text prints", () => {
  const events = [prompt("One"), reply("A"), prompt("Two"), reply("B")];
  expect(readEnough(events, { last: 1 })).toBe(true);
  expect(readEnough(events, { last: 2 })).toBe(false);
  expect(readEnough(events, { all: true })).toBe(false);
  expect(readEnough(events, {})).toBe(false);
});
