import { z } from "zod";
import { browseSourceSchema } from "./browse";

export const browseSearchRequestSchema = z.object({
  source: browseSourceSchema,
  query: z
    .string()
    .min(1)
    .max(256)
    .refine((value) => !/[\r\n\0]/.test(value), "Use one line of text."),
  /** Find the text only as typed; the result cap counts these matches. */
  matchCase: z.boolean().optional(),
});
export const browseSearchSchema = browseSearchRequestSchema.extend({
  matches: z.array(
    z.object({ path: z.string(), line: z.number().int().positive(), text: z.string() }),
  ),
  truncated: z.boolean(),
  reason: z.string().optional(),
  resultSource: browseSourceSchema.optional(),
  engine: z.enum(["zoekt", "git"]).optional(),
  index: z
    .object({
      state: z.enum(["ready", "indexing", "unavailable", "error"]),
      message: z.string().optional(),
    })
    .optional(),
});
export type BrowseSearch = z.infer<typeof browseSearchSchema>;
export const browseSearchResponseSchema = browseSearchSchema;

export const browseBlameRequestSchema = z
  .object({
    source: browseSourceSchema,
    path: z.string().min(1).max(4096),
    identity: z.string().min(1).max(16384),
    startLine: z.number().int().min(1).max(200_000),
    endLine: z.number().int().min(1).max(200_000),
  })
  .refine(
    (input) => input.endLine >= input.startLine && input.endLine - input.startLine < 200,
    "Select at most 200 lines.",
  );
export const browseBlameSchema = z.object({
  source: browseSourceSchema,
  path: z.string(),
  identity: z.string(),
  lines: z.array(
    z.object({
      line: z.number().int().positive(),
      commit: z.string(),
      author: z.string(),
      date: z.string(),
      summary: z.string(),
    }),
  ),
  truncated: z.boolean(),
  reason: z.string().optional(),
});
export type BrowseBlame = z.infer<typeof browseBlameSchema>;
export type BrowseBlameRequest = z.infer<typeof browseBlameRequestSchema>;
export const browseBlameResponseSchema = browseBlameSchema;
