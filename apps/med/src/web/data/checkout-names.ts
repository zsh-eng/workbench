import type { RegisteredRepository } from "../../shared/protocol";

/* Med names a checkout by its repository and its place in that repository, so
 * home folder paths stay out of screenshots. Only sources and selections keep
 * the absolute path. */

/** A worktree's place in its repository; a worktree elsewhere shows its folder name. */
export function repositoryLocation(repository: string, path: string) {
  if (path === repository) return "";
  if (path.startsWith(`${repository}/`)) return path.slice(repository.length + 1);
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The repository name, then the worktree's location when it is not the repository itself. */
export function checkoutName(name: string, location: string) {
  return location ? `${name} · ${location}` : name;
}

/** The short name of a registered checkout; an unregistered one shows its folder name. */
export function checkoutNameFor(repositories: RegisteredRepository[], path: string) {
  const repository = repositories.find(
    (item) => item.path === path || item.worktrees.some((tree) => tree.path === path),
  );
  return repository
    ? checkoutName(repository.name, repositoryLocation(repository.path, path))
    : path.slice(path.lastIndexOf("/") + 1);
}
