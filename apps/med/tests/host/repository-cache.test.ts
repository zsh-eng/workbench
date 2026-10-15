import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost, type RunningHost, type StartHostOptions } from "../../src/host/server";
import type { BrowseList } from "../../src/shared/browse";
import type { GitTargets } from "../../src/shared/git-actions";
import type { Branch, Session } from "../../src/shared/protocol";
import type { SavedReview } from "../../src/shared/saved-review";

// The host answers Git questions from a cache. These tests change the
// repository between reads and check that each answer follows: at once for
// answers from Git metadata, and after the watcher's file event for answers
// from working files.

const temporary: string[] = [];
const hosts: RunningHost[] = [];
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      // Not the parent's GIT_* variables: a GIT_DIR would lead to another repository.
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();

/** Polls with real timers, which the safety-check test does not fake. */
async function until<T>(read: () => Promise<T>, done: (value: T) => boolean, timeout = 5000) {
  const end = Date.now() + timeout;
  for (;;) {
    const value = await read();
    if (done(value) || Date.now() > end) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

async function fixture(watch: StartHostOptions["watch"] = {}) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), "med repository cache ")));
  temporary.push(parent);
  const repo = join(parent, "repo");
  await mkdir(repo);
  git(repo, "init", "--quiet", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  await writeFile(join(repo, "file.ts"), "export const value = 1;\n");
  git(repo, "add", ".");
  git(repo, "commit", "--quiet", "-m", "initial");
  const ready = new Set<string>();
  const host = await startHost({
    repo,
    search: { binDir: "/no-med-test-search-tools" },
    watch: { ...watch, onReady: (path) => ready.add(path) },
  });
  hosts.push(host);
  const read = async <T>(path: string, body?: unknown): Promise<T> => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.ok, `${path}: ${response.status}`).toBe(true);
    return (await response.json()) as T;
  };
  /** Waits until the checkout's watcher sees file edits, so that reads use the cache. */
  const watching = async () => {
    await until(async () => ready.has(repo), Boolean);
    expect(ready.has(repo)).toBe(true);
  };
  /** Opens the checkout's event stream, as a window that shows it does. */
  const show = async () => {
    const stream = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${host.port}/api/events?repo=${encodeURIComponent(repo)}`,
      { headers: { authorization: `Bearer ${host.token}` }, signal: stream.signal },
    );
    await response.body!.getReader().read();
    return () => stream.abort();
  };
  /** A plain GET, for its status and headers. */
  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(`http://127.0.0.1:${host.port}${path}`, {
      headers: { authorization: `Bearer ${host.token}`, ...headers },
    });
  return { parent, repo, read, get, watching, show };
}

async function answers({ repo, read }: Awaited<ReturnType<typeof fixture>>) {
  const query = `repo=${encodeURIComponent(repo)}`;
  const [session, branches, targets, list] = await Promise.all([
    read<Session>(`/api/session?${query}`),
    read<Branch[]>(`/api/branches?${query}`),
    read<GitTargets>(`/api/git/targets?${query}`),
    read<BrowseList>("/api/browse/list", { source: { kind: "worktree", repo } }),
  ]);
  return {
    head: session.repository.head,
    branch: session.repository.branch,
    worktrees: session.worktrees.map((tree) => tree.path),
    branches: branches.map((entry) => `${entry.name} ${entry.head}`),
    targetHead: targets.head,
    targetBranch: targets.branch,
    refs: targets.refs.map((ref) => ref.label),
    untracked: list.entries.filter((entry) => entry.status === "?").map((entry) => entry.path),
    tracked: list.entries.filter((entry) => !entry.status).map((entry) => entry.path),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("cached Git answers follow a commit, a checkout, a stage, an unstage, a new worktree, and a branch delete", async () => {
  // A long safety check: only Git metadata and file events can change the answers.
  const value = await fixture({ safetyMs: 600_000 });
  const { parent, repo, watching } = value;
  const first = await answers(value);
  await watching();
  // Reads after the watcher is ready come from the cache and give the same answers.
  expect(await answers(value)).toEqual(first);
  expect(first.tracked).toEqual(["file.ts"]);

  await writeFile(join(repo, "second.ts"), "export const second = 2;\n");
  git(repo, "add", "second.ts");
  git(repo, "commit", "--quiet", "-m", "second");
  const head = git(repo, "rev-parse", "HEAD");
  const committed = await answers(value);
  expect(committed).toMatchObject({ head, targetHead: head, branches: [`main ${head}`] });

  git(repo, "switch", "--quiet", "-c", "topic");
  expect(await answers(value)).toMatchObject({
    branch: "topic",
    targetBranch: "topic",
    branches: [`main ${head}`, `topic ${head}`],
    refs: ["main", "topic"],
  });

  // Answers from working files follow the watcher's event, well before the safety check.
  await writeFile(join(repo, "new.ts"), "export const fresh = 3;\n");
  expect(
    (
      await until(
        () => answers(value),
        (next) => next.untracked.includes("new.ts"),
      )
    ).untracked,
  ).toEqual(["new.ts"]);
  git(repo, "add", "new.ts");
  const staged = await until(
    () => answers(value),
    (next) => next.tracked.includes("new.ts"),
  );
  expect(staged).toMatchObject({ untracked: [], tracked: ["file.ts", "new.ts", "second.ts"] });
  git(repo, "rm", "--cached", "--quiet", "new.ts");
  const unstaged = await until(
    () => answers(value),
    (next) => next.untracked.includes("new.ts"),
  );
  expect(unstaged).toMatchObject({ untracked: ["new.ts"], tracked: ["file.ts", "second.ts"] });

  const linked = join(parent, "linked");
  git(repo, "worktree", "add", "--quiet", "-b", "side", linked);
  const added = await answers(value);
  expect(added.worktrees).toEqual([repo, linked]);
  expect(added.branches).toEqual([`main ${head}`, `side ${head}`, `topic ${head}`]);

  git(repo, "switch", "--quiet", "main");
  git(repo, "branch", "--quiet", "-D", "topic");
  expect(await answers(value)).toMatchObject({
    branch: "main",
    branches: [`main ${head}`, `side ${head}`],
    refs: ["main", "side"],
  });
});

/** A saved thread whose working changes Med captured. Its drift answer
 * says whether the checkout changed since. */
async function savedWorking(value: Awaited<ReturnType<typeof fixture>>) {
  const { repo, read } = value;
  await writeFile(join(repo, "file.ts"), "export const value = 2;\n");
  const saved = await read<SavedReview>("/api/reviews", {
    title: "Working",
    targets: [{ repo, comparison: { kind: "working" } }],
  });
  const target = saved.targets.find((entry) => entry.captured)!;
  return async () =>
    (await read<{ changed: boolean }>(`/api/reviews/${saved.id}/targets/${target.id}/drift`))
      .changed;
}

test("a saved target's diff answers a read again with 304 and no body", async () => {
  const value = await fixture();
  await writeFile(join(value.repo, "file.ts"), "export const value = 2;\n");
  const saved = await value.read<SavedReview>("/api/reviews", {
    title: "Working",
    targets: [{ repo: value.repo, comparison: { kind: "working" } }],
  });
  const path = `/api/reviews/${saved.id}/targets/${saved.targets[0]!.id}/review`;
  const first = await value.get(path);
  expect(first.status).toBe(200);
  const tag = first.headers.get("etag")!;
  expect(first.headers.get("cache-control")).toBe("private, no-cache");
  expect((await first.json()).files).toHaveLength(1);
  const again = await value.get(path, { "if-none-match": tag });
  expect(again.status).toBe(304);
  expect(await again.text()).toBe("");
});

test("a file edit updates the cached drift answer through the watcher's event", async () => {
  const value = await fixture({ safetyMs: 600_000 });
  const drift = await savedWorking(value);
  expect(await drift()).toBe(false);
  await value.watching();
  expect(await drift()).toBe(false);
  await writeFile(join(value.repo, "file.ts"), "export const value = 3;\n");
  expect(await until(drift, (changed) => changed, 3000)).toBe(true);
  await writeFile(join(value.repo, "file.ts"), "export const value = 2;\n");
  expect(await until(drift, (changed) => !changed, 3000)).toBe(false);
});

test("the safety check corrects a cached answer after a missed file event: each minute on screen, each 10 minutes off screen", async () => {
  // File events are off, so the watcher misses each edit. Only the safety
  // check, at its default interval, finds the change.
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const value = await fixture({ events: false });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 300));
  const drift = await savedWorking(value);
  expect(await drift()).toBe(false);
  await value.watching();
  expect(await drift()).toBe(false);

  // No window shows the checkout: the check runs every 10 minutes.
  await writeFile(join(value.repo, "file.ts"), "export const value = 3;\n");
  await settle();
  vi.advanceTimersByTime(9 * 60_000);
  await settle();
  expect(await drift()).toBe(false);
  vi.advanceTimersByTime(60_000);
  expect(await until(drift, (changed) => changed, 3000)).toBe(true);

  // A window shows it, with the checkout's event stream: the check runs each minute.
  const hide = await value.show();
  await writeFile(join(value.repo, "file.ts"), "export const value = 2;\n");
  await settle();
  expect(await drift()).toBe(true);
  vi.advanceTimersByTime(60_000);
  expect(await until(drift, (changed) => !changed, 3000)).toBe(false);
  hide();
});
