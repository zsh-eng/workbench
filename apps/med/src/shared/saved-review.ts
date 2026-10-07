import { z } from "zod";
import { comparisonSchema, type ReviewResponse, type SourceResponse } from "./protocol";

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

/** A pasted or agent-written explanation of a review, in Markdown. */
export const MAX_BRIEF_LENGTH = 100_000;
export const briefTextSchema = z
  .string()
  .trim()
  .min(1, "Supply the brief text.")
  .max(
    MAX_BRIEF_LENGTH,
    `A brief can contain up to ${MAX_BRIEF_LENGTH.toLocaleString("en")} characters.`,
  );
export const savedBriefSchema = z.object({ text: z.string(), updatedAt: z.string() });
export type SavedBrief = z.infer<typeof savedBriefSchema>;

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
  agent: z.enum(["claude", "codex"]),
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/, "Session IDs use letters, digits, _ and -."),
  cwd: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^(?:\/|[A-Za-z]:[\\/])/, "A session directory must be absolute."),
});
export type AgentSession = z.infer<typeof agentSessionSchema>;
export const MAX_SESSIONS = 32;
/** At most this many iterations; the oldest briefs and comparisons stay. */
export const MAX_ITERATIONS = 64;

export const savedReviewCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  key: reviewKeySchema.optional(),
  sessions: z.array(agentSessionSchema).max(MAX_SESSIONS).optional(),
  pullRequestUrl: pullRequestUrlSchema.optional(),
  brief: briefTextSchema.optional(),
  targets: z
    .array(
      z.object({
        repo: z.string().min(1).max(4096),
        comparison: comparisonSchema.refine(
          (comparison) => comparison.kind !== "files" && comparison.kind !== "patch",
          "Saved reviews support Git comparisons and working changes.",
        ),
      }),
    )
    .min(1)
    .max(16),
});
export type SavedReviewCreate = z.infer<typeof savedReviewCreateSchema>;
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
});
export type SavedReviewTarget = z.infer<typeof savedReviewTargetSchema>;
/** One round of agent work: the comparisons it captured and its brief. */
export const savedIterationSchema = z.object({
  number: z.number().int().positive(),
  createdAt: z.string(),
  targetIds: z.array(z.string()),
  brief: savedBriefSchema.optional(),
});
export type SavedIteration = z.infer<typeof savedIterationSchema>;
/** Later details for a review, such as the pull request opened after it. */
export const savedReviewDetailsSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  pullRequestUrl: pullRequestUrlSchema.nullable().optional(),
  /** Added to the review's sessions. */
  sessions: z.array(agentSessionSchema).max(MAX_SESSIONS).optional(),
});
export const savedReviewSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  title: z.string(),
  pullRequestUrl: pullRequestUrlSchema.optional(),
  brief: savedBriefSchema.optional(),
  createdAt: z.string(),
  revision: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  targets: z.array(savedReviewTargetSchema),
  sessions: z.array(agentSessionSchema).optional(),
  /** Present once a key is used; the last one is current. */
  iterations: z.array(savedIterationSchema).optional(),
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
export const savedFeedbackSchema = z.object({
  text: z.string(),
  count: z.number().int().nonnegative(),
  repositoryCount: z.number().int().nonnegative(),
  revision: z.number().int().nonnegative(),
});
export type SavedFeedback = z.infer<typeof savedFeedbackSchema>;
export interface CapturedReviewTarget {
  images?: { path: string; side: "old" | "new"; mime: string; data: string }[];
  repositoryId: string;
  repo: string;
  branch: string | null;
  review: ReviewResponse;
  sources: SourceResponse[];
}
