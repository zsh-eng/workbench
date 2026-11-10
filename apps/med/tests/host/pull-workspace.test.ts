import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { OwnedState } from "../../src/shared/owned-session";
import type { RegisteredRepository } from "../../src/shared/protocol";
import type { PullJob } from "../../src/shared/pull-workspace";
import type { SavedReview } from "../../src/shared/saved-review";
import { threadOfReview } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { readServerEvents } from "../../src/web/data/sse";
import { removeFolder } from "./remove-folder";

const directories: string[] = [];
const hosts: RunningHost[] = [];
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(directories.splice(0).map((path) => removeFolder(path)));
  vi.unstubAllEnvs();
});

const fixture = (name: string) => fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url));
const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

test("a pasted pull request link opens in a worktree with its review and an agent, and closing removes the worktree", async () => {
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
    session: { agent: "claude", cwd: job.worktree },
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

  // Closing the workspace removes its worktree; an agent at work, the main
  // checkout, and untracked files keep it.
  const remove = (path: string) =>
    api<{ removed?: true; error?: { message: string } }>("/api/worktrees/remove", { path });
  const owned = `/api/sessions/${threadOfReview(review)}/owned`;
  const status = async () => (await api<OwnedState>(owned)).data.status;
  await api(owned, { action: "prompt", text: "Wait" });
  await vi.waitFor(async () => expect(await status()).toBe("working"));
  expect((await remove(job.worktree!)).data.error?.message).toBe(
    "An agent is working in this worktree. Stop it, then try again.",
  );
  await api(owned, { action: "interrupt" });
  await vi.waitFor(async () => expect(await status()).toBe("idle"));
  expect(await remove(repo)).toMatchObject({
    status: 409,
    data: {
      error: {
        message: "This is the repository's own checkout. Med removes only linked worktrees.",
      },
    },
  });
  await writeFile(join(job.worktree!, "notes.md"), "Ask about rounding.\n");
  expect(await remove(job.worktree!)).toMatchObject({
    status: 409,
    data: {
      error: {
        message: "It has changed or untracked files. Commit or discard them, then try again.",
      },
    },
  });
  expect(await status()).toBe("idle");
  await rm(join(job.worktree!, "notes.md"));
  expect(await remove(job.worktree!)).toEqual({ status: 200, data: { removed: true } });
  await expect(stat(job.worktree!)).rejects.toThrow("ENOENT");
  expect(git(repo, "worktree", "list")).not.toContain("pr-7");
  // The branch keeps its commits, and the agent that worked there stops.
  expect(git(repo, "rev-parse", "durations")).toBe(head);
  await vi.waitFor(async () => expect(await status()).toBe("exited"));
  const listed = await api<{ repositories: RegisteredRepository[] }>("/api/repositories");
  expect(listed.data.repositories[0]!.worktrees.map((entry) => entry.path)).toEqual([repo]);
  expect((await remove(job.worktree!)).status).toBe(403);

  // The link opens again in a new worktree, with the same review.
  const reopened = await follow((await api<PullJob>("/api/pulls", { url: started.data.url })).data);
  expect(reopened.at(-1)).toMatchObject({ status: "done", reviewId: job.reviewId });
  expect(reopened.at(-1)!.steps.find((step) => step.id === "worktree")?.label).toBe(
    "Make a worktree",
  );
});

test("the pull requests page searches GitHub in the registered repositories' remotes, or in all of it", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med pull inbox ")));
  directories.push(directory);
  const repo = join(directory, "trailhead");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "git@github.com:acme/trailhead.git");
  const log = join(directory, "gh.log");
  const node = (number: number, author: string) => ({
    url: `https://github.com/acme/trailhead/pull/${number}`,
    number,
    title: `Change ${number}`,
    isDraft: false,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-02T00:00:00Z",
    additions: 3,
    deletions: 1,
    headRefName: `topic-${number}`,
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    author: { login: author },
    repository: { nameWithOwner: "acme/trailhead" },
    commits: { nodes: [] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "you" } }] },
  });
  vi.stubEnv("FAKE_GH_LOG", log);
  vi.stubEnv(
    "FAKE_GH_SEARCH",
    // An issue in the results is not a pull request, and is left out.
    JSON.stringify({
      review: [node(418, "maya"), { title: "An issue" }],
      author: [node(420, "you")],
    }),
  );
  vi.stubEnv("MED_HOME_DIR", join(directory, "home"));
  const host = await startHost({
    repo,
    stateDir: join(directory, "state"),
    port: 0,
    gh: { command: process.execPath, args: [fixture("gh/fake-gh.mjs")] },
  });
  hosts.push(host);
  const read = async (query = "") =>
    (await (
      await fetch(`http://127.0.0.1:${host.port}/api/pull-requests${query}`, {
        headers: { authorization: `Bearer ${host.token}` },
      })
    ).json()) as {
      scope: string;
      repositories: string[];
      waiting: { number: number; why?: string }[];
      yours: { number: number }[];
    };
  const searches = async () =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => (JSON.parse(line) as string[]).find((arg) => arg.startsWith("q=")));
  const inbox = await read();
  expect(inbox).toMatchObject({
    scope: "registered",
    repositories: ["acme/trailhead"],
    waiting: [{ number: 418, why: "review requested" }],
    yours: [{ number: 420 }],
  });
  expect((await searches()).sort()).toEqual([
    "q=is:pr is:open archived:false author:@me repo:acme/trailhead",
    "q=is:pr is:open archived:false review-requested:@me repo:acme/trailhead",
  ]);
  // A read stays a minute, unless the page asks again.
  await read();
  expect(await searches()).toHaveLength(2);
  await read("?refresh=1");
  expect(await searches()).toHaveLength(4);
  // All of GitHub has no repository qualifiers.
  expect((await read("?all=1")).scope).toBe("all");
  expect((await searches()).slice(-2).sort()).toEqual([
    "q=is:pr is:open archived:false author:@me",
    "q=is:pr is:open archived:false review-requested:@me",
  ]);
});

test("the pull requests page also searches the GitHub hosts that Settings names, and lists the rest when gh cannot read one", async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med pull hosts ")));
  directories.push(directory);
  const repository = async (name: string, remote: string) => {
    const path = join(directory, name);
    await mkdir(path);
    git(path, "init", "-q", "-b", "main");
    git(path, "remote", "add", "origin", remote);
    return path;
  };
  const trailhead = await repository("trailhead", "git@github.com:acme/trailhead.git");
  // GitHub Enterprise, which Settings names, and a host that answers as
  // GitHub does but that Settings leaves out.
  const charts = await repository("charts", "git@github.acme.build:Tides/Charts.git");
  const notes = await repository("notes", "https://git.acme.build/tides/notes.git");
  const log = join(directory, "gh.log");
  const node = (number: number, author: string, host: string, repository: string, day: string) => ({
    url: `https://${host}/${repository}/pull/${number}`,
    number,
    title: `Change ${number}`,
    isDraft: false,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: `2026-11-${day}T00:00:00Z`,
    additions: 3,
    deletions: 1,
    headRefName: `topic-${number}`,
    baseRefName: "main",
    reviewDecision: "REVIEW_REQUIRED",
    mergeable: "MERGEABLE",
    author: { login: author },
    repository: { nameWithOwner: repository },
    commits: { nodes: [] },
    reviewRequests: { nodes: [{ requestedReviewer: { __typename: "User", login: "you" } }] },
  });
  vi.stubEnv("FAKE_GH_LOG", log);
  vi.stubEnv(
    "FAKE_GH_SEARCH",
    JSON.stringify({
      review: [node(418, "maya", "github.com", "acme/trailhead", "02")],
      author: [node(420, "you", "github.com", "acme/trailhead", "02")],
      hosts: {
        "github.acme.build": {
          review: [node(7, "lena", "github.acme.build", "Tides/Charts", "03")],
          author: [node(9, "you", "github.acme.build", "Tides/Charts", "03")],
        },
      },
    }),
  );
  vi.stubEnv("MED_HOME_DIR", join(directory, "home"));
  const host = await startHost({
    repo: trailhead,
    repos: [trailhead, charts, notes],
    stateDir: join(directory, "state"),
    port: 0,
    gh: { command: process.execPath, args: [fixture("gh/fake-gh.mjs")] },
    openIn: { isGitHub: async (name) => name === "git.acme.build" },
  });
  hosts.push(host);
  const base = `http://127.0.0.1:${host.port}`;
  const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const put = await fetch(`${base}/api/settings`, {
    method: "PUT",
    headers,
    body: JSON.stringify({
      key: "openIn.hosts",
      value: { "github.acme.build": "github", "git.acme.build": "off" },
    }),
  });
  expect(put.status).toBe(200);
  const read = async (query = "") =>
    (await (await fetch(`${base}/api/pull-requests${query}`, { headers })).json()) as {
      repositories: string[];
      waiting: { number: number }[];
      yours: { number: number }[];
      skipped?: { host: string; reason: string }[];
    };
  const numbers = (inbox: Awaited<ReturnType<typeof read>>) => ({
    waiting: inbox.waiting.map((row) => row.number),
    yours: inbox.yours.map((row) => row.number),
  });
  // Each search names its host, and goes there.
  const searches = async () =>
    (await readFile(log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => {
        const args = JSON.parse(line) as string[];
        const at = args.indexOf("--hostname");
        const query = args.find((arg) => arg.startsWith("q=")) ?? "";
        return `${at < 0 ? "github.com" : args[at + 1]} ${query.replace("q=is:pr is:open archived:false ", "")}`;
      });

  const inbox = await read();
  expect(inbox.repositories).toEqual(["acme/trailhead", "github.acme.build/tides/charts"]);
  // Both hosts' pull requests, newest first: what waits on you, then yours.
  expect(numbers(inbox)).toEqual({ waiting: [7, 418], yours: [9, 420] });
  expect(inbox.skipped).toBeUndefined();
  expect((await searches()).sort()).toEqual([
    "github.acme.build author:@me repo:tides/charts",
    "github.acme.build review-requested:@me repo:tides/charts",
    "github.com author:@me repo:acme/trailhead",
    "github.com review-requested:@me repo:acme/trailhead",
  ]);

  // A host that gh is not signed in to leaves the others listed, and says why.
  vi.stubEnv("FAKE_GH_SIGNED_OUT", "github.acme.build");
  const partial = await read("?refresh=1");
  expect(numbers(partial)).toEqual({ waiting: [418], yours: [420] });
  expect(partial.skipped).toEqual([
    {
      host: "github.acme.build",
      reason: "You are not logged into any accounts on github.acme.build",
    },
  ]);

  // All of GitHub searches every GitHub host, with no repository qualifiers.
  vi.stubEnv("FAKE_GH_SIGNED_OUT", "");
  await writeFile(log, "");
  expect(numbers(await read("?all=1"))).toEqual({ waiting: [7, 418], yours: [9, 420] });
  expect((await searches()).sort()).toEqual([
    "github.acme.build author:@me",
    "github.acme.build review-requested:@me",
    "github.com author:@me",
    "github.com review-requested:@me",
  ]);
});
