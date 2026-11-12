import { z } from "zod";
import { browseSourceSchema } from "./browse";
import {
  comparisonSchema,
  noteAuthorSchema,
  type ReviewResponse,
  type SourceResponse,
} from "./protocol";
import {
  reviewGuideSchema,
  savedCommitSchema,
  savedGuideSchema,
  type SavedCommit,
} from "./review-guide";

export const pullRequestUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        /^\/[^/]+\/[^/]+\/pull\/[1-9]\d*\/?$/.test(url.pathname)
      );
    } catch {
      return false;
    }
  }, "Supply an HTTPS GitHub pull request URL.");

const commentTextSchema = z.string().trim().min(1).max(16384);
export const pullRequestStateSchema = z.enum(["open", "draft", "merged", "closed"]);
export type PullRequestState = z.infer<typeof pullRequestStateSchema>;

/** Lines that a comment on a file quotes, at most. */
export const MAX_FILE_COMMENT_LINES = 400;
/**
 * A comment on lines of a file in the thread's checkout or at a commit, not
 * on a review's change: `gc` in a file. It goes to the thread's agent as a
 * review comment does, with the lines it quotes. The agent answers in its
 * thread with `med reply`, and `--resolve` marks it done; the user can open it
 * again. The ID is a UUID, so `med reply` takes its first characters.
 */
export const fileCommentInputSchema = z.object({
  source: browseSourceSchema,
  path: z.string().min(1).max(4096),
  line: z.number().int().positive(),
  endLine: z.number().int().positive().optional(),
  /** The lines as the user saw them, from `line`. */
  quote: z.string().max(64 * 1024),
  text: commentTextSchema,
});
export type FileCommentInput = z.infer<typeof fileCommentInputSchema>;
export const fileCommentReplySchema = z.object({
  id: z.string(),
  text: z.string(),
  /** The agent that answered with `med reply`; none for the user's reply. */
  author: noteAuthorSchema.optional(),
  createdAt: z.string(),
});
export type FileCommentReply = z.infer<typeof fileCommentReplySchema>;
export const fileCommentSchema = fileCommentInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  replies: z.array(fileCommentReplySchema).max(200),
  /** Done: the agent resolved it (`med reply --resolve`), or the user did. */
  resolved: z.object({ at: z.string(), by: noteAuthorSchema.optional() }).optional(),
});
export type FileComment = z.infer<typeof fileCommentSchema>;
const commentIdSchema = z.string().min(1).max(64);
export const fileCommentMutationSchema = z.union([
  z.object({ add: fileCommentInputSchema }),
  z.object({ edit: z.object({ id: commentIdSchema, text: commentTextSchema }) }),
  z.object({ remove: commentIdSchema }),
  z.object({ reply: z.object({ id: commentIdSchema, text: commentTextSchema }) }),
  z.object({ resolve: commentIdSchema }),
  z.object({ reopen: commentIdSchema }),
]);
export type FileCommentMutation = z.infer<typeof fileCommentMutationSchema>;

/** A name the agent chooses for its task, such as its branch. Creating a
 * review again with the same key adds an iteration to that review instead of
 * opening another workspace. */
export const reviewKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^[\w./@:+#-]+$/,
    "Use letters, digits, and . / @ : + # _ - in a review key, such as a branch name.",
  );
/** An agent session that worked on a review, so a terminal can resume it.
 * `cwd` is the directory the session started in, where resume finds it. */
export const agentSessionSchema = z.object({
  /** Claude and Codex keep transcripts that Med reads. Med keeps the updates
   * of an ACP session itself, because it started the session. */
  agent: z.enum(["claude", "codex", "acp"]),
  /** The agent's name, for an ACP agent such as OpenCode. */
  name: z.string().max(80).optional(),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "Session IDs use letters, digits, _ and -."),
  cwd: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^(?:\/|[A-Za-z]:[\\/])/, "A session directory must be absolute."),
});
export type AgentSession = z.infer<typeof agentSessionSchema>;
/** A session's agent for the UI: Claude, Codex, or an ACP agent's own name. */
export const agentName = (session: { agent: AgentSession["agent"]; name?: string }) =>
  session.agent === "claude"
    ? "Claude"
    : session.agent === "codex"
      ? "Codex"
      : (session.name ?? "Agent");
/** At most this many iterations; the oldest comparisons stay. */
export const MAX_ITERATIONS = 64;

/** Paths, folders, or globs of a comparison's files that a tool wrote, as a
 * guide names files (`med review create --generated`, docs/GENERATED.md). */
export const generatedPatternsSchema = z.array(z.string().trim().min(1).max(1024)).max(500);
export const savedReviewCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  key: reviewKeySchema.optional(),
  /** The agent session that hands off the review: the review is one of its
   * thread's. Without one, the review is a thread of its own. */
  session: agentSessionSchema.optional(),
  pullRequestUrl: pullRequestUrlSchema.optional(),
  /** The PR's own title, read with gh. The review header shows it. */
  pullRequestTitle: z.string().trim().min(1).max(200).optional(),
  /** Segments to read the change in; see review-guide.ts. */
  guide: reviewGuideSchema.optional(),
  /** What the agent shows. */
  targets: z
    .array(
      z.object({
        repo: z.string().min(1).max(4096),
        comparison: comparisonSchema
          .refine(
            (comparison) => comparison.kind !== "files" && comparison.kind !== "patch",
            "Saved reviews support Git comparisons and working changes.",
          )
          .refine(
            (comparison) => !("session" in comparison && comparison.session),
            "A saved review keeps paths, not a session's files. Use paths.",
          ),
        /** Files that the capture marks generated, unless Git attributes unmark them. */
        generated: generatedPatternsSchema.optional(),
      }),
    )
    .min(1)
    .max(16),
});
export type SavedReviewCreate = z.infer<typeof savedReviewCreateSchema>;
/** The names of a range's endpoints when Med captured it, such as main and
 * week-view. The review's row shows them in place of object IDs; older
 * records have none, and show short IDs. */
export const endpointNamesSchema = z.object({
  base: z.string().max(256).optional(),
  head: z.string().max(256).optional(),
  /** The range is the newest commits of this branch at capture, such as an
   * agent's commit on main. */
  on: z.object({ branch: z.string().max(256), commits: z.number().int().positive() }).optional(),
});
export type EndpointNames = z.infer<typeof endpointNamesSchema>;
export const savedReviewTargetSchema = z.object({
  id: z.string(),
  repositoryId: z.string(),
  repo: z.string(),
  branch: z.string().nullable(),
  label: z.string(),
  comparison: comparisonSchema,
  base: z.string(),
  head: z.string(),
  captured: z.boolean(),
  commentReviewId: z.string().optional(),
  /** A range's commits, oldest first, so the Guide can show them one by one. */
  commits: z.array(savedCommitSchema).optional(),
  /** The range has more commits than `commits` keeps. */
  moreCommits: z.boolean().optional(),
  names: endpointNamesSchema.optional(),
});
export type SavedReviewTarget = z.infer<typeof savedReviewTargetSchema>;
/** One hand-off: the comparisons it captured and its guide. */
export const savedIterationSchema = z.object({
  number: z.number().int().positive(),
  createdAt: z.string(),
  targetIds: z.array(z.string()),
  guide: savedGuideSchema.optional(),
});
export type SavedIteration = z.infer<typeof savedIterationSchema>;
/** What changed since the reader's last review of a thread
 * (`GET /api/reviews/:id/since`): the files of version `to` that differ from
 * version `from`, by the content of their new side. */
export const sinceSchema = z.object({
  from: z.number().int().positive(),
  to: z.number().int().positive(),
  /** Why `from`: the last version commented on or opened (`viewed`), or
   * else the one before. */
  basis: z.enum(["commented", "viewed", "previous"]),
  files: z.array(
    z.object({
      path: z.string(),
      change: z.enum(["changed", "new", "gone"]),
      /** The comparison of version `to` that has it (for "gone": of `from`). */
      target: z.string(),
      /** The repository, when the version has more than one comparison. */
      repo: z.string().optional(),
    }),
  ),
  /** Files that changed only because their base moved, as after a rebase. */
  moved: z.array(z.string()).optional(),
  /** Commits of version `to` that `from` did not have. A rebased commit
   * keeps its author time and subject, so it does not count. */
  commits: z.array(z.string()).optional(),
});
export type Since = z.infer<typeof sinceSchema>;
/** Later details for a review, such as the pull request opened after it. */
export const savedReviewDetailsSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  pullRequestUrl: pullRequestUrlSchema.nullable().optional(),
  pullRequestTitle: z.string().trim().min(1).max(200).optional(),
  /** Links the review to the session that handed it off. */
  session: agentSessionSchema.optional(),
});
export const savedReviewSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  /** A short name for the workspace list and the browser tab. */
  title: z.string(),
  pullRequestUrl: pullRequestUrlSchema.optional(),
  /** The PR's own title, shown in the review header in place of the title. */
  pullRequestTitle: z.string().optional(),
  /** The guide of a review without iterations; otherwise each iteration has its own. */
  guide: savedGuideSchema.optional(),
  createdAt: z.string(),
  revision: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  targets: z.array(savedReviewTargetSchema),
  /** The agent session that handed it off: the review is one of that
   * session's thread. Without one, the review is a thread of its own. */
  session: agentSessionSchema.optional(),
  /** Present once a key is used; the last one is current. */
  iterations: z.array(savedIterationSchema).optional(),
  /** The versions the reader opened, for "what is new since you looked". */
  readVersions: z.array(z.number().int().positive()).optional(),
  totals: z
    .object({
      additions: z.number().nonnegative(),
      deletions: z.number().nonnegative(),
      files: z.number().nonnegative(),
      comparisons: z.number().nonnegative(),
    })
    .optional(),
});
export type SavedReview = z.infer<typeof savedReviewSchema>;
/** The checkout of a review: its first own comparison's. */
export function reviewCheckout(saved: Pick<SavedReview, "targets">) {
  const target = saved.targets.find((entry) => !entry.commentReviewId) ?? saved.targets[0];
  return target && { repositoryId: target.repositoryId, repo: target.repo, branch: target.branch };
}
/**
 * The base branch that a review's comparison names, such as main for
 * `main..week-view`, while the repository has that branch: the Changes of the
 * review's checkout start there. A range of commit IDs, as a pull request's,
 * names none.
 */
export function reviewBase(
  repository: { branches: readonly { name: string }[] } | undefined,
  target: Pick<SavedReviewTarget, "names"> | undefined,
) {
  const base = target?.names?.base;
  return base && repository?.branches.some((branch) => branch.name === base) ? base : undefined;
}
/** The agent's hand-offs: the review's own comparisons, without the commits
 * that the reader commented on. */
export const handoffTargets = (saved: Pick<SavedReview, "targets">) =>
  saved.targets.filter((target) => !target.commentReviewId);
export const savedFeedbackSchema = z.object({
  text: z.string(),
  count: z.number().int().nonnegative(),
  repositoryCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});
export type SavedFeedback = z.infer<typeof savedFeedbackSchema>;
export interface CapturedReviewTarget {
  commits?: { list: SavedCommit[]; more: boolean };
  names?: EndpointNames;
  images?: { path: string; side: "old" | "new"; mime: string; data: string }[];
  repositoryId: string;
  repo: string;
  branch: string | null;
  review: ReviewResponse;
  sources: SourceResponse[];
}
