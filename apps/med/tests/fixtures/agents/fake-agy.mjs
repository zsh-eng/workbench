#!/usr/bin/env node
// A stand-in for `agy` in headless stream-json mode that replays a recorded
// session (agy-stream.jsonl, from agy 1.4.10 with throwaway prompts). Each
// line on its input plays the next recorded turn, up to its `result`; a line
// that comes during a turn waits for it, as agy's queue does. A prompt that
// asks to sleep holds its turn open until its input closes, which ends the
// process as agy does: an error result and exit code 1. The subagent's
// transcript goes to $MED_HOME_DIR/.gemini, where agy keeps it. It writes its
// arguments to $MED_HOME_DIR/agy-runs.jsonl.
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const home = process.env.MED_HOME_DIR;
if (args[0] === "models") {
  // As `agy models` prints them: the ID, which names the effort, and a name.
  process.stdout.write("gemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n");
  process.exit(0);
}
appendFileSync(join(home, "agy-runs.jsonl"), `${JSON.stringify({ args, cwd: process.cwd() })}\n`);
const recorded = readFileSync(fileURLToPath(new URL("agy-stream.jsonl", import.meta.url)), "utf8")
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));
const out = recorded.filter((entry) => entry.dir === "out").map((entry) => entry.line);
const init = out.find((line) => line.event === "init");
const transcript = recorded.find((entry) => entry.dir === "transcript");
// The recorded turns, each up to its result; the last result is the one
// that closing the input gave.
const turns = [];
let current = [];
for (const line of out) {
  if (line.event === "init") continue;
  current.push(line);
  if (line.event === "result") {
    turns.push(current);
    current = [];
  }
}
const closing = turns.pop().at(-1);
const flag = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const conversation = flag("--conversation") ?? init.conversation_id;
const write = (line) =>
  process.stdout.write(
    `${JSON.stringify(line)
      .replaceAll(init.conversation_id, conversation)
      .replaceAll("/work/scratch", process.cwd())}\n`,
  );
write({ ...init, conversation_id: conversation });

let ended = false;
let release;
let playing = Promise.resolve();
const end = () => {
  ended = true;
  write(closing);
  process.exit(1);
};
createInterface({ input: process.stdin, crlfDelay: Infinity })
  .on("line", (raw) => {
    const message = JSON.parse(raw);
    if (message.event !== "user") return;
    const turn = turns.shift() ?? [];
    playing = playing.then(async () => {
      for (const line of turn) {
        if (ended) return;
        await new Promise((resolve) => setTimeout(resolve, 5));
        const info = line.step_update?.subagent_info;
        if (info && transcript) {
          const child = info.subagents[0];
          const path = join(
            home,
            ".gemini",
            "antigravity-cli",
            "brain",
            child.conversation_id,
            ".system_generated",
            "logs",
            "transcript.jsonl",
          );
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(
            path,
            transcript.lines.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
          );
          child.log_uri = pathToFileURL(path).href;
        }
        if (line.event === "result" && String(message.message.content).includes("sleep"))
          await new Promise((resolve) => (release = resolve));
        write(line);
      }
    });
  })
  .on("close", () => {
    release?.();
    void playing.then(end, end);
    if (release) end();
  });
