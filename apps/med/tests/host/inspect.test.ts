import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { blameBrowse, MAX_SEARCH_MATCHES, searchBrowse } from "../../src/host/repository/inspect";
import { readBrowse } from "../../src/host/repository/browse";
import { browseBlameRequestSchema, browseSearchRequestSchema } from "../../src/shared/inspect";
import { startHost, type RunningHost } from "../../src/host/server";

const temporary: string[] = [];
const hosts: RunningHost[] = [];
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Test Author",
      GIT_AUTHOR_EMAIL: "test@example.com",
      GIT_COMMITTER_NAME: "Test Author",
      GIT_COMMITTER_EMAIL: "test@example.com",
    },
  }).trim();
async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-inspect-")));
  temporary.push(root);
  const repo = join(root, "main");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  await mkdir(join(repo, "src"));
  await writeFile(join(repo, "src/file.txt"), "First literal [query]\nOriginal second line\n");
  await writeFile(join(repo, ".gitignore"), "ignored.txt\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "Initial content");
  return { root, repo, oid: git(repo, "rev-parse", "HEAD") };
}
afterEach(async () => {
  await Promise.all(hosts.splice(0).map((host) => host.close()));
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("searches literal content in selected worktrees and immutable commits, including untracked but excluding ignored", async () => {
  const { root, repo, oid } = await fixture();
  const linked = join(root, "linked");
  git(repo, "worktree", "add", "-q", "-b", "topic", linked);
  await writeFile(join(repo, "src/file.txt"), "main [QUERY]\n");
  await writeFile(join(linked, "src/file.txt"), "linked [Query]\n");
  await writeFile(join(repo, "new.txt"), "new [query]\n");
  await writeFile(join(repo, "ignored.txt"), "secret [query]\n");
  await writeFile(join(repo, "binary.bin"), "[query]\0binary");
  // Files come in path order, tracked or not.
  expect((await searchBrowse({ kind: "worktree", repo }, "[query]")).matches).toEqual([
    { path: "new.txt", line: 1, text: "new [query]" },
    { path: "src/file.txt", line: 1, text: "main [QUERY]" },
  ]);
  expect((await searchBrowse({ kind: "worktree", repo: linked }, "[query]")).matches).toEqual([
    { path: "src/file.txt", line: 1, text: "linked [Query]" },
  ]);
  expect((await searchBrowse({ kind: "commit", repo, oid }, "[query]")).matches).toEqual([
    { path: "src/file.txt", line: 1, text: "First literal [query]" },
  ]);
  expect(git(repo, "symbolic-ref", "--short", "HEAD")).toBe("main");
});

test("search does not return files through linked parents or nested repositories; unusual paths remain literal", async () => {
  const { root, repo } = await fixture();
  await writeFile(join(root, "file.txt"), "outside needle");
  await rm(join(repo, "src"), { recursive: true });
  await symlink(root, join(repo, "src"));
  await symlink(join(root, "file.txt"), join(repo, "link"));
  const nested = join(repo, "nested");
  await mkdir(nested);
  git(nested, "init", "-q");
  await writeFile(join(nested, "secret.txt"), "nested needle");
  const path = "[literal]\tname\n.txt";
  await writeFile(join(repo, path), "allowed needle");
  git(repo, "add", "--", path);
  git(repo, "commit", "-q", "-m", "Literal path");
  const source = { kind: "worktree" as const, repo };
  expect((await searchBrowse(source, "needle")).matches).toEqual([
    { path, line: 1, text: "allowed needle" },
  ]);
  expect(
    (await searchBrowse({ kind: "commit", repo, oid: git(repo, "rev-parse", "HEAD") }, "needle"))
      .matches,
  ).toEqual([{ path, line: 1, text: "allowed needle" }]);
});

test("match case finds the text as typed, and the cap counts only those lines", async () => {
  const { repo, oid } = await fixture();
  // More lines in another case than the cap, then one as typed.
  await writeFile(
    join(repo, "many.txt"),
    `${"needle\n".repeat(MAX_SEARCH_MATCHES + 50)}const Needle = 1;\n`,
  );
  const source = { kind: "worktree" as const, repo };
  const any = await searchBrowse(source, "Needle");
  expect(any.matches).toHaveLength(MAX_SEARCH_MATCHES);
  expect(any.truncated).toBe(true);
  expect(await searchBrowse(source, "Needle", undefined, true)).toMatchObject({
    matchCase: true,
    truncated: false,
    matches: [{ path: "many.txt", line: MAX_SEARCH_MATCHES + 51, text: "const Needle = 1;" }],
  });
  // At a commit too: the committed file has the text only in lower case.
  expect(
    (await searchBrowse({ kind: "commit", repo, oid }, "[QUERY]", undefined, true)).matches,
  ).toEqual([]);
  expect(
    (await searchBrowse({ kind: "commit", repo, oid }, "[query]", undefined, true)).matches,
  ).toEqual([{ path: "src/file.txt", line: 1, text: "First literal [query]" }]);
});

test("search bounds matches and snippets and reports truncation", async () => {
  const { repo } = await fixture();
  await writeFile(
    join(repo, "many.txt"),
    Array.from(
      { length: MAX_SEARCH_MATCHES + 1 },
      () => `${"a".repeat(2000)} needle ${"b".repeat(2000)}\n`,
    ).join(""),
  );
  const result = await searchBrowse({ kind: "worktree", repo }, "needle");
  expect(result.matches).toHaveLength(MAX_SEARCH_MATCHES);
  expect(result.truncated).toBe(true);
  expect(
    result.matches.every((match) => match.text.length <= 1002 && match.text.includes("needle")),
  ).toBe(true);
  const aborted = AbortSignal.abort();
  await expect(searchBrowse({ kind: "worktree", repo }, "needle", aborted)).rejects.toThrow(
    "aborted",
  );
  for (const query of ["", "a\nb", "a\0b", "x".repeat(257)])
    expect(
      browseSearchRequestSchema.safeParse({ source: { kind: "worktree", repo }, query }).success,
    ).toBe(false);
});

test("blame reports committed and uncommitted lines for the exact file identity without writes", async () => {
  const { repo, oid } = await fixture();
  const source = { kind: "worktree" as const, repo };
  await writeFile(
    join(repo, "src/file.txt"),
    "First literal [query]\nEdited second line\nNew third line\n",
  );
  const file = await readBrowse(source, "src/file.txt");
  const status = git(repo, "status", "--porcelain");
  const result = await blameBrowse({
    source,
    path: file.path,
    identity: file.identity,
    startLine: 1,
    endLine: 200,
  });
  expect(result.lines).toHaveLength(3);
  expect(result.lines[0]).toMatchObject({
    line: 1,
    commit: oid,
    author: "Test Author",
    summary: "Initial content",
  });
  expect(result.lines[0]!.date).toMatch(/^\d{4}-\d\d-/);
  expect(result.lines[1]).toMatchObject({
    line: 2,
    commit: "0".repeat(40),
    author: "Not committed",
  });
  expect(result.lines[2]).toMatchObject({ line: 3, summary: "Uncommitted change" });
  expect(git(repo, "status", "--porcelain")).toBe(status);
  const commit = { kind: "commit" as const, repo, oid };
  const original = await readBrowse(commit, file.path);
  const historical = await blameBrowse({
    source: commit,
    path: file.path,
    identity: original.identity,
    startLine: 2,
    endLine: 2,
  });
  expect(historical.lines).toHaveLength(1);
  expect(historical.lines[0]).toMatchObject({ line: 2, commit: oid });
});

test("blame rejects stale identity, traversal, and overlarge ranges; handles missing history and binary files", async () => {
  const { root, repo } = await fixture();
  const source = { kind: "worktree" as const, repo };
  const file = await readBrowse(source, "src/file.txt");
  const input = { source, path: file.path, identity: file.identity, startLine: 1, endLine: 1 };
  await writeFile(join(repo, file.path), "new version");
  await expect(blameBrowse(input)).rejects.toMatchObject({ code: "file-changed", status: 409 });
  await expect(blameBrowse({ ...input, path: "../outside" })).rejects.toMatchObject({
    code: "invalid-path",
  });
  expect(browseBlameRequestSchema.safeParse({ ...input, endLine: 201 }).success).toBe(false);
  expect(browseBlameRequestSchema.safeParse({ ...input, startLine: 2 }).success).toBe(false);
  for (const [path, text] of [
    ["new.txt", "untracked"],
    ["binary.bin", "a\0b"],
  ]) {
    await writeFile(join(repo, path!), text!);
    const read = await readBrowse(source, path!);
    const result = await blameBrowse({ ...input, path: path!, identity: read.identity });
    expect(result.lines).toEqual([]);
    expect(result.reason).toBeTruthy();
  }
  const unborn = join(root, "unborn");
  await mkdir(unborn);
  git(unborn, "init", "-q");
  await writeFile(join(unborn, "new.txt"), "first file");
  const fresh = { kind: "worktree" as const, repo: unborn };
  const read = await readBrowse(fresh, "new.txt");
  expect(
    await blameBrowse({ ...input, source: fresh, path: "new.txt", identity: read.identity }),
  ).toMatchObject({ lines: [], reason: "This worktree has no committed history." });
  await expect(blameBrowse(input, AbortSignal.abort())).rejects.toThrow("aborted");
});

test("HTTP search and blame enforce repository authorization and range schemas", async () => {
  const { root, repo } = await fixture();
  const host = await startHost({ repo });
  hosts.push(host);
  const origin = `http://127.0.0.1:${host.port}`;
  const headers = { authorization: `Bearer ${host.token}`, "content-type": "application/json" };
  const call = (route: string, body: unknown) =>
    fetch(`${origin}/api/browse/${route}`, { method: "POST", headers, body: JSON.stringify(body) });
  const source = { kind: "worktree" as const, repo };
  const file = await readBrowse(source, "src/file.txt");
  expect((await call("search", { source, query: "literal" })).status).toBe(200);
  expect(
    (await call("search", { source: { ...source, repo: root }, query: "literal" })).status,
  ).toBe(403);
  const input = { source, path: file.path, identity: file.identity, startLine: 1, endLine: 1 };
  expect((await call("blame", input)).status).toBe(200);
  expect((await call("blame", { ...input, endLine: 201 })).status).toBe(400);
  expect((await call("blame", { ...input, identity: "stale" })).status).toBe(409);
});

test("blame preserves a UTF-8 BOM in verified working contents", async () => {
  const { repo } = await fixture();
  const path = "bom.txt";
  await writeFile(join(repo, path), "\ufeffcommitted first line\nsecond line\n");
  git(repo, "add", path);
  git(repo, "commit", "-q", "-m", "BOM content");
  const oid = git(repo, "rev-parse", "HEAD");
  const source = { kind: "worktree" as const, repo };
  const file = await readBrowse(source, path);
  expect(file.text).toBe("\ufeffcommitted first line\nsecond line\n");
  const blame = await blameBrowse({
    source,
    path,
    identity: file.identity,
    startLine: 1,
    endLine: 2,
  });
  expect(blame.lines.map((line) => line.commit)).toEqual([oid, oid]);
});

test("working blame does not execute Git clean filters", async () => {
  const { repo } = await fixture();
  await writeFile(join(repo, ".gitattributes"), "src/file.txt filter=inspect-test\n");
  git(repo, "config", "filter.inspect-test.clean", "touch inspect-filter-ran; cat");
  const source = { kind: "worktree" as const, repo };
  const file = await readBrowse(source, "src/file.txt");
  const result = await blameBrowse({
    source,
    path: file.path,
    identity: file.identity,
    startLine: 1,
    endLine: 2,
  });
  expect(result.lines).toEqual([]);
  expect(result.reason).toContain("Git content filter");
  await expect(access(join(repo, "inspect-filter-ran"))).rejects.toMatchObject({ code: "ENOENT" });
});
