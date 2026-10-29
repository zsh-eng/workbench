#!/usr/bin/env node
// A stand-in for `codex app-server` that replays a recorded session
// (codex-app-server.jsonl, from Codex 0.160 with a throwaway prompt). Each
// request from Med plays what Codex answered to the same request in the
// recording, in order; an approval request waits for Med's answer, which
// plays what followed it. Like Codex, it writes the thread's rollout in
// $MED_HOME_DIR/.codex/sessions, with a child rollout for the subagent.
// Unknown requests get an error. It answers `model/list` and `thread/resume`
// on their own, so a resumed thread works too.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

if (process.argv[2] !== "app-server") process.exit(2);
const recorded = readFileSync(
  fileURLToPath(new URL("codex-app-server.jsonl", import.meta.url)),
  "utf8",
)
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

// What Codex wrote after each of Med's lines, until Med's next line.
const segments = new Map();
for (let index = 0; index < recorded.length; index++) {
  const entry = recorded[index];
  if (entry.dir !== "in") continue;
  const key = entry.line.method ?? `answer:${entry.line.id}`;
  const lines = [];
  for (let next = index + 1; next < recorded.length && recorded[next].dir !== "in"; next++)
    lines.push(recorded[next].line);
  if (!segments.has(key)) segments.set(key, []);
  segments.get(key).push({ id: entry.line.id, lines });
}
const main = recorded.find((entry) => entry.line.result?.thread)?.line.result.thread.id;
let cwd = "/work/scratch";
const home = process.env.MED_HOME_DIR;
const day = new Date();
const folder = join(
  home,
  ".codex",
  "sessions",
  String(day.getFullYear()),
  String(day.getMonth() + 1).padStart(2, "0"),
  String(day.getDate()).padStart(2, "0"),
);
const rollout = (thread) => join(folder, `rollout-2026-10-30T05-54-31-${thread}.jsonl`);
const record = (thread, type, payload) =>
  appendFileSync(
    rollout(thread),
    `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`,
  );

/** What Codex writes to the rollout for a notification. */
function persist(method, params) {
  const thread = params?.threadId;
  if (!thread) return;
  const item = params.item;
  if (method === "turn/started" && thread === main)
    record(thread, "event_msg", { type: "task_started" });
  if (method === "turn/completed" && thread === main)
    record(
      thread,
      "event_msg",
      params.turn.status === "interrupted"
        ? { type: "turn_aborted", reason: "interrupted" }
        : { type: "task_complete" },
    );
  if (method === "thread/tokenUsage/updated" && thread === main) {
    const usage = params.tokenUsage;
    const tokens = (part) => ({
      input_tokens: part.inputTokens,
      cached_input_tokens: part.cachedInputTokens,
      output_tokens: part.outputTokens,
      total_tokens: part.totalTokens,
    });
    record(thread, "event_msg", {
      type: "token_count",
      info: {
        total_token_usage: tokens(usage.total),
        last_token_usage: tokens(usage.last),
        model_context_window: usage.modelContextWindow,
      },
    });
  }
  if (method === "item/started" && item?.type === "subAgentActivity" && item.kind === "started") {
    record(thread, "response_item", {
      type: "function_call",
      name: "spawn_agent",
      namespace: "collaboration",
      arguments: JSON.stringify({ task_name: item.agentPath.split("/").at(-1) }),
      call_id: item.id,
    });
    record(item.agentThreadId, "session_meta", {
      id: item.agentThreadId,
      cwd,
      source: {
        subagent: { thread_spawn: { parent_thread_id: thread, agent_path: item.agentPath } },
      },
    });
  }
  if (method !== "item/completed" || !item) return;
  if (item.type === "subAgentActivity" && item.kind === "started")
    record(thread, "event_msg", {
      type: "item_completed",
      item: {
        type: "SubAgentActivity",
        id: item.id,
        kind: "started",
        agent_thread_id: item.agentThreadId,
        agent_path: item.agentPath,
      },
    });
  if (item.type === "userMessage" || item.type === "agentMessage")
    record(thread, "response_item", {
      type: "message",
      role: item.type === "userMessage" ? "user" : "assistant",
      content: [
        item.type === "userMessage"
          ? { type: "input_text", text: item.content.map((part) => part.text ?? "").join("") }
          : { type: "output_text", text: item.text },
      ],
    });
}

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
let asked = 0;
/** The recorded IDs of the approvals that wait, by the ID that Med sees. */
const approvals = new Map();
let playing = Promise.resolve();
const play = (lines, requestId) =>
  (playing = playing.then(async () => {
    for (const recordedLine of lines) {
      const line = JSON.parse(JSON.stringify(recordedLine).replaceAll("/work/scratch", cwd));
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (line.method === undefined) {
        write({ ...line, id: requestId });
        continue;
      }
      if (line.id !== undefined) {
        // An approval: the rest waits for Med's answer.
        const id = ++asked;
        approvals.set(id, line.id);
        write({ ...line, id });
        return;
      }
      persist(line.method, line.params);
      write(line);
    }
  }));

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (raw) => {
  const message = JSON.parse(raw);
  if (message.method === undefined) {
    const recordedId = approvals.get(message.id);
    approvals.delete(message.id);
    const next = segments.get(`answer:${recordedId}`)?.shift();
    if (next) play(next.lines);
    return;
  }
  if (message.method === "thread/start") {
    cwd = message.params.cwd;
    mkdirSync(folder, { recursive: true });
    record(main, "session_meta", { id: main, cwd, source: "vscode" });
  }
  const next = segments.get(message.method)?.shift();
  if (next) return play(next.lines, message.id);
  if (message.id === undefined) return;
  if (message.method === "thread/resume")
    return write({
      id: message.id,
      result: { thread: { id: message.params.threadId }, model: "gpt-6-luna" },
    });
  if (message.method === "model/list") {
    const models = recorded.find((entry) => entry.line.result?.data)?.line.result;
    return write({ id: message.id, result: models });
  }
  write({
    id: message.id,
    error: { code: -32601, message: `No ${message.method} in the recording` },
  });
});
