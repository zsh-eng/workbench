#!/usr/bin/env node
// A stand-in for `codex exec --json`, as Med's questions run it. It has
// `codex exec fork` only with FAKE_CODEX_FORK=1; without it, it answers the
// fork's --help as an older Codex does, with the help of `codex exec`. It
// writes each run's arguments, folder, and prompt under MED_HOME_DIR.
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
if (args[0] !== "exec") process.exit(2);
const forking = args[1] === "fork";
if (args.includes("--help")) {
  process.stdout.write(
    forking && process.env.FAKE_CODEX_FORK === "1"
      ? "Fork a previous session by id into a new session\n\nUsage: codex exec fork [OPTIONS] <SESSION_ID> [PROMPT]\n"
      : "Run Codex non-interactively\n\nUsage: codex exec [OPTIONS] [PROMPT]\n",
  );
  process.exit(0);
}
const flag = (name) => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const prompt = readFileSync(0, "utf8");
const runs = join(process.env.MED_HOME_DIR, "codex-runs");
mkdirSync(runs, { recursive: true });
writeFileSync(
  join(runs, `${Date.now()}-${randomUUID().slice(0, 4)}.json`),
  JSON.stringify({ args, cwd: process.cwd(), prompt }),
);
const sandbox =
  flag("--sandbox") ??
  args.find((arg) => arg.startsWith("sandbox_mode="))?.slice("sandbox_mode=".length) ??
  "workspace-write";
const send = (message) => process.stdout.write(`${JSON.stringify(message)}\n`);
send({ type: "thread.started", thread_id: randomUUID() });
send({ type: "turn.started" });
send({ type: "item.completed", item: { id: "item_0", type: "reasoning", text: "Reading" } });
const parent = forking ? args.at(-2) : undefined;
send({
  type: "item.completed",
  item: {
    id: "item_1",
    type: "agent_message",
    text: `Codex, ${parent ? `fork of ${parent}` : "new session"}, sandbox ${sandbox.replaceAll('"', "")}. You asked: ${prompt.split("\n")[0]}`,
  },
});
send({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
