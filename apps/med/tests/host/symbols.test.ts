import { execFileSync } from "node:child_process";
import { mkdtemp, writeFile, rm, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import {
  discoverCtags,
  FileSymbolService,
  parseSymbols,
  WorkingTreeSymbols,
} from "../../src/host/search/symbols";
import { readBrowse } from "../../src/host/repository/browse";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});
test("Ctags output is validated and declaration duplicates are removed", () => {
  const tag = JSON.stringify({
    _type: "tag",
    name: "hello",
    kind: "function",
    line: 4,
    scope: "Example",
  });
  expect(
    parseSymbols(
      [tag, tag, "bad json", JSON.stringify({ _type: "tag", name: "bad", line: -2 })].join("\n"),
      "a.ts",
    ),
  ).toEqual({
    matches: [{ name: "hello", kind: "function", line: 4, path: "a.ts", scope: "Example" }],
    truncated: false,
  });
});
const tool = await discoverCtags();
test.skipIf(!tool)(
  "file symbols use the exact worktree or historical snapshot and reject stale identities",
  async () => {
    const repo = await realpath(await mkdtemp(join(tmpdir(), "med-symbol-test-")));
    roots.push(repo);
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-C",
          repo,
          "-c",
          "core.hooksPath=/dev/null",
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          ...args,
        ],
        { encoding: "utf8" },
      ).trim();
    git("init", "-q");
    await writeFile(join(repo, "file.ts"), "export function committed() {}\n");
    git("add", ".");
    git("commit", "-qm", "test");
    const oid = git("rev-parse", "HEAD");
    const source = { kind: "worktree" as const, repo };
    const before = await readBrowse(source, "file.ts");
    await writeFile(join(repo, "file.ts"), "export function modified() {}\n");
    const service = new FileSymbolService(tool);
    const live = await service.search({ source, query: "", path: "file.ts" });
    expect(live.matches.map((m) => m.name)).toContain("modified");
    expect(
      (
        await service.search({ source: { kind: "commit", repo, oid }, query: "", path: "file.ts" })
      ).matches.map((m) => m.name),
    ).toContain("committed");
    expect(
      (await service.search({ source, query: "", path: "file.ts", identity: before.identity }))
        .unavailable,
    ).toContain("changed");
    expect((await service.search({ source, query: "", path: "file.ts" })).matches).toEqual(
      live.matches,
    );
    await writeFile(join(repo, "file.zig"), "pub fn hello() void {}\n");
    expect((await service.search({ source, query: "", path: "file.zig" })).unavailable).toContain(
      "does not support",
    );
    await writeFile(join(repo, "binary.ts"), Buffer.from([0, 1, 2]));
    expect((await service.search({ source, query: "", path: "binary.ts" })).matches).toEqual([]);
  },
);

test.skipIf(!tool)(
  "project symbols of a checkout come from its working files, and follow their changes",
  async () => {
    const repo = await realpath(await mkdtemp(join(tmpdir(), "med-project-symbols-")));
    const outside = await realpath(await mkdtemp(join(tmpdir(), "med-project-outside-")));
    roots.push(repo, outside);
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        [
          "-C",
          repo,
          "-c",
          "commit.gpgsign=false",
          "-c",
          "user.name=Test",
          "-c",
          "user.email=test@example.com",
          ...args,
        ],
        { encoding: "utf8" },
      );
    git("init", "-q");
    await writeFile(join(repo, ".gitignore"), "ignored.ts\n");
    await writeFile(join(repo, "a.ts"), "export function committedName() {}\n");
    await writeFile(join(repo, "data.json"), JSON.stringify({ committedKey: 1 }));
    git("add", ".");
    git("commit", "-qm", "test");
    await writeFile(join(repo, "b.ts"), "export class UntrackedCounter {}\n");
    await writeFile(join(repo, "ignored.ts"), "export function ignoredName() {}\n");
    await writeFile(join(outside, "secret.ts"), "export function outsideName() {}\n");
    await symlink(join(outside, "secret.ts"), join(repo, "link.ts"));
    const service = new WorkingTreeSymbols(tool);
    const names = async (query: string) =>
      (await service.search(repo, query))!.matches.map((match) => `${match.name} ${match.path}`);
    const first = await service.search(repo, "Counter");
    expect(first?.resultSource).toEqual({ kind: "worktree", repo });
    expect(first?.matches.map((match) => match.name)).toEqual(["UntrackedCounter"]);
    expect(await names("committed")).toEqual(["committedName a.ts"]);
    // Ignored files, data files, and links are not parsed.
    expect(await names("ignored")).toEqual([]);
    expect(await names("committedKey")).toEqual([]);
    expect(await names("outside")).toEqual([]);
    // A change, a rename and a deletion show at the next search.
    await writeFile(join(repo, "a.ts"), "export function renamedFunction() {}\n");
    await rm(join(repo, "b.ts"));
    expect(await names("committed")).toEqual([]);
    expect(await names("renamed")).toEqual(["renamedFunction a.ts"]);
    expect(await names("Counter")).toEqual([]);
  },
);
