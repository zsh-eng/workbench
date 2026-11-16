import { expect, test } from "vitest";
import { changesBase } from "../../src/shared/protocol";

const repository = (checkedOut: string, defaultBranch?: string) => ({
  path: "/repo",
  worktrees: [{ path: "/repo", head: "a".repeat(40), branch: checkedOut }],
  ...(defaultBranch ? { defaultBranch } : {}),
});

test("Changes start at the repository's default branch, whatever branch its main checkout is on", () => {
  // An agent's branch in the main checkout: its changes since main, with its commits.
  expect(changesBase(repository("agent/fix", "main"), "agent/fix")).toBe("main");
  expect(changesBase(repository("main", "main"), "agent/fix")).toBe("main");
  // On main itself, the working changes.
  expect(changesBase(repository("agent/fix", "main"), "main")).toBeUndefined();
  // A base that the reader chose leads.
  expect(changesBase(repository("agent/fix", "main"), "agent/fix", "release")).toBe("release");
  // A repository with no default branch that Med knows: its main checkout's branch.
  expect(changesBase(repository("trunk"), "feature")).toBe("trunk");
});
