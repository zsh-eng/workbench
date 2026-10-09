// Writes the Trailhead fixture as a Git repository with fixed authors and
// dates. The user's Git configuration is not read.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { author, history, rounds } from "./fixture.ts";

function git(repo: string, args: string[], date?: string): void {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repo,
    env: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: repo,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")}: ${result.stderr.toString()}`);
  }
}

function write(repo: string, files: Record<string, string>): void {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), content);
  }
}

/** Creates the repository with its commit history and no working changes. */
export function createRepository(repo: string): void {
  mkdirSync(repo, { recursive: true });
  git(repo, ["init", "--quiet", "--initial-branch=main"]);
  for (const commit of history) {
    write(repo, commit.files);
    git(repo, ["add", "--all"]);
    git(repo, ["commit", "--quiet", "--message", commit.message], commit.date);
  }
}

/** Writes one agent round as working changes. */
export function applyRound(repo: string, index: number): void {
  write(repo, rounds[index]!.files);
}

if (import.meta.main) {
  const repo = process.argv[2];
  if (!repo) throw new Error("Usage: bun repo.ts <directory> [rounds]");
  createRepository(repo);
  const count = Number(process.argv[3] ?? 0);
  for (let index = 0; index < count; index += 1) applyRound(repo, index);
}
