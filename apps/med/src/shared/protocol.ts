import { z } from "zod";

export const comparisonSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("working") }),
  z.object({ kind: z.literal("staged") }),
  z.object({ kind: z.literal("unstaged") }),
  z.object({ kind: z.literal("commit"), commit: z.string().min(1).max(256) }),
  z.object({
    kind: z.literal("range"),
    base: z.string().min(1).max(256),
    head: z.string().min(1).max(256),
    includeBase: z.boolean().optional(),
    mergeBase: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("patch"), path: z.string().min(1).max(4096) }),
  z.object({
    kind: z.literal("files"),
    oldPath: z.string().min(1).max(4096),
    newPath: z.string().min(1).max(4096),
  }),
]);
export type Comparison = z.infer<typeof comparisonSchema>;
/** Stable wire identity. Object property order and an omitted false flag do not
 * change the comparison. Inclusive ranges must remain distinct. */
export function comparisonKey(value: Comparison): string {
  const parsed = comparisonSchema.parse(value);
  if (parsed.kind === "range")
    return JSON.stringify({
      ...parsed,
      includeBase: !!parsed.includeBase,
      mergeBase: !!parsed.mergeBase,
    });
  return JSON.stringify(parsed);
}

export const reviewRequestSchema = z.object({
  repo: z.string().min(1).max(4096),
  comparison: comparisonSchema,
});
export type ReviewRequest = z.infer<typeof reviewRequestSchema>;
export interface Repository {
  path: string;
  name: string;
  head: string;
  branch: string;
  shallow: boolean;
  git?: boolean;
}
export interface Worktree {
  path: string;
  head: string;
  branch: string;
  bare?: boolean;
}
export interface Session {
  protocol: 1;
  repository: Repository;
  worktrees: Worktree[];
  repositoryId?: string;
  repositories?: RegisteredRepository[];
  initialComparison?: Comparison;
}
export interface Branch {
  name: string;
  head: string;
  worktreePath?: string;
  current: boolean;
}
/** One local Git repository; linked worktrees share this identity. */
export interface RegisteredRepository {
  id: string;
  path: string;
  name: string;
  branches: Branch[];
  worktrees: Worktree[];
  error?: string;
}
export interface Commit {
  id: string;
  parents: string[];
  subject: string;
  author: string;
  /** Git author time as Unix milliseconds. */
  timestamp: number;
  refs: string[];
}
/** A GitHub pull request comment, read-only in Med. */
export interface PullRequestComment {
  id: number;
  author: string;
  body: string;
  createdAt: string;
  url: string;
}
/** An inline review thread. `line` is null when GitHub marks it outdated. */
export interface PullRequestThread {
  id: number;
  path: string;
  side: "old" | "new";
  line: number | null;
  startLine: number | null;
  originalLine: number | null;
  comments: PullRequestComment[];
}
export interface PullRequestComments {
  url: string;
  /** The pull request's head commit; thread lines refer to it. */
  head: string;
  fetchedAt: number;
  threads: PullRequestThread[];
  /** General comments on the pull request. */
  conversation: PullRequestComment[];
  /** Review summaries: approvals, change requests, and review text. */
  reviews: (PullRequestComment & { state: string })[];
}
/** Commit message body and size, loaded when a commit card opens. */
export interface CommitDetails {
  id: string;
  /** The message after the subject, without co-author trailers. */
  body: string;
  coAuthors: string[];
  files: number;
  additions: number;
  deletions: number;
}
export interface HistoryPage {
  commits: Commit[];
  cursor: string | null;
  hasMore: boolean;
}
export interface ReviewFile {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  binary: boolean;
  tooLarge?: boolean;
  untracked?: boolean;
}
export interface ReviewMetrics {
  gitMs: number;
  totalMs: number;
  patchBytes: number;
  cacheHit: boolean;
}
export interface ReviewResponse {
  id: string;
  repo: string;
  comparison: Comparison;
  base: string;
  head: string;
  label: string;
  files: ReviewFile[];
  patch: string;
  metrics: ReviewMetrics;
  warnings: string[];
}
export interface SourceResponse {
  reviewId: string;
  path: string;
  old: string;
  new: string;
}
export interface ChangeEvent {
  type: "changed" | "ready";
  repo: string;
  revision: number;
}
export interface ApiError {
  error: { code: string; message: string };
}
export const noteInputSchema = z.object({
  path: z.string().min(1),
  side: z.enum(["old", "new"]),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  text: z.string().min(1).max(16384),
  parentId: z.string().optional(),
});
export type NoteInput = z.infer<typeof noteInputSchema>;
export interface Note extends NoteInput {
  id: string;
  createdAt: string;
  updatedAt: string;
  resolution?: "active" | "stale" | "orphaned";
}
export interface NoteState {
  reviewId: string;
  revision: number;
  notes: Note[];
}
export const noteMutationSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add"), note: noteInputSchema }),
  z.object({ type: z.literal("edit"), id: z.string(), text: z.string().min(1).max(16384) }),
  z.object({ type: z.literal("remove"), id: z.string() }),
]);
export type NoteMutation = z.infer<typeof noteMutationSchema>;
export const notesRequestSchema = z.object({
  reviewId: z.string(),
  expectedRevision: z.number().int().nonnegative(),
  mutation: noteMutationSchema,
});
