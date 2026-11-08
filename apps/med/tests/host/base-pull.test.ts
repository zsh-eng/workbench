import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { BasePulls, pullBase } from "../../src/host/repository/base-pull";
import { startHost, type RunningHost } from "../../src/host/server";
import type { RegisteredRepository } from "../../src/shared/protocol";

// Synthetic repositories only: a bare remote, the checkout that Med pulls,
// and another clone that pushes to the remote, as a teammate would.

const roots: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const env = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
};
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function commit(repo: string, file: string, text: string) {
  await writeFile(join(repo, file), text);
  git(repo, "add", file);
  git(repo, "commit", "-q", "-m", `Change ${file}`);
  return git(repo, "rev-parse", "HEAD");
}

async function fixture(branch = "main") {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-base-pull-")));
  roots.push(root);
  const remote = join(root, "remote.git");
  git(root, "init", "-q", "--bare", "-b", branch, remote);
  const seed = join(root, "seed");
  git(root, "init", "-q", "-b", branch, seed);
  git(seed, "config", "commit.gpgsign", "false");
  await commit(seed, "trail.txt", "Loop trail\n");
  git(seed, "remote", "add", "origin", remote);
  git(seed, "push", "-q", "origin", branch);
  const repo = join(root, "trailhead");
  git(root, "clone", "-q", remote, repo);
  git(repo, "config", "commit.gpgsign", "false");
  const teammate = join(root, "teammate");
  git(root, "clone", "-q", remote, teammate);
  git(teammate, "config", "commit.gpgsign", "false");
  /** A new commit on the remote's base branch. */
  const push = async (text: string) => {
    git(teammate, "pull", "-q", "--ff-only");
    const head = await commit(teammate, "trail.txt", text);
    git(teammate, "push", "-q", "origin", branch);
    return head;
  };
  const registered = (): RegisteredRepository => ({
    id: "trailhead",
    path: repo,
    name: "trailhead",
    branches: [],
    worktrees: [
      {
        path: repo,
        head: git(repo, "rev-parse", "HEAD"),
        branch: git(repo, "branch", "--show-current"),
      },
    ],
  });
  return { root, remote, repo, push, registered };
}

test("a clean checkout of the base branch moves forward to the remote's", async () => {
  const { repo, push, registered } = await fixture();
  const before = git(repo, "rev-parse", "main");
  expect(await pullBase(registered())).toEqual({
    repository: repo,
    branch: "main",
    outcome: "current",
  });
  const head = await push("Loop trail, 5 km\n");
  expect(await pullBase(registered())).toEqual({
    repository: repo,
    branch: "main",
    outcome: "updated",
    from: before,
    to: head,
  });
  expect(git(repo, "rev-parse", "HEAD")).toBe(head);
  expect(await readFile(join(repo, "trail.txt"), "utf8")).toBe("Loop trail, 5 km\n");
  expect(git(repo, "status", "--porcelain")).toBe("");
});

test("a base branch that no checkout has out moves by its ref; the checkout's own branch stays", async () => {
  const { repo, push, registered } = await fixture();
  git(repo, "switch", "-q", "-c", "search-filters");
  const own = await commit(repo, "filters.ts", "export {};\n");
  const head = await push("Loop trail, 5 km\n");
  const result = await pullBase(registered());
  expect(result).toMatchObject({ branch: "main", outcome: "updated", to: head });
  expect(git(repo, "rev-parse", "main")).toBe(head);
  expect(git(repo, "rev-parse", "HEAD")).toBe(own);
  expect(git(repo, "branch", "--show-current")).toBe("search-filters");
});

test("uncommitted changes or commits of its own leave the branch, and only fetch", async () => {
  const { repo, push, registered } = await fixture();
  const before = git(repo, "rev-parse", "main");
  await writeFile(join(repo, "trail.txt"), "My edit\n");
  const head = await push("Loop trail, 5 km\n");
  expect(await pullBase(registered())).toEqual({
    repository: repo,
    branch: "main",
    outcome: "fetched",
    reason: "main is checked out with uncommitted changes.",
  });
  expect(git(repo, "rev-parse", "main")).toBe(before);
  expect(git(repo, "rev-parse", "origin/main")).toBe(head);
  expect(await readFile(join(repo, "trail.txt"), "utf8")).toBe("My edit\n");

  git(repo, "checkout", "-q", "--", "trail.txt");
  const mine = await commit(repo, "notes.txt", "Mine\n");
  expect(await pullBase(registered())).toMatchObject({
    outcome: "fetched",
    reason: "main has commits of its own.",
  });
  expect(git(repo, "rev-parse", "main")).toBe(mine);
});

test("the base branch goes by the remote's name for it, such as develop", async () => {
  const { repo, push, registered } = await fixture("develop");
  expect(git(repo, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")).toBe("origin/develop");
  const head = await push("Loop trail, 5 km\n");
  expect(await pullBase(registered())).toMatchObject({ branch: "develop", outcome: "updated" });
  expect(git(repo, "rev-parse", "develop")).toBe(head);
});

test("a repository without a remote, or an unreachable one, says why", async () => {
  const { root, repo, remote, registered } = await fixture();
  const alone = join(root, "alone");
  git(root, "init", "-q", "-b", "main", alone);
  git(alone, "config", "commit.gpgsign", "false");
  await commit(alone, "a.txt", "a\n");
  expect(
    await pullBase({ id: "alone", path: alone, name: "alone", branches: [], worktrees: [] }),
  ).toEqual({ repository: alone, outcome: "skipped", reason: "No base branch with a remote." });

  await rm(remote, { recursive: true, force: true });
  const result = await pullBase(registered());
  expect(result).toMatchObject({ repository: repo, branch: "main", outcome: "failed" });
  expect(result.reason).toBeTruthy();
});

test("the pulls run on a timer while the setting is on, and refresh the repositories after a move", async () => {
  const { repo, push, registered } = await fixture();
  let enabled = false;
  let refreshed = 0;
  const pulls = new BasePulls(
    {
      repositories: () => [registered()],
      enabled: async () => enabled,
      refresh: async () => refreshed++,
    },
    { delayMs: 10, intervalMs: 10 },
  );
  const head = await push("Loop trail, 5 km\n");
  expect(await pulls.run()).toEqual([]);
  enabled = true;
  pulls.start();
  try {
    await expect.poll(() => pulls.last.get(repo)?.outcome).toBe("updated");
    expect(git(repo, "rev-parse", "HEAD")).toBe(head);
    expect(refreshed).toBe(1);
    await expect.poll(() => pulls.last.get(repo)?.outcome).toBe("current");
  } finally {
    pulls.close();
  }
});

test("the host pulls now on POST /api/base-pulls, and reports the last pulls", async () => {
  const { root, repo, push } = await fixture();
  const settingsPath = join(root, "settings.json");
  const host = await startHost({ repo, stateDir: join(root, "state"), settingsPath, port: 0 });
  hosts.push(host);
  const api = (method: string) =>
    fetch(`http://127.0.0.1:${host.port}/api/base-pulls`, {
      method,
      headers: { authorization: `Bearer ${host.token}` },
    }).then((response) => response.json() as Promise<{ pulls: { outcome: string }[] }>);
  const head = await push("Loop trail, 5 km\n");
  expect((await api("POST")).pulls).toMatchObject([{ branch: "main", outcome: "updated" }]);
  expect(git(repo, "rev-parse", "HEAD")).toBe(head);
  expect((await api("GET")).pulls).toMatchObject([{ branch: "main", outcome: "updated" }]);

  // `sources.pullBase: false` turns the pulls off.
  await writeFile(settingsPath, JSON.stringify({ "sources.pullBase": false }));
  await push("Loop trail, 6 km\n");
  expect((await api("POST")).pulls).toEqual([]);
  expect(git(repo, "rev-parse", "HEAD")).toBe(head);
});
