import { realpath } from "node:fs/promises";
import { HostError } from "../runtime/errors";
import { git } from "../runtime/process";
import { listWorktrees } from "./history";

/**
 * Removes a linked worktree with `git worktree remove`, without --force, so
 * Git keeps one that has changed or untracked files. The main checkout stays,
 * and so does a detached checkout whose commit no branch holds. The branch
 * stays too. Returns the main checkout.
 */
export async function removeWorktree(path: string, signal?: AbortSignal) {
  const worktrees = await listWorktrees(path, signal);
  const canonical = (entry: { path: string }) => realpath(entry.path).catch(() => entry.path);
  const main = worktrees[0];
  let target: (typeof worktrees)[number] | undefined;
  for (const entry of worktrees) if ((await canonical(entry)) === path) target = entry;
  if (!main || !target)
    throw new HostError("worktree-not-found", "Git does not list this worktree.", 404);
  if (!target.linked)
    throw new HostError(
      "main-worktree",
      "This is the repository's own checkout. Med removes only linked worktrees.",
      409,
    );
  if (target.branch === "Detached HEAD") {
    const held = await git(
      path,
      ["for-each-ref", "--count=1", "--contains", "HEAD", "--format=%(refname)"],
      { signal, maxBytes: 8192 },
    );
    if (!held.toString("utf8").trim())
      throw new HostError(
        "worktree-unsaved",
        "Its commit is on no branch. Make a branch to keep it, or close the workspace alone.",
        409,
      );
  }
  try {
    await git(main.path, ["worktree", "remove", path], { signal, timeoutMs: 120_000 });
  } catch (error) {
    signal?.throwIfAborted();
    const stderr = String((error as { stderr?: unknown }).stderr ?? "");
    if (stderr.includes("contains modified or untracked files"))
      throw new HostError(
        "worktree-changed",
        "It has changed or untracked files. Commit or discard them, then try again.",
        409,
      );
    const line = stderr
      .trim()
      .split("\n")
      .at(-1)
      ?.replace(/^(fatal|error): /, "");
    throw new HostError("worktree-kept", line || "Git could not remove this worktree.", 409);
  }
  return main.path;
}
