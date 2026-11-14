import {
  commitRoutes,
  type CommitRequest,
  type CommitResult,
  type DiscardRequest,
  type FileChanges,
  type ShownFile,
  type WorkingFile,
  type WorkingStatus,
} from "../../shared/git-actions";
import type { ReviewFile } from "../../shared/protocol";
import { reviewSchema, type createApi } from "./api";

export type { CommitResult, FileChanges, ShownFile, WorkingFile, WorkingStatus };

/** `q` in a file's Vim Normal or Visual mode: the workspace on screen opens
 * its Commit tab, or goes back, as `q` does outside the file (App.tsx). */
export const COMMIT_KEY = "med:commit-key";
export const pressCommitKey = () => window.dispatchEvent(new Event(COMMIT_KEY));
/** A commit as the tab sends it; the host adds the checkout. */
export type CommitInput = Omit<CommitRequest, "repo">;
/** What a discard takes from one file: a hunk, or the whole file as the
 * confirmation showed it, and whether staged changes go too. */
export type DiscardInput = Pick<DiscardRequest, "staged" | "hunk" | "stamp">;
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
  /** Stage one hunk of the file's unstaged patch, or unstage one of its
   * staged hunks, named by its text as `changes` gave it. */
  stageHunk(file: WorkingFile, hunk: string, stage: boolean): Promise<WorkingStatus>;
  /** Discard the file's changes, or one hunk of them. Nothing can undo it. */
  discard(file: WorkingFile, input: DiscardInput): Promise<WorkingStatus>;
  /** Commit the index, or with `all`, the files named. The commit stops when
   * Git has other files or other content than the tab showed. */
  commit(input: CommitInput): Promise<CommitResult>;
  /** Push HEAD to the upstream; `track` pushes a branch without one and tracks it. */
  push(head: string, track: boolean): Promise<PushedBranch>;
}

export function createCommitApi(api: ReturnType<typeof createApi>, repo: string): CommitApi {
  const post = (body: object) => ({
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ repo, ...body }),
  });
  const named = (file: WorkingFile) => ({
    repo,
    path: file.path,
    ...(file.previousPath ? { previousPath: file.previousPath } : {}),
  });
  return {
    status: (signal) => api.call(commitRoutes.status, { repo }, signal),
    changes: (file, signal) => api.call(commitRoutes.changes, named(file), signal),
    diff: async (signal) => {
      const review = await api.json("/api/review", reviewSchema, {
        ...post({ comparison: { kind: "working" } }),
        signal,
      });
      return { id: review.id, files: review.files, patch: review.patch };
    },
    stage: (paths, stage) =>
      api.call(commitRoutes.stage, { repo, stage, ...(paths ? { paths } : {}) }),
    stageHunk: (file, hunk, stage) =>
      api.call(commitRoutes.stageHunk, { ...named(file), hunk, stage }),
    discard: (file, input) => api.call(commitRoutes.discard, { ...named(file), ...input }),
    commit: (input) => api.call(commitRoutes.commit, { repo, ...input }),
    push: (head, track) => api.call(commitRoutes.pushBranch, { repo, head, track }),
  };
}

/** The paths that stage or unstage one row: a rename moves both names. */
export const rowPaths = (file: WorkingFile) =>
  file.previousPath ? [file.path, file.previousPath] : [file.path];

/** The paths that a commit of this status would hold, sorted. */
export const stagedPaths = (status: WorkingStatus) =>
  status.files
    .filter((file) => file.staged && file.staged !== "conflicted")
    .flatMap(rowPaths)
    .toSorted();

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
