import { describe, expect, test } from "vitest";
import { createReviewController } from "../../src/web/data/controller";
import type { Branch, Comparison, Worktree } from "../../src/shared/protocol";
const A = "a".repeat(40),
  B = "b".repeat(40),
  C = "c".repeat(40);
function fixture() {
  let worktrees: Worktree[] = [
    { path: "/repo", head: A, branch: "main" },
    { path: "/linked", head: B, branch: "feature" },
  ];
  let branches: Branch[] = [
    { name: "main", head: A, current: true, worktreePath: "/repo" },
    { name: "feature", head: B, current: false, worktreePath: "/linked" },
    { name: "topic", head: C, current: false },
  ];
  let linkedBranch = "feature";
  const reviews: { repo: string; comparison: Comparison }[] = [];
  const controller = createReviewController({
    events: false,
    parsePatch: async () => [],
    fetch: async (input, init) => {
      const url = new URL(String(input), "http://localhost");
      const repo = url.searchParams.get("repo") ?? "/repo";
      if (url.pathname === "/api/session")
        return Response.json({
          protocol: 1,
          repository: {
            path: repo,
            name: "repo",
            head: repo === "/repo" ? A : B,
            branch:
              repo === "/repo" ? "main" : repo === "/detached" ? "Detached HEAD" : linkedBranch,
            git: true,
            shallow: false,
          },
          worktrees,
        });
      if (url.pathname === "/api/branches") return Response.json(branches);
      if (url.pathname === "/api/review") {
        const input = JSON.parse(String(init?.body));
        reviews.push(input);
        const id =
          input.comparison.kind === "commit" ? input.comparison.commit : input.repo + "-working";
        return Response.json({
          id,
          repo: input.repo,
          comparison: input.comparison,
          base: A,
          head: id,
          label: "Review",
          files: [],
          patch: "",
          warnings: [],
          metrics: { gitMs: 0, totalMs: 0, patchBytes: 0, cacheHit: false },
        });
      }
      if (url.pathname === "/api/notes")
        return Response.json({
          reviewId: url.searchParams.get("reviewId"),
          revision: 0,
          notes: [],
        });
      throw new Error(url.pathname);
    },
  });
  return {
    controller,
    reviews,
    setLinkedBranch: (name: string) => {
      linkedBranch = name;
    },
    addDetached: () => {
      worktrees = [...worktrees, { path: "/detached", head: C, branch: "Detached HEAD" }];
    },
    setBranches: (next: Branch[]) => {
      branches = next;
    },
  };
}
describe("branch targets", () => {
  test("uses an existing worktree but reads unattached branch objects without changing checkout", async () => {
    const f = fixture();
    await f.controller.initialize();
    await f.controller.selectBranch("feature");
    expect(f.reviews.at(-1)).toEqual({ repo: "/linked", comparison: { kind: "working" } });
    await f.controller.selectBranch("topic");
    expect(f.reviews.at(-1)).toEqual({ repo: "/repo", comparison: { kind: "commit", commit: C } });
    expect(f.controller.getSnapshot().historyRef).toBe("refs/heads/topic");
    const count = f.reviews.length;
    await f.controller.selectComparison({ kind: "working" });
    expect(f.reviews).toHaveLength(count);
    expect(f.controller.getSnapshot().error).toContain("no worktree");
    f.controller.dispose();
  });
  test("falls back to branch snapshot if a worktree changed branches since discovery", async () => {
    const f = fixture();
    await f.controller.initialize();
    f.setLinkedBranch("another");
    await f.controller.selectBranch("feature");
    expect(f.reviews.at(-1)?.comparison).toEqual({ kind: "commit", commit: B });
    expect(f.controller.getSnapshot().activeBranch).toBe("feature");
    expect(f.controller.getSnapshot().historyRef).toBe("refs/heads/feature");
    f.controller.dispose();
  });
  test("refresh discovers detached worktrees and keeps detached selection distinct", async () => {
    const f = fixture();
    await f.controller.initialize();
    f.addDetached();
    await f.controller.refresh();
    expect(f.controller.getSnapshot().session?.worktrees).toHaveLength(3);
    await f.controller.selectWorktree("/detached");
    expect(f.controller.getSnapshot().activeBranch).toBeNull();
    expect(f.controller.getSnapshot().historyRef).toBeNull();
    f.controller.dispose();
  });
});
