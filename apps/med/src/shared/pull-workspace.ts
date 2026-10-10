import { z } from "zod";

/**
 * A GitHub pull request that Med opens as a workspace: the host finds its
 * repository, checks it out in a worktree, saves its review, and can start an
 * agent there. The workspace shows each step until the review is ready.
 */

const PULL_URL = /^https:\/\/([\w.-]+)\/([\w.-]+)\/([\w.-]+)\/pull\/(\d+)(?:[/?#]\S*)?$/;

/** The pull request that a pasted link names, such as one copied from its Files tab. */
export function parsePullUrl(text: string) {
  const match = PULL_URL.exec(text.trim());
  if (!match) return undefined;
  const [, host, owner, name, number] = match;
  return {
    host: host!.toLowerCase(),
    owner: owner!,
    name: name!.replace(/\.git$/, ""),
    number: Number(number),
    url: `https://${host}/${owner}/${name}/pull/${number}`,
  };
}
export type PullAddress = NonNullable<ReturnType<typeof parsePullUrl>>;

export const pullStartSchema = z.object({
  url: z.string().max(500),
  /** The agent to start in the worktree, to review the pull request. */
  agent: z.string().max(80).optional(),
});

export const pullStepSchema = z.object({
  id: z.enum(["repository", "pull", "worktree", "checkout", "base", "review", "agent"]),
  label: z.string(),
  state: z.enum(["pending", "running", "done", "skipped", "failed"]),
  /** Such as the local path or the pull request's title. */
  detail: z.string().optional(),
  startedAt: z.number().optional(),
  endedAt: z.number().optional(),
});
export type PullStep = z.infer<typeof pullStepSchema>;

export const pullJobSchema = z.object({
  id: z.string(),
  url: z.string(),
  /** owner/name, until the pull request's title is known. */
  slug: z.string(),
  number: z.number(),
  title: z.string().optional(),
  status: z.enum(["running", "done", "failed"]),
  steps: z.array(pullStepSchema),
  error: z.string().optional(),
  reviewId: z.string().optional(),
  worktree: z.string().optional(),
});
export type PullJob = z.infer<typeof pullJobSchema>;
