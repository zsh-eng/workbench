import { execFileSync } from "node:child_process";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { readBrowse, writeBrowse } from "../../src/host/repository/browse";

// A save checks the file's folder several times while it writes its copy.
// This hook runs at each of those checks, so another program can write then.
const hooks = vi.hoisted(() => ({
  folderCheck: null as null | ((path: string) => Promise<void>),
}));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    realpath: async (...args: Parameters<typeof actual.realpath>) => {
      await hooks.folderCheck?.(String(args[0]));
      return actual.realpath(...args);
    },
  };
});

const roots: string[] = [];
afterEach(async () => {
  hooks.folderCheck = null;
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

test("a save never replaces a file that another program wrote while the save checked it", async () => {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "med-save-window-")));
  roots.push(root);
  const repo = join(root, "repo");
  const folder = join(repo, "src");
  await fs.mkdir(folder, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: repo });
  const path = "src/file.txt";
  const file = join(repo, path);
  await fs.writeFile(file, "first\n");
  const source = { kind: "worktree", repo } as const;
  // Med's copy of the draft is in the folder while the save checks.
  const saving = async () =>
    (await fs.readdir(folder)).some((name) => name.startsWith(".med-save-"));

  // Count the folder checks of one save.
  let checks = 0;
  hooks.folderCheck = async (checked) => {
    if (checked === folder && (await saving())) checks++;
  };
  const first = await readBrowse(source, path);
  await writeBrowse(source, path, first.identity, "draft\n");
  expect(checks).toBeGreaterThan(0);

  // Another program writes at each check in turn. The save stops each time,
  // and the other program's text stays.
  for (let check = 1; check <= checks; check++) {
    hooks.folderCheck = null;
    await fs.writeFile(file, `before ${check}\n`);
    const current = await readBrowse(source, path);
    let seen = 0;
    hooks.folderCheck = async (checked) => {
      if (checked === folder && (await saving()) && ++seen === check)
        await fs.writeFile(file, `agent ${check}\n`);
    };
    await expect(
      writeBrowse(source, path, current.identity, `draft ${check}\n`),
    ).rejects.toMatchObject({ code: "file-changed", status: 409 });
    expect(await fs.readFile(file, "utf8")).toBe(`agent ${check}\n`);
  }
});
