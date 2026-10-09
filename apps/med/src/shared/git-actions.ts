import { z } from "zod";
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
const commitId = z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/);
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
export const stageRequestSchema = z.object({
  repo: repoField,
  /** Omitted: every change. */
  paths: z.array(z.string().min(1).max(4096)).min(1).max(10_000).optional(),
  stage: z.boolean(),
});
export type StageRequest = z.infer<typeof stageRequestSchema>;
export const commitRequestSchema = z.object({
  repo: repoField,
  message: z.string().max(100_000),
  indexKey: z.string().min(1).max(128),
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
