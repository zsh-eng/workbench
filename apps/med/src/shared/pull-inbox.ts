import { z } from "zod";

// The pull requests page: open pull requests that involve you, read from
// GitHub with your gh sign-in when the page opens, on focus, and every five
// minutes while it shows. Med reads only; it merges and approves nothing.

export const pullInboxRowSchema = z.object({
  url: z.string(),
  number: z.number().int().positive(),
  title: z.string(),
  /** owner/name */
  repository: z.string(),
  author: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  draft: z.boolean(),
  /** GitHub's review decision: what the reviewers say together. */
  review: z.enum(["approved", "changes-requested", "required", "none"]),
  checks: z.enum(["pass", "fail", "pending", "none"]),
  conflicts: z.boolean(),
  additions: z.number().int().nonnegative(),
  deletions: z.number().int().nonnegative(),
  /** Why it waits on you, as the page says it. */
  why: z.string().optional(),
  /** Pull requests stacked on this one, each on the one before: a stack is
   * one row, from its base. */
  stack: z
    .array(z.object({ url: z.string(), number: z.number().int().positive(), title: z.string() }))
    .optional(),
});
export type PullInboxRow = z.infer<typeof pullInboxRowSchema>;

export const pullInboxSchema = z.object({
  /** The gh sign-in's login. */
  viewer: z.string(),
  /** Your registered repositories' GitHub remotes, or all of GitHub. */
  scope: z.enum(["registered", "all"]),
  /** owner/name on github.com, host/owner/name on another GitHub host. */
  repositories: z.array(z.string()),
  waiting: z.array(pullInboxRowSchema),
  yours: z.array(pullInboxRowSchema),
  readAt: z.string(),
  /** Why there is nothing to show, such as gh not signed in. */
  unavailable: z.string().optional(),
  /** GitHub hosts that gh could not read, such as one it is not signed in
   * to, while the others listed. */
  skipped: z.array(z.object({ host: z.string(), reason: z.string() })).optional(),
});
export type PullInbox = z.infer<typeof pullInboxSchema>;
