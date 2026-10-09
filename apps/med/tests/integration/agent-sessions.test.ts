import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import {
  createClaudeTranscriptReader,
  readClaudeTranscript,
} from "../../src/shared/agent-session-claude";
import { readCodexRollout } from "../../src/shared/agent-session-codex";
import { createSessionStore, type SessionItem } from "../../src/web/data/session-store";

const fixture = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const claude = fixture("../../src/web/components/elements/session-fixture.jsonl");

function thread(events: Parameters<ReturnType<typeof createSessionStore>["applyAll"]>[0]) {
  const store = createSessionStore();
  store.applyAll(events);
  return store.getSnapshot();
}
const tools = (items: SessionItem[]) => items.filter((item) => item.kind === "tool");
const text = (item: SessionItem | undefined) =>
  item?.kind === "agent"
    ? item.text
    : item?.kind === "user" && item.content[0]?.type === "text"
      ? item.content[0].text
      : "";

describe("Claude Code transcripts", () => {
  test("a recorded session becomes a thread of messages, tool calls, and diffs", () => {
    const session = thread(readClaudeTranscript(claude));
    expect(text(session.items[0])).toMatch(/^The weekly summary prints raw milliseconds/);
    expect(text(session.items.at(-1))).toMatch(/^The weekly summary now shows best times/);
    expect(session.toolCalls).toBe(13);
    // Reminders and tool lists that the agent read do not show.
    expect(JSON.stringify(session.items)).not.toContain("system-reminder");

    const calls = tools(session.items);
    const missing = calls.filter((item) => item.kind === "tool" && item.call.status === "failed");
    expect(missing.map((item) => item.kind === "tool" && item.call.title)).toEqual([
      "Find **/*",
      "Search “\\b(ms|millis|milliseconds|duration)\\b”",
    ]);
    const write = calls.find(
      (item) => item.kind === "tool" && item.call.title === "Write src/duration.ts",
    );
    expect(write?.kind === "tool" && write.call.content[0]).toMatchObject({
      type: "diff",
      oldText: null,
      newText: expect.stringContaining("export function formatDuration(ms: number): string"),
    });
    const edit = calls.find(
      (item) => item.kind === "tool" && item.call.title === "Edit src/summary.ts",
    );
    expect(edit?.kind === "tool" && edit.call.content).toEqual([
      expect.objectContaining({ type: "diff", _meta: { med: { excerpt: true } } }),
    ]);
  });

  test("reading a growing transcript line by line gives the same thread", () => {
    const reader = createClaudeTranscriptReader();
    const store = createSessionStore();
    const idle: boolean[] = [];
    for (const line of claude.split("\n")) {
      for (const event of reader.line(line)) store.apply(event);
      idle.push(reader.idle());
    }
    expect(store.getSnapshot()).toEqual(thread(readClaudeTranscript(claude)));
    // The subagent works from its prompt until its report ends the turn.
    expect(idle.indexOf(true, 1)).toBe(claude.trim().split("\n").length - 2);
  });

  test("background work, subagents, plans, and compaction attach to their calls", () => {
    const at = (second: number) => `2026-10-10T09:00:${String(second).padStart(2, "0")}.000Z`;
    const lines = [
      {
        type: "user",
        timestamp: at(0),
        message: { role: "user", content: "Start the server and check the parser." },
      },
      {
        type: "assistant",
        timestamp: at(1),
        uuid: "a1",
        message: {
          id: "m1",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "plan",
              name: "TodoWrite",
              input: {
                todos: [
                  { content: "Start the server", status: "in_progress" },
                  { content: "Check the parser", status: "pending" },
                ],
              },
            },
          ],
        },
      },
      {
        type: "assistant",
        timestamp: at(2),
        uuid: "a2",
        message: {
          id: "m2",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "server",
              name: "Bash",
              input: {
                command: "bun run dev",
                description: "Start the dev server",
                run_in_background: true,
              },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: at(2),
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "server",
              content: "Command running in background with ID: b1",
            },
          ],
        },
        toolUseResult: { stdout: "", stderr: "", interrupted: false, backgroundTaskId: "b1" },
      },
      {
        type: "assistant",
        timestamp: at(3),
        uuid: "a3",
        message: {
          id: "m3",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "agent",
              name: "Agent",
              input: { description: "Check the parser", prompt: "…", run_in_background: true },
            },
          ],
        },
      },
      {
        type: "user",
        timestamp: at(3),
        message: {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "agent", content: "Async agent launched" }],
        },
        toolUseResult: { isAsync: true, status: "async_launched", agentId: "s1" },
      },
      { type: "system", subtype: "api_error", timestamp: at(4), retryAttempt: 1, maxRetries: 10 },
      {
        type: "user",
        timestamp: at(9),
        message: {
          role: "user",
          content:
            "<task-notification>\n<task-id>b1</task-id>\n<status>failed</status>\n<summary>Port 5173 is in use</summary>\n</task-notification>",
        },
      },
      { type: "system", subtype: "compact_boundary", timestamp: at(10), uuid: "c1" },
      {
        type: "user",
        timestamp: at(10),
        isCompactSummary: true,
        message: {
          role: "user",
          content: "The server failed; the parser check runs in a subagent.",
        },
      },
    ];
    const reader = createClaudeTranscriptReader();
    const events = lines.flatMap((line) => reader.line(JSON.stringify(line)));
    // The subagent's own transcript reads into the call that started it.
    const agent = reader.subagentOf("agent");
    expect(agent).toBe("s1");
    const nested = readClaudeTranscript(
      JSON.stringify({
        type: "assistant",
        timestamp: at(6),
        uuid: "n1",
        message: {
          id: "n1",
          role: "assistant",
          content: [{ type: "text", text: "The parser handles empty input." }],
        },
      }),
      { parentToolCallId: "agent" },
    );
    const session = thread([...events, ...nested].sort((a, b) => a.at - b.at));

    expect(session.plan).toEqual([
      { content: "Start the server", priority: "medium", status: "in_progress" },
      { content: "Check the parser", priority: "medium", status: "pending" },
    ]);
    const server = session.items.find((item) => item.id === "server");
    expect(server?.kind === "tool" && server.call).toMatchObject({
      status: "failed",
      background: { id: "b1", kind: "shell" },
      content: [{ type: "content", content: { type: "text", text: "Port 5173 is in use" } }],
    });
    const subagent = session.items.find((item) => item.id === "agent");
    expect(subagent?.kind === "tool" && subagent.call.status).toBe("in_progress");
    expect(subagent?.kind === "tool" && subagent.items.map(text)).toEqual([
      "The parser handles empty input.",
    ]);
    expect(
      session.items
        .filter((item) => item.kind === "notice")
        .map((item) => item.kind === "notice" && item.title),
    ).toEqual(["The API returned an error"]);
    expect(session.items.at(-1)).toMatchObject({
      kind: "compaction",
      summary: "The server failed; the parser check runs in a subagent.",
    });
  });
});

describe("Codex rollouts", () => {
  test("a rollout becomes the same kind of thread", () => {
    const session = thread(readCodexRollout(fixture("../fixtures/sessions/codex-rollout.jsonl")));
    // Codex repeats messages as events and adds its environment as a user message.
    expect(session.items.filter((item) => item.kind === "user").map(text)).toEqual([
      "The weekly summary prints raw milliseconds. Add formatDuration(ms) and use it in summarize().",
    ]);
    expect(session.items.filter((item) => item.kind === "agent")).toHaveLength(1);
    expect(session.plan.map((entry) => entry.status)).toEqual([
      "in_progress",
      "pending",
      "pending",
    ]);
    expect(session.usage).toEqual({ size: 272000, used: 18000 });

    const calls = tools(session.items).map((item) => item.kind === "tool" && item.call);
    expect(calls.map((call) => call && [call.kind, call.status, call.title])).toEqual([
      ["search", "completed", "rg -n bestTimeMs src"],
      ["read", "completed", "sed -n '1,20p' src/summary.ts"],
      ["edit", "completed", "Edit 2 files"],
      ["execute", "failed", "bun test"],
    ]);
    expect(calls[2] && calls[2].content).toEqual([
      expect.objectContaining({ path: "src/duration.ts", oldText: null }),
      expect.objectContaining({
        path: "src/summary.ts",
        oldText: expect.stringContaining("${trail.bestTimeMs} ms"),
        newText: expect.stringContaining('import { formatDuration } from "./duration";'),
      }),
    ]);
    expect(calls[3] && calls[3].content).toEqual([
      {
        type: "content",
        content: { type: "text", text: "✗ summarizes each trail\n1 fail, 2 pass" },
      },
    ]);
  });
});
