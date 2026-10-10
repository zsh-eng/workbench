// A stand-in for an Agent Client Protocol agent, such as `opencode acp`:
// JSON-RPC on stdio, with config options, legacy modes, commands, and a
// permission request.
import { createInterface } from "node:readline";

let model = "small";
let mode = "build";
let next = 0;
const waiting = new Map();
let held;

const write = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const update = (value) =>
  write({ method: "session/update", params: { sessionId: "s1", update: value } });
const say = (text) =>
  update({ sessionUpdate: "agent_message_chunk", content: { type: "text", text } });
const ask = (method, params) =>
  new Promise((resolve) => {
    const id = ++next;
    waiting.set(id, resolve);
    write({ id, method, params });
  });
const options = () => [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: model,
    options: [
      { value: "small", name: "Small" },
      { value: "large", name: "Large" },
    ],
  },
];

async function handle(method, params) {
  switch (method) {
    case "initialize":
      return { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
    case "session/new":
      setTimeout(() =>
        update({
          sessionUpdate: "available_commands_update",
          availableCommands: [{ name: "init", description: "Write AGENTS.md" }],
        }),
      );
      return {
        sessionId: "s1",
        configOptions: options(),
        modes: {
          currentModeId: mode,
          availableModes: [
            { id: "build", name: "Build" },
            { id: "plan", name: "Plan" },
          ],
        },
      };
    case "session/set_config_option":
      model = params.value;
      return { configOptions: options() };
    case "session/set_mode":
      mode = params.modeId;
      return {};
    case "session/prompt": {
      const text = params.prompt.map((block) => block.text).join("");
      // OpenCode sends the prompt back as a user update.
      update({
        sessionUpdate: "user_message_chunk",
        messageId: "u",
        content: { type: "text", text },
      });
      // OpenCode ends a turn without a word when its model refuses the request.
      if (text.includes("Silent")) return { stopReason: "end_turn" };
      if (text.includes("Edit")) {
        const answer = await ask("session/request_permission", {
          sessionId: "s1",
          toolCall: {
            toolCallId: "c1",
            title: "Edit summary.ts",
            rawInput: { path: "summary.ts" },
          },
          options: [
            { optionId: "allow", name: "Allow", kind: "allow_once" },
            { optionId: "reject", name: "Reject", kind: "reject_once" },
          ],
        });
        say(`Outcome: ${answer.outcome.outcome} ${answer.outcome.optionId ?? ""}`.trim());
        return { stopReason: "end_turn" };
      }
      if (text.includes("Wait")) {
        await new Promise((resolve) => (held = resolve));
        return { stopReason: "cancelled" };
      }
      say(`(${model}, ${mode}) ${text.split("\n")[0]}`);
      return { stopReason: "end_turn" };
    }
    default:
      throw Object.assign(new Error(`No ${method}`), { code: -32601 });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "session/cancel") return held?.();
  if (message.method && message.id !== undefined)
    return handle(message.method, message.params).then(
      (result) => write({ id: message.id, result }),
      (error) =>
        write({ id: message.id, error: { code: error.code ?? -32603, message: error.message } }),
    );
  if (message.id !== undefined) {
    waiting.get(message.id)?.(message.result);
    waiting.delete(message.id);
  }
});
