import type { Branch, RegisteredRepository } from "../../shared/protocol";
import { reviewBase, type SavedReviewTarget } from "../../shared/saved-review";

/** A full commit ID (SHA-1 or SHA-256), not a name such as `working`. */
const FULL_OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Where a saved review's code is now: the checkout the workspace opens,
 * and the branch it shows. A branch that the checkout does not have checked
 * out shows as a read-only snapshot. */
export interface ReviewPlace {
  checkout: string;
  branch?: Branch;
}

/**
 * The place a saved review's workspace moves to, so its files are a click
 * away. Uncommitted work is in the checkout it came from. A commit is in the
 * checkout that has it checked out, else on its branch: the branch the agent
 * named, one at that commit, or the branch whose newest commits it was. With
 * none of these, as after the branch went, the workspace stays where the
 * review was captured.
 */
export function reviewPlace(
  repository: Pick<RegisteredRepository, "path" | "branches" | "worktrees">,
  target: Pick<SavedReviewTarget, "repo" | "branch" | "head" | "names">,
): ReviewPlace {
  const named = (name: string | null | undefined) =>
    name ? repository.branches.find((branch) => branch.name === name) : undefined;
  const trees = repository.worktrees.filter((tree) => !tree.bare);
  const home = trees.some((tree) => tree.path === target.repo) ? target.repo : repository.path;
  const at = (path: string) => {
    const tree = trees.find((entry) => entry.path === path);
    return { checkout: path, branch: named(tree?.branch) };
  };
  if (!FULL_OID.test(target.head))
    return home === target.repo ? at(home) : { checkout: home, branch: named(target.branch) };
  // The checkout it came from first, when it still has the commit.
  const holding = trees.filter((tree) => tree.head === target.head);
  const tree = holding.find((entry) => entry.path === target.repo) ?? holding[0];
  if (tree) return at(tree.path);
  const branch =
    named(target.names?.head) ??
    repository.branches.find((entry) => entry.head === target.head) ??
    named(target.names?.on?.branch);
  if (branch?.worktreePath && trees.some((entry) => entry.path === branch.worktreePath))
    return { checkout: branch.worktreePath, branch };
  if (branch) return { checkout: home, branch };
  return { checkout: home, branch: named(target.branch) };
}

/**
 * The checkout whose live Changes are the review's: its place, when that is
 * a checkout with the review's branch or commit checked out, or the checkout
 * that the review came from. None when the place is a read-only snapshot of
 * a branch, or the main checkout in place of a checkout that is gone: the
 * review then has no Changes of its own, and the thread's checkout shows.
 */
export function liveReviewCheckout(
  repository: Pick<RegisteredRepository, "path" | "branches" | "worktrees">,
  target: Pick<SavedReviewTarget, "repo" | "branch" | "head" | "names">,
): string | undefined {
  const { checkout, branch } = reviewPlace(repository, target);
  const tree = repository.worktrees.find((entry) => !entry.bare && entry.path === checkout);
  if (!tree) return undefined;
  if (branch) return branch.worktreePath === checkout ? checkout : undefined;
  return checkout === target.repo || tree.head === target.head ? checkout : undefined;
}

/** The Changes of a review: its live checkout, and the base branch that its
 * comparison names for them. */
export interface ReviewChanges {
  path: string;
  repositoryId: string;
  base?: string;
}

/** The Changes that belong to the review's comparison on screen; none
 * without one, or when it has no live checkout (`liveReviewCheckout`). */
export function reviewChanges(
  repositories: readonly RegisteredRepository[],
  target: SavedReviewTarget | undefined,
): ReviewChanges | undefined {
  const repository = target && repositories.find((entry) => entry.id === target.repositoryId);
  const path = repository && liveReviewCheckout(repository, target);
  if (!path) return undefined;
  const base = reviewBase(repository, target);
  return { path, repositoryId: repository.id, ...(base && { base }) };
}
