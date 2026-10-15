import { afterEach, expect, test, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SavedReview } from "../../src/shared/saved-review";
import type { ThreadList } from "../../src/shared/threads";
import { startHost, type RunningHost } from "../../src/host/server";
import { readServerEvents } from "../../src/web/data/sse";

// A thread learns the pull request that its branch opened after the thread
// did: the host asks gh for the open tabs only, and only with a gh sign-in.

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

const git = (cwd: string, ...args: string[]) =>
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

async function fixture({ signedIn }: { signedIn: boolean }) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), "med pr links ")));
  directories.push(directory);
  const repo = join(directory, "trails");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  git(repo, "remote", "add", "origin", "git@github.com:acme/trails.git");
  await writeFile(join(repo, "trails.ts"), "export const trails = [];\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "Start");
  // Two branches in worktrees, each with a commit and an open pull request.
  const heads: Record<string, string> = {};
  for (const branch of ["durations", "elevation"]) {
    const tree = join(directory, branch);
    git(repo, "worktree", "add", "-q", "-b", branch, tree);
    await writeFile(join(tree, `${branch}.ts`), `export const ${branch} = 1;\n`);
    git(tree, "add", ".");
    git(tree, "commit", "-q", "-m", `Add ${branch}`);
    heads[branch] = git(tree, "rev-parse", "HEAD");
  }
  const pull = (number: number, branch: string) => ({
    url: `https://github.com/acme/trails/pull/${number}`,
    title: `Add ${branch}`,
    number,
    headRefOid: heads[branch],
  });
  vi.stubEnv(
    "FAKE_GH_PULLS",
    JSON.stringify({ durations: [pull(7, "durations")], elevation: [pull(8, "elevation")] }),
  );
  const log = join(directory, "gh.log");
  vi.stubEnv("FAKE_GH_LOG", log);
  // gh's sign-in: its hosts file, without token variables.
  for (const name of ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"])
    vi.stubEnv(name, "");
  const config = join(directory, "gh-config");
  await mkdir(config);
  if (signedIn) await writeFile(join(config, "hosts.yml"), "github.com:\n    user: trails\n");
  vi.stubEnv("GH_CONFIG_DIR", config);
  vi.stubEnv("MED_HOME_DIR", join(directory, "home"));
  const host = await startHost({
    repo,
    repos: [repo],
    stateDir: join(directory, "state"),
    port: 0,
    gh: {
      command: process.execPath,
      args: [fileURLToPath(new URL("../fixtures/gh/fake-gh.mjs", import.meta.url))],
    },
  });
  hosts.push(host);
  const api = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect({ path, status: response.status }).toEqual({ path, status: 200 });
    return (await response.json()) as T;
  };
  const thread = (branch: string) =>
    api<SavedReview>("/api/reviews", {
      title: `Add ${branch}`,
      targets: [
        {
          repo: join(directory, branch),
          comparison: { kind: "range", base: "main", head: heads[branch], mergeBase: true },
        },
      ],
    });
  /** A window's thread list: the host reads it while a window listens. */
  const listen = async () => {
    const response = await fetch(`http://127.0.0.1:${host.port}/api/threads/events`, {
      headers: { authorization: `Bearer ${host.token}` },
    });
    const lists: ThreadList[] = [];
    const controller = new AbortController();
    streams.push(controller);
    void readServerEvents(
      response.body!,
      (event) => lists.push(JSON.parse(event.data) as ThreadList),
      controller.signal,
    ).catch(() => {});
    await vi.waitFor(() => expect(lists.length).toBeGreaterThan(0));
    return lists;
  };
  /** The branches that gh was asked about. */
  const asked = async () =>
    (await readFile(log, "utf8").catch(() => ""))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as string[])
      .filter((args) => args[0] === "pr" && args[1] === "list")
      .map((args) => args[args.indexOf("--head") + 1]);
  return { api, thread, listen, asked };
}

test("an open thread links the pull request that its branch opened later; history asks gh nothing", async () => {
  const { api, thread, listen, asked } = await fixture({ signedIn: true });
  const open = await thread("durations");
  const closed = await thread("elevation");
  expect(open.pullRequestUrl).toBeUndefined();
  // The second thread goes to history before any window lists the tabs.
  await api(`/api/threads/${closed.id}/close`, {});

  const lists = await listen();
  await vi.waitFor(
    () =>
      expect(lists.at(-1)!.threads.find((entry) => entry.id === open.id)?.pullRequestUrl).toBe(
        "https://github.com/acme/trails/pull/7",
      ),
    { timeout: 10_000 },
  );
  const linked = await api<SavedReview>(`/api/reviews/${open.id}`);
  expect(linked).toMatchObject({
    pullRequestUrl: "https://github.com/acme/trails/pull/7",
    pullRequestTitle: "Add durations",
  });
  expect(await asked()).toEqual(["durations"]);
  expect((await api<SavedReview>(`/api/reviews/${closed.id}`)).pullRequestUrl).toBeUndefined();

  // A linked thread asks no more, through two more reads of the tabs.
  await new Promise((resolve) => setTimeout(resolve, 3500));
  expect(await asked()).toEqual(["durations"]);
});

test("without a gh sign-in, the host starts no gh process", async () => {
  const { thread, listen, asked } = await fixture({ signedIn: false });
  const open = await thread("durations");
  const lists = await listen();
  // Three reads of the tabs, 1.5 seconds apart.
  await new Promise((resolve) => setTimeout(resolve, 4000));
  expect(await asked()).toEqual([]);
  expect(lists.at(-1)!.threads.find((entry) => entry.id === open.id)?.pullRequestUrl).toBe(
    undefined,
  );
});
