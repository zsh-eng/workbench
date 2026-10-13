import { z } from "zod";

/**
 * A guide splits a review into segments that a reader can check one at a
 * time: a short summary of the whole change, then a few segments, each with a
 * title, a summary, its files, and the agent's comments. The agent that made
 * the change writes it (`med review create --guide`).
 */

/**
 * Which part of the system a segment touches, after pulls.review's categories
 * (upstream/PULLS-REVIEW.md). Segments already split the change by intent, so
 * this is one other axis that sets segments apart at a glance.
 */
export const GUIDE_AREAS = [
  "ui",
  "api",
  "core",
  "data",
  "cli",
  "security",
  "tests",
  "docs",
  "examples",
  "deps",
  "build",
  "scripts",
  "config",
  "i18n",
  "assets",
  "other",
] as const;
export type GuideArea = (typeof GUIDE_AREAS)[number];
/** "risk" is for what needs extra care: security, data loss, hard to revert, easy to get wrong. */
export const GUIDE_COMMENT_KINDS = ["note", "suggestion", "risk", "question"] as const;
export type GuideCommentKind = (typeof GUIDE_COMMENT_KINDS)[number];

export const MAX_GUIDE_SEGMENTS = 40;
export const MAX_GUIDE_COMMENTS = 200;
/** The guide's JSON, in characters, as the host stores it. */
export const MAX_GUIDE_LENGTH = 200_000;

const path = z.string().trim().min(1).max(4096);
const line = z.number().int().positive().max(10_000_000);

export const guideCommentSchema = z
  .object({
    /** A repository-relative path, as in the segment's `files`. */
    file: path,
    /** Without a line, the comment is about the whole file. */
    line: line.optional(),
    endLine: line.optional(),
    /** "new" for added and unchanged lines, "old" for removed ones. */
    side: z.enum(["old", "new"]).default("new"),
    kind: z.enum(GUIDE_COMMENT_KINDS).default("note"),
    body: z.string().trim().min(1).max(4000),
  })
  .refine(
    (comment) =>
      comment.endLine === undefined ||
      (comment.line !== undefined && comment.endLine >= comment.line),
    { message: "A comment's endLine needs a line and cannot come before it.", path: ["endLine"] },
  );
export type GuideComment = z.infer<typeof guideCommentSchema>;

export const guideSegmentSchema = z.object({
  title: z.string().trim().min(1).max(120),
  area: z.enum(GUIDE_AREAS).optional(),
  /** The whole segment needs extra care: security, data loss, hard to revert. */
  critical: z.boolean().optional(),
  /** One to three sentences of Markdown: why this segment exists, over what it does. */
  summary: z.string().trim().max(4000).optional(),
  /** Paths, folders that end in "/", or globs with * and **. */
  files: z.array(path).min(1).max(500),
  comments: z.array(guideCommentSchema).max(50).optional(),
});
export type GuideSegment = z.infer<typeof guideSegmentSchema>;

export const reviewGuideSchema = z
  .object({
    /** Markdown: what changed and why, for the Overview. */
    summary: z.string().trim().max(8000).optional(),
    segments: z.array(guideSegmentSchema).min(1).max(MAX_GUIDE_SEGMENTS),
  })
  .refine(
    (guide) =>
      guide.segments.reduce((sum, segment) => sum + (segment.comments?.length ?? 0), 0) <=
      MAX_GUIDE_COMMENTS,
    { message: `A guide can hold up to ${MAX_GUIDE_COMMENTS} comments.` },
  )
  .refine((guide) => JSON.stringify(guide).length <= MAX_GUIDE_LENGTH, {
    message: `A guide can hold up to ${MAX_GUIDE_LENGTH.toLocaleString("en")} characters.`,
  });
export type ReviewGuide = z.infer<typeof reviewGuideSchema>;

/** A guide as a review stores it. */
export const savedGuideSchema = z.object({
  summary: z.string().optional(),
  segments: z.array(
    z.object({
      title: z.string(),
      area: z.enum(GUIDE_AREAS).optional(),
      critical: z.boolean().optional(),
      summary: z.string().optional(),
      files: z.array(z.string()),
      comments: z
        .array(
          z.object({
            file: z.string(),
            line: z.number().int().positive().optional(),
            endLine: z.number().int().positive().optional(),
            side: z.enum(["old", "new"]),
            kind: z.enum(GUIDE_COMMENT_KINDS),
            body: z.string(),
          }),
        )
        .optional(),
    }),
  ),
  updatedAt: z.string(),
});
export type SavedGuide = z.infer<typeof savedGuideSchema>;

/** A commit of a saved range, oldest first, for reading the review commit by commit. */
export const savedCommitSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
  subject: z.string().max(1000),
  author: z.string().max(200),
  timestamp: z.number(),
});
export type SavedCommit = z.infer<typeof savedCommitSchema>;
/** A range keeps at most this many of its newest commits. */
export const MAX_SAVED_COMMITS = 50;

/** The first error of an invalid guide, with its place, for the CLI and the host. */
export function guideError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) return "The guide is not valid.";
  const where = issue.path.length
    ? issue.path
        .map((part) => (typeof part === "number" ? `[${part}]` : `.${String(part)}`))
        .join("")
    : "";
  return `Invalid guide${where ? ` at ${where.replace(/^\./, "")}` : ""}: ${issue.message}`;
}
