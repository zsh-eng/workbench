import { z } from "zod";
import type { RouteContract } from "./routes";
export const gitTargetsSchema = z.object({
  branch: z.string(),
  head: z.string(),
  refs: z.array(z.object({ name: z.string(), label: z.string() })),
  remotes: z.array(z.object({ name: z.string(), branches: z.array(z.string()) })),
});
export type GitTargets = z.infer<typeof gitTargetsSchema>;
export const pushRequestSchema = z.object({
  repo: z.string().min(1).max(4096),
  head: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
  remote: z.string().min(1).max(256),
  branch: z.string().min(1).max(256),
});
export type PushRequest = z.infer<typeof pushRequestSchema>;
export const pushResultSchema = z.object({
  head: z.string(),
  remote: z.string(),
  branch: z.string(),
});

// The Commit tab: stage files, commit them, and push the branch.
const repoField = z.string().min(1).max(4096);
/** A Git object ID, SHA-1 or SHA-256. */
const objectId = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
const commitId = objectId;
export const changeKindSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
  "copied",
  "typechange",
  "untracked",
  "conflicted",
]);
export type ChangeKind = z.infer<typeof changeKindSchema>;
/** One changed path. `staged` compares HEAD with the index; `unstaged`
 * compares the index with the working file. */
export const workingFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().optional(),
  staged: changeKindSchema.nullable(),
  unstaged: changeKindSchema.nullable(),
});
export type WorkingFile = z.infer<typeof workingFileSchema>;
export const workingStatusSchema = z.object({
  repo: z.string(),
  /** Empty when HEAD is detached. */
  branch: z.string(),
  /** Empty before the first commit. */
  head: z.string(),
  upstream: z.object({ remote: z.string(), branch: z.string() }).nullable(),
  ahead: z.number(),
  behind: z.number(),
  /** Where a branch without an upstream would push, or null without a remote. */
  pushRemote: z.string().nullable(),
  /** Names HEAD and the index; a commit must name the same state. */
  indexKey: z.string(),
  files: z.array(workingFileSchema),
});
export type WorkingStatus = z.infer<typeof workingStatusSchema>;
export const fileChangesSchema = z.object({
  path: z.string(),
  staged: z.string(),
  unstaged: z.string(),
  binary: z.boolean(),
  tooLarge: z.boolean(),
});
export type FileChanges = z.infer<typeof fileChangesSchema>;
/** Commit all names every change: at most 10,000, and a rename has two paths. */
const STAGE_PATHS = 20_000;
export const stageRequestSchema = z.object({
  repo: repoField,
  /** Omitted: every change. */
  paths: z.array(z.string().min(1).max(4096)).min(1).max(STAGE_PATHS).optional(),
  stage: z.boolean(),
});
export type StageRequest = z.infer<typeof stageRequestSchema>;
/** One file of a commit, and what the Commit tab showed of it. */
export const shownFileSchema = z.object({
  path: z.string().min(1).max(4096),
  /** The blob that the tab's diff showed: the staged one, or the working
   * file's for Commit all. */
  object: objectId.optional(),
  /** A new file that Git does not track: the SHA-256 of the text shown. */
  text: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
export type ShownFile = z.infer<typeof shownFileSchema>;
export const commitRequestSchema = z.object({
  repo: repoField,
  message: z.string().max(100_000),
  indexKey: z.string().min(1).max(128),
  /** The files that the commit must hold, with what the tab showed of them.
   * The commit stops when Git has other files staged, or other content. */
  files: z.array(shownFileSchema).max(STAGE_PATHS).optional(),
  /** Stage `files` first, as `git commit -a` does: in a copy of the index,
   * so a commit that does not complete leaves the index as it was. */
  all: z.boolean().optional(),
});
export type CommitRequest = z.infer<typeof commitRequestSchema>;
export const commitResultSchema = z.object({ head: commitId, summary: z.string() });
export type CommitResult = z.infer<typeof commitResultSchema>;
export const branchPushRequestSchema = z.object({
  repo: repoField,
  head: commitId,
  /** Push a branch without an upstream to `pushRemote` and track it there. */
  track: z.boolean(),
});
export type BranchPushRequest = z.infer<typeof branchPushRequestSchema>;

/** The Commit tab's routes. Without `repo`, a GET reads the host's default
 * repository. */
export const commitRoutes = {
  status: {
    method: "GET",
    path: "/api/git/status",
    input: z.object({ repo: repoField.optional() }),
    output: workingStatusSchema,
  },
  changes: {
    method: "GET",
    path: "/api/git/file-changes",
    input: z.object({
      repo: repoField.optional(),
      path: z.string().max(4096).optional(),
      previousPath: z.string().max(4096).optional(),
    }),
    output: fileChangesSchema,
  },
  stage: {
    method: "POST",
    path: "/api/git/stage",
    input: stageRequestSchema,
    output: workingStatusSchema,
    maxBody: 32 * 1024 * 1024,
  },
  commit: {
    method: "POST",
    path: "/api/git/commit",
    input: commitRequestSchema,
    output: commitResultSchema,
    maxBody: 32 * 1024 * 1024,
  },
  pushBranch: {
    method: "POST",
    path: "/api/git/push-branch",
    input: branchPushRequestSchema,
    output: pushResultSchema,
  },
} as const satisfies Record<string, RouteContract>;
