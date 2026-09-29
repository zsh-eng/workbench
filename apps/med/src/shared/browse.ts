import { z } from "zod";

const repo = z.string().min(1).max(4096);
export const browseSourceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("worktree"), repo }),
  z.object({
    kind: z.literal("commit"),
    repo,
    oid: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
  }),
]);
export type BrowseSource = z.infer<typeof browseSourceSchema>;
export const browseEntrySchema = z.object({
  path: z.string(),
  kind: z.enum(["file", "directory", "symlink", "submodule"]),
  status: z.string().optional(),
});
export type BrowseEntry = z.infer<typeof browseEntrySchema>;
export const browseListRequestSchema = z.object({
  source: browseSourceSchema,
  ignored: z.boolean().optional(),
});
export const browseListSchema = z.object({
  source: browseSourceSchema,
  entries: z.array(browseEntrySchema),
  truncated: z.boolean(),
});
export type BrowseList = z.infer<typeof browseListSchema>;
export const browseReadRequestSchema = z.object({
  source: browseSourceSchema,
  path: z.string().min(1).max(4096),
});
export const browseReadSchema = z.object({
  source: browseSourceSchema,
  path: z.string(),
  kind: z.enum(["text", "image", "video", "binary", "missing", "too-large", "unsupported"]),
  size: z.number().nonnegative(),
  identity: z.string(),
  media: z.object({ mime: z.string(), kind: z.enum(["image", "video"]) }).optional(),
  text: z.string().optional(),
  plain: z.boolean().optional(),
  truncated: z.boolean().optional(),
  reason: z.string().optional(),
});
export type BrowseRead = z.infer<typeof browseReadSchema>;

export const browseListResponseSchema = browseListSchema;
export const browseReadResponseSchema = browseReadSchema;

export const browseWriteRequestSchema = z.object({
  source: z.object({ kind: z.literal("worktree"), repo }),
  path: z.string().min(1).max(4096),
  expectedIdentity: z.string().min(1).max(8192),
  text: z.string().max(1024 * 1024),
});
