import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
import type { ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { runReviewCommand } from "../../src/cli/review";
import { readServerEvents } from "../../src/web/data/sse";

const directories: string[] = [];
const hosts: RunningHost[] = [];
const streams: AbortController[] = [];
afterEach(async () => {
  for (const stream of streams.splice(0)) stream.abort();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
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
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med threads ")));
  directories.push(directory);
  const repo = join(directory, "trail-notes");
  await mkdir(repo);
  git(repo, ["init", "-q", "-b", "main"]);
  await writeFile(join(repo, "summary.ts"), "export const best = 1;\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "Start"]);
  const home = join(directory, "home");
  await mkdir(home);
  vi.stubEnv("MED_HOME_DIR", home);
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
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
  /** The thread list as the window's stream sends it, latest first. */
  const list = async () => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    const latest: { value: ThreadList | null } = { value: null };
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => (latest.value = JSON.parse(event.data) as ThreadList),
      controller.signal,
    ).catch(() => {});
    await vi.waitFor(() => expect(latest.value).not.toBeNull());
    return latest;
  };
  const repositoryId = (await api<{ repositories: { id: string }[] }>("/api/repositories")).data
    .repositories[0]!.id;
  return { api, list, repo, repositoryId, home, host, stateDir: join(directory, "state") };
}

test("a thread starts its agent on a new branch in a worktree, and archiving can remove it", async () => {
  const { api, list, repo, repositoryId } = await fixture();
  const start = (prompt: string) =>
    api<{ review: SavedReview }>("/api/threads", { repositoryId, prompt, preset: "claude" });

  // The task names the thread and its branch; the agent starts on it at once.
  const first = await start("Show each result's age in the list, as relative times.");
  expect(first.status).toBe(200);
  const review = first.data.review;
  expect(review.title).toBe("Show each result's age in the list");
  const worktree = review.targets[0]!.repo;
  expect(git(worktree, ["branch", "--show-current"])).toBe("show-each-results-age-list");
  expect(git(repo, ["branch", "--show-current"])).toBe("main");
  const session = review.sessions![0]!;
  expect(session.cwd).toBe(worktree);
  await vi.waitFor(
    async () => {
      const state = (await api<OwnedState>(`/api/reviews/${review.id}/owned/${session.id}`)).data;
      expect(state).toMatchObject({ status: "idle", turns: 1 });
    },
    { timeout: 5000 },
  );

  // The same task again takes the next free branch name.
  const second = (await start("Show each result's age in the list")).data.review;
  expect(git(second.targets[0]!.repo, ["branch", "--show-current"])).toBe(
    "show-each-results-age-list-2",
  );

  // The list shows both, newest first, each in its own linked worktree.
  const threads = await list();
  await vi.waitFor(() =>
    expect(
      threads.value!.threads.map((thread) => [thread.id, thread.branch, thread.linked]),
    ).toEqual([
      [second.id, "show-each-results-age-list-2", true],
      [review.id, "show-each-results-age-list", true],
    ]),
  );
  expect(threads.value!.threads[0]!.repository).toMatchObject({
    id: repositoryId,
    name: "trail-notes",
  });

  // Git keeps a worktree with changes, and the thread stays.
  await writeFile(join(second.targets[0]!.repo, "summary.ts"), "export const best = 2;\n");
  const kept = await api<{ error: { code: string } }>(`/api/threads/${second.id}/archive`, {
    archived: true,
    removeWorktree: true,
  });
  expect(kept.status).toBe(409);
  expect(threads.value!.threads).toHaveLength(2);

  // Archiving leaves the list and removes the worktree; the branch stays.
  const archived = await api<{ review: SavedReview }>(`/api/threads/${review.id}/archive`, {
    archived: true,
    removeWorktree: true,
  });
  expect(archived.status).toBe(200);
  expect(archived.data.review.archivedAt).toBeTruthy();
  expect(existsSync(worktree)).toBe(false);
  expect(git(repo, ["branch", "--list", "show-each-results-age-list"])).toContain(
    "show-each-results-age-list",
  );
  await vi.waitFor(
    () => expect(threads.value!.threads.map((thread) => thread.id)).toEqual([second.id]),
    { timeout: 5000 },
  );

  // Undo brings the thread back.
  await api(`/api/threads/${review.id}/archive`, { archived: false });
  await vi.waitFor(
    () => expect(threads.value!.threads.map((thread) => thread.id)).toContain(review.id),
    { timeout: 5000 },
  );

  // Archiving is not work on a thread: after Undo, it keeps its time and place.
  const time = () => threads.value!.threads.find((thread) => thread.id === second.id)?.updatedAt;
  const before = time();
  await api(`/api/threads/${second.id}/archive`, { archived: true });
  await vi.waitFor(() => expect(time()).toBeUndefined(), { timeout: 5000 });
  await api(`/api/threads/${second.id}/archive`, { archived: false });
  await vi.waitFor(() => expect(time()).toBe(before), { timeout: 5000 });
});

test("a thread's agent hands off its work with the command that its system prompt gives", async () => {
  const { api, home, host, repositoryId, stateDir } = await fixture();
  const review = (
    await api<{ review: SavedReview }>("/api/threads", {
      repositoryId,
      prompt: "Make the best result two.",
      preset: "claude",
    })
  ).data.review;
  const worktree = review.targets[0]!.repo;
  const session = review.sessions![0]!;
  const argsFile = join(home, ".claude", "projects", "-fake-repo", `${session.id}.args.json`);
  const args = await vi.waitFor(
    async () => JSON.parse(await readFile(argsFile, "utf8")) as string[],
  );
  const prompt = args[args.indexOf("--append-system-prompt") + 1]!;
  const command = /`med review (create [^`]+)`/.exec(prompt)![1]!;

  // The agent changes a file and runs the command as written; the brief comes
  // from a file here instead of standard input.
  await writeFile(join(worktree, "summary.ts"), "export const best = 2;\n");
  const brief = join(worktree, "..", "brief.md");
  await writeFile(brief, "The best result is two.\n");
  const words = [...command.matchAll(/"((?:[^"\\]|\\.)*)"|(\S+)/g)].map((match) =>
    match[1] === undefined ? match[2]! : (JSON.parse(`"${match[1]}"`) as string),
  );
  words[words.indexOf("--brief") + 1] = brief;
  await runReviewCommand([...words, "--state-dir", stateDir, "--port", String(host.port)], {
    print: () => {},
    home,
  });

  // The thread gets a second round with the change.
  const saved = (await api<SavedReview>(`/api/reviews/${review.id}`)).data;
  expect(saved.iterations).toHaveLength(2);
  expect(saved.totals).toMatchObject({ files: 1, additions: 1, deletions: 1 });
});
