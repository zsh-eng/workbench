// A stand-in for `claude -p --input-format stream-json`. It answers Med's
// control requests, asks to edit a file, and writes a transcript under
// MED_HOME_DIR as Claude Code does. With `--fork-session`, its first prompt
// starts a new transcript with the resumed session's history.
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
// `claude -p` with a text prompt, as a question runs it; it does not return.
if (!args.includes("--input-format")) await (await import("./fake-claude-print.mjs")).run(args);
const flag = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const sessionId = flag("--session-id") ?? flag("--resume");
const projects = join(process.env.MED_HOME_DIR, ".claude", "projects");
const project = join(projects, "-fake-repo");
mkdirSync(project, { recursive: true });
const transcript = join(project, `${sessionId}.jsonl`);
/** The resumed session's history, which a fork copies with its own ID. */
let forkOf = args.includes("--fork-session") ? flag("--resume") : undefined;
function copyHistory() {
  const folder = readdirSync(projects).find((name) =>
    existsSync(join(projects, name, `${forkOf}.jsonl`)),
  );
  if (folder)
    for (const line of readFileSync(join(projects, folder, `${forkOf}.jsonl`), "utf8").split("\n"))
      if (line.trim())
        appendFileSync(transcript, `${JSON.stringify({ ...JSON.parse(line), sessionId })}\n`);
  forkOf = undefined;
}
// A test reads the arguments and the variables that Med sets.
writeFileSync(join(project, `${sessionId}.args.json`), JSON.stringify(args));
writeFileSync(
  join(project, `${sessionId}.env.json`),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(process.env).filter(([name]) => name.startsWith("MED_") || name === "PATH"),
    ),
  ),
);
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

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/** A reply that thinks first, as Claude Code 2.1 with thinking does: one API
 * message with a thinking block, then a text block that streams word by
 * word, `MED_FAKE_WORD_MS` apart. Claude Code keeps the message's blocks
 * from the transcript until the message's stop reason comes, then writes
 * each block as its own line, all with that stop reason. */
async function thinkAndReply(text) {
  const id = `msg_${randomUUID().slice(0, 8)}`;
  const message = { id, type: "message", role: "assistant", model: "claude-opus-5-5" };
  const stream = (event) => send({ type: "stream_event", event, parent_tool_use_id: null });
  const words = Number(process.env.MED_FAKE_WORD_MS ?? 150);
  stream({ type: "message_start", message: { ...message, content: [], stop_reason: null } });
  stream({ type: "content_block_start", index: 0, content_block: { type: "thinking" } });
  const started = Date.now();
  for (const part of ["Weighing ", "the options."]) {
    await pause(words);
    stream({
      type: "content_block_delta",
      index: 0,
      delta: { type: "thinking_delta", thinking: part },
    });
  }
  stream({ type: "content_block_stop", index: 0 });
  const thought = { type: "thinking", thinking: "", signature: "fake" };
  const thinkingDurationMs = Date.now() - started;
  send({ type: "assistant", message: { ...message, stop_reason: null, content: [thought] } });
  stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  for (const part of text.split(/(?<= )/)) {
    await pause(words);
    stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: part } });
  }
  stream({ type: "content_block_stop", index: 1 });
  const block = { type: "text", text };
  send({ type: "assistant", message: { ...message, stop_reason: null, content: [block] } });
  stream({ type: "message_delta", delta: { stop_reason: "end_turn" } });
  record({
    type: "assistant",
    uuid: randomUUID(),
    thinkingDurationMs,
    message: { ...message, stop_reason: "end_turn", content: [thought] },
  });
  record({
    type: "assistant",
    uuid: randomUUID(),
    message: { ...message, stop_reason: "end_turn", content: [block] },
  });
  stream({ type: "message_stop" });
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
            {
              value: "opus",
              displayName: "Opus",
              supportedEffortLevels: ["low", "medium", "high"],
            },
            { value: "haiku", displayName: "Haiku" },
          ],
          current_permission_mode: mode,
          account: { email: "someone@example.invalid" },
        });
      case "set_model":
        model = request.model ?? "default";
        return ok();
      case "set_permission_mode":
        // As Claude Code 2.1 does, Bypass needs leave at the start.
        if (
          request.mode === "bypassPermissions" &&
          !args.includes("--allow-dangerously-skip-permissions") &&
          flag("--permission-mode") !== "bypassPermissions"
        )
          return send({
            type: "control_response",
            response: {
              subtype: "error",
              request_id,
              error: "Cannot set permission mode to bypassPermissions",
              error_code: "bypass_not_launched",
            },
          });
        mode = request.mode;
        ok({ mode });
        return send({ type: "system", subtype: "status", status: null, permissionMode: mode });
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
  // Bare mode never reads the signed-in account.
  if (process.env.CLAUDE_CODE_SIMPLE === "1") {
    send({ type: "result", subtype: "success", is_error: true, result: "Not logged in" });
    return;
  }
  const content = message.message.content;
  // A prompt with images is a list of blocks, as the Claude API takes it.
  const blocks = typeof content === "string" ? [{ type: "text", text: content }] : content;
  const text = blocks
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
  const images = blocks.filter((block) => block.type === "image");
  if (forkOf) copyHistory();
  record({ type: "user", uuid: randomUUID(), message: { role: "user", content } });
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
  // AskUserQuestion and ExitPlanMode, as Claude Code 2.1 asks them.
  if (text.includes("Question")) {
    const request_id = `ask-${randomUUID().slice(0, 8)}`;
    asks.set(request_id, (answer) =>
      reply(
        answer.behavior === "allow"
          ? `Answers: ${JSON.stringify(answer.updatedInput.answers)}`
          : `No answer: ${answer.message}`,
      ),
    );
    send({
      type: "control_request",
      request_id,
      request: {
        subtype: "can_use_tool",
        tool_name: "AskUserQuestion",
        display_name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "Which format should durations use?",
              header: "Format",
              options: [
                { label: "Short", description: "1h 5m" },
                { label: "Long", description: "1 hour 5 minutes" },
              ],
              multiSelect: false,
            },
            {
              question: "Which units can show?",
              header: "Units",
              options: [{ label: "Hours" }, { label: "Minutes" }, { label: "Seconds" }],
              multiSelect: true,
            },
          ],
        },
        tool_use_id: "toolu_q",
        requires_user_interaction: true,
      },
    });
    return;
  }
  if (text.includes("Propose")) {
    const request_id = `plan-${randomUUID().slice(0, 8)}`;
    const plan = "# Format durations\n\n1. Add `formatDuration`.\n2. Test the hour.\n";
    asks.set(request_id, (answer) => {
      if (answer.behavior !== "allow") return reply(`Still planning: ${answer.message}`);
      const set = answer.updatedPermissions?.find((entry) => entry.type === "setMode");
      if (set) {
        mode = set.mode;
        send({ type: "system", subtype: "status", status: null, permissionMode: mode });
      }
      reply(`Approved; mode ${mode}.`);
    });
    send({
      type: "control_request",
      request_id,
      request: {
        subtype: "can_use_tool",
        tool_name: "ExitPlanMode",
        display_name: "ExitPlanMode",
        input: { plan, planFilePath: "/plans/format-durations.md" },
        tool_use_id: "toolu_p",
        requires_user_interaction: true,
      },
    });
    return;
  }
  if (text.includes("Think")) {
    void thinkAndReply("Kept the station's own time and wrote a test for the hour.");
    return;
  }
  if (text.includes("Wait")) {
    waiting = true;
    return;
  }
  // An agent that dies during its turn, as on an out-of-memory error.
  if (text.includes("Crash")) {
    process.stderr.write("FATAL ERROR: the fake ran out of memory\n");
    process.exit(1);
  }
  if (images.length)
    return reply(
      `Saw ${images.map((image) => `${image.source.type} ${image.source.media_type}`).join(", ")}: ${text}`,
    );
  reply(`Model ${model}, effort ${effort}, mode ${mode}: ${text.split("\n")[0]}`);
});
