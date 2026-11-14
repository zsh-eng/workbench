import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { startHost, type RunningHost } from "../../src/host/server";
import type { FileChanges, WorkingStatus } from "../../src/shared/git-actions";
import { splitPatch } from "../../src/shared/patch-hunks";

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
  const changes = async (path: string, previousPath?: string) =>
    (
      await call<FileChanges>(
        `/api/git/file-changes?${new URLSearchParams({ repo, path, ...(previousPath ? { previousPath } : {}) })}`,
      )
    ).body;
  const stageHunk = (path: string, hunk: string, stage: boolean, previousPath?: string) =>
    call<WorkingStatus & { error?: { message: string } }>("/api/git/stage-hunk", {
      repo,
      path,
      ...(previousPath ? { previousPath } : {}),
      hunk,
      stage,
    });
  const discard = (path: string, more: object) =>
    call<WorkingStatus & { error?: { message: string } }>("/api/git/discard", {
      repo,
      path,
      ...more,
    });
  return { repo, remote, call, status, stage, commit, push, changes, stageHunk, discard };
}
const write = (repo: string, path: string, text: string) => writeFile(join(repo, path), text);
const hunks = (patch: string) => splitPatch(patch).hunks.map((hunk) => hunk.text);
/** Thirty numbered lines, the last without a newline, with some changed. */
const lines = (changed: Record<number, string> = {}) =>
  Array.from({ length: 30 }, (_, index) => changed[index + 1] ?? String(index + 1)).join("\n");
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

test("stages and unstages one hunk at a time, the last one without a final newline", async () => {
  const { repo, changes, stageHunk } = await fixture();
  await write(repo, "a.ts", lines());
  git(repo, "add", "a.ts");
  git(repo, "commit", "-m", "start");
  // One hunk adds a line; the other changes the last line, which has no newline.
  const edited = lines({ 3: "3\nthree and a half", 30: "thirty" });
  await write(repo, "a.ts", edited);
  const [first, last] = hunks((await changes("a.ts")).unstaged);
  expect(last).toContain("\\ No newline at end of file");

  let state = (await stageHunk("a.ts", first!, true)).body;
  expect(summary(state)).toEqual(["a.ts: modified / modified"]);
  expect(git(repo, "show", ":a.ts")).toBe(lines({ 3: "3\nthree and a half" }));
  // The staged line moved the last hunk down; its text from before still names it.
  expect(hunks((await changes("a.ts")).unstaged)).not.toContain(last);
  state = (await stageHunk("a.ts", last!, true)).body;
  expect(summary(state)).toEqual(["a.ts: modified / -"]);
  expect(git(repo, "show", ":a.ts")).toBe(edited);

  const staged = hunks((await changes("a.ts")).staged);
  expect(staged).toHaveLength(2);
  state = (await stageHunk("a.ts", staged[0]!, false)).body;
  expect(git(repo, "show", ":a.ts")).toBe(lines({ 30: "thirty" }));
  state = (await stageHunk("a.ts", hunks((await changes("a.ts")).staged)[0]!, false)).body;
  expect(summary(state)).toEqual(["a.ts: - / modified"]);
  // Staging never touches the working file.
  expect(await readFile(join(repo, "a.ts"), "utf8")).toBe(edited);
  // A hunk that Git no longer has stages nothing.
  const other = first!.replace("three and a half", "three and a quarter");
  expect(await stageHunk("a.ts", other, true)).toMatchObject({ status: 409 });
  expect(summary(state)).toEqual(["a.ts: - / modified"]);
});

test("a staged rename stays staged when one of its hunks is unstaged, and a new file stages whole", async () => {
  const { repo, changes, stageHunk } = await fixture();
  await write(repo, "a.ts", lines());
  git(repo, "add", "a.ts");
  git(repo, "commit", "-m", "start");
  // A name with a space: Git ends its --- and +++ lines with a tab.
  git(repo, "mv", "a.ts", "b c.ts");
  await write(repo, "b c.ts", lines({ 2: "two", 28: "twenty-eight" }));
  git(repo, "add", "--all");
  const staged = hunks((await changes("b c.ts", "a.ts")).staged);
  expect(staged).toHaveLength(2);
  let state = (await stageHunk("b c.ts", staged[1]!, false, "a.ts")).body;
  expect(summary(state)).toEqual(["b c.ts <- a.ts: renamed / modified"]);
  expect(git(repo, "show", ":b c.ts")).toBe(lines({ 2: "two" }));
  const [unstaged] = hunks((await changes("b c.ts", "a.ts")).unstaged);
  state = (await stageHunk("b c.ts", unstaged!, true, "a.ts")).body;
  expect(summary(state)).toEqual(["b c.ts <- a.ts: renamed / -"]);

  // A new file is one hunk. It stages whole, with its mode, and unstages whole.
  await write(repo, "new.sh", "#!/bin/sh\necho new\n");
  await chmod(join(repo, "new.sh"), 0o755);
  const [added] = hunks((await changes("new.sh")).unstaged);
  state = (await stageHunk("new.sh", added!, true)).body;
  expect(summary(state)).toContain("new.sh: added / -");
  expect(git(repo, "ls-files", "--stage", "new.sh")).toMatch(/^100755 /);
  state = (await stageHunk("new.sh", hunks((await changes("new.sh")).staged)[0]!, false)).body;
  expect(summary(state)).toContain("new.sh: - / untracked");
});

test("discards a hunk or a file only as the tab showed it, and changes the index only with staged", async () => {
  const { repo, changes, discard } = await fixture();
  const read = (path: string) => readFile(join(repo, path), "utf8");
  const stamp = async (path: string, previousPath?: string) =>
    (await changes(path, previousPath)).stamp;
  // Before the first commit, a staged file goes back to nothing.
  await write(repo, "first.ts", "first\n");
  git(repo, "add", "first.ts");
  let state = (await discard("first.ts", { staged: true, stamp: await stamp("first.ts") })).body;
  expect(summary(state)).toEqual([]);
  expect(existsSync(join(repo, "first.ts"))).toBe(false);

  await write(repo, "a.ts", lines());
  await write(repo, "b.ts", "b\n");
  git(repo, "add", "--all");
  git(repo, "commit", "-m", "start");
  // An unstaged hunk goes back to the index; the other hunk stays.
  await write(repo, "a.ts", lines({ 3: "three", 30: "thirty" }));
  const [first] = hunks((await changes("a.ts")).unstaged);
  state = (await discard("a.ts", { staged: false, hunk: first })).body;
  expect(await read("a.ts")).toBe(lines({ 30: "thirty" }));
  // A staged hunk leaves the index and the working file.
  git(repo, "add", "a.ts");
  await write(repo, "a.ts", lines({ 10: "ten", 30: "thirty" }));
  const [stagedHunk] = hunks((await changes("a.ts")).staged);
  state = (await discard("a.ts", { staged: true, hunk: stagedHunk })).body;
  expect(summary(state)).toEqual(["a.ts: - / modified"]);
  expect(git(repo, "show", ":a.ts")).toBe(lines());
  expect(await read("a.ts")).toBe(lines({ 10: "ten" }));

  // A partly staged file without staged: the working file takes the index's version.
  git(repo, "add", "a.ts");
  await write(repo, "a.ts", lines({ 10: "ten", 20: "twenty" }));
  state = (await discard("a.ts", { staged: false, stamp: await stamp("a.ts") })).body;
  expect(summary(state)).toEqual(["a.ts: modified / -"]);
  expect(await read("a.ts")).toBe(lines({ 10: "ten" }));
  // An agent changes the file after the tab showed it: nothing goes.
  const before = await stamp("a.ts");
  await write(repo, "a.ts", lines({ 10: "ten", 11: "eleven" }));
  expect(await discard("a.ts", { staged: true, stamp: before })).toMatchObject({ status: 409 });
  expect(await read("a.ts")).toBe(lines({ 10: "ten", 11: "eleven" }));
  // With staged, the file goes back to HEAD.
  state = (await discard("a.ts", { staged: true, stamp: await stamp("a.ts") })).body;
  expect(summary(state)).toEqual([]);
  expect(await read("a.ts")).toBe(lines());

  // A file that Git does not track is deleted, and so is a staged new file
  // with staged; a deleted file comes back; a rename is undone.
  await write(repo, "new.ts", "new\n");
  await write(repo, "added.ts", "added\n");
  git(repo, "add", "added.ts");
  await rm(join(repo, "b.ts"));
  git(repo, "mv", "a.ts", "moved.ts");
  state = (await discard("new.ts", { staged: false, stamp: await stamp("new.ts") })).body;
  expect(existsSync(join(repo, "new.ts"))).toBe(false);
  state = (await discard("b.ts", { staged: false, stamp: await stamp("b.ts") })).body;
  expect(await read("b.ts")).toBe("b\n");
  state = (await discard("added.ts", { staged: true, stamp: await stamp("added.ts") })).body;
  expect(existsSync(join(repo, "added.ts"))).toBe(false);
  const rename = { staged: true, previousPath: "a.ts", stamp: await stamp("moved.ts", "a.ts") };
  state = (await discard("moved.ts", rename)).body;
  expect(summary(state)).toEqual([]);
  expect(await read("a.ts")).toBe(lines());
  expect(existsSync(join(repo, "moved.ts"))).toBe(false);

  // A folder, such as a nested repository, is never deleted.
  await mkdir(join(repo, "nested"));
  git(join(repo, "nested"), "init", "--quiet");
  await write(repo, "nested/x.ts", "x\n");
  const folder = await discard("nested/", { staged: false, stamp: await stamp("nested/") });
  expect(folder.status).toBe(422);
  expect(existsSync(join(repo, "nested", "x.ts"))).toBe(true);
});

test("a discard changes no file that the confirmation does not name", async () => {
  const { repo, changes, discard, stageHunk } = await fixture();
  const read = (path: string) => readFile(join(repo, path), "utf8");
  const stamp = async (path: string, previousPath?: string) =>
    (await changes(path, previousPath)).stamp;
  await write(repo, "a.txt", "a\n");
  await write(repo, "gone", "gone\n");
  await write(repo, "latin.txt", lines());
  git(repo, "add", "--all");
  git(repo, "commit", "-m", "start");

  // A rename's old path holds a new file again: it is a row of its own.
  git(repo, "mv", "a.txt", "b.txt");
  await write(repo, "b.txt", "b\n");
  await write(repo, "a.txt", "new work\n");
  const rename = { previousPath: "a.txt", stamp: await stamp("b.txt", "a.txt") };
  expect(await discard("b.txt", { ...rename, staged: true })).toMatchObject({
    status: 409,
    body: { error: { message: expect.stringContaining("a.txt is a new file") } },
  });
  await discard("b.txt", { ...rename, staged: false });
  expect(await read("a.txt")).toBe("new work\n");
  expect(await read("b.txt")).toBe("a\n");

  // A folder took a deleted file's place: neither goes.
  await rm(join(repo, "gone"));
  await mkdir(join(repo, "gone"));
  await write(repo, "gone/keep.txt", "keep\n");
  const folder = await discard("gone", { staged: true, stamp: await stamp("gone") });
  expect(folder).toMatchObject({
    status: 422,
    body: { error: { message: expect.stringContaining("gone is a folder") } },
  });
  expect(await read("gone/keep.txt")).toBe("keep\n");

  // `git add -N`: the index has the name only, and the file goes.
  await write(repo, "named.txt", "named\n");
  git(repo, "add", "-N", "named.txt");
  const named = await discard("named.txt", { staged: false, stamp: await stamp("named.txt") });
  expect(named.body.files.map((file) => file.path)).not.toContain("named.txt");
  expect(existsSync(join(repo, "named.txt"))).toBe(false);

  // A new file is one hunk: it is discarded as a file, by its stamp.
  const [whole] = hunks((await changes("a.txt")).unstaged);
  expect(await discard("a.txt", { staged: false, hunk: whole })).toMatchObject({ status: 422 });

  // Bytes that are not UTF-8 never go back to Git as U+FFFD.
  await writeFile(
    join(repo, "latin.txt"),
    Buffer.from(lines({ 3: "café", 28: "twenty-eight" }), "latin1"),
  );
  const [broken, clean] = hunks((await changes("latin.txt")).unstaged);
  expect(broken).toContain("\uFFFD");
  expect(await stageHunk("latin.txt", broken!, true)).toMatchObject({
    status: 422,
    body: { error: { message: expect.stringContaining("not UTF-8") } },
  });
  expect(await discard("latin.txt", { staged: false, hunk: broken })).toMatchObject({
    status: 422,
  });
  expect(git(repo, "diff", "--cached", "--name-only")).not.toContain("latin.txt");
  expect((await stageHunk("latin.txt", clean!, true)).status).toBe(200);
  expect(git(repo, "show", ":latin.txt")).toBe(lines({ 28: "twenty-eight" }));

  // A file too large to show still has a stamp that changes with it.
  const large = (letter: string) => `${letter.repeat(100)}\n`.repeat(15_000);
  await write(repo, "large.txt", large("x"));
  git(repo, "add", "large.txt");
  git(repo, "commit", "-m", "large");
  await write(repo, "large.txt", large("y"));
  const shown = await changes("large.txt");
  expect(shown.tooLarge).toBe(true);
  await write(repo, "large.txt", large("z"));
  expect(await discard("large.txt", { staged: false, stamp: shown.stamp })).toMatchObject({
    status: 409,
  });
  expect(await read("large.txt")).toBe(large("z"));
});
