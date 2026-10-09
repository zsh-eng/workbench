import {
  commitResultSchema,
  fileChangesSchema,
  pushResultSchema,
  workingStatusSchema,
  type CommitResult,
  type FileChanges,
  type WorkingFile,
  type WorkingStatus,
} from "../../shared/git-actions";
import type { createApi } from "./api";

export type { CommitResult, FileChanges, WorkingFile, WorkingStatus };
export interface PushedBranch {
  head: string;
  remote: string;
  branch: string;
}

/** What the Commit tab needs from one checkout. The elements page gives it an
 * in-memory repository; the app gives it the host. */
export interface CommitApi {
  status(signal?: AbortSignal): Promise<WorkingStatus>;
  changes(file: WorkingFile, signal?: AbortSignal): Promise<FileChanges>;
  /** Stage or unstage these paths, or every change; returns the new status. */
  stage(paths: string[] | null, stage: boolean): Promise<WorkingStatus>;
  commit(message: string, indexKey: string): Promise<CommitResult>;
  /** Push HEAD to the upstream; `track` pushes a branch without one and tracks it. */
  push(head: string, track: boolean): Promise<PushedBranch>;
}

export function createCommitApi(api: ReturnType<typeof createApi>, repo: string): CommitApi {
  const post = (body: object) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, ...body }),
  });
  return {
    status: (signal) =>
      api.json(`/api/git/status?repo=${encodeURIComponent(repo)}`, workingStatusSchema, {
        signal,
      }),
    changes: (file, signal) =>
      api.json(
        `/api/git/file-changes?${new URLSearchParams({
          repo,
          path: file.path,
          ...(file.previousPath ? { previousPath: file.previousPath } : {}),
        })}`,
        fileChangesSchema,
        { signal },
      ),
    stage: (paths, stage) =>
      api.json("/api/git/stage", workingStatusSchema, post({ stage, ...(paths ? { paths } : {}) })),
    commit: (message, indexKey) =>
      api.json("/api/git/commit", commitResultSchema, post({ message, indexKey })),
    push: (head, track) =>
      api.json("/api/git/push-branch", pushResultSchema, post({ head, track })),
  };
}

/** The paths that stage or unstage one row: a rename moves both names. */
export const rowPaths = (file: WorkingFile) =>
  file.previousPath ? [file.path, file.previousPath] : [file.path];

/** "staged", "partial", or "unstaged", for the row's mark. */
export function stageState(file: WorkingFile) {
  if (file.staged === "conflicted") return "unstaged" as const;
  if (file.staged && file.unstaged) return "partial" as const;
  return file.staged ? ("staged" as const) : ("unstaged" as const);
}
