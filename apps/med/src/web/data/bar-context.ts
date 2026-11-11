import type { ThreadList } from "../../shared/threads";
import type { IconName } from "../components/Icon";
import type { Workspace } from "./workspaces";

export const basename = (path: string) =>
  path
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .at(-1) ?? path;

/** What the band names: a checkout, or a vault or pull request by its title. A
 * thread's checkout also carries the thread's title. */
export type BarContext =
  | {
      kind: "checkout";
      repository: string;
      branch?: string;
      path: string;
      linked: boolean;
      title?: string;
    }
  | { kind: "label"; icon: IconName; text: string };

/** A thread names the checkout it works in; a repository workspace, the one
 * it reports once it loads. A worktree goes by its repository's name. */
export function barContext(
  workspace: Workspace | undefined,
  list: ThreadList | null,
  /** The thread's name. */
  name?: string,
) {
  if (!workspace) return undefined;
  if (workspace.kind === "vault")
    return { kind: "label", icon: "vault", text: workspace.title ?? "Vault" } as const;
  if (workspace.kind === "thread") {
    const thread = list?.threads.find((entry) => entry.id === workspace.threadId);
    // What the workspace shows, such as a review's branch, else where the
    // thread works.
    const viewing = workspace.viewingPath;
    if (viewing && viewing !== thread?.checkout)
      return {
        kind: "checkout",
        repository: workspace.viewingRepository ?? basename(viewing),
        branch: workspace.viewingBranch,
        path: viewing,
        linked: workspace.worktree === viewing,
        title: name ?? thread?.title,
      } as const;
    if (!thread?.checkout) return undefined;
    return {
      kind: "checkout",
      repository: thread.repository?.name ?? basename(thread.checkout),
      branch: viewing ? (workspace.viewingBranch ?? thread.branch) : thread.branch,
      path: thread.checkout,
      linked: !!thread.linked,
      title: name ?? thread.title,
    } as const;
  }
  if (workspace.kind === "pull")
    return { kind: "label", icon: "pullRequest", text: workspace.title ?? "Pull request" } as const;
  if (!workspace.path) return undefined;
  return {
    kind: "checkout",
    repository:
      list?.repositories.find((entry) => entry.id === workspace.repositoryId)?.name ??
      workspace.repository ??
      basename(workspace.path),
    branch: workspace.branch,
    path: workspace.path,
    linked: !!workspace.worktree,
  } as const;
}
