import { afterEach, describe, expect, test } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ByteCache } from "../../src/host/runtime/cache";
import { runProcess } from "../../src/host/runtime/process";
import { loadHistory, listBranches, listWorktrees } from "../../src/host/repository/history";
import { ReviewService, parseRawDiff } from "../../src/host/repository/review";
import { startHost, type RunningHost } from "../../src/host/server";
import { NoteService } from "../../src/host/notes";

const temporary: string[] = [];
const hosts: RunningHost[] = [];
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", args, {
    cwd: repo,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: "Test",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
async function repository() {
  const repo = await mkdtemp(join(tmpdir(), "med host test "));
  temporary.push(repo);
  git(repo, "init", "-b", "main");
  git(repo, "config", "commit.gpgsign", "false");
  return repo;
}
async function commit(repo: string, text: string, subject: string) {
  await writeFile(join(repo, "file.txt"), text);
  git(repo, "add", "file.txt");
  git(repo, "commit", "-m", subject);
  return git(repo, "rev-parse", "HEAD");
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("bounded host primitives", () => {
  test("evicts the least recently read bytes and refuses oversized entries", () => {
    const cache = new ByteCache<number>(8);
    cache.set("a", 1, 4);
    cache.set("b", 2, 4);
    expect(cache.get("a")).toBe(1);
    cache.set("c", 3, 4);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.bytes).toBe(8);
    cache.set("huge", 9, 10);
    expect(cache.get("huge")).toBeUndefined();
  });
  test("terminates output overflow and cancelled children", async () => {
    await expect(
      runProcess(process.execPath, ["-e", "process.stdout.write('x'.repeat(100000))"], {
        cwd: tmpdir(),
        maxBytes: 100,
      }),
    ).rejects.toMatchObject({ code: "output-too-large" });
    const abort = new AbortController();
    const running = runProcess(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      cwd: tmpdir(),
      signal: abort.signal,
    });
    abort.abort();
    await expect(running).rejects.toMatchObject({ code: "cancelled" });
  });
  test("parses rename paths with tabs and newlines without splitting them", () => {
    const oid = "1".repeat(40);
    const files = parseRawDiff(
      Buffer.from(`:100644 100644 ${oid} ${oid} R100\0old\tname\0new\nname\0`),
    );
    expect(files[0]).toMatchObject({ previousPath: "old\tname", path: "new\nname", status: "R" });
  });
});

describe("Git history and comparisons", () => {
  test("lists local branch checkouts and pages another branch without changing HEAD", async () => {
    const repo = await repository();
    const first = await commit(repo, "one\n", "first");
    const second = await commit(repo, "two\n", "second");
    const third = await commit(repo, "three\n", "third");
    git(repo, "branch", "topic/ui", second);
    const parent = await mkdtemp(join(tmpdir(), "med branch checkout "));
    temporary.push(parent);
    const linked = join(parent, "linked");
    git(repo, "worktree", "add", "-b", "linked", linked, first);
    const rootPath = await realpath(repo),
      linkedPath = await realpath(linked);
    expect(await listBranches(repo)).toEqual([
      { name: "linked", head: first, current: false, worktreePath: linkedPath },
      { name: "main", head: third, current: true, worktreePath: rootPath },
      { name: "topic/ui", head: second, current: false },
    ]);
    expect((await listBranches(linked)).find((branch) => branch.name === "linked")?.current).toBe(
      true,
    );
    const ref = "refs/heads/topic/ui";
    const page = await loadHistory(repo, null, 1, undefined, ref);
    expect(page.commits[0]!.id).toBe(second);
    expect(page.hasMore).toBe(true);
    git(repo, "branch", "--force", "topic/ui", third);
    const next = await loadHistory(repo, page.cursor, 1, undefined, ref);
    expect(next.commits[0]!.id).toBe(first);
    await expect(
      loadHistory(repo, page.cursor, 1, undefined, "refs/heads/main"),
    ).rejects.toMatchObject({ code: "invalid-cursor" });
    await expect(loadHistory(repo, null, 1, undefined, "--output=bad")).rejects.toMatchObject({
      code: "invalid-revision",
    });
    expect(git(repo, "rev-parse", "HEAD")).toBe(third);
    expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("main");
    expect(git(linked, "rev-parse", "HEAD")).toBe(first);
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("three\n");
  });
  test("handles empty branch lists and malformed history cursors", async () => {
    const repo = await repository();
    expect(await listBranches(repo)).toEqual([]);
    await expect(
      loadHistory(repo, Buffer.from("null").toString("base64url"), 10),
    ).rejects.toMatchObject({ code: "invalid-cursor" });
  });
  test("pages a frozen history and selects commits without moving HEAD", async () => {
    const repo = await repository();
    const first = await commit(repo, "one\n", "first");
    const second = await commit(repo, "two\n", "second");
    const third = await commit(repo, "three\n", "third");
    const page = await loadHistory(repo, null, 1);
    expect(page.commits).toHaveLength(1);
    expect(page.commits[0]).toMatchObject({
      id: third,
      parents: [second],
      subject: "third",
      author: "Test",
    });
    expect(page.commits[0]!.timestamp).toBe(
      Number(git(repo, "show", "-s", "--format=%at", third)) * 1000,
    );
    await commit(repo, "four\n", "fourth");
    const next = await loadHistory(repo, page.cursor, 1);
    expect(next.commits[0]!.id).toBe(second);
    const service = new ReviewService();
    const result = await service.load({ repo, comparison: { kind: "commit", commit: second } });
    expect(result.base).toBe(first);
    expect(result.patch).toContain("+two");
    expect(result.files[0]).toMatchObject({ path: "file.txt", additions: 1, deletions: 1 });
    const cached = await service.load({ repo, comparison: { kind: "commit", commit: second } });
    expect(cached.metrics.cacheHit).toBe(true);
    expect(git(repo, "show", "-s", "--format=%s", "HEAD")).toBe("fourth");
    expect(await service.sources(result.id, "file.txt")).toMatchObject({
      old: "one\n",
      new: "two\n",
    });
    await expect(
      service.load({ repo, comparison: { kind: "commit", commit: "--output=bad" } }),
    ).rejects.toMatchObject({ code: "invalid-revision" });
  });
  test("inclusive commit ranges include the oldest change and support root commits", async () => {
    const repo = await repository();
    const first = await commit(repo, "one\n", "first");
    const second = await commit(repo, "two\n", "second");
    const third = await commit(repo, "three\n", "third");
    const service = new ReviewService();
    const inclusive = await service.load({
      repo,
      comparison: { kind: "range", base: second, head: third, includeBase: true },
    });
    expect(inclusive.base).toBe(first);
    expect(inclusive.patch).toContain("-one");
    expect(inclusive.patch).toContain("+three");
    const ordinary = await service.load({
      repo,
      comparison: { kind: "range", base: second, head: third },
    });
    expect(ordinary.base).toBe(second);
    const singleRange = { kind: "range" as const, base: third, head: third, includeBase: true };
    const samePatch = await service.load({ repo, comparison: singleRange });
    expect(samePatch.comparison).toEqual(singleRange);
    expect(samePatch.label).toContain("inclusive");
    const singleCommit = { kind: "commit" as const, commit: third };
    const cachedCommit = await service.load({ repo, comparison: singleCommit });
    expect(cachedCommit.comparison).toEqual(singleCommit);
    expect(cachedCommit.label).toContain("first parent");
    const root = await service.load({
      repo,
      comparison: { kind: "range", base: first, head: third, includeBase: true },
    });
    expect(root.files[0]?.status).toBe("A");
    expect(root.patch).toContain("+three");
  });
  test("root commits and unborn worktrees are valid comparisons", async () => {
    const repo = await repository();
    await writeFile(join(repo, "fresh.txt"), "untracked\n");
    const service = new ReviewService();
    const empty = await loadHistory(repo, null, 20);
    expect(empty.commits).toEqual([]);
    const unborn = await service.load({ repo, comparison: { kind: "working" } });
    expect(unborn.files[0]).toMatchObject({ path: "fresh.txt", untracked: true });
    const root = await commit(repo, "root\n", "root");
    const result = await service.load({ repo, comparison: { kind: "commit", commit: root } });
    expect(result.files[0]).toMatchObject({ path: "file.txt", status: "A" });
    expect(await service.sources(result.id, "file.txt")).toMatchObject({ old: "", new: "root\n" });
  });
  test("staged and unstaged sources remain distinct, and live reads reject changes", async () => {
    const repo = await repository();
    await commit(repo, "original\n", "initial");
    await writeFile(join(repo, "file.txt"), "staged\n");
    git(repo, "add", "file.txt");
    await writeFile(join(repo, "file.txt"), "working\n");
    const service = new ReviewService();
    const staged = await service.load({ repo, comparison: { kind: "staged" } });
    const unstaged = await service.load({ repo, comparison: { kind: "unstaged" } });
    expect(await service.sources(staged.id, "file.txt")).toMatchObject({
      old: "original\n",
      new: "staged\n",
    });
    expect(await service.sources(unstaged.id, "file.txt")).toMatchObject({
      old: "staged\n",
      new: "working\n",
    });
    await writeFile(join(repo, "file.txt"), "next edit\n");
    await expect(service.sources(unstaged.id, "file.txt")).rejects.toMatchObject({
      code: "source-changed",
    });
    git(repo, "add", "file.txt");
    expect(await service.sources(staged.id, "file.txt")).toMatchObject({ new: "staged\n" });
  });
  test("reads a symlink as link text and rejects paths outside the review", async () => {
    if (process.platform === "win32") return;
    const repo = await repository();
    await commit(repo, "initial\n", "initial");
    await symlink("/private/etc/passwd", join(repo, "link"));
    const service = new ReviewService();
    const review = await service.load({ repo, comparison: { kind: "working" } });
    expect(await service.sources(review.id, "link")).toMatchObject({
      old: "",
      new: "/private/etc/passwd",
    });
    await expect(service.sources(review.id, "../secret")).rejects.toMatchObject({
      code: "file-not-found",
    });
  });
  test("lists linked worktrees without changing either checkout", async () => {
    const repo = await repository();
    await commit(repo, "one\n", "initial");
    const parent = await mkdtemp(join(tmpdir(), "med worktree "));
    temporary.push(parent);
    const linked = join(parent, "linked");
    git(repo, "worktree", "add", "-b", "feature", linked);
    const result = await listWorktrees(repo);
    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: await realpath(linked), branch: "feature" }),
      ]),
    );
    expect(await readFile(join(repo, "file.txt"), "utf8")).toBe("one\n");
  });
  test("reports unavailable shallow parents instead of fabricating a root diff", async () => {
    const repo = await repository();
    const first = await commit(repo, "one\n", "first");
    const second = await commit(repo, "two\n", "second");
    const parent = await mkdtemp(join(tmpdir(), "med shallow "));
    temporary.push(parent);
    const clone = join(parent, "clone");
    git(parent, "clone", "--depth=1", pathToFileURL(repo).href, clone);
    await expect(
      new ReviewService().load({ repo: clone, comparison: { kind: "commit", commit: second } }),
    ).rejects.toMatchObject({ code: "parent-unavailable" });
    expect((await loadHistory(clone, null, 10)).commits[0]!.parents).toEqual([first]);
  });
  test("keeps oversized untracked paths visible", async () => {
    const repo = await repository();
    await commit(repo, "one\n", "initial");
    await writeFile(join(repo, "large.txt"), "x".repeat(8 * 1024 * 1024 + 1));
    const review = await new ReviewService().load({ repo, comparison: { kind: "working" } });
    expect(review.files.find((file) => file.path === "large.txt")).toMatchObject({
      tooLarge: true,
    });
    expect(review.warnings.length).toBeGreaterThan(0);
  });
  test("retains notes after a save and marks changed anchors stale or orphaned", async () => {
    const repo = await repository();
    await commit(repo, "original\n", "initial");
    await writeFile(join(repo, "file.txt"), "edited\n");
    const service = new ReviewService();
    const notes = new NoteService(service);
    const first = await service.load({ repo, comparison: { kind: "working" } });
    notes.adopt(first.id);
    const saved = await notes.mutate(first.id, 0, {
      type: "add",
      note: { path: "file.txt", side: "new", line: 1, text: "Keep this observation" },
    });
    await writeFile(join(repo, "file.txt"), "edited again\n");
    const second = await service.load({ repo, comparison: { kind: "working" } });
    const carried = notes.adopt(second.id);
    expect(carried.notes[0]).toMatchObject({
      id: saved.notes[0]!.id,
      text: "Keep this observation",
      resolution: "stale",
    });
    await expect(
      notes.mutate(first.id, 1, { type: "edit", id: saved.notes[0]!.id, text: "outdated" }),
    ).rejects.toMatchObject({ code: "stale-review" });
    await writeFile(join(repo, "file.txt"), "original\n");
    const third = await service.load({ repo, comparison: { kind: "working" } });
    expect(notes.adopt(third.id).notes[0]).toMatchObject({
      text: "Keep this observation",
      resolution: "orphaned",
    });
  });
});

describe("file and patch inputs", () => {
  test("freezes file pairs and parses standalone patches outside Git", async () => {
    const directory = await mkdtemp(join(tmpdir(), "med standalone "));
    temporary.push(directory);
    const oldPath = join(directory, "before.txt"),
      newPath = join(directory, "after.txt");
    await writeFile(oldPath, "before\n");
    await writeFile(newPath, "after\n");
    const service = new ReviewService();
    const review = await service.load({
      repo: directory,
      comparison: { kind: "files", oldPath, newPath },
    });
    expect(review.files[0]).toMatchObject({ path: "after.txt", additions: 1, deletions: 1 });
    await writeFile(newPath, "changed later\n");
    expect(await service.sources(review.id, "after.txt")).toMatchObject({
      old: "before\n",
      new: "after\n",
    });
    const patchPath = join(directory, "review.patch");
    await writeFile(patchPath, review.patch);
    const patch = await service.load({
      repo: directory,
      comparison: { kind: "patch", path: patchPath },
    });
    expect(patch.files[0]!.path).toBe("after.txt");
    await expect(service.sources(patch.id, "after.txt")).rejects.toMatchObject({
      code: "source-unavailable",
    });
    const notes = new NoteService(service);
    notes.adopt(patch.id);
    expect(
      (
        await notes.mutate(patch.id, 0, {
          type: "add",
          note: { path: "after.txt", side: "new", line: 1, text: "Patch observation" },
        })
      ).notes,
    ).toHaveLength(1);
    await expect(
      notes.mutate(patch.id, 1, {
        type: "add",
        note: { path: "after.txt", side: "new", line: 20, text: "Outside patch" },
      }),
    ).rejects.toMatchObject({ code: "invalid-note" });
  });
  test("requires explicit authorization for input paths outside the selected directory", async () => {
    const directory = await mkdtemp(join(tmpdir(), "med input directory "));
    temporary.push(directory);
    const external = await mkdtemp(join(tmpdir(), "med input external "));
    temporary.push(external);
    const path = join(external, "test.patch");
    await writeFile(
      path,
      "diff --git a/file b/file\n--- a/file\n+++ b/file\n@@ -1 +1 @@\n-old\n+new\n",
    );
    await expect(
      new ReviewService().load({ repo: directory, comparison: { kind: "patch", path } }),
    ).rejects.toMatchObject({ code: "input-not-allowed" });
    const review = await new ReviewService(new Set([path])).load({
      repo: directory,
      comparison: { kind: "patch", path },
    });
    expect(review.files[0]!.path).toBe("file");
  });
});

describe("HTTP boundary", () => {
  test("discovers branch worktrees through the authenticated API and accepts a history ref", async () => {
    const repo = await repository();
    const first = await commit(repo, "one\n", "first");
    const second = await commit(repo, "two\n", "second");
    git(repo, "branch", "snapshot", first);
    const host = await startHost({ repo });
    hosts.push(host);
    const base = `http://127.0.0.1:${host.port}`,
      headers = { authorization: `Bearer ${host.token}` };
    expect((await fetch(`${base}/api/branches`)).status).toBe(401);
    const parent = await mkdtemp(join(tmpdir(), "med discovered checkout "));
    temporary.push(parent);
    const linked = join(parent, "linked");
    git(repo, "worktree", "add", "-b", "linked", linked, first);
    const branches = await (await fetch(`${base}/api/branches`, { headers })).json();
    expect(branches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "linked", worktreePath: await realpath(linked) }),
        expect.objectContaining({ name: "snapshot", head: first }),
      ]),
    );
    const worktreeSession = await fetch(
      `${base}/api/session?repo=${encodeURIComponent(await realpath(linked))}`,
      { headers },
    );
    expect(worktreeSession.status).toBe(200);
    expect(
      (
        await fetch(
          `${base}/api/events?repo=${encodeURIComponent("/not-an-authorized-repository")}`,
          { headers },
        )
      ).status,
    ).toBe(403);
    const streamAbort = new AbortController();
    const stream = await fetch(
      `${base}/api/events?repo=${encodeURIComponent(await realpath(linked))}`,
      { headers, signal: streamAbort.signal },
    );
    expect(stream.status).toBe(200);
    const reader = stream.body!.getReader();
    const ready = new TextDecoder().decode((await reader.read()).value);
    expect(ready).toContain(`"repo":${JSON.stringify(await realpath(linked))}`);
    expect(ready).toContain("event: ready");
    streamAbort.abort();
    const history = await (
      await fetch(`${base}/api/history?ref=${encodeURIComponent("refs/heads/snapshot")}&limit=1`, {
        headers,
      })
    ).json();
    expect(history.commits[0].id).toBe(first);
    expect((await fetch(`${base}/api/history?ref=--output%3Dbad`, { headers })).status).toBe(400);
    expect(git(repo, "rev-parse", "HEAD")).toBe(second);
  });
  test("reveals files in the file manager only inside the repository", async () => {
    const repo = await repository();
    await commit(repo, "one\n", "first");
    const revealed: string[] = [];
    const host = await startHost({ repo, reveal: (path) => revealed.push(path) });
    hosts.push(host);
    const reveal = (path: string) =>
      fetch(`http://127.0.0.1:${host.port}/api/reveal`, {
        method: "POST",
        headers: { authorization: `Bearer ${host.token}`, "content-type": "application/json" },
        body: JSON.stringify({ path }),
      });
    expect((await reveal("file.txt")).status).toBe(200);
    expect((await reveal("../outside.txt")).status).toBe(403);
    expect((await reveal("missing.txt")).status).toBe(404);
    expect(revealed).toEqual([join(await realpath(repo), "file.txt")]);
  });
  test("reads a commit's body, co-authors, and size for the history card", async () => {
    const repo = await repository();
    await commit(repo, "one\ntwo\n", "first");
    await writeFile(join(repo, "file.txt"), "one\nthree\nfour\n");
    await writeFile(join(repo, "notes.txt"), "new\n");
    git(repo, "add", "-A");
    git(
      repo,
      "commit",
      "-m",
      "feat: second",
      "-m",
      "Explains the change.",
      "-m",
      "Co-Authored-By: Ada Okafor <ada@example.com>",
    );
    const id = git(repo, "rev-parse", "HEAD");
    const host = await startHost({ repo });
    hosts.push(host);
    const base = `http://127.0.0.1:${host.port}`,
      headers = { authorization: `Bearer ${host.token}` };
    expect(await (await fetch(`${base}/api/commit?id=${id}`, { headers })).json()).toEqual({
      id,
      body: "Explains the change.",
      coAuthors: ["Ada Okafor"],
      files: 2,
      additions: 3,
      deletions: 1,
    });
    expect((await fetch(`${base}/api/commit?id=HEAD`, { headers })).status).toBe(400);
  });
  test("authenticates requests and enforces source and note versions", async () => {
    const repo = await repository();
    const id = await commit(repo, "one\ntwo\n", "first");
    const host = await startHost({ repo });
    hosts.push(host);
    const base = `http://127.0.0.1:${host.port}`;
    const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
    expect((await fetch(`${base}/api/session`)).status).toBe(401);
    expect(
      (
        await fetch(`${base}/api/session`, {
          headers: { ...headers, origin: "https://example.com" },
        })
      ).status,
    ).toBe(403);
    const session = await (await fetch(`${base}/api/session`, { headers })).json();
    expect(session.repository.path).toBe(await realpath(repo));
    const review = await (
      await fetch(`${base}/api/review`, {
        method: "POST",
        headers,
        body: JSON.stringify({ repo, comparison: { kind: "commit", commit: id } }),
      })
    ).json();
    expect(review.id).toBeTypeOf("string");
    const source = await (
      await fetch(`${base}/api/source?reviewId=${review.id}&path=file.txt`, { headers })
    ).json();
    expect(source.new).toBe("one\ntwo\n");
    const note = { path: "file.txt", side: "new", line: 1, text: "Review this" };
    const add = (expectedRevision: number, body = note) =>
      fetch(`${base}/api/notes`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          reviewId: review.id,
          expectedRevision,
          mutation: { type: "add", note: body },
        }),
      });
    expect((await add(0, { ...note, line: 50 })).status).toBe(400);
    const saved = await (await add(0)).json();
    expect(saved.revision).toBe(1);
    expect(saved.notes).toHaveLength(1);
    expect((await add(0)).status).toBe(409);
    expect(
      (await fetch(`${base}/api/source?reviewId=${review.id}&path=../secret`, { headers })).status,
    ).toBe(404);
    const streamAbort = new AbortController();
    const stream = await fetch(`${base}/api/events`, { headers, signal: streamAbort.signal });
    expect(stream.headers.get("content-type")).toBe("text/event-stream");
    const first = await stream.body!.getReader().read();
    expect(new TextDecoder().decode(first.value)).toContain("event: ready");
    streamAbort.abort();
  });
  test("serves assets only within the web root", async () => {
    const repo = await repository();
    await commit(repo, "one\n", "first");
    const webRoot = join(repo, "web");
    await mkdir(webRoot);
    await writeFile(join(webRoot, "index.html"), "<title>Review</title>");
    const host = await startHost({ repo, webRoot });
    hosts.push(host);
    const response = await fetch(`http://127.0.0.1:${host.port}/`);
    expect(await response.text()).toBe("<title>Review</title>");
    // The elements page is an app route, not a file in the web root.
    expect(await (await fetch(`http://127.0.0.1:${host.port}/elements`)).text()).toBe(
      "<title>Review</title>",
    );
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  });
  test("serves the install manifest and its icons without a token", async () => {
    const repo = await repository();
    await commit(repo, "one\n", "first");
    const host = await startHost({ repo, webRoot: resolve("public") });
    hosts.push(host);
    const base = `http://127.0.0.1:${host.port}`;
    const response = await fetch(`${base}/manifest.webmanifest`);
    expect(response.headers.get("content-type")).toBe("application/manifest+json");
    // Unhashed files revalidate, so an installed app picks up a new icon.
    expect(response.headers.get("cache-control")).toBe("no-cache");
    const manifest = await response.json();
    expect(manifest).toMatchObject({ start_url: "/", scope: "/", display: "standalone" });
    for (const icon of manifest.icons) {
      const image = await fetch(new URL(icon.src, base));
      expect(image.headers.get("content-type")).toBe(icon.type);
      const png = new DataView(await image.arrayBuffer());
      expect(`${png.getUint32(16)}x${png.getUint32(20)}`).toBe(icon.sizes);
    }
  });
  test("launches a file-only session in a directory without Git", async () => {
    const repo = await mkdtemp(join(tmpdir(), "med no git "));
    temporary.push(repo);
    const oldPath = join(repo, "old.txt"),
      newPath = join(repo, "new.txt");
    await writeFile(oldPath, "old\n");
    await writeFile(newPath, "new\n");
    const comparison = { kind: "files" as const, oldPath, newPath };
    const host = await startHost({ repo, initialComparison: comparison });
    hosts.push(host);
    const base = `http://127.0.0.1:${host.port}`,
      headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
    const session = await (await fetch(`${base}/api/session`, { headers })).json();
    expect(session.repository.git).toBe(false);
    expect(session.initialComparison).toEqual(comparison);
    const response = await fetch(`${base}/api/review`, {
      method: "POST",
      headers,
      body: JSON.stringify({ repo, comparison }),
    });
    expect(response.status).toBe(200);
    const history = await (await fetch(`${base}/api/history`, { headers })).json();
    expect(history.commits).toEqual([]);
  });
});
