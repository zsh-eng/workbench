import { expect, test } from "vitest";
import { intoWorktree } from "../../src/shared/threads";

const worktree = "/state/worktrees/repo-1/tidy-clock";

test("a new thread's task names its files in the worktree that it runs in", () => {
  const prompt = [
    "Work through /work/repo/src/duration.ts:12 and `/work/repo/docs/a b.md`.",
    "(see /work/repo/src/x.ts) and /work/repo.",
    "Leave /work/repo-old/src/x.ts, /work/repo.git and /elsewhere/work/repo/src alone.",
  ].join("\n");
  expect(intoWorktree(prompt, ["/work/repo/"], worktree)).toBe(
    [
      `Work through ${worktree}/src/duration.ts:12 and \`${worktree}/docs/a b.md\`.`,
      `(see ${worktree}/src/x.ts) and ${worktree}.`,
      "Leave /work/repo-old/src/x.ts, /work/repo.git and /elsewhere/work/repo/src alone.",
    ].join("\n"),
  );
});

test("either spelling of the checkout moves, once, even when the worktree sits under it", () => {
  const inside = "/private/work/repo/.med/worktrees/fix";
  expect(
    intoWorktree(
      "/work/repo/a.ts and /private/work/repo/b.ts",
      ["/work/repo", "/private/work/repo"],
      inside,
    ),
  ).toBe(`${inside}/a.ts and ${inside}/b.ts`);
  expect(intoWorktree("/work/repo/a.ts", [worktree], worktree)).toBe("/work/repo/a.ts");
});
