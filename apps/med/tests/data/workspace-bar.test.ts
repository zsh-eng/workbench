import { describe, expect, test } from "vitest";
import { barContext } from "../../src/web/data/bar-context";
import type { ThreadList } from "../../src/shared/threads";

const list = {
  threads: [
    {
      id: "claude-t1",
      kind: "session",
      title: "Tax rates",
      createdAt: "2026-11-12T00:00:00Z",
      updatedAt: 0,
      repository: { id: "repo-0", name: "tide", path: "/code/tide" },
      checkout: "/code/tide",
      branch: "main",
      reviews: [],
    },
  ],
  repositories: [],
} as unknown as ThreadList;
const thread = { id: "thread-claude-t1", kind: "thread", threadId: "claude-t1" } as const;

describe("a thread's band", () => {
  test("names where the thread works until the workspace says what it shows", () => {
    expect(barContext(thread, list)).toMatchObject({ path: "/code/tide", branch: "main" });
  });

  test("names the branch that a Review moved the workspace to", () => {
    expect(
      barContext(
        {
          ...thread,
          viewingPath: "/code/tide",
          viewingBranch: "tax-rates",
          viewingRepository: "tide",
        },
        list,
      ),
    ).toMatchObject({ repository: "tide", path: "/code/tide", branch: "tax-rates" });
  });

  test("names another checkout that a Review shows", () => {
    expect(
      barContext(
        {
          ...thread,
          viewingPath: "/code/tide-feature",
          viewingBranch: "feature",
          viewingRepository: "tide",
          worktree: "/code/tide-feature",
        },
        list,
      ),
    ).toMatchObject({
      repository: "tide",
      path: "/code/tide-feature",
      branch: "feature",
      linked: true,
      title: "Tax rates",
    });
  });
});
