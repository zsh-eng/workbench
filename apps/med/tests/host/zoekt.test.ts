import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, expect, test } from "vitest";
import { ZoektSearchService } from "../../src/host/search/service";

const binaryDirectory = process.env.MED_TEST_ZOEKT_BIN;
const temporary: string[] = [];
const services: ZoektSearchService[] = [];
const git = (repo: string, ...args: string[]) =>
  execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
    cwd: repo,
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "Search Test",
      GIT_AUTHOR_EMAIL: "search@example.com",
      GIT_COMMITTER_NAME: "Search Test",
      GIT_COMMITTER_EMAIL: "search@example.com",
    },
  }).trim();

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "med-zoekt-")));
  temporary.push(root);
  const repo = join(root, "main");
  await mkdir(repo);
  git(repo, "init", "-q", "-b", "main");
  await writeFile(join(repo, "file.txt"), "committed needle\nneedle OR repo:other\n");
  git(repo, "add", ".");
  git(repo, "commit", "-q", "-m", "Initial content");
  return { root, repo, oid: git(repo, "rev-parse", "HEAD"), cacheRoot: join(root, "cache") };
}

/** A checkout searches its working files up to `maxWorkingFiles` files; these
 * tests use the index for any checkout unless they ask otherwise. */
async function start(
  repo: string,
  cacheRoot: string,
  binDir = binaryDirectory,
  maxWorkingFiles = 0,
) {
  const service = new ZoektSearchService(repo, {
    binDir,
    cacheRoot,
    pollMs: 50,
    debounceMs: 20,
    maxWorkingFiles,
  });
  services.push(service);
  await service.start();
  return service;
}

async function ready(
  service: ZoektSearchService,
  branch?: string,
  commit?: string,
  recovery = false,
) {
  const deadline = Date.now() + (recovery ? 30_000 : 20_000);
  while (Date.now() < deadline) {
    const status = service.status();
    if (status.state === "error" && !recovery)
      throw new Error(status.message ?? "Index build failed.");
    if (
      status.state === "ready" &&
      (!branch ||
        status.branches.some(
          (entry) => entry.name === branch && (!commit || entry.commit === commit),
        ))
    )
      return;
    await delay(50);
  }
  throw new Error(`Index did not become ready: ${JSON.stringify(service.status())}`);
}

async function fingerprint(repo: string) {
  return {
    refs: git(repo, "show-ref"),
    head: git(repo, "symbolic-ref", "HEAD"),
    index: createHash("sha256")
      .update(await readFile(join(repo, ".git/index")))
      .digest("hex"),
    contents: await readFile(join(repo, "file.txt"), "utf8"),
  };
}

async function shardStats(root: string): Promise<Record<string, { size: number; mtime: number }>> {
  const result: Record<string, { size: number; mtime: number }> = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) Object.assign(result, await shardStats(path));
    else if (entry.name.endsWith(".zoekt")) {
      const value = await stat(path);
      result[path] = { size: value.size, mtime: value.mtimeMs };
    }
  }
  return result;
}

afterEach(async () => {
  for (const service of services.splice(0).reverse()) await service.close();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("without the index, a checkout searches its working files with uncommitted and untracked changes, and a commit its own files", async () => {
  const { root, repo, oid, cacheRoot } = await fixture();
  await writeFile(join(repo, "file.txt"), "dirty needle\n");
  await writeFile(join(repo, "untracked.txt"), "untracked needle\n");
  const service = await start(repo, cacheRoot, join(root, "missing-binaries"));
  expect(service.status().state).toBe("unavailable");
  const source = { kind: "worktree" as const, repo };
  const before = await fingerprint(repo);
  expect(await service.search(source, "needle")).toMatchObject({
    source,
    resultSource: source,
    engine: "git",
    matches: [
      { path: "file.txt", line: 1, text: "dirty needle" },
      { path: "untracked.txt", line: 1, text: "untracked needle" },
    ],
  });
  expect(await service.search({ kind: "commit", repo, oid }, "needle")).toMatchObject({
    resultSource: { kind: "commit", repo, oid },
    engine: "git",
    matches: [
      { path: "file.txt", line: 1, text: "committed needle" },
      { path: "file.txt", line: 2, text: "needle OR repo:other" },
    ],
  });
  await expect(service.search(source, "needle", AbortSignal.abort())).rejects.toThrow(/abort/i);
  expect(await fingerprint(repo)).toEqual(before);
});

test.skipIf(!binaryDirectory)(
  "a checkout up to the limit searches its working files though the index is ready; a larger one reads its last commit and says so",
  async () => {
    const { repo, oid, cacheRoot } = await fixture();
    await writeFile(join(repo, "file.txt"), "dirty needle\n");
    const source = { kind: "worktree" as const, repo };
    const small = await start(repo, cacheRoot, binaryDirectory, 1);
    await ready(small, "main", oid);
    expect(await small.search(source, "needle")).toMatchObject({
      resultSource: source,
      engine: "git",
      matches: [{ path: "file.txt", line: 1, text: "dirty needle" }],
    });
    expect((await small.search(source, "needle")).reason).toBeUndefined();
    await small.close();
    const large = await start(repo, cacheRoot, binaryDirectory, 0);
    await ready(large, "main", oid);
    expect(await large.search(source, "needle")).toMatchObject({
      resultSource: { kind: "commit", repo, oid },
      engine: "zoekt",
      matches: [
        { path: "file.txt", line: 1, text: "committed needle" },
        { path: "file.txt", line: 2, text: "needle OR repo:other" },
      ],
      reason:
        "This checkout has more than 0 files, so search reads its last commit in the index, without uncommitted changes.",
    });
  },
  45_000,
);

test.skipIf(!binaryDirectory)(
  "Zoekt searches exact commits and linked branches without writes or query syntax injection",
  async () => {
    const { root, repo, oid, cacheRoot } = await fixture();
    const linked = join(root, "linked");
    git(repo, "worktree", "add", "-q", "-b", "topic", linked);
    await writeFile(join(linked, "file.txt"), "topic needle\n");
    git(linked, "add", "file.txt");
    git(linked, "commit", "-q", "-m", "Topic content");
    const topicOid = git(linked, "rev-parse", "HEAD");
    await writeFile(join(linked, "file.txt"), "dirty topic needle\n");
    const before = await fingerprint(repo);
    const linkedIndex = await readFile(join(repo, ".git/worktrees/linked/index"));
    const service = await start(repo, cacheRoot);
    await ready(service, "topic", topicOid);
    const source = { kind: "worktree" as const, repo };
    expect(await service.search(source, "needle OR repo:other")).toMatchObject({
      engine: "zoekt",
      resultSource: { kind: "commit", repo, oid },
      matches: [{ path: "file.txt", line: 2, text: "needle OR repo:other" }],
    });
    expect(await service.search({ kind: "worktree", repo: linked }, "needle")).toMatchObject({
      engine: "zoekt",
      resultSource: { kind: "commit", repo: linked, oid: topicOid },
      matches: [{ path: "file.txt", line: 1, text: "topic needle" }],
    });
    expect(await service.search({ kind: "commit", repo, oid }, "committed")).toMatchObject({
      engine: "zoekt",
      matches: [{ path: "file.txt", line: 1, text: "committed needle" }],
    });
    expect(await fingerprint(repo)).toEqual(before);
    expect(await readFile(join(repo, ".git/worktrees/linked/index"))).toEqual(linkedIndex);
    expect(await readFile(join(linked, "file.txt"), "utf8")).toBe("dirty topic needle\n");
  },
  30_000,
);

test.skipIf(!binaryDirectory)(
  "polling updates committed content and synchronizes added and removed branches without Git hooks",
  async () => {
    const { repo, oid, cacheRoot } = await fixture();
    const service = await start(repo, cacheRoot);
    await ready(service, "main", oid);
    await writeFile(join(repo, "file.txt"), "new committed needle\n");
    git(repo, "add", "file.txt");
    git(repo, "commit", "-q", "-m", "Updated content");
    const updated = git(repo, "rev-parse", "HEAD");
    const before = await fingerprint(repo);
    // This request must never return the old index version, even before
    // polling sees the commit: until then, Git searches the working files.
    expect(await service.search({ kind: "worktree", repo }, "needle")).toMatchObject({
      engine: "git",
      resultSource: { kind: "worktree", repo },
      matches: [{ path: "file.txt", line: 1, text: "new committed needle" }],
    });
    await ready(service, "main", updated);
    expect((await service.search({ kind: "worktree", repo }, "needle")).engine).toBe("zoekt");
    expect(await service.search({ kind: "commit", repo, oid }, "committed")).toMatchObject({
      resultSource: { kind: "commit", repo, oid },
      matches: [{ path: "file.txt", line: 1, text: "committed needle" }],
    });
    expect(await fingerprint(repo)).toEqual(before);
    git(repo, "branch", "agent/new");
    await ready(service, "agent/new", updated);
    git(repo, "branch", "-D", "agent/new");
    await expect
      .poll(
        () => {
          const status = service.status();
          return (
            status.state === "ready" && !status.branches.some((entry) => entry.name === "agent/new")
          );
        },
        { timeout: 20_000, interval: 50 },
      )
      .toBe(true);
    expect(service.status().branches).toContainEqual({ name: "main", commit: updated });
    // Agents can amend or rewind a branch. Its dirty working file must not replace commit data.
    git(repo, "update-ref", "refs/heads/main", oid);
    const rewound = await fingerprint(repo);
    await ready(service, "main", oid);
    expect(await service.search({ kind: "worktree", repo }, "committed")).toMatchObject({
      engine: "zoekt",
      resultSource: { kind: "commit", repo, oid },
      matches: [{ path: "file.txt", line: 1, text: "committed needle" }],
    });
    expect(await fingerprint(repo)).toEqual(rewound);
  },
  45_000,
);

test.skipIf(!binaryDirectory).each(["missing", "corrupt"] as const)(
  "rebuilds %s persisted shards with an intact manifest without changing source files",
  async (damage) => {
    const { repo, oid, cacheRoot } = await fixture();
    const first = await start(repo, cacheRoot);
    await ready(first, "main", oid);
    const shards = Object.keys(await shardStats(cacheRoot));
    expect(shards.length).toBeGreaterThan(0);
    const manifestPath = join(dirname(dirname(shards[0]!)), "manifest.json");
    const manifest = await readFile(manifestPath, "utf8");
    const sourceBefore = await fingerprint(repo);
    await first.close();
    for (const shard of shards) {
      if (damage === "missing") await rm(shard);
      else await writeFile(shard, "invalid zoekt shard\n");
    }
    expect(await readFile(manifestPath, "utf8")).toBe(manifest);
    const reopened = await start(repo, cacheRoot);
    await ready(reopened, "main", oid, true);
    expect(await reopened.search({ kind: "worktree", repo }, "committed")).toMatchObject({
      engine: "zoekt",
      resultSource: { kind: "commit", repo, oid },
      matches: [{ path: "file.txt", line: 1, text: "committed needle" }],
    });
    expect(Object.keys(await shardStats(cacheRoot)).length).toBeGreaterThan(0);
    expect(await fingerprint(repo)).toEqual(sourceBefore);
  },
  40_000,
);

test.skipIf(!binaryDirectory)(
  "retains index shards across restart and uses Git when another host owns the cache",
  async () => {
    const { repo, oid, cacheRoot } = await fixture();
    const first = await start(repo, cacheRoot);
    await ready(first, "main", oid);
    const shards = await shardStats(cacheRoot);
    expect(Object.keys(shards).length).toBeGreaterThan(0);
    const other = await start(repo, cacheRoot);
    expect(other.status().state).toBe("unavailable");
    expect(await other.search({ kind: "worktree", repo }, "committed")).toMatchObject({
      engine: "git",
      resultSource: { kind: "worktree", repo },
      matches: [{ path: "file.txt", line: 1, text: "committed needle" }],
    });
    expect(await other.search({ kind: "commit", repo, oid }, "committed")).toMatchObject({
      engine: "git",
      resultSource: { kind: "commit", repo, oid },
    });
    await other.close();
    await first.close();
    const reopened = await start(repo, cacheRoot);
    await ready(reopened, "main", oid);
    expect((await reopened.search({ kind: "worktree", repo }, "committed")).engine).toBe("zoekt");
    expect(await shardStats(cacheRoot)).toEqual(shards);
  },
  45_000,
);

test.skipIf(!binaryDirectory)(
  "match case keeps the index's lines as typed, and Git counts the cap when the index stopped at its own",
  async () => {
    const { repo, cacheRoot } = await fixture();
    // More lines in another case than the index returns, then one as typed.
    await writeFile(join(repo, "many.txt"), `${"needle\n".repeat(250)}const NEEDLE = 1;\n`);
    git(repo, "add", "many.txt");
    git(repo, "commit", "-q", "-m", "Many needles");
    const oid = git(repo, "rev-parse", "HEAD");
    const service = await start(repo, cacheRoot);
    await ready(service, "main", oid);
    const source = { kind: "commit" as const, repo, oid };
    expect(await service.search(source, "Committed", undefined, true)).toMatchObject({
      engine: "zoekt",
      matchCase: true,
      matches: [],
    });
    expect(await service.search(source, "committed", undefined, true)).toMatchObject({
      engine: "zoekt",
      matches: [{ path: "file.txt", line: 1, text: "committed needle" }],
    });
    expect(await service.search(source, "NEEDLE", undefined, true)).toMatchObject({
      engine: "git",
      matchCase: true,
      truncated: false,
      matches: [{ path: "many.txt", line: 251, text: "const NEEDLE = 1;" }],
    });
  },
  30_000,
);

test.skipIf(!binaryDirectory)(
  "indexed symbols exclude references and dirty files and keep the exact commit",
  async () => {
    const { repo, cacheRoot } = await fixture();
    await writeFile(
      join(repo, "symbol.ts"),
      "export function committedSymbol() {}\ncommittedSymbol();\n",
    );
    git(repo, "add", ".");
    git(repo, "commit", "-qm", "Symbol");
    const oid = git(repo, "rev-parse", "HEAD");
    const service = await start(repo, cacheRoot);
    await ready(service);
    await writeFile(join(repo, "symbol.ts"), "export function dirtySymbol() {}\n");
    const result = await service.symbols({ kind: "worktree", repo }, "committedSymbol");
    expect(result.unavailable).toBeUndefined();
    expect(result.resultSource).toEqual({ kind: "commit", repo, oid });
    expect(result.matches).toEqual([
      { name: "committedSymbol", kind: "function", path: "symbol.ts", line: 1 },
    ]);
    expect((await service.symbols({ kind: "worktree", repo }, "dirtySymbol")).matches).toEqual([]);
    expect(
      (await service.symbols({ kind: "commit", repo, oid: "b".repeat(40) }, "committedSymbol"))
        .unavailable,
    ).toContain("not indexed");
  },
);
