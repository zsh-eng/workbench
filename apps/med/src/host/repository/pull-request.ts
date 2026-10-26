import { tmpdir } from "node:os";
import { z } from "zod";
import type {
  PullRequestComment,
  PullRequestComments,
  PullRequestSummary,
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
/** The pull request itself: its head, which thread lines refer to, and what
 * the header says of it. */
const PULL = `{head: .head.sha, number, title, ${AUTHOR}, state, draft, merged}`;
const pull = z.object({
  head: z.string(),
  number: z.number(),
  title: z.string(),
  author: z.string(),
  state: z.string(),
  draft: z.boolean().nullable().optional(),
  merged: z.boolean().nullable().optional(),
});
const summary = ({ number, title, author, state, draft, merged }: z.infer<typeof pull>) =>
  ({
    number,
    title,
    author,
    state: merged ? "merged" : state === "closed" ? "closed" : draft ? "draft" : "open",
  }) satisfies PullRequestSummary;
const INLINE = `.[] | {id, ${AUTHOR}, body, createdAt: .created_at, url: .html_url, reply: .in_reply_to_id, path, line, startLine: .start_line, originalLine: .original_line, side}`;

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
    gh(host!, [`${base}/pulls/${number}`, "--jq", PULL]).then((text) =>
      pull.parse(JSON.parse(text)),
    ),
    gh(host!, ["--paginate", `${base}/pulls/${number}/comments?per_page=100`, "--jq", INLINE]),
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
      `.[] | {id, ${AUTHOR}, body, createdAt: .submitted_at, url: .html_url, state}`,
    ]),
  ]);
  const summaries = lines(reviews, review);
  // A pending review is the reader's own draft on GitHub. GitHub shows it
  // only to its author, and lists its comments only under the review.
  const drafts = await Promise.all(
    summaries
      .filter((entry) => entry.state === "PENDING")
      .map((entry) =>
        gh(host!, [
          "--paginate",
          `${base}/pulls/${number}/reviews/${entry.id}/comments?per_page=100`,
          "--jq",
          INLINE,
        ]),
      ),
  );
  // GitHub points every reply at the thread's first comment, also a draft
  // reply to a thread that others started.
  const threads = new Map<number, PullRequestThread>();
  const entries = [
    ...lines(inline, reviewComment).map((entry) => ({ entry, draft: false })),
    ...drafts.flatMap((text) =>
      lines(text, reviewComment).map((entry) => ({ entry, draft: true })),
    ),
  ];
  for (const { entry, draft } of entries) {
    const added = { ...toComment(entry), ...(draft && { draft }) };
    const root = entry.reply ?? entry.id;
    const thread = threads.get(root);
    if (thread) thread.comments.push(added);
    else
      threads.set(root, {
        id: root,
        path: entry.path,
        side: entry.side === "LEFT" ? "old" : "new",
        line: entry.line,
        startLine: entry.startLine,
        originalLine: entry.originalLine,
        comments: [added],
      });
  }
  return {
    url,
    head: head.head,
    pull: summary(head),
    fetchedAt: Date.now(),
    threads: [...threads.values()],
    conversation: lines(conversation, comment).map(toComment),
    // Approvals and change requests count without text; empty comments and
    // an empty draft do not.
    reviews: summaries
      .filter(
        (entry) =>
          (entry.body ?? "") !== "" || (entry.state !== "COMMENTED" && entry.state !== "PENDING"),
      )
      .map((entry) => ({
        ...toComment(entry),
        state: entry.state,
        ...(entry.state === "PENDING" && { draft: true }),
      })),
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
