import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OwnedState } from "../../src/shared/owned-session";
import type { SavedReview } from "../../src/shared/saved-review";
import type { Thread, ThreadList } from "../../src/shared/threads";
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
    // The agents' `med` command; here it prints its arguments.
    cli: [process.execPath, "-e", "process.stdout.write(JSON.stringify(process.argv.slice(1)))"],
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
  const start = (prompt: string, choices?: { model: string }) =>
    api<{ review: SavedReview }>("/api/threads", {
      repositoryId,
      prompt,
      preset: "claude",
      choices,
    });

  // The task names the thread and its branch; the agent starts on it at once.
  const first = await start("Show each result's age in the list, as relative times.");
  expect(first.status).toBe(200);
  const review = first.data.review;
  expect(review.title).toBe("Show each result's age in the list");
  const worktree = review.checkout!.repo;
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

  // The same task again takes the next free branch name, here with a chosen model.
  const second = (await start("Show each result's age in the list", { model: "haiku" })).data
    .review;
  expect(git(second.checkout!.repo, ["branch", "--show-current"])).toBe(
    "show-each-results-age-list-2",
  );
  await vi.waitFor(async () => {
    const owned = await api<OwnedState>(
      `/api/reviews/${second.id}/owned/${second.sessions![0]!.id}`,
    );
    expect(owned.data.settings.find((setting) => setting.id === "model")?.value).toBe("haiku");
  });

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
  // The list names the main checkout's branch, which New thread offers as Checkout.
  expect(threads.value!.repositories).toEqual([
    { id: repositoryId, name: "trail-notes", path: repo, branch: "main" },
  ]);

  // Git keeps a worktree with changes, and the tab stays.
  await writeFile(join(second.checkout!.repo, "summary.ts"), "export const best = 2;\n");
  const kept = await api<{ error: { code: string } }>(`/api/threads/${second.id}/close`, {
    removeWorktree: true,
  });
  expect(kept.status).toBe(409);
  expect(threads.value!.threads).toHaveLength(2);

  // Close sends the tab to history and removes the worktree; the branch stays.
  const closed = await api<{ closed: boolean }>(`/api/threads/${review.id}/close`, {
    removeWorktree: true,
  });
  expect(closed).toEqual({ status: 200, data: { closed: true } });
  expect(existsSync(worktree)).toBe(false);
  expect(git(repo, ["branch", "--list", "show-each-results-age-list"])).toContain(
    "show-each-results-age-list",
  );
  await vi.waitFor(
    () => expect(threads.value!.threads.map((thread) => thread.id)).toEqual([second.id]),
    { timeout: 5000 },
  );
  const history = await api<{ threads: Thread[] }>("/api/threads/history");
  expect(history.data.threads.map((thread) => [thread.id, thread.open])).toEqual([
    [review.id, false],
  ]);
  expect(history.data.threads[0]!.closedAt).toEqual(expect.any(Number));

  // Undo opens it again at its place.
  await api(`/api/threads/${review.id}/open`, { restore: true });
  await vi.waitFor(
    () => expect(threads.value!.threads.map((thread) => thread.id)).toEqual([second.id, review.id]),
    { timeout: 5000 },
  );

  // Closing is not work on a thread: it keeps its time, and ⌘⌥T its place.
  const time = () => threads.value!.threads.find((thread) => thread.id === second.id)?.updatedAt;
  const before = time();
  await api(`/api/threads/${second.id}/close`, {});
  await vi.waitFor(() => expect(time()).toBeUndefined(), { timeout: 5000 });
  const reopened = await api<{ thread: Thread }>("/api/threads/reopen", {});
  expect(reopened.data.thread).toMatchObject({ id: second.id, open: true });
  await vi.waitFor(() => expect(time()).toBe(before), { timeout: 5000 });
  expect(threads.value!.threads.map((thread) => thread.id)).toEqual([second.id, review.id]);
  // Nothing left to reopen.
  expect((await api("/api/threads/reopen", {})).status).toBe(404);

  // The archive route of older windows closes and opens a tab.
  await api(`/api/threads/${second.id}/archive`, { archived: true });
  await vi.waitFor(() => expect(time()).toBeUndefined(), { timeout: 5000 });
  await api(`/api/threads/${second.id}/archive`, { archived: false });
  await vi.waitFor(() => expect(time()).toBe(before), { timeout: 5000 });
});

test("a thread's agent hands off its work as the setup instructions say, with no flags for the thread", async () => {
  const { api, home, host, repositoryId, stateDir } = await fixture();
  const review = (
    await api<{ review: SavedReview }>("/api/threads", {
      repositoryId,
      prompt: "Make the best result two.",
      preset: "claude",
    })
  ).data.review;
  const worktree = review.checkout!.repo;
  const session = review.sessions![0]!;
  const project = join(home, ".claude", "projects", "-fake-repo");
  const args = await vi.waitFor(
    async () =>
      JSON.parse(await readFile(join(project, `${session.id}.args.json`), "utf8")) as string[],
  );
  // Med adds nothing to the agent's prompt: the user's CLAUDE.md or AGENTS.md
  // holds the instructions.
  expect(args).not.toContain("--append-system-prompt");
  const environment = JSON.parse(
    await readFile(join(project, `${session.id}.env.json`), "utf8"),
  ) as Record<string, string>;
  expect(environment).toMatchObject({
    MED_SESSION: "owned",
    MED_PORT: String(host.port),
    MED_STATE_DIR: stateDir,
    MED_THREAD_KEY: review.key,
    MED_THREAD_REPO: worktree,
  });
  // `med` on the agent's PATH is this host's command, with the arguments intact.
  const med = execFileSync("med", ["review", "it's here"], {
    env: { PATH: environment.PATH! },
    encoding: "utf8",
  });
  expect(JSON.parse(med)).toEqual(["review", "it's here"]);

  // The agent changes a file and runs the command in the setup instructions,
  // with its own environment; the guide comes from a file here.
  const instructions = await readFile(
    fileURLToPath(new URL("../../skills/thread-instructions.md", import.meta.url)),
    "utf8",
  );
  const command = /`med review (create [^`]+)`/.exec(instructions)![1]!.replace(/\s+/g, " ");
  expect(command).toBe('create --working --title "<2-4 words>" --guide -');
  await writeFile(join(worktree, "summary.ts"), "export const best = 2;\n");
  const guide = join(worktree, "..", "guide.json");
  await writeFile(
    guide,
    JSON.stringify({
      summary: "The best result is two.",
      segments: [{ title: "Best result", files: ["summary.ts"] }],
    }),
  );
  const printed: string[] = [];
  const run = (words: string[]) =>
    runReviewCommand(words, { environment, home, print: (line) => printed.push(line) });
  await run(["create", "--working", "--title", "Best result", "--guide", guide]);

  // The thread captured nothing at its start; the hand-off is its Review's
  // version 1, with the change and its guide.
  expect(review.targets).toEqual([]);
  const saved = (await api<SavedReview>(`/api/reviews/${review.id}`)).data;
  expect(saved.iterations).toHaveLength(1);
  expect(saved.totals).toMatchObject({ files: 1, additions: 1, deletions: 1 });
  expect(saved.iterations![0]!.guide?.segments.map((segment) => segment.title)).toEqual([
    "Best result",
  ]);

  // Med sends the user's messages itself, so wait ends at once.
  printed.length = 0;
  await run(["wait"]);
  expect(printed.join("\n")).toContain("Do not run med review wait in this session.");
});
