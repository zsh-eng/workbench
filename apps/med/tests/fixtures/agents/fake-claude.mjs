// A stand-in for `claude -p --input-format stream-json`. It answers Med's
// control requests, asks to edit a file, and writes a transcript under
// MED_HOME_DIR as Claude Code does.
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
const flag = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const sessionId = flag("--session-id") ?? flag("--resume");
const project = join(process.env.MED_HOME_DIR, ".claude", "projects", "-fake-repo");
mkdirSync(project, { recursive: true });
const transcript = join(project, `${sessionId}.jsonl`);
let model = flag("--model") ?? "default";
let mode = flag("--permission-mode") ?? "default";
const effort = flag("--effort") ?? "default";
const asks = new Map();
let waiting = false;

const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
const record = (entry) =>
  appendFileSync(
    transcript,
    `${JSON.stringify({ ...entry, sessionId, cwd: process.cwd(), timestamp: new Date().toISOString() })}\n`,
  );
function reply(text) {
  const id = `msg_${randomUUID().slice(0, 8)}`;
  send({ type: "stream_event", event: { type: "message_start", message: { id } } });
  send({
    type: "stream_event",
    event: { type: "content_block_delta", delta: { type: "text_delta", text } },
  });
  record({
    type: "assistant",
    uuid: randomUUID(),
    message: { id, role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text }] },
  });
  send({
    type: "assistant",
    message: { id, role: "assistant", content: [{ type: "text", text }] },
  });
  send({ type: "result", subtype: "success", is_error: false, result: text });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line);
  if (message.type === "control_response") {
    const done = asks.get(message.response.request_id);
    asks.delete(message.response.request_id);
    done?.(message.response.response);
    return;
  }
  if (message.type === "control_request") {
    const { request, request_id } = message;
    const ok = (response = {}) =>
      send({ type: "control_response", response: { subtype: "success", request_id, response } });
    switch (request.subtype) {
      case "initialize":
        return ok({
          commands: [
            { name: "review", description: "Review the current changes", builtin: false },
            { name: "clear", description: "Clear the conversation", builtin: true },
          ],
          models: [
            { value: "default", displayName: "Default", supportedEffortLevels: ["low", "high"] },
            { value: "haiku", displayName: "Haiku" },
          ],
          current_permission_mode: mode,
          account: { email: "someone@example.invalid" },
        });
      case "set_model":
        model = request.model ?? "default";
        return ok();
      case "set_permission_mode":
        mode = request.mode;
        return ok();
      case "get_context_usage":
        return ok({
          categories: [{ name: "Messages", tokens: 2500, kind: "used" }],
          totalTokens: 2500,
          maxTokens: 10000,
          percentage: 25,
        });
      case "interrupt":
        ok({ still_queued: [] });
        if (waiting) {
          waiting = false;
          record({
            type: "user",
            uuid: randomUUID(),
            message: { role: "user", content: "[Request interrupted by user]" },
          });
          send({ type: "result", subtype: "error_during_execution", is_error: true });
        }
        return;
      default:
        return send({
          type: "control_response",
          response: { subtype: "error", request_id, error: `No ${request.subtype}` },
        });
    }
  }
  if (message.type !== "user") return;
  const text = message.message.content;
  record({ type: "user", uuid: randomUUID(), message: { role: "user", content: text } });
  send({ type: "system", subtype: "status", status: "requesting" });
  if (text.includes("Edit")) {
    const request_id = `ask-${randomUUID().slice(0, 8)}`;
    asks.set(request_id, (answer) =>
      reply(
        answer.behavior === "allow"
          ? `Edited summary.ts${answer.updatedPermissions ? " and kept the rule" : ""}.`
          : "Left summary.ts as it was.",
      ),
    );
    send({
      type: "control_request",
      request_id,
      request: {
        subtype: "can_use_tool",
        tool_name: "Edit",
        display_name: "Edit",
        input: { file_path: "summary.ts" },
        permission_suggestions: [{ type: "addRules" }],
        tool_use_id: "toolu_1",
      },
    });
    return;
  }
  if (text.includes("Wait")) {
    waiting = true;
    return;
  }
  reply(`Model ${model}, effort ${effort}, mode ${mode}: ${text.split("\n")[0]}`);
});
