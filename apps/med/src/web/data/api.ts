import { z } from "zod";
import { apiErrorMessage, comparisonSchema } from "../../shared/protocol";
import { browserFetch, liveStream } from "./live";

const worktreeSchema = z.object({
  path: z.string(),
  head: z.string(),
  branch: z.string(),
  bare: z.boolean().optional(),
  linked: z.boolean().optional(),
});
export const branchesSchema = z.array(
  z.object({
    name: z.string(),
    head: z.string(),
    worktreePath: z.string().optional(),
    current: z.boolean(),
  }),
);
export const registeredRepositorySchema = z.object({
  id: z.string(),
  path: z.string(),
  name: z.string(),
  branches: branchesSchema,
  worktrees: z.array(worktreeSchema),
  error: z.string().optional(),
});
export const repositoriesSchema = z.object({
  repositories: z.array(registeredRepositorySchema),
});
export const sessionSchema = z.object({
  protocol: z.literal(1),
  repository: z.object({
    path: z.string(),
    name: z.string(),
    head: z.string(),
    branch: z.string(),
    shallow: z.boolean(),
    git: z.boolean().optional(),
  }),
  worktrees: z.array(worktreeSchema),
  repositoryId: z.string().optional(),
  repositories: z.array(registeredRepositorySchema).optional(),
  initialComparison: comparisonSchema.optional(),
});
export const historySchema = z.object({
  commits: z.array(
    z.object({
      id: z.string(),
      parents: z.array(z.string()),
      subject: z.string(),
      author: z.string(),
      timestamp: z.number(),
      refs: z.array(z.string()),
    }),
  ),
  cursor: z.string().nullable(),
  hasMore: z.boolean(),
});
export const commitDetailsSchema = z.object({
  id: z.string(),
  body: z.string(),
  coAuthors: z.array(z.string()),
  files: z.number(),
  additions: z.number(),
  deletions: z.number(),
});
export const revealSchema = z.object({ revealed: z.literal(true) });
const pullRequestCommentSchema = z.object({
  id: z.number(),
  author: z.string(),
  body: z.string(),
  createdAt: z.string(),
  url: z.string(),
});
export const pullRequestCommentsSchema = z.object({
  url: z.string(),
  head: z.string(),
  fetchedAt: z.number(),
  threads: z.array(
    z.object({
      id: z.number(),
      path: z.string(),
      side: z.enum(["old", "new"]),
      line: z.number().nullable(),
      startLine: z.number().nullable(),
      originalLine: z.number().nullable(),
      comments: z.array(pullRequestCommentSchema),
    }),
  ),
  conversation: z.array(pullRequestCommentSchema),
  reviews: z.array(pullRequestCommentSchema.extend({ state: z.string() })),
});
export const reviewSchema = z.object({
  id: z.string(),
  repo: z.string(),
  comparison: comparisonSchema,
  base: z.string(),
  head: z.string(),
  label: z.string(),
  files: z.array(
    z.object({
      path: z.string(),
      previousPath: z.string().optional(),
      status: z.string(),
      additions: z.number(),
      deletions: z.number(),
      binary: z.boolean(),
      tooLarge: z.boolean().optional(),
      untracked: z.boolean().optional(),
    }),
  ),
  patch: z.string(),
  warnings: z.array(z.string()),
  metrics: z.object({
    gitMs: z.number(),
    totalMs: z.number(),
    patchBytes: z.number(),
    cacheHit: z.boolean(),
  }),
});
export const notesSchema = z.object({
  reviewId: z.string(),
  revision: z.number().int().nonnegative(),
  notes: z.array(
    z.object({
      id: z.string(),
      path: z.string(),
      side: z.enum(["old", "new"]),
      line: z.number().int().positive(),
      endLine: z.number().int().positive().optional(),
      text: z.string(),
      parentId: z.string().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
      resolution: z.enum(["active", "stale", "orphaned"]).optional(),
    }),
  ),
});
export const sourceSchema = z.object({
  reviewId: z.string(),
  path: z.string(),
  old: z.string(),
  new: z.string(),
});
export const eventSchema = z.object({
  type: z.enum(["ready", "changed"]),
  repo: z.string(),
  revision: z.number().int().nonnegative(),
});

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export function createApi(fetcher: typeof fetch, token: string) {
  const headers = (input?: HeadersInit) => {
    const result = new Headers(input);
    if (token) result.set("Authorization", `Bearer ${token}`);
    return result;
  };
  return {
    async json<T>(url: string, schema: z.ZodType<T>, init: RequestInit = {}): Promise<T> {
      const response = await fetcher(url, { ...init, headers: headers(init.headers) });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        throw new HttpError(
          apiErrorMessage(body) ?? `Request failed (${response.status}).`,
          response.status,
        );
      }
      const result = schema.safeParse(await response.json());
      if (!result.success) throw new Error("The server returned an invalid response.");
      return result.data;
    },
    stream(url: string, signal: AbortSignal) {
      if (fetcher === browserFetch) return liveStream(token, url, signal);
      return fetcher(url, { headers: headers({ Accept: "text/event-stream" }), signal });
    },
  };
}
