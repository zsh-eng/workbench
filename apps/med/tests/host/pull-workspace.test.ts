import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PullJob } from "../../src/shared/pull-workspace";
import type { SavedReview } from "../../src/shared/saved-review";
import { startHost, type RunningHost } from "../../src/host/server";
import { readServerEvents } from "../../src/web/data/sse";

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
  vi.unstubAllEnvs();
});

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("a pasted pull request link opens in a worktree with its review and an agent", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med pull ")));
  directories.push(directory);
  // GitHub, as a bare repository with the pull request's head ref.
  const upstream = join(directory, "upstream");
  await mkdir(upstream);
  git(upstream, "init", "-q", "-b", "main");
  git(upstream, "config", "user.email", "test@example.com");
  git(upstream, "config", "user.name", "Test");
  await writeFile(join(upstream, "trails.ts"), "export const trails = [];\n");
  git(upstream, "add", ".");
  git(upstream, "commit", "-q", "-m", "Start");
  const base = git(upstream, "rev-parse", "HEAD");
  git(upstream, "checkout", "-q", "-b", "durations");
  await writeFile(
    join(upstream, "duration.ts"),
    "export const minutes = (ms: number) => ms / 60_000;\n",
  );
  git(upstream, "add", ".");
  git(upstream, "commit", "-q", "-m", "Add durations");
  const head = git(upstream, "rev-parse", "HEAD");
  git(upstream, "checkout", "-q", "main");
  const remote = join(directory, "remote.git");
  git(directory, "clone", "-q", "--bare", upstream, remote);
  git(remote, "update-ref", "refs/pull/7/head", head);
  // The user's clone: its origin names GitHub; it has main, not the branch.
  const repo = join(directory, "trails");
  git(directory, "clone", "-q", "--branch", "main", "--single-branch", remote, repo);
  git(repo, "remote", "set-url", "origin", "git@github.com:acme/trails.git");
  vi.stubEnv("FAKE_GH_REMOTE", remote);
  vi.stubEnv(
    "FAKE_GH_PULL",
    JSON.stringify({
      number: 7,
      title: "Add durations",
      url: "https://github.com/acme/trails/pull/7",
      baseRefName: "main",
      baseRefOid: base,
      headRefName: "durations",
      headRefOid: head,
    }),
  );
  vi.stubEnv("MED_HOME_DIR", join(directory, "home"));
  const stateDir = join(directory, "state");
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir,
    port: 0,
    gh: { command: process.execPath, args: [fixture("gh/fake-gh.mjs")] },
    agents: async () => [
      {
        id: "claude",
        name: "Claude Code",
        kind: "claude",
        available: true,
        command: process.execPath,
        args: [fixture("agents/fake-claude.mjs")],
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
  /** Each state of a job, as the workspace reads them, until it ends. */
  const follow = async (job: PullJob) => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/pulls/${job.id}/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    const states: PullJob[] = [];
    const controller = new AbortController();
    await readServerEvents(
      response.body!,
      (event) => {
        states.push(JSON.parse(event.data) as PullJob);
        if (states.at(-1)!.status !== "running") controller.abort();
      },
      controller.signal,
    ).catch(() => {});
    return states;
  };

  // A link from the Files tab names the same pull request.
  const started = await api<PullJob>("/api/pulls", {
    url: "https://github.com/acme/trails/pull/7/files",
    agent: "claude",
  });
  expect(started.data).toMatchObject({ slug: "acme/trails", number: 7, status: "running" });
  const states = await follow(started.data);
  const job = states.at(-1)!;
  expect(job.error).toBeUndefined();
  expect(job).toMatchObject({ status: "done", title: "Add durations" });
  // The workspace shows the title before the review is ready.
  expect(states.some((state) => state.title && !state.reviewId)).toBe(true);
  expect(job.steps.map((step) => [step.label, step.state, step.detail])).toEqual([
    ["Find acme/trails", "done", repo],
    ["Read pull request #7", "done", "Add durations"],
    ["Make a worktree", "done", job.worktree],
    ["Check out durations", "done", "durations"],
    ["Fetch main", "skipped", "Already here"],
    ["Save the review", "done", undefined],
    ["Start Claude Code", "done", undefined],
  ]);
  // The worktree has the head; the user's checkout stays on main.
  expect(job.worktree).toBe(join(stateDir, "worktrees", job.worktree!.split("/").at(-2)!, "pr-7"));
  expect(git(job.worktree!, "rev-parse", "HEAD")).toBe(head);
  expect(git(repo, "branch", "--show-current")).toBe("main");

  const review = (await api<SavedReview>(`/api/reviews/${job.reviewId}`)).data;
  expect(review).toMatchObject({
    title: "#7 Add durations",
    pullRequestUrl: "https://github.com/acme/trails/pull/7",
    targets: [{ repo: job.worktree, base, head }],
    sessions: [{ agent: "claude", cwd: job.worktree }],
  });

  // The same link again reuses the worktree and the review.
  const again = await follow((await api<PullJob>("/api/pulls", { url: started.data.url })).data);
  expect(again.at(-1)).toMatchObject({ status: "done", reviewId: job.reviewId });
  expect(again.at(-1)!.steps.find((step) => step.id === "worktree")?.label).toBe(
    "Use the worktree",
  );
  expect(again.at(-1)!.steps.find((step) => step.id === "review")?.detail).toBe("Up to date");

  // A repository that Med does not know fails at the first step and says why.
  const unknown = await follow(
    (await api<PullJob>("/api/pulls", { url: "https://github.com/acme/other/pull/1" })).data,
  );
  expect(unknown.at(-1)).toMatchObject({
    status: "failed",
    error: "Add a clone of acme/other to Med, then open the link again.",
  });
  expect(unknown.at(-1)!.steps[0]!.state).toBe("failed");
  expect((await api("/api/pulls", { url: "https://example.com/not-a-pull" })).status).toBe(400);
});
