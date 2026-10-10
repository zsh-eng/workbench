import { z } from "zod";

/** One finding of a Codex review, at lines of the reviewed commit. */
export const codexFindingSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  /** 0 is the most urgent, as in "[P0]". */
  priority: z.number().int().min(0).max(3).nullable(),
  confidence: z.number().nullable(),
  /** Relative to the checkout that Codex reviewed. */
  path: z.string(),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});
export type CodexFinding = z.infer<typeof codexFindingSchema>;

/** A `codex review` run, or /review in a Codex session, in a review's checkout. */
export const codexReviewRunSchema = z.object({
  id: z.string(),
  /** The Codex session, to resume with `codex resume`. */
  threadId: z.string(),
  /** The checkout that Codex reviewed. */
  repo: z.string(),
  /** HEAD when the review ran; finding lines refer to it. */
  commit: z.string().nullable(),
  createdAt: z.string(),
  /** What Codex compared, such as "changes against 'main'". */
  target: z.string(),
  /** Codex's verdict, such as "patch is incorrect". */
  verdict: z.string(),
  explanation: z.string(),
  findings: z.array(codexFindingSchema),
});
export type CodexReviewRun = z.infer<typeof codexReviewRunSchema>;
export const codexReviewsSchema = z.object({ runs: z.array(codexReviewRunSchema) });
