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
import type { ReviewFile } from "../../shared/protocol";
import { reviewSchema, type createApi } from "./api";

export type { CommitResult, FileChanges, WorkingFile, WorkingStatus };
/** Every change from HEAD to the working files, as one patch. */
export interface WorkingDiff {
  /** Names the content: the same id means the same changes. */
  id: string;
  files: ReviewFile[];
  patch: string;
}
export interface PushedBranch {
  head: string;
  remote: string;
  branch: string;
}

/** What the Commit tab needs from one checkout. The elements page gives it an
 * in-memory repository; the app gives it the host. */
export interface CommitApi {
  status(signal?: AbortSignal): Promise<WorkingStatus>;
  /** The staged and unstaged halves of one file, for a partly staged file. */
  changes(file: WorkingFile, signal?: AbortSignal): Promise<FileChanges>;
  diff(signal?: AbortSignal): Promise<WorkingDiff>;
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
    diff: async (signal) => {
      const review = await api.json("/api/review", reviewSchema, {
        ...post({ comparison: { kind: "working" } }),
        signal,
      });
      return { id: review.id, files: review.files, patch: review.patch };
    },
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

/** A stage or unstage that Git has not answered yet. */
export interface StageChange {
  /** Null changes every file. */
  paths: ReadonlySet<string> | null;
  stage: boolean;
}

/** The status after a stage or unstage, as the view shows it before Git
 * answers. Git's answer replaces it, including any rename it detects. */
export function predictStage(status: WorkingStatus, change: StageChange): WorkingStatus {
  const files = status.files.map((file) => {
    if (change.paths && !rowPaths(file).some((path) => change.paths!.has(path))) return file;
    if (file.staged === "conflicted") return file;
    if (change.stage)
      return file.unstaged
        ? {
            ...file,
            staged: file.staged ?? (file.unstaged === "untracked" ? "added" : file.unstaged),
            unstaged: null,
          }
        : file;
    return file.staged
      ? {
          ...file,
          staged: null,
          unstaged: file.unstaged ?? (file.staged === "added" ? "untracked" : file.staged),
        }
      : file;
  });
  return { ...status, files };
}
