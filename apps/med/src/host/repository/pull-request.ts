import { tmpdir } from "node:os";
import { z } from "zod";
import type {
  PullRequestComment,
  PullRequestComments,
  PullRequestThread,
} from "../../shared/protocol";
import { HostError } from "../runtime/errors";
import { ProcessFailure, runProcess } from "../runtime/process";

// GitHub pull request comments, read with the user's gh sign-in. Med only
// reads them: it never posts, replies, or resolves on GitHub.

const PULL_REQUEST = /^https:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:[/?#]|$)/;
const FRESH_MS = 30_000;
const cache = new Map<string, { at: number; value: Promise<PullRequestComments> }>();

const comment = z.object({
  id: z.number(),
  author: z.string(),
  body: z.string().nullable(),
  createdAt: z.string().nullable(),
  url: z.string(),
});
const reviewComment = comment.extend({
  reply: z.number().nullable(),
  path: z.string(),
  line: z.number().nullable(),
  startLine: z.number().nullable(),
  originalLine: z.number().nullable(),
  side: z.enum(["LEFT", "RIGHT"]).nullable(),
});
const review = comment.extend({ state: z.string() });

const AUTHOR = 'author: (.user.login // "ghost")';

async function gh(host: string, args: string[]) {
  try {
    const { stdout } = await runProcess("gh", ["api", "--hostname", host, ...args], {
      cwd: tmpdir(),
      timeoutMs: 20_000,
      maxBytes: 8 * 1024 * 1024,
    });
    return stdout.toString("utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new HostError(
        "gh-unavailable",
        "Install the GitHub CLI (gh) and run gh auth login to show pull request comments.",
        503,
      );
    if (error instanceof ProcessFailure && error.code === "command-failed")
      throw new HostError(
        "gh-failed",
        error.stderr.trim().split("\n").at(-1)?.replace(/^gh: /, "") ||
          "gh could not read the pull request.",
        502,
      );
    throw error;
  }
}

function lines<T>(text: string, schema: z.ZodType<T>): T[] {
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => schema.parse(JSON.parse(line)));
}

const toComment = (entry: z.infer<typeof comment>): PullRequestComment => ({
  id: entry.id,
  author: entry.author,
  body: entry.body ?? "",
  createdAt: entry.createdAt ?? "",
  url: entry.url,
});

async function load(url: string): Promise<PullRequestComments> {
  const match = PULL_REQUEST.exec(url);
  if (!match) throw new HostError("invalid-pull-request", "This is not a pull request URL.", 400);
  const [, host, owner, repo, number] = match;
  const base = `repos/${owner}/${repo}`;
  const [head, inline, conversation, reviews] = await Promise.all([
    gh(host!, [`${base}/pulls/${number}`, "--jq", ".head.sha"]),
    gh(host!, [
      "--paginate",
      `${base}/pulls/${number}/comments?per_page=100`,
      "--jq",
      `.[] | {id, ${AUTHOR}, body, createdAt: .created_at, url: .html_url, reply: .in_reply_to_id, path, line, startLine: .start_line, originalLine: .original_line, side}`,
    ]),
    gh(host!, [
      "--paginate",
      `${base}/issues/${number}/comments?per_page=100`,
      "--jq",
      `.[] | {id, ${AUTHOR}, body, createdAt: .created_at, url: .html_url}`,
    ]),
    gh(host!, [
      "--paginate",
      `${base}/pulls/${number}/reviews?per_page=100`,
      "--jq",
      // Approvals and change requests count without text; empty comments do not.
      `.[] | select(.state != "PENDING") | select((.body // "") != "" or .state != "COMMENTED") | {id, ${AUTHOR}, body, createdAt: .submitted_at, url: .html_url, state}`,
    ]),
  ]);
  // GitHub points every reply at the thread's first comment.
  const threads = new Map<number, PullRequestThread>();
  for (const entry of lines(inline, reviewComment)) {
    const root = entry.reply ?? entry.id;
    const thread = threads.get(root);
    if (thread) thread.comments.push(toComment(entry));
    else
      threads.set(root, {
        id: root,
        path: entry.path,
        side: entry.side === "LEFT" ? "old" : "new",
        line: entry.line,
        startLine: entry.startLine,
        originalLine: entry.originalLine,
        comments: [toComment(entry)],
      });
  }
  return {
    url,
    head: head.trim(),
    fetchedAt: Date.now(),
    threads: [...threads.values()],
    conversation: lines(conversation, comment).map(toComment),
    reviews: lines(reviews, review).map((entry) => ({ ...toComment(entry), state: entry.state })),
  };
}

/** A pull request's comments, read again after 30 seconds or on request. Pages
 * share one read, so it is not tied to the request that started it. */
export function loadPullRequestComments(url: string, refresh = false) {
  const cached = cache.get(url);
  if (cached && !refresh && Date.now() - cached.at < FRESH_MS) return cached.value;
  const value = load(url);
  cache.set(url, { at: Date.now(), value });
  value.catch(() => {
    if (cache.get(url)?.value === value) cache.delete(url);
  });
  return value;
}
