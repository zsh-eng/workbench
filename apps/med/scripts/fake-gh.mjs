import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

// The GitHub CLI's token variables. A validation runs without them.
const TOKENS = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];

// The stand-in. It finds its folder from its own path, so it works with any
// environment. It answers a call from answers.json: the first rule whose
// `args` are all in the call's arguments. It logs each call to calls.jsonl.
// A call with no rule fails, as a real gh would be the only other answer.
const FAKE = `#!/usr/bin/env node
// A stand-in for the GitHub CLI in Med's validations (scripts/fake-gh.mjs).
const { appendFileSync, readFileSync } = require("node:fs");
const { dirname, join } = require("node:path");
const home = dirname(dirname(__filename));
const args = process.argv.slice(2);
if (args[0] === "--fake-gh-home") {
  process.stdout.write(home);
  process.exit(0);
}
let rules = [];
try {
  rules = JSON.parse(readFileSync(join(home, "answers.json"), "utf8"));
} catch {}
const rule = rules.find((entry) => entry.args.every((arg) => args.includes(arg)));
appendFileSync(
  join(home, "calls.jsonl"),
  JSON.stringify({ args, cwd: process.cwd(), answered: Boolean(rule) }) + "\\n",
);
if (!rule) {
  process.stderr.write("fake gh: no fixed answer for gh " + args.join(" ") + "\\n");
  process.exit(1);
}
process.stdout.write(rule.stdout ?? "");
process.exit(rule.exitCode ?? 0);
`;

/**
 * Puts a fake GitHub CLI first on PATH, with a scratch GH_CONFIG_DIR and no
 * GitHub token, for this process and every process that it starts: the Med
 * host and CLI, from dist/cli.js or MED_EXECUTABLE. A validation must never
 * reach GitHub. Call this before the script starts Med, as
 * removeGitEnvironment. The scratch folder goes when the process exits.
 */
export function useFakeGh() {
  // The real path, as the fake finds its own (macOS links /var to /private/var).
  const home = realpathSync(mkdtempSync(join(tmpdir(), "med-fake-gh-")));
  const bin = join(home, "bin");
  const config = join(home, "config");
  mkdirSync(bin);
  mkdirSync(config);
  writeFileSync(join(bin, "gh"), FAKE, { mode: 0o755 });
  writeFileSync(join(home, "answers.json"), "[]");
  writeFileSync(join(home, "calls.jsonl"), "");
  process.on("exit", () => rmSync(home, { recursive: true, force: true }));
  for (const name of TOKENS) delete process.env[name];
  process.env.GH_CONFIG_DIR = config;
  process.env.GH_PROMPT_DISABLED = "1";
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ""}`;
  // A child that keeps this PATH finds the fake first, as this process does.
  const found = execFileSync("gh", ["--fake-gh-home"], { encoding: "utf8" });
  if (found !== home) throw new Error(`gh on PATH is not the fake: ${found}`);
  const calls = () =>
    readFileSync(join(home, "calls.jsonl"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  return {
    /**
     * Sets the fixed answers: the first rule whose `args` are all in a call's
     * arguments gives `stdout` (text, or a value to print as JSON) and
     * `exitCode` (0 by default).
     */
    answer(rules) {
      const fixed = rules.map(({ args, stdout = "", exitCode = 0 }) => ({
        args,
        stdout: typeof stdout === "string" ? stdout : JSON.stringify(stdout),
        exitCode,
      }));
      writeFileSync(join(home, "answers.json"), JSON.stringify(fixed));
    },
    /** Each call so far, as `{ args, cwd, answered }`. */
    calls,
    /**
     * Fails when a call had no fixed answer: only a real gh could have
     * answered it. Checks again that the fake is first on PATH, so no later
     * call falls through to a real gh. Returns the calls.
     */
    check() {
      const all = calls();
      const missed = all.filter((call) => !call.answered);
      if (missed.length)
        throw new Error(
          `gh calls with no fixed answer:\n${missed.map((call) => `gh ${call.args.join(" ")}`).join("\n")}`,
        );
      if (!process.env.PATH?.startsWith(bin + delimiter))
        throw new Error("The fake gh is no longer first on PATH.");
      return all;
    },
  };
}
