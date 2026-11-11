import { describe, expect, test } from "vitest";
import { reviewPlace } from "../../src/web/data/review-place";

const main = "a".repeat(40);
const feature = "b".repeat(40);
const reviewed = "c".repeat(40);
const repository = {
  path: "/code/tide",
  branches: [
    { name: "main", head: main, worktreePath: "/code/tide", current: true },
    { name: "feature", head: feature, worktreePath: "/code/tide-feature", current: false },
    { name: "tax-rates", head: reviewed, current: false },
  ],
  worktrees: [
    { path: "/code/tide", head: main, branch: "main" },
    { path: "/code/tide-feature", head: feature, branch: "feature", linked: true },
  ],
};
const target = { repo: "/code/tide", branch: "main", head: reviewed };

describe("a saved review's place", () => {
  test("uncommitted work stays in the checkout it came from", () => {
    expect(
      reviewPlace(repository, {
        ...target,
        repo: "/code/tide-feature",
        branch: "feature",
        head: "worktree",
      }),
    ).toEqual({ checkout: "/code/tide-feature", branch: repository.branches[1] });
  });

  test("a commit that a checkout has checked out opens that checkout, to edit", () => {
    expect(reviewPlace(repository, { ...target, head: feature })).toEqual({
      checkout: "/code/tide-feature",
      branch: repository.branches[1],
    });
  });

  test("a branch that no checkout has is a snapshot of that branch, not the capture's branch", () => {
    // Captured from main with `--head tax-rates`: the target's branch says main.
    expect(reviewPlace(repository, { ...target, names: { head: "tax-rates" } })).toEqual({
      checkout: "/code/tide",
      branch: repository.branches[2],
    });
    // Older reviews have no name: the branch at that commit.
    expect(reviewPlace(repository, target)).toEqual({
      checkout: "/code/tide",
      branch: repository.branches[2],
    });
  });

  test("a branch that has moved on opens its own checkout", () => {
    expect(
      reviewPlace(repository, { ...target, head: "d".repeat(40), names: { head: "feature" } }),
    ).toEqual({ checkout: "/code/tide-feature", branch: repository.branches[1] });
  });

  test("an agent's older commits on main stay on main", () => {
    expect(
      reviewPlace(repository, {
        ...target,
        head: "d".repeat(40),
        names: { on: { branch: "main", commits: 2 } },
      }),
    ).toEqual({ checkout: "/code/tide", branch: repository.branches[0] });
  });

  test("a commit that no branch has stays where the review was captured", () => {
    expect(
      reviewPlace(repository, { ...target, repo: "/code/gone", head: "d".repeat(40) }),
    ).toEqual({ checkout: "/code/tide", branch: repository.branches[0] });
  });
});
