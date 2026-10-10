/**
 * Makes a replay fixture from a Claude Code transcript.
 *
 *   bun scripts/session-fixture.ts <transcript.jsonl> <out.jsonl> --root <repo> [--prompt <file>]
 *
 * The fixture keeps the lines and fields that the session reader uses and
 * drops the rest: attachments, system prompts, signatures, and request IDs.
 * `--root` is the repository the agent worked in; its path becomes
 * /work/<name> and is the working directory of every line. `--prompt`
 * replaces the first user message, for a brief that was written for the
 * recording rather than for the task. The script stops if the result still
 * holds the user name, the home directory, or an email address.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { basename } from "node:path";

const [source, target, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf(name);
  return index < 0 ? undefined : rest[index + 1];
};
const root = option("--root");
if (!source || !target || !root) {
  console.error(
    "Usage: bun scripts/session-fixture.ts <transcript.jsonl> <out.jsonl> --root <repo> [--prompt <file>]",
  );
  process.exit(1);
}
const promptFile = option("--prompt");
const prompt = promptFile ? readFileSync(promptFile, "utf8").trim() : undefined;
const work = `/work/${basename(root)}`;
const user = userInfo().username;
const home = homedir();

type Json = Record<string, unknown>;
const KEEP = [
  "type",
  "subtype",
  "uuid",
  "timestamp",
  "message",
  "toolUseResult",
  "thinkingDurationMs",
  "isMeta",
  "isCompactSummary",
  "isApiErrorMessage",
  "retryAttempt",
  "maxRetries",
  "customTitle",
] as const;

function scrub(value: string) {
  return value
    .split(root!)
    .join(work)
    .split(home)
    .join("~")
    .replace(new RegExp(`\\b${user}\\b`, "g"), "dev");
}

function clean(value: unknown): unknown {
  if (typeof value === "string") return scrub(value);
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const result: Json = {};
    for (const [key, item] of Object.entries(value)) {
      // Thought signatures and request IDs are opaque and large.
      if (key === "signature" || key === "requestId") continue;
      result[key] = clean(item);
    }
    return result;
  }
  return value;
}

const reminder = /^\s*<system-reminder>[\s\S]*<\/system-reminder>\s*$/;
let prompted = false;
const lines: string[] = [];
for (const raw of readFileSync(source, "utf8").split("\n")) {
  if (!raw.trim()) continue;
  const entry = JSON.parse(raw) as Json;
  if (!["user", "assistant", "system", "custom-title"].includes(String(entry.type))) continue;
  if (entry.isMeta) continue;
  const message = entry.message as Json | undefined;
  if (entry.type === "user" && typeof message?.content === "string") {
    if (reminder.test(message.content)) continue;
    if (!prompted && prompt) {
      message.content = prompt;
      prompted = true;
    }
  }
  const kept: Json = {};
  for (const key of KEEP) if (entry[key] !== undefined) kept[key] = entry[key];
  if (message) {
    const { id, role, model, stop_reason, content } = message;
    kept.message = { id, role, model, stop_reason, content };
  }
  kept.cwd = work;
  lines.push(JSON.stringify(clean(kept)));
}

const output = `${lines.join("\n")}\n`;
for (const leak of [
  home,
  `/Users/${user}`,
  new RegExp(`\\b${user}\\b`),
  /[\w.+-]+@(?!example\.invalid)[\w-]+\.\w+/,
]) {
  const found = typeof leak === "string" ? output.includes(leak) : leak.test(output);
  if (found) {
    console.error(`The fixture still holds ${String(leak)}. Check the transcript by hand.`);
    process.exit(1);
  }
}
writeFileSync(target, output);
console.log(`${lines.length} lines, ${(output.length / 1024).toFixed(1)} KiB → ${target}`);
