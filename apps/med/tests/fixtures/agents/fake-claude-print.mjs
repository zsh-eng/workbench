// A stand-in for `claude -p` with the prompt on standard input, as Med's
// questions run it. With --resume it continues a session's transcript; with
// --fork-session it copies the session's records under a new ID, as Claude
// Code does, and the session's own transcript does not change. It answers
// once in stream-json, and names its mode, model, and what the thread said.
import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export async function run(args) {
  const flag = (name) => {
    const index = args.indexOf(name);
    return index < 0 ? undefined : args[index + 1];
  };
  const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
  const resume = flag("--resume");
  const fork = args.includes("--fork-session");
  const named = flag("--session-id");
  if (named && resume && !fork) {
    process.stderr.write(
      "Error: --session-id can only be used with --continue or --resume if --fork-session is also specified.\n",
    );
    process.exit(1);
  }
  const projects = join(process.env.MED_HOME_DIR, ".claude", "projects");
  const lead =
    resume &&
    readdirSync(projects)
      .map((folder) => join(projects, folder, `${resume}.jsonl`))
      .find((path) => existsSync(path));
  const sessionId = resume && !fork ? resume : (named ?? randomUUID());
  if (resume && !lead) {
    send({
      type: "result",
      subtype: "error_during_execution",
      is_error: true,
      session_id: sessionId,
      errors: [`No conversation found with session ID: ${resume}`],
    });
    process.exit(1);
  }
  const folder = join(projects, process.cwd().replace(/[^A-Za-z0-9-]/g, "-"));
  mkdirSync(folder, { recursive: true });
  const transcript = resume && !fork ? lead : join(folder, `${sessionId}.jsonl`);
  // A test reads the arguments and the process, away from the projects.
  const runs = join(process.env.MED_HOME_DIR, "claude-print");
  mkdirSync(runs, { recursive: true });
  writeFileSync(join(runs, `${sessionId}.args.json`), JSON.stringify(args));
  writeFileSync(join(runs, `${sessionId}.pid`), String(process.pid));

  const mode = flag("--permission-mode") ?? "default";
  const model = flag("--model") ?? "default";
  const effort = flag("--effort") ?? "default";
  const prompt = readFileSync(0, "utf8");
  const record = (entry) =>
    appendFileSync(
      transcript,
      `${JSON.stringify({ ...entry, sessionId, cwd: process.cwd(), timestamp: new Date().toISOString() })}\n`,
    );
  const history = lead
    ? readFileSync(lead, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
  if (fork)
    for (const entry of history)
      appendFileSync(transcript, `${JSON.stringify({ ...entry, sessionId })}\n`);
  const first = history.find((entry) => entry.type === "user")?.message?.content;

  send({ type: "system", subtype: "init", session_id: sessionId, permissionMode: mode, model });
  record({ type: "user", uuid: randomUUID(), message: { role: "user", content: prompt } });
  const text = `Mode ${mode}, model ${model}, effort ${effort}. The thread began with: ${first ?? "nothing"}. You asked: ${prompt.split("\n")[0]}`;
  const id = `msg_${randomUUID().slice(0, 8)}`;
  send({ type: "stream_event", event: { type: "message_start", message: { id } } });
  const words = text.split(" ");
  const half = Math.ceil(words.length / 2);
  for (const part of [words.slice(0, half).join(" ") + " ", words.slice(half).join(" ")]) {
    send({
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: part } },
    });
    // A question with "Wait" stops after the first part, until Med ends it.
    if (prompt.includes("Wait")) await new Promise(() => setInterval(() => {}, 1000));
  }
  const message = { id, role: "assistant", model, content: [{ type: "text", text }] };
  record({ type: "assistant", uuid: randomUUID(), message });
  send({ type: "assistant", message, session_id: sessionId });
  send({
    type: "result",
    subtype: "success",
    is_error: false,
    result: text,
    session_id: sessionId,
  });
  process.exit(0);
}
