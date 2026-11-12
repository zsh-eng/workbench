import { z } from "zod";
import { threadIdSchema } from "./threads";

/**
 * A GitHub pull request that Med opens as a workspace, or adds to a thread
 * as one more of its reviews: the host finds its repository, checks it out
 * in a worktree, saves its review, and can start an agent there. The
 * workspace shows each step until the review is ready.
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

/** Whether two links name one pull request, whatever page of it each is. */
export function samePull(a: string, b: string) {
  const [one, other] = [parsePullUrl(a), parsePullUrl(b)];
  return !!one && !!other && one.url.toLowerCase() === other.url.toLowerCase();
}

/** The key of the review that Med saves for a pull request: one review for
 * each pull request, with a version for each head. */
export const pullReviewKey = (address: PullAddress) =>
  `${address.host}/${address.owner}/${address.name}#${address.number}`;
/** Whether a review's key is a pull request's, not one that an agent chose
 * for its hand-offs. */
export const isPullReviewKey = (key: string) => /^[\w.-]+\/[\w.-]+\/[\w.-]+#\d+$/.test(key);

export const pullStartSchema = z.object({
  url: z.string().max(500),
  /** The agent to start in the worktree, to review the pull request. */
  agent: z.string().max(80).optional(),
  /** The session's thread that the review joins, as one more of its
   * reviews. Without it, the review is a thread of its own. */
  thread: threadIdSchema.optional(),
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
  /** The thread that the review joins, when the link was added to one. */
  thread: z.string().optional(),
});
export type PullJob = z.infer<typeof pullJobSchema>;
