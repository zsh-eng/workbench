#!/usr/bin/env node
// A stand-in for `agy acp`, Antigravity's Agent Client Protocol server, with
// the message shapes that agy 1.5.14 sends. As agy does, it keeps each
// conversation's transcript under $MED_HOME_DIR/.gemini, so a later process
// goes on with it (`session/resume`) or replays it (`session/load`), and it
// forgets the model, thinking level, and mode of the process before. It asks
// before an edit or a command as agy's modes do, with a string as the
// request's ID.
// It writes its arguments and the sessions it opens to
// $MED_HOME_DIR/agy-runs.jsonl.
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const home = process.env.MED_HOME_DIR;
const note = (entry) => appendFileSync(join(home, "agy-runs.jsonl"), `${JSON.stringify(entry)}\n`);
note({ args, cwd: process.cwd(), pid: process.pid });
if (args[0] !== "acp") process.exit(2);

const chosen = { model: "gemini-4-neon", thought_level: "high", mode: "default" };
const OFFERED = {
  model: ["Model", "model", ["gemini-4-neon", "gemini-4-hydrogen"]],
  thought_level: ["Thinking Level", "thought_level", ["low", "medium", "high"]],
  mode: ["Mode", "mode", ["default", "accept-edits", "auto", "plan"]],
};
const options = () =>
  Object.entries(OFFERED).map(([id, [name, category, values]]) => ({
    id,
    name,
    category,
    type: "select",
    currentValue: chosen[id],
    options: values.map((value) => ({ value, name: value })),
  }));

let session;
/** A context that agy's /compact does not shrink ("Fill and hold"). */
let held = false;
let next = 0;
let cancel;
const waiting = new Map();
const write = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const update = (value) =>
  write({ method: "session/update", params: { sessionId: session, update: value } });
const say = (text) =>
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = String(++next);
    waiting.set(id, resolve);
    write({ id, method, params });
  });

const transcript = (id) =>
  join(
    home,
    ".gemini",
    "antigravity-cli",
    "brain",
    id,
    ".system_generated",
    "logs",
    "transcript.jsonl",
  );
const steps = (id) =>
  existsSync(transcript(id))
    ? readFileSync(transcript(id), "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const keep = (type, content) => {
  const path = transcript(session);
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(
    path,
    `${JSON.stringify({ step_index: steps(session).length, type, status: "DONE", content })}\n`,
  );
};
const request = (content) =>
  /<USER_REQUEST>\n?([\s\S]*?)\n?<\/USER_REQUEST>/.exec(content)?.[1] ?? content;
const opened = () => ({
  sessionId: session,
  configOptions: options(),
  modes: {
    currentModeId: chosen.mode,
    availableModes: OFFERED.mode[2].map((id) => ({ id, name: id })),
  },
});
const open = (method, id) => {
  if (!steps(id).length) throw Object.assign(new Error("conversation not found"), { code: -32002 });
  session = id;
  note({ method, sessionId: id });
};

async function handle(method, params) {
  switch (method) {
    case "initialize":
      return {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          promptCapabilities: { image: true, audio: false, embeddedContext: true },
          sessionCapabilities: { resume: {}, close: {}, load: {}, list: {} },
        },
        agentInfo: { name: "Antigravity ACP Server", version: "1.5.15" },
        authMethods: [],
      };
    case "session/new":
      session = randomUUID();
      note({ method, sessionId: session });
      setTimeout(() =>
        update({
          sessionUpdate: "available_commands_update",
          availableCommands: [
            { name: "plan", description: "Plan carefully." },
            { name: "compact", description: "Summarize the conversation." },
          ],
        }),
      );
      return opened();
    case "session/resume":
      open(method, params.sessionId);
      return opened();
    case "session/load":
      open(method, params.sessionId);
      // The conversation, replayed before the answer.
      for (const step of steps(session))
        if (step.type === "USER_INPUT")
          update({
            sessionUpdate: "user_message_chunk",
            content: { type: "text", text: request(step.content) },
          });
        else if (step.type === "PLANNER_RESPONSE" && step.content) say(step.content);
      return opened();
    case "session/set_config_option":
      chosen[params.configId] = params.value;
      if (params.configId === "mode")
        update({ sessionUpdate: "current_mode_update", currentModeId: params.value });
      return { configOptions: options() };
    case "session/prompt": {
      const text = params.prompt.map((block) => block.text ?? "").join("");
      const images = params.prompt.filter((block) => block.type === "image");
      const turn = steps(session).filter((step) => step.type === "USER_INPUT").length + 1;
      keep("USER_INPUT", `<USER_REQUEST>\n${text}\n</USER_REQUEST>`);
      // As agy counts a turn: input without the cache reads, and output
      // with the thinking, which the total does not add again.
      const reply = (words, used = held ? 251_000 : 1000 * turn) => {
        if (words) say(words);
        keep("PLANNER_RESPONSE", words);
        update({ sessionUpdate: "usage_update", used, size: 1048576 });
        return {
          stopReason: "end_turn",
          usage: {
            inputTokens: 10,
            outputTokens: 2,
            cachedReadTokens: 100,
            cachedWriteTokens: 0,
            thoughtTokens: 1,
            totalTokens: 112,
          },
        };
      };
      // A turn that fills the context, and agy's own /compact, which says
      // nothing: its context then is the compaction's request, and the next
      // turn's is the smaller one.
      if (text.includes("Fill")) {
        held = text.includes("hold");
        return reply("Filled.", 250_000);
      }
      if (text === "/compact") return reply("", 252_000);
      if (images.length)
        return reply(`Saw ${images.map((image) => image.mimeType).join(", ")}: ${text}`);
      // As agy does: its default and plan modes ask before an edit, and
      // every mode but auto asks before a command.
      const approve = async (call, content) => {
        update({ sessionUpdate: "tool_call_update", ...call, status: "pending" });
        const answer = await ask("session/request_permission", {
          sessionId: session,
          toolCall: { sessionUpdate: "tool_call", ...call, status: "pending", ...content },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "deny", name: "Deny", kind: "reject_once" },
          ],
        });
        const allowed = answer?.outcome?.optionId === "allow";
        update({
          sessionUpdate: "tool_call_update",
          ...call,
          status: allowed ? "in_progress" : "failed",
          ...(allowed ? {} : { rawOutput: "permission check failed: user denied" }),
        });
        return allowed ? "allowed" : (answer?.outcome?.outcome ?? "denied");
      };
      // agy ends the turn without a word after a refusal.
      const refused = (outcome) => ({
        stopReason: outcome === "cancelled" ? "cancelled" : "end_turn",
      });
      if (text.includes("Edit")) {
        const path = join(process.cwd(), "summary.ts");
        const call = {
          toolCallId: `call_${turn}`,
          name: "write_file",
          kind: "edit",
          title: "File summary.ts",
          locations: [{ path }],
          rawInput: { Content: "export const best = 2;\n", Overwrite: true, Path: path },
        };
        update({ sessionUpdate: "tool_call", ...call, status: "in_progress" });
        if (chosen.mode === "default" || chosen.mode === "plan") {
          const outcome = await approve(call, {
            content: [
              {
                type: "diff",
                path,
                oldText: "export const best = 1;\n",
                newText: "export const best = 2;\n",
              },
            ],
          });
          if (outcome !== "allowed") return refused(outcome);
        }
        update({ sessionUpdate: "tool_call_update", ...call, status: "completed" });
        return reply("Edited summary.ts.");
      }
      const command = /Run ([^,.]+)/.exec(text)?.[1];
      if (command) {
        const call = {
          toolCallId: `call_${turn}`,
          name: "run_command",
          kind: "execute",
          title: command,
          rawInput: { CommandLine: command },
        };
        update({ sessionUpdate: "tool_call", ...call, status: "in_progress" });
        if (chosen.mode !== "auto") {
          const outcome = await approve(call);
          if (outcome !== "allowed") return refused(outcome);
        }
        if (command.startsWith("sleep")) {
          // The command runs until Stop.
          await new Promise((resolve) => (cancel = resolve));
          cancel = undefined;
          update({ sessionUpdate: "tool_call_update", ...call, status: "failed" });
          return { stopReason: "cancelled" };
        }
        update({ sessionUpdate: "tool_call_update", ...call, status: "completed" });
        return reply(`Ran ${command}.`);
      }
      return reply(
        `(${chosen.model}, ${chosen.thought_level}, ${chosen.mode}) turn ${turn}: ${text}`,
      );
    }
    default:
      throw Object.assign(new Error(`No ${method}`), { code: -32601 });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "session/cancel") return cancel?.();
  if (message.method && message.id !== undefined)
    return handle(message.method, message.params).then(
      (result) => write({ id: message.id, result }),
      (error) =>
        write({ id: message.id, error: { code: error.code ?? -32603, message: error.message } }),
    );
  if (message.id !== undefined) {
    waiting.get(String(message.id))?.(message.result);
    waiting.delete(String(message.id));
  }
});
