import { mkdir, writeFile } from "node:fs/promises";
import { basename, delimiter, join } from "node:path";

/**
 * What an agent that Med starts in a thread needs to know. Claude Code adds it
 * to its system prompt; an ACP agent reads it before its first prompt.
 */
export function threadInstructions(title: string, cwd: string) {
  return [
    `You work in a Med thread named ${JSON.stringify(title)}, in ${cwd}. Med is the user's local review app. It shows the user your changes as you work, and it sends you their messages and review comments as new turns.`,
    'When a piece of work is ready, hand it off for review: run `med review create --working --title "<2-4 words>" --guide -` with a JSON guide on standard input. MED_THREAD_KEY and MED_THREAD_REPO in your environment keep the review in this thread. For committed work, use `--base <commit-before-work> --head HEAD` in place of `--working`.',
    'The guide splits your change into segments that the user reads one at a time: {"summary": "Why the change matters, in 1-3 sentences.", "segments": [{"title": "At most 4 words", "summary": "Why, in 1-3 sentences.", "files": ["src/parse.ts", "src/recover/", "tests/**"], "comments": [{"file": "src/parse.ts", "line": 42, "kind": "risk", "body": "What needs care, in Markdown."}]}]}. Group files by intent, not by folder: usually 1-5 segments, the core change first, and tests after the code they cover. Put every changed file in one segment. Comment only where it saves the reader time; comment kinds are note, suggestion, risk, and question. Run `med docs agents` for the full format.',
    "Med checks the guide against the changed files and prints what it leaves out; fix the guide with `med review update --guide -`. After you open a pull request, run `med review update --pr <url>`.",
    "Do not run `med review wait`: Med sends the user's messages to you itself.",
  ].join("\n\n");
}

/** The command that runs this Med again: its executable, or a runtime and its script. */
export function ownCommand(): string[] {
  const runtime = /^(node|nodejs|bun)(\.exe)?$/.test(basename(process.execPath));
  return runtime && process.argv[1] ? [process.execPath, process.argv[1]] : [process.execPath];
}

/**
 * Writes a `med` command in `directory` that runs `command`, so the agents that
 * Med starts use this host's version even when `med` is not on PATH.
 */
export async function writeMedCommand(directory: string, command: readonly string[]) {
  const quote = (word: string) => `'${word.replaceAll("'", `'\\''`)}'`;
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "med"),
    `#!/bin/sh\nexec ${command.map(quote).join(" ")} "$@"\n`,
    { mode: 0o755 },
  );
}

/** Variables for an agent that Med starts: how to reach this host, and its thread. */
export function ownedEnvironment(options: {
  port: number;
  stateDir?: string;
  bin?: string;
  thread?: { key: string; repo: string };
}): Record<string, string> {
  return {
    MED_SESSION: "owned",
    MED_PORT: String(options.port),
    ...(options.stateDir ? { MED_STATE_DIR: options.stateDir } : {}),
    ...(options.thread
      ? { MED_THREAD_KEY: options.thread.key, MED_THREAD_REPO: options.thread.repo }
      : {}),
    ...(options.bin ? { PATH: [options.bin, process.env.PATH ?? ""].join(delimiter) } : {}),
  };
}
