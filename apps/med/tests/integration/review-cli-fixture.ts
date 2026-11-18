import { execFileSync } from "node:child_process";
import { type Server } from "node:http";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, vi } from "vitest";
import { runReviewCommand } from "../../src/cli/review";
import { startHost, type RunningHost } from "../../src/host/server";

// `med review` through the production host, for the review-cli*.test.ts
// files: repositories with work to hand off, and a host that saves it.

// The agent running these tests has its own session, maybe in a Med thread;
// reviews here record none.
/** Clears the session variables of the agent that runs these tests. */
export function clearAgentSession() {
  for (const name of [
    "CLAUDE_CODE_SESSION_ID",
    "MED_SESSION",
    "MED_THREAD_KEY",
    "MED_THREAD_REPO",
    "MED_PORT",
    "MED_STATE_DIR",
  ])
    vi.stubEnv(name, "");
}
export const temporary: string[] = [];
export const servers: Server[] = [];
export const hosts: RunningHost[] = [];
/** Closes the test's hosts and servers, removes its folders, and restores its variables. */
export async function cleanUp() {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((done) => {
          server.close(() => done());
          server.closeAllConnections();
        }),
    ),
  );
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  vi.unstubAllEnvs();
}
export async function state() {
  const path = await realpath(await mkdtemp(join(tmpdir(), "med-review-cli-")));
  temporary.push(path);
  return path;
}
export const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.invalid",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.invalid",
    },
  }).trim();
export async function fixture(count = 1) {
  const root = await state();
  const repos: string[] = [];
  for (let index = 0; index < count; index++) {
    const repo = join(root, `repo-${index}`);
    await mkdir(repo);
    git(repo, "init", "-b", "main");
    git(repo, "config", "commit.gpgsign", "false");
    await writeFile(join(repo, "file.txt"), "before\n");
    git(repo, "add", ".");
    git(repo, "commit", "-m", "before");
    await writeFile(join(repo, "file.txt"), `after ${index}\n`);
    repos.push(repo);
  }
  const stateDir = join(root, "state");
  const host = await startHost({ repo: repos[0]!, repos, stateDir, port: 0 });
  hosts.push(host);
  const args = ["--state-dir", stateDir, "--port", String(host.port)];
  const run = async (...command: string[]) => {
    const output: string[] = [];
    await runReviewCommand([...command, ...args], { print: (text) => output.push(text) });
    return output.join("\n");
  };
  const api = async (path: string) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    expect(response.status).toBe(200);
    return response.json();
  };
  const saved = async (output: string) => {
    expect(output).toMatch(
      new RegExp(
        `^\\[Review changes here\\]\\(http://127\\.0\\.0\\.1:${host.port}/review/r_[a-z0-9]+\\)$`,
      ),
    );
    expect(output).not.toContain(host.token);
    const id = output.match(/\/review\/(r_[a-z0-9]+)/)![1];
    return api(`/api/reviews/${id}`);
  };
  // Advice carries the options of this test's own instance.
  const flags = `--port ${host.port} --state-dir ${stateDir}`;
  return { root, repos, host, stateDir, flags, run, api, saved };
}

// A hostile peer is outside the CLI's tested path. Keep real fetch so redirects
// and credential redaction are observed rather than asserted as request options.

// Focused state tests cover simultaneous creation and stale-process cleanup.
// Sequential CLI tests cannot reliably reproduce these cross-process races.
