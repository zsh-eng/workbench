import type { PullRequestComments, PullRequestThread, ReviewResponse } from "../../shared/protocol";
import type { SavedReviewTarget } from "../../shared/saved-review";
import type { ParsedReviewFile } from "../../shared/review";

/** Where each GitHub thread shows: at its line in the diff, or in the
 * pull request panel with the reason. */
export interface ThreadPlacement {
  inline: ReadonlySet<number>;
  /** Why no thread can show in this diff. */
  reason?: string;
  /** Why one thread is in the panel and not at its line. */
  reasons: ReadonlyMap<number, string>;
}

const short = (commit: string) => commit.slice(0, 7);

/**
 * GitHub thread lines refer to the pull request's head commit. A thread shows
 * at its line only when the diff shows that commit and that line: a Review
 * version with the head, or Changes whose head commit is the head (a commit,
 * a range, or Branch or Working changes at the branch tip). Working changes
 * can have edits on top, so a file with uncommitted changes lists its
 * threads. A thread that GitHub marks outdated has no line.
 */
export function placeThreads(
  data: PullRequestComments | null,
  files: readonly ParsedReviewFile[],
  shown:
    | { kind: "review"; target: SavedReviewTarget | undefined }
    | { kind: "changes"; review: ReviewResponse | null },
): { byPath: Map<string, PullRequestThread[]>; placement: ThreadPlacement } {
  const byPath = new Map<string, PullRequestThread[]>();
  const inline = new Set<number>();
  const reasons = new Map<number, string>();
  const placement = { inline, reasons };
  if (!data) return { byPath, placement };
  const lines = `Lines refer to the pull request head, ${short(data.head)}.`;
  let head: string | undefined;
  let uncommitted: ReadonlySet<string> = new Set();
  let shows: string;
  if (shown.kind === "review") {
    const target = shown.target;
    if (!target)
      return {
        byPath,
        placement: { ...placement, reason: `${lines} Choose a version to see them.` },
      };
    head = target.captured ? undefined : target.head;
    shows = target.captured ? "captured working changes" : short(target.head);
  } else {
    const review = shown.review;
    const comparison = review?.comparison;
    if (comparison?.kind === "commit" || comparison?.kind === "range") head = review!.head;
    else if (comparison?.kind === "working") {
      head = review!.headCommit;
      uncommitted = new Set(review!.uncommitted);
    }
    shows =
      comparison?.kind === "staged" || comparison?.kind === "unstaged"
        ? `${comparison.kind} changes`
        : head
          ? short(head)
          : "changes without a commit";
  }
  if (head !== data.head)
    return {
      byPath,
      placement: {
        ...placement,
        reason: `${lines} This comparison shows ${shows}, so they are listed here.`,
      },
    };
  for (const thread of data.threads) {
    const line = thread.line;
    if (line === null) {
      reasons.set(thread.id, "Outdated on GitHub.");
      continue;
    }
    if (uncommitted.has(thread.path)) {
      reasons.set(thread.id, `${thread.path} has changes after the pull request head.`);
      continue;
    }
    const metadata = files.find((file) => file.path === thread.path)?.metadata;
    const visible = metadata?.hunks.some((hunk) => {
      const start = thread.side === "old" ? hunk.deletionStart : hunk.additionStart;
      const count = thread.side === "old" ? hunk.deletionCount : hunk.additionCount;
      return line >= start && line < start + count;
    });
    if (!visible) {
      reasons.set(
        thread.id,
        metadata ? "The diff does not show this line." : "The diff does not show this file.",
      );
      continue;
    }
    inline.add(thread.id);
    byPath.set(thread.path, [...(byPath.get(thread.path) ?? []), thread]);
  }
  return { byPath, placement };
}
