import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startHost, type RunningHost } from "../../src/host/server";
import type { FileChanges, WorkingStatus } from "../../src/shared/git-actions";

const roots: string[] = [];
const hosts: RunningHost[] = [];
const identity = {
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
};
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...identity, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
  }).trim();

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-commit-flow-")));
  roots.push(root);
  const repo = join(root, "repo");
  const remote = join(root, "remote.git");
  await mkdir(repo);
  git(repo, "init", "-b", "main");
  // The host's own commits read the repository's identity.
  git(repo, "config", "user.name", "Test");
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "commit.gpgsign", "false");
  await mkdir(remote);
  git(remote, "init", "--bare");
  git(repo, "remote", "add", "origin", remote);
  const host = await startHost({ repo, stateDir: join(root, "state"), port: 0 });
  hosts.push(host);
  const call = async <T>(path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${host.port}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: (await response.json()) as T };
  };
  const status = async () =>
    (await call<WorkingStatus>(`/api/git/status?repo=${encodeURIComponent(repo)}`)).body;
  const stage = (stage: boolean, paths?: string[]) =>
    call<WorkingStatus>("/api/git/stage", { repo, stage, ...(paths ? { paths } : {}) });
  const commit = (message: string, indexKey: string, more: object = {}) =>
    call<{ head?: string; summary?: string; error?: { message: string } }>("/api/git/commit", {
      repo,
      message,
      indexKey,
      ...more,
    });
  const push = (head: string, track: boolean) =>
    call<{ branch?: string; error?: { message: string } }>("/api/git/push-branch", {
      repo,
      head,
      track,
    });
  return { repo, remote, call, status, stage, commit, push };
}
const write = (repo: string, path: string, text: string) => writeFile(join(repo, path), text);
const summary = (status: WorkingStatus) =>
  status.files.map(
    (file) =>
      `${file.path}${file.previousPath ? ` <- ${file.previousPath}` : ""}: ${file.staged ?? "-"} / ${file.unstaged ?? "-"}`,
  );

afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("stages and unstages files, all changes, and literal names, before and after the first commit", async () => {
  const { repo, status, stage, call } = await fixture();
  await write(repo, "first.ts", "one\n");
  await write(repo, "*.ts", "a file named with a star\n");
  // Before the first commit, unstaging empties the index.
  let state = (await stage(true)).body;
  expect(state.head).toBe("");
  expect(summary(state)).toEqual(["*.ts: added / -", "first.ts: added / -"]);
  state = (await stage(false, ["*.ts"])).body;
  // The star names one file, not a pattern.
  expect(summary(state)).toEqual(["*.ts: - / untracked", "first.ts: added / -"]);
  git(repo, "add", "--all");
  git(repo, "commit", "-m", "start");

  await write(repo, "first.ts", "one\ntwo\n");
  git(repo, "mv", "*.ts", "star file.ts");
  await write(repo, "new.ts", "new\n");
  git(repo, "rm", "--quiet", "--cached", "first.ts");
  state = await status();
  expect(state.branch).toBe("main");
  expect(state.upstream).toBeNull();
  expect(state.pushRemote).toBe("origin");
  expect(summary(state)).toEqual([
    "first.ts: deleted / untracked",
    "new.ts: - / untracked",
    "star file.ts <- *.ts: renamed / -",
  ]);
  state = (await stage(true, ["first.ts", "new.ts"])).body;
  expect(summary(state)).toEqual([
    "first.ts: modified / -",
    "new.ts: added / -",
    "star file.ts <- *.ts: renamed / -",
  ]);
  // A rename unstages with its original path.
  state = (await stage(false, ["star file.ts", "*.ts"])).body;
  expect(summary(state)).toEqual([
    "*.ts: - / deleted",
    "first.ts: modified / -",
    "new.ts: added / -",
    "star file.ts: - / untracked",
  ]);
  state = (await stage(false)).body;
  expect(state.files.every((file) => file.staged === null)).toBe(true);

  // One file's staged and unstaged parts are separate patches.
  git(repo, "add", "first.ts");
  await write(repo, "first.ts", "one\ntwo\nthree\n");
  const changes = (
    await call<FileChanges>(`/api/git/file-changes?repo=${encodeURIComponent(repo)}&path=first.ts`)
  ).body;
  expect(changes.staged).toContain("+two");
  expect(changes.staged).not.toContain("+three");
  expect(changes.unstaged).toContain("+three");
  const untracked = (
    await call<FileChanges>(`/api/git/file-changes?repo=${encodeURIComponent(repo)}&path=new.ts`)
  ).body;
  expect(untracked).toMatchObject({ staged: "", binary: false });
  expect(untracked.unstaged).toContain("+new");
  expect((await stage(true, ["../outside"])).status).toBe(400);
});

test("stages and unstages more paths than one command line holds", async () => {
  const { repo, stage, commit } = await fixture();
  await mkdir(join(repo, "many"));
  // 6,000 paths of 190 characters are more than the 1 MB that macOS allows
  // for a command's arguments.
  const paths = Array.from({ length: 6000 }, (_, index) => `many/${"n".repeat(180)}-${index}.ts`);
  await Promise.all(paths.map((path) => write(repo, path, "one\n")));
  const states = (state: WorkingStatus) => [
    ...new Set(state.files.map((file) => `${file.staged ?? "-"} / ${file.unstaged ?? "-"}`)),
  ];

  // Before the first commit and after it.
  let result = await stage(true, paths);
  expect(result.status).toBe(200);
  expect(result.body.files).toHaveLength(6000);
  expect(states(result.body)).toEqual(["added / -"]);
  result = await stage(false, paths);
  expect(states(result.body)).toEqual(["- / untracked"]);
  result = await stage(true, paths);
  expect((await commit("start", result.body.indexKey)).status).toBe(200);
  await Promise.all(paths.map((path) => write(repo, path, "two\n")));
  result = await stage(true, paths);
  expect(states(result.body)).toEqual(["modified / -"]);
  result = await stage(false, paths);
  expect(result.body.files).toHaveLength(6000);
  expect(states(result.body)).toEqual(["- / modified"]);
});

test("commits only the staged state the view saw, and reports hook output", async () => {
  const { repo, status, stage, commit } = await fixture();
  await write(repo, "a.ts", "a\n");
  git(repo, "add", "a.ts");
  git(repo, "commit", "-m", "start");
  await write(repo, "a.ts", "a\nstaged\n");
  await write(repo, "b.ts", "not staged\n");
  const seen = (await stage(true, ["a.ts"])).body;

  expect(await commit("   ", seen.indexKey)).toMatchObject({ status: 422 });
  // Someone stages more after the view loaded: the commit refuses.
  git(repo, "add", "b.ts");
  expect(await commit("feat: a", seen.indexKey)).toMatchObject({ status: 409 });
  git(repo, "restore", "--staged", "b.ts");
  expect((await status()).indexKey).toBe(seen.indexKey);

  // A failing hook leaves nothing committed and returns its output.
  const hook = join(repo, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\necho 'lint: a.ts needs a semicolon' >&2\nexit 1\n");
  await chmod(hook, 0o755);
  const failed = await commit("feat: a", seen.indexKey);
  expect(failed.status).toBe(422);
  expect(failed.body.error?.message).toContain("lint: a.ts needs a semicolon");
  await rm(hook);

  // An edit to the working file after staging leaves the index as the view saw it.
  await write(repo, "a.ts", "a\nstaged\nlater\n");
  const done = await commit("feat: a\n\nThe body stays.\n", seen.indexKey);
  expect(done.status).toBe(200);
  expect(done.body.summary).toBe("feat: a");
  expect(git(repo, "log", "-1", "--format=%H%n%B")).toBe(
    `${done.body.head}\nfeat: a\n\nThe body stays.`,
  );
  expect(git(repo, "show", "--name-only", "--format=", "HEAD")).toBe("a.ts");
  expect(git(repo, "show", "HEAD:a.ts")).toBe("a\nstaged");
  // Unstaged work stays where it was.
  expect(summary(await status())).toEqual(["a.ts: - / modified", "b.ts: - / untracked"]);
  expect(await commit("again", (await status()).indexKey)).toMatchObject({ status: 422 });
});

test("Commit all stages in a copy of the index, so a failed hook leaves the index as it was", async () => {
  const { repo, status, commit } = await fixture();
  await write(repo, "a.ts", "a\n");
  git(repo, "add", "a.ts");
  git(repo, "commit", "-m", "start");
  await write(repo, "a.ts", "a\nb\n");
  await write(repo, "new.ts", "new\n");
  const seen = await status();
  const all = { all: true, files: [{ path: "a.ts" }, { path: "new.ts" }] };
  const hook = join(repo, ".git", "hooks", "pre-commit");
  await writeFile(hook, "#!/bin/sh\necho 'lint: a.ts needs a semicolon' >&2\nexit 1\n");
  await chmod(hook, 0o755);

  const failed = await commit("feat: all", seen.indexKey, all);
  expect(failed.status).toBe(422);
  expect(failed.body.error?.message).toContain("lint: a.ts needs a semicolon");
  // As after git commit -a: nothing is staged that was not staged before.
  expect(summary(await status())).toEqual(["a.ts: - / modified", "new.ts: - / untracked"]);
  expect((await status()).indexKey).toBe(seen.indexKey);

  await rm(hook);
  // A file that came after the tab read the checkout is not in the commit.
  await write(repo, "later.ts", "later\n");
  const done = await commit("feat: all", seen.indexKey, all);
  expect(done.status).toBe(200);
  expect(git(repo, "show", "--name-only", "--format=", "HEAD")).toBe("a.ts\nnew.ts");
  expect(summary(await status())).toEqual(["later.ts: - / untracked"]);
});

test("a commit stops when a file is not what the tab showed of it", async () => {
  const { repo, status, commit } = await fixture();
  await write(repo, "a.ts", "a\n");
  git(repo, "add", "a.ts");
  git(repo, "commit", "-m", "start");
  const start = git(repo, "rev-parse", "HEAD");
  const changed = "A file changed after the tab showed it. Check the changes, then commit again.";

  // The tab showed a.ts as staged. An agent changes and stages it again; the
  // tab reads the status, but its diff still shows the first change.
  await write(repo, "a.ts", "a\nshown\n");
  git(repo, "add", "a.ts");
  const shown = git(repo, "rev-parse", ":a.ts");
  await write(repo, "a.ts", "a\nlater\n");
  git(repo, "add", "a.ts");
  let seen = await status();
  let result = await commit("feat: a", seen.indexKey, { files: [{ path: "a.ts", object: shown }] });
  expect(result).toMatchObject({ status: 409, body: { error: { message: changed } } });
  expect(git(repo, "rev-parse", "HEAD")).toBe(start);
  result = await commit("feat: a", seen.indexKey, {
    files: [{ path: "a.ts", object: git(repo, "rev-parse", ":a.ts") }],
  });
  expect(result.status).toBe(200);

  // Commit all: a changed file, and a new file that Git does not track.
  await write(repo, "a.ts", "a\nlater\nall\n");
  await write(repo, "new.ts", "new\n");
  const object = git(repo, "hash-object", "a.ts");
  const text = createHash("sha256").update("new\n").digest("hex");
  const all = {
    all: true,
    files: [
      { path: "a.ts", object },
      { path: "new.ts", text },
    ],
  };
  seen = await status();
  await write(repo, "a.ts", "a\nlater\nall, by an agent\n");
  expect(await commit("feat: all", seen.indexKey, all)).toMatchObject({
    status: 409,
    body: { error: { message: changed } },
  });
  await write(repo, "a.ts", "a\nlater\nall\n");
  await write(repo, "new.ts", "new, by an agent\n");
  expect(await commit("feat: all", seen.indexKey, all)).toMatchObject({ status: 409 });
  // A refused Commit all leaves the index as it was.
  expect(summary(await status())).toEqual(["a.ts: - / modified", "new.ts: - / untracked"]);
  // An agent reverts a counted file: it has no change to commit.
  await write(repo, "new.ts", "new\n");
  await write(repo, "a.ts", "a\nlater\n");
  expect(await commit("feat: all", seen.indexKey, all)).toMatchObject({
    status: 409,
    body: {
      error: {
        message:
          "The staged files changed since you pressed Commit. Check them, then commit again.",
      },
    },
  });
  await write(repo, "a.ts", "a\nlater\nall\n");
  result = await commit("feat: all", seen.indexKey, all);
  expect(result.status).toBe(200);
  expect(git(repo, "show", "HEAD:a.ts")).toBe("a\nlater\nall");
  expect(git(repo, "show", "HEAD:new.ts")).toBe("new");
});

test("pushes a new branch after the user agrees to track it, then pushes to its upstream", async () => {
  const { repo, remote, status, push } = await fixture();
  await write(repo, "a.ts", "a\n");
  git(repo, "add", "a.ts");
  git(repo, "commit", "-m", "start");
  git(repo, "switch", "--quiet", "-c", "feature");
  let state = await status();
  expect(state).toMatchObject({ branch: "feature", upstream: null, pushRemote: "origin" });

  expect(await push(state.head, false)).toMatchObject({ status: 409 });
  expect(await push("f".repeat(40), true)).toMatchObject({ status: 409 });
  expect(await push(state.head, true)).toMatchObject({ status: 200, body: { branch: "feature" } });
  expect(git(remote, "rev-parse", "feature")).toBe(state.head);
  state = await status();
  expect(state).toMatchObject({ upstream: { remote: "origin", branch: "feature" }, ahead: 0 });

  await write(repo, "a.ts", "a\nb\n");
  git(repo, "commit", "--quiet", "-am", "next");
  state = await status();
  expect(state.ahead).toBe(1);
  expect(await push(state.head, false)).toMatchObject({ status: 200 });
  expect(git(remote, "rev-parse", "feature")).toBe(state.head);
});
