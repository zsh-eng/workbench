// A stand-in for codex-acp: an ACP agent whose session ID is Codex's thread
// ID, and which writes the session's rollout in $MED_HOME_DIR/.codex/sessions,
// as Codex does for a session that it runs through ACP.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const home = process.env.MED_HOME_DIR;
let rollout;
let sessionId;

const write = (message) =>
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
const record = (type, payload) =>
  appendFileSync(
    rollout,
    `${JSON.stringify({ timestamp: new Date().toISOString(), type, payload })}\n`,
  );

function handle(method, params) {
  switch (method) {
    case "initialize":
      return { protocolVersion: 1, agentCapabilities: {}, authMethods: [] };
    case "session/new": {
      sessionId = randomUUID();
      const now = new Date();
      const folder = join(
        home,
        ".codex",
        "sessions",
        String(now.getFullYear()),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
      );
      mkdirSync(folder, { recursive: true });
      const stamp = now.toISOString().slice(0, 19).replace(/:/g, "-");
      rollout = join(folder, `rollout-${stamp}-${sessionId}.jsonl`);
      record("session_meta", { id: sessionId, cwd: params.cwd, originator: "codex_acp" });
      return { sessionId };
    }
    case "session/prompt": {
      const text = params.prompt.map((block) => block.text ?? "").join("");
      record("response_item", {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      });
      record("response_item", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Done." }],
      });
      record("event_msg", { type: "task_complete" });
      write({
        method: "session/update",
        params: {
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "Done." },
          },
        },
      });
      return { stopReason: "end_turn" };
    }
    default:
      throw Object.assign(new Error(`No ${method}`), { code: -32601 });
  }
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method && message.id !== undefined) {
    try {
      write({ id: message.id, result: handle(message.method, message.params) });
    } catch (error) {
      write({ id: message.id, error: { code: error.code ?? -32603, message: error.message } });
    }
  }
});
