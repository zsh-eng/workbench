import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SavedReview } from "../../src/shared/saved-review";
import type { ThreadList } from "../../src/shared/threads";
import { runThreadCommand } from "../../src/cli/thread";
import { startHost, type RunningHost } from "../../src/host/server";
import { removeFolder } from "./remove-folder";

// The Superagent: one thread, made once, in a folder of Med's that the lists
// of repositories leave out; its first turn is the brief, on Opus at high
// effort. Its messages to other threads name it.

beforeEach(() => {
  for (const name of ["MED_PORT", "MED_STATE_DIR", "MED_THREAD_KEY"]) vi.stubEnv(name, "");
});
const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Med",
      GIT_AUTHOR_EMAIL: "med@example.invalid",
      GIT_COMMITTER_NAME: "Med",
      GIT_COMMITTER_EMAIL: "med@example.invalid",
    },
  }).trim();

async function fixture() {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med superagent ")));
  directories.push(directory);
  const repo = join(directory, "trailhead");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "trails.ts"), "export const trails = 3;\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  const stateDir = join(directory, "state");
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir,
    port: 0,
    agents: async () => [
      {
        id: "claude",
        name: "Claude Code",
        kind: "claude",
        available: true,
        command: process.execPath,
        args: [fileURLToPath(new URL("../fixtures/agents/fake-claude.mjs", import.meta.url))],
      },
    ],
  });
  hosts.push(host);
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, data: (await response.json()) as T };
  };
  const project = join(home, ".claude", "projects", "-fake-repo");
  /** The user messages of a session's transcript, as the fake Claude records them. */
  const said = async (sessionId: string) =>
    (await readFile(join(project, `${sessionId}.jsonl`), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { type: string; message?: { content: unknown } })
      .filter((entry) => entry.type === "user" && typeof entry.message?.content === "string")
      .map((entry) => entry.message!.content as string);
  return { api, host, project, repo, said, stateDir };
}

test("the Superagent is one thread in a hidden folder, started once with its brief on Opus at high effort", async () => {
  const { api, project, said, stateDir } = await fixture();
  const first = await api<{ review: SavedReview; created: boolean }>("/api/superagent", {});
  expect(first.status).toBe(200);
  expect(first.data.created).toBe(true);
  const review = first.data.review;
  expect(review.title).toBe("Superagent");
  expect(review.key).toBe("superagent");
  const folder = join(stateDir, "superagent");
  expect(existsSync(join(folder, ".git"))).toBe(true);
  const session = review.sessions![0]!;
  expect(session.cwd).toBe(await realpath(folder));

  // Opus at high effort, and the brief as its first turn.
  const args = await vi.waitFor(
    async () =>
      JSON.parse(await readFile(join(project, `${session.id}.args.json`), "utf8")) as string[],
  );
  expect(args).toEqual(expect.arrayContaining(["--model", "opus", "--effort", "high"]));
  await vi.waitFor(async () =>
    expect((await said(session.id))[0]).toMatch(/^You are the Superagent/),
  );
  expect((await said(session.id))[0]).toContain("med thread send <id>");

  // Again, it is the same thread, and the brief is not sent twice.
  const again = await api<{ review: SavedReview; created: boolean }>("/api/superagent", {});
  expect(again.data).toMatchObject({ created: false, review: { id: review.id } });
  expect(await said(session.id)).toHaveLength(1);

  // The lists of repositories leave its folder out; the thread list marks it.
  const repositories = (await api<{ repositories: { path: string }[] }>("/api/repositories")).data
    .repositories;
  expect(repositories.map((entry) => entry.path)).not.toContain(await realpath(folder));
  expect(repositories).toHaveLength(1);
  const threads = (await api<ThreadList>("/api/threads")).data.threads;
  expect(threads.find((thread) => thread.id === review.id)).toMatchObject({ superagent: true });
  expect(threads.filter((thread) => thread.superagent)).toHaveLength(1);
});

test("`med thread send` from the Superagent reaches another thread's agent, labelled as its", async () => {
  const { api, host, said, stateDir } = await fixture();
  const superagent = (await api<{ review: SavedReview }>("/api/superagent", {})).data.review;
  const repositoryId = (await api<{ repositories: { id: string }[] }>("/api/repositories")).data
    .repositories[0]!.id;
  const thread = (
    await api<{ review: SavedReview }>("/api/threads", {
      repositoryId,
      prompt: "Count the trails.",
      preset: "claude",
    })
  ).data.review;
  const session = thread.sessions![0]!;
  // Its first turn ends.
  await vi.waitFor(
    async () => {
      const list = (await api<ThreadList>("/api/threads")).data.threads;
      expect(list.find((entry) => entry.id === thread.id)?.state).toBe("idle");
    },
    { timeout: 10_000 },
  );

  const printed: string[] = [];
  const send = (id: string, key: string) =>
    runThreadCommand(
      ["send", id, "Say how many there are.", "--state-dir", stateDir, "--port", String(host.port)],
      {
        print: (line: string) => printed.push(line),
        openUrl: async () => {},
        environment: { MED_THREAD_KEY: key },
      },
    );
  await send(thread.id, "superagent");
  expect(printed.at(-1)).toBe(`Sent to "${thread.title}" (${thread.id}).`);
  await vi.waitFor(async () =>
    expect((await said(session.id)).at(-1)).toBe("From the Superagent:\n\nSay how many there are."),
  );

  // A thread does not send to itself.
  await expect(send(superagent.id, "superagent")).rejects.toThrow(
    "A thread can't send a message to itself.",
  );
});
