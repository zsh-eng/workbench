#!/usr/bin/env node
// A stand-in for Pi's RPC mode (`pi --mode rpc`), with the message shapes of
// Pi 0.67: commands and responses by `id`, and events without one. As Pi
// does, it keeps each session in a file under $PI_CODING_AGENT_DIR/sessions
// that it writes once its model has answered, opens one again with
// `--session <file>`, and forgets the model and level of the process before.
// An extension's dialog asks before "Clean" turns run.
// It writes its arguments to $MED_HOME_DIR/pi-runs.jsonl.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const args = process.argv.slice(2);
const home = process.env.MED_HOME_DIR;
appendFileSync(join(home, "pi-runs.jsonl"), `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
if (args[args.indexOf("--mode") + 1] !== "rpc") process.exit(2);

const MODELS = [
  { provider: "openai-codex", id: "gpt-5.4", name: "GPT-5.4", reasoning: true },
  { provider: "openai-codex", id: "gpt-5.4-mini", name: "GPT-5.4 Mini", reasoning: true },
  // A model's ID may hold a slash, as OpenRouter's do; this one does not reason.
  {
    provider: "openrouter",
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    reasoning: false,
  },
];
let model = MODELS[0];
let level = "medium";
/** A "Fill" turn fills the context, until a compaction. */
let filled = false;
const at = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
const root = join(process.env.PI_CODING_AGENT_DIR ?? join(home, ".pi", "agent"), "sessions");
const folder = join(root, `--${process.cwd().replace(/^\//, "").replace(/[/:]/g, "-")}--`);
let file = at("--session");
let id = randomUUID();
let messages = [];
if (file && existsSync(file)) {
  const entries = readFileSync(file, "utf8").split("\n").filter(Boolean).map(JSON.parse);
  id = entries[0].id;
  messages = entries.filter((entry) => entry.type === "message").map((entry) => entry.message);
} else if (!file && !args.includes("--no-session"))
  file = join(folder, `${new Date().toISOString().replace(/[:.]/g, "-")}_${id}.jsonl`);
const keep = (message) => {
  messages.push(message);
  if (!file || !messages.some((entry) => entry.role === "assistant")) return;
  mkdirSync(dirname(file), { recursive: true });
  if (!existsSync(file))
    appendFileSync(
      file,
      [{ type: "session", id, cwd: process.cwd() }, ...messages.slice(0, -1)]
        .map(
          (entry) =>
            `${JSON.stringify(entry.type ? entry : { type: "message", message: entry })}\n`,
        )
        .join(""),
    );
  appendFileSync(file, `${JSON.stringify({ type: "message", message })}\n`);
};

const write = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const state = () => ({
  model,
  thinkingLevel: level,
  isStreaming: false,
  isCompacting: false,
  sessionId: id,
  ...(file ? { sessionFile: file } : {}),
  messageCount: messages.length,
});
let abort;
const dialogs = new Map();

async function prompt(text, images) {
  const turn = messages.filter((message) => message.role === "user").length + 1;
  keep({ role: "user", content: text, timestamp: Date.now() });
  write({ type: "agent_start" });
  const say = (words, stopReason = "stop", extra = {}) => {
    const message = {
      role: "assistant",
      content: [{ type: "text", text: words }],
      provider: model.provider,
      model: model.id,
      usage: { input: 10, output: 2, cacheRead: 100, cacheWrite: 0, cost: { total: 0.001 } },
      stopReason,
      timestamp: Date.now(),
      ...extra,
    };
    write({ type: "message_start", message: { ...message, content: [] } });
    if (words)
      write({
        type: "message_update",
        message,
        assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: words },
      });
    write({ type: "message_end", message });
    keep(message);
  };
  const tool = async (toolName, toolArgs, result) => {
    const toolCallId = `call_${turn}`;
    write({ type: "tool_execution_start", toolCallId, toolName, args: toolArgs });
    const output = await result;
    write({
      type: "tool_execution_end",
      toolCallId,
      toolName,
      result: { content: [{ type: "text", text: output.text }] },
      isError: output.isError ?? false,
    });
  };
  if (images.length) say(`Saw ${images.map((image) => image.mimeType).join(", ")}: ${text}`);
  else if (text.includes("Fail")) say("", "error", { errorMessage: "429 Rate limited" });
  else if (text.includes("Fill")) {
    filled = true;
    say("Filled.");
  } else if (text.includes("Clean")) {
    // An extension's question, answered in the client.
    const answer = await new Promise((resolve) => {
      const request = randomUUID();
      dialogs.set(request, resolve);
      write({
        type: "extension_ui_request",
        id: request,
        method: "confirm",
        title: "Allow bash?",
        message: "rm -rf build",
      });
    });
    say(answer.confirmed ? "Cleaned." : "Left it.");
  } else if (text.includes("Edit")) {
    await tool(
      "edit",
      {
        path: "summary.ts",
        oldText: "export const best = 1;\n",
        newText: "export const best = 2;\n",
      },
      { text: "Edited summary.ts" },
    );
    say("Edited summary.ts.");
  } else {
    const command = /Run ([^,.]+)/.exec(text)?.[1];
    if (command?.startsWith("sleep")) {
      // The command runs until abort.
      await tool(
        "bash",
        { command },
        new Promise((resolve) => (abort = () => resolve({ text: "aborted", isError: true }))),
      );
      abort = undefined;
      say("", "aborted");
    } else if (command) {
      await tool("bash", { command }, { text: "summary.ts" });
      say(`Ran ${command}.`);
    } else say(`(${model.id}, ${level}) turn ${turn}: ${text}`);
  }
  write({ type: "agent_end", messages: [] });
}

const levels = () =>
  model.reasoning ? ["off", "minimal", "low", "medium", "high", "xhigh"] : ["off"];
function handle(command) {
  switch (command.type) {
    case "get_state":
      return state();
    case "get_available_models":
      return { models: MODELS };
    case "set_model": {
      const next = MODELS.find(
        (entry) => entry.provider === command.provider && entry.id === command.modelId,
      );
      if (!next) throw new Error(`Model not found: ${command.provider}/${command.modelId}`);
      model = next;
      // As Pi does: a new model takes its default level.
      level = model.reasoning ? "medium" : "off";
      return model;
    }
    case "set_thinking_level":
      level = levels().includes(command.level) ? command.level : levels().at(-1);
      return undefined;
    case "prompt":
      void prompt(command.message, command.images ?? []);
      return undefined;
    case "abort":
      abort?.();
      return undefined;
    case "get_session_stats":
      return {
        sessionId: id,
        contextUsage: {
          tokens: filled
            ? 250_000
            : 1000 * messages.filter((message) => message.role === "user").length,
          contextWindow: 272000,
          percent: 0,
        },
      };
    case "compact": {
      // As Pi does: the events of a manual compaction, then its result.
      write({ type: "compaction_start", reason: "manual" });
      const result = {
        summary: "The user filled the context.",
        firstKeptEntryId: "e1",
        tokensBefore: 250_000,
      };
      filled = false;
      write({ type: "compaction_end", reason: "manual", result, aborted: false, willRetry: false });
      return result;
    }
    default:
      throw new Error(`Unknown command: ${command.type}`);
  }
}

// Pi splits its input on \n alone.
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let end;
  while ((end = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (!line.trim()) continue;
    const command = JSON.parse(line);
    if (command.type === "extension_ui_response") {
      dialogs.get(command.id)?.(command);
      dialogs.delete(command.id);
      continue;
    }
    try {
      const data = handle(command);
      write({ id: command.id, type: "response", command: command.type, success: true, data });
    } catch (error) {
      write({
        id: command.id,
        type: "response",
        command: command.type,
        success: false,
        error: error.message,
      });
    }
  }
});
// As Pi does, it ends with its input.
process.stdin.on("end", () => process.exit(0));
