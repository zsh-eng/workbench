import { z } from "zod";
import { attemptRefSchema } from "./attempts";
import { comparisonSchema, type ReviewResponse, type SourceResponse } from "./protocol";
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
/** An agent reply that the user pinned to a review. The review keeps a copy
 * of the text, because a transcript can lose old replies. The brief and the
 * pins of an iteration are its Notes. */
export const MAX_PINS = 50;
export const pinSourceSchema = z.object({
  agent: z.enum(["claude", "codex", "acp"]),
  /** The agent's name, for an ACP agent such as OpenCode. */
  name: z.string().max(80).optional(),
  sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  /** The reply's item in the session thread. */
  itemId: z.string().min(1).max(200).optional(),
});
export const savedPinSchema = z.object({
  id: z.string(),
  text: z.string(),
  createdAt: z.string(),
  source: pinSourceSchema.optional(),
});
export type SavedPin = z.infer<typeof savedPinSchema>;
export const pinMutationSchema = z.union([
  z.object({ add: z.object({ text: briefTextSchema, source: pinSourceSchema.optional() }) }),
  z.object({ remove: z.string().min(1).max(64) }),
]);
export type PinMutation = z.infer<typeof pinMutationSchema>;
/** A comment on a passage of the Notes: the brief or a pinned reply. */
export const MAX_QUOTE_LENGTH = 4000;
const commentTextSchema = z.string().trim().min(1).max(16384);
export const briefCommentInputSchema = z.object({
  /** "brief", or the pinned reply's ID. */
  section: z.string().regex(/^(?:brief|p_[a-f0-9]{12})$/),
  /** The iteration of the brief. A review without iterations has none. */
  iteration: z.number().int().positive().optional(),
  quote: z.string().trim().min(1).max(MAX_QUOTE_LENGTH),
  /** The text just before the quote, which tells a repeated passage apart. */
  prefix: z.string().max(64).optional(),
  text: commentTextSchema,
});
export type BriefCommentInput = z.infer<typeof briefCommentInputSchema>;
export const briefCommentSchema = briefCommentInputSchema.extend({
  id: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BriefComment = z.infer<typeof briefCommentSchema>;
export const briefCommentMutationSchema = z.union([
  z.object({ add: briefCommentInputSchema }),
  z.object({ edit: z.object({ id: z.string().min(1).max(64), text: commentTextSchema }) }),
  z.object({ remove: z.string().min(1).max(64) }),
]);
export type BriefCommentMutation = z.infer<typeof briefCommentMutationSchema>;

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
export const MAX_SESSIONS = 32;
/** At most this many iterations; the oldest briefs and comparisons stay. */
export const MAX_ITERATIONS = 64;

export const savedReviewCreateSchema = z.object({
  title: z.string().trim().min(1).max(200),
  key: reviewKeySchema.optional(),
  sessions: z.array(agentSessionSchema).max(MAX_SESSIONS).optional(),
  pullRequestUrl: pullRequestUrlSchema.optional(),
  /** The PR's own title, read with gh. The review header shows it. */
  pullRequestTitle: z.string().trim().min(1).max(200).optional(),
  brief: briefTextSchema.optional(),
  /** Segments to read the change in; see review-guide.ts. */
  guide: reviewGuideSchema.optional(),
  /** One attempt at a task that several agents do; see attempts.ts. */
  group: attemptRefSchema.optional(),
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
/** One round of agent work: the comparisons it captured and its brief. */
export const savedIterationSchema = z.object({
  number: z.number().int().positive(),
  createdAt: z.string(),
  targetIds: z.array(z.string()),
  brief: savedBriefSchema.optional(),
  guide: savedGuideSchema.optional(),
  pins: z.array(savedPinSchema).optional(),
  /** The reader started these notes: they begin empty, without the brief of
   * an iteration before them. */
  fresh: z.boolean().optional(),
});
export type SavedIteration = z.infer<typeof savedIterationSchema>;
/** Later details for a review, such as the pull request opened after it. */
export const savedReviewDetailsSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  pullRequestUrl: pullRequestUrlSchema.nullable().optional(),
  pullRequestTitle: z.string().trim().min(1).max(200).optional(),
  /** Added to the review's sessions. */
  sessions: z.array(agentSessionSchema).max(MAX_SESSIONS).optional(),
});
export const savedReviewSchema = z.object({
  id: z.string(),
  key: z.string().optional(),
  /** A short name for the workspace list and the browser tab. */
  title: z.string(),
  pullRequestUrl: pullRequestUrlSchema.optional(),
  /** The PR's own title, shown in the review header in place of the title. */
  pullRequestTitle: z.string().optional(),
  brief: savedBriefSchema.optional(),
  /** The guide of a review without iterations; otherwise each iteration has its own. */
  guide: savedGuideSchema.optional(),
  /** Pins of a review without iterations; otherwise each iteration has its own. */
  pins: z.array(savedPinSchema).optional(),
  /** Comments on passages of the Notes. `commentCount` counts them. */
  briefComments: z.array(briefCommentSchema).optional(),
  createdAt: z.string(),
  revision: z.number().int().nonnegative(),
  commentCount: z.number().int().nonnegative(),
  targets: z.array(savedReviewTargetSchema),
  sessions: z.array(agentSessionSchema).optional(),
  /** Set when the thread is archived: the thread list leaves it out. */
  archivedAt: z.string().optional(),
  /** One attempt at a task that several agents do; see attempts.ts. */
  group: attemptRefSchema.optional(),
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
  commits?: { list: SavedCommit[]; more: boolean };
  names?: EndpointNames;
  images?: { path: string; side: "old" | "new"; mime: string; data: string }[];
  repositoryId: string;
  repo: string;
  branch: string | null;
  review: ReviewResponse;
  sources: SourceResponse[];
}
