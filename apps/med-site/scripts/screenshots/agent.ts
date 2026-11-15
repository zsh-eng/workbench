// Claude Code's stand-in while the site records its demo (capture.ts). When
// the reviewer sends a message, Med resumes the demo's session with it, as
// it resumes a real one: `claude -p --input-format stream-json --resume …`.
// The stand-in answers Med's control requests and hands each prompt to
// capture.ts, which plays the agent's round in the transcript (session.ts);
// the turn ends when capture.ts says so. It runs no model and reads no
// account.
//
// capture.ts puts a `claude` that runs this file first on Med's PATH, and
// names a folder in MED_DEMO_AGENT: the stand-in writes each prompt to
// `turn-<n>.txt` there, and waits for `turn-<n>.done`.
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const args = process.argv.slice(2);
if (args.includes("--version")) {
  console.log("2.1.0 (Claude Code)");
  process.exit(0);
}
const folder = process.env.MED_DEMO_AGENT;
if (!folder) throw new Error("MED_DEMO_AGENT names no folder.");

const send = (message: unknown) =>
  process.stdout.write(`${JSON.stringify(message)}\n`);
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

let turns = 0;
async function take(text: string) {
  turns += 1;
  const turn = join(folder!, `turn-${turns}`);
  writeFileSync(`${turn}.txt`, text);
  send({ type: "system", subtype: "status", status: "requesting" });
  while (!existsSync(`${turn}.done`)) await pause(100);
  send({ type: "result", subtype: "success", is_error: false, result: "" });
}

createInterface({ input: process.stdin }).on("line", (line) => {
  const message = JSON.parse(line) as {
    type: string;
    request_id?: string;
    request?: { subtype: string };
    message?: { content: string | { type: string; text?: string }[] };
  };
  if (message.type === "control_request") {
    const { request, request_id } = message;
    const ok = (response = {}) =>
      send({
        type: "control_response",
        response: { subtype: "success", request_id, response },
      });
    switch (request?.subtype) {
      case "initialize":
        return ok({
          commands: [],
          models: [{ value: "default", displayName: "Default" }],
          current_permission_mode: "default",
        });
      case "set_model":
      case "apply_flag_settings":
      case "set_permission_mode":
      case "interrupt":
        return ok();
      default:
        return send({
          type: "control_response",
          response: {
            subtype: "error",
            request_id,
            error: `No ${request?.subtype}`,
          },
        });
    }
  }
  if (message.type !== "user") return;
  const content = message.message?.content ?? "";
  const text =
    typeof content === "string"
      ? content
      : content.map((block) => block.text ?? "").join("");
  void take(text);
});
