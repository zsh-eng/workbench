import { createHash } from "node:crypto";
import { basename } from "node:path";
import type {
  Branch,
  Commit,
  CommitDetails,
  HistoryPage,
  Repository,
  Worktree,
} from "../../shared/protocol";
import { git } from "../runtime/process";
import { HostError } from "../runtime/errors";

const OID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_BRANCHES = 10_000;
const MAX_WORKTREES = 1_024;

function validRevision(revision: unknown): revision is string {
  return (
    typeof revision === "string" &&
    revision.length > 0 &&
    revision.length <= 256 &&
    !revision.startsWith("-") &&
    !revision.includes("\0")
  );
}

/** Resolve user revisions once; never pass option-like values to Git. */
export async function resolveCommit(repo: string, revision: string, signal?: AbortSignal) {
  if (!validRevision(revision)) {
    throw new HostError("invalid-revision", "Use a commit ID or a branch name.");
  }
  const result = (
    await git(repo, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`], {
      signal,
      maxBytes: 1024,
    })
  )
    .toString("utf8")
    .trim();
  if (!OID.test(result))
    throw new HostError("invalid-revision", "Git did not return a valid commit ID.");
  return result;
}

export async function resolveRepository(path: string, signal?: AbortSignal): Promise<Repository> {
  const repo = (await git(path, ["rev-parse", "--show-toplevel"], { signal, maxBytes: 8192 }))
    .toString("utf8")
    .trim();
  const [head, branch, shallow] = await Promise.all([
    resolveCommit(repo, "HEAD", signal).catch(() => ""),
    git(repo, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      signal,
      acceptedExitCodes: [0, 1],
      maxBytes: 8192,
    }),
    git(repo, ["rev-parse", "--is-shallow-repository"], { signal, maxBytes: 128 }),
  ]);
  return {
    path: repo,
    name: basename(repo),
    head,
    branch: branch.toString("utf8").trim() || "Detached HEAD",
    shallow: shallow.toString("utf8").trim() === "true",
  };
}

export async function listWorktrees(repo: string, signal?: AbortSignal): Promise<Worktree[]> {
  const data = (
    await git(repo, ["worktree", "list", "--porcelain", "-z"], { signal, maxBytes: 1024 * 1024 })
  ).toString("utf8");
  const result: Worktree[] = [];
  let current: Worktree | undefined;
  for (const field of data.split("\0")) {
    if (field.startsWith("worktree ")) {
      current = { path: field.slice(9), head: "", branch: "Detached HEAD" };
      result.push(current);
      if (result.length > MAX_WORKTREES)
        throw new HostError(
          "too-many-worktrees",
          "This repository exceeds the 1,024-worktree limit.",
          413,
        );
    } else if (current && field.startsWith("HEAD ")) current.head = field.slice(5);
    else if (current && field.startsWith("branch "))
      current.branch = field.slice(7).replace(/^refs\/heads\//, "");
    else if (current && field === "bare") current.bare = true;
  }
  return result;
}

/** List local branches and their existing checkouts without switching any branch. */
export async function listBranches(
  repo: string,
  signal?: AbortSignal,
  discoveredWorktrees?: Worktree[],
): Promise<Branch[]> {
  const [output, worktrees] = await Promise.all([
    git(
      repo,
      [
        "for-each-ref",
        `--count=${MAX_BRANCHES + 1}`,
        "--sort=refname",
        "--format=%(refname)%00%(objectname)%00%(HEAD)",
        "refs/heads/",
      ],
      { signal, maxBytes: 2 * 1024 * 1024 },
    ),
    discoveredWorktrees ? Promise.resolve(discoveredWorktrees) : listWorktrees(repo, signal),
  ]);
  const paths = new Map(
    worktrees
      .filter((worktree) => !worktree.bare)
      .map((worktree) => [worktree.branch, worktree.path]),
  );
  const records = output.toString("utf8").split("\n").filter(Boolean);
  if (records.length > MAX_BRANCHES)
    throw new HostError(
      "too-many-branches",
      "This repository exceeds the 10,000-branch limit.",
      413,
    );
  return records.map((record) => {
    const [ref, head, marker] = record.split("\0");
    if (!ref?.startsWith("refs/heads/") || !head || !OID.test(head))
      throw new HostError("invalid-branches", "Git returned an invalid local branch record.", 422);
    const name = ref.slice("refs/heads/".length);
    const worktreePath = paths.get(name);
    return { name, head, current: marker === "*", ...(worktreePath ? { worktreePath } : {}) };
  });
}

interface Cursor {
  tip: string;
  skip: number;
  repo: string;
  ref?: string;
}
const repoKey = (repo: string) => createHash("sha256").update(repo).digest("hex").slice(0, 16);

/** Page one frozen commit ancestry, retaining every parent edge, including page boundaries. */
export async function loadHistory(
  repo: string,
  cursor: string | null,
  requestedLimit: number,
  signal?: AbortSignal,
  ref?: string,
): Promise<HistoryPage> {
  if (ref !== undefined && !validRevision(ref))
    throw new HostError("invalid-revision", "Use a commit ID or a branch name.");
  const limit = Math.min(100, Math.max(1, Math.trunc(requestedLimit) || 50));
  let state: Cursor;
  if (cursor) {
    try {
      state = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as Cursor;
    } catch {
      throw new HostError("invalid-cursor", "The history cursor is not valid. Reload history.");
    }
    if (
      !state ||
      typeof state !== "object" ||
      typeof state.tip !== "string" ||
      !OID.test(state.tip) ||
      !Number.isSafeInteger(state.skip) ||
      state.skip < 0 ||
      state.skip > 1_000_000 ||
      state.repo !== repoKey(repo) ||
      (state.ref !== undefined && !validRevision(state.ref)) ||
      (ref !== undefined && ref !== (state.ref ?? "HEAD"))
    ) {
      throw new HostError(
        "invalid-cursor",
        "The history cursor does not match this repository and branch.",
      );
    }
  } else {
    const tip =
      ref !== undefined
        ? await resolveCommit(repo, ref, signal)
        : (await resolveRepository(repo, signal)).head;
    if (!tip) return { commits: [], cursor: null, hasMore: false };
    state = { tip, skip: 0, repo: repoKey(repo), ref: ref ?? "HEAD" };
  }
  const bytes = await git(
    repo,
    [
      "log",
      "--topo-order",
      `--max-count=${limit + 1}`,
      `--skip=${state.skip}`,
      "-z",
      "--format=%H%x00%P%x00%an%x00%at%x00%s%x00%D",
      state.tip,
      "--",
    ],
    { signal, maxBytes: 2 * 1024 * 1024 },
  );
  const fields = bytes.toString("utf8").split("\0");
  const commits: Commit[] = [];
  for (let i = 0; i + 5 < fields.length; i += 6) {
    const id = fields[i]!.trim();
    if (!OID.test(id)) continue;
    commits.push({
      id,
      parents: fields[i + 1]!.split(" ").filter(Boolean),
      author: fields[i + 2]!,
      timestamp: Number(fields[i + 3]) * 1000,
      subject: fields[i + 4]!,
      refs: fields[i + 5]!.split(", ").filter(Boolean),
    });
  }
  // Git hides parent links at a shallow boundary; keep the raw edge for a truthful DAG.
  for (const commit of commits)
    if (commit.parents.length === 0) {
      const header = (
        await git(repo, ["cat-file", "commit", commit.id], { signal, maxBytes: 1024 * 1024 })
      )
        .toString("utf8")
        .split("\n\n", 1)[0]!;
      commit.parents = [...header.matchAll(/^parent ([0-9a-f]+)$/gm)].map((match) => match[1]!);
    }
  const hasMore = commits.length > limit;
  return {
    commits: commits.slice(0, limit),
    hasMore,
    cursor: hasMore
      ? Buffer.from(JSON.stringify({ ...state, skip: state.skip + limit })).toString("base64url")
      : null,
  };
}

const COAUTHOR = /^co-authored-by:\s*(.+?)\s*(?:<[^>]*>)?\s*$/i;
const SHORTSTAT = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/;

/** The body and line counts of one commit. A merge counts against its first parent. */
export async function loadCommitDetails(
  repo: string,
  id: string,
  signal?: AbortSignal,
): Promise<CommitDetails> {
  if (!OID.test(id)) throw new HostError("invalid-revision", "Use a full commit ID.");
  const output = (
    await git(
      repo,
      [
        "show",
        "--no-color",
        "--diff-merges=first-parent",
        "--shortstat",
        "--format=%b%x00",
        id,
        "--",
      ],
      { signal, maxBytes: 1024 * 1024 },
    )
  ).toString("utf8");
  const split = output.indexOf("\0");
  const message = split < 0 ? "" : output.slice(0, split);
  const coAuthors: string[] = [];
  const body = message
    .split("\n")
    .filter((line) => {
      const match = COAUTHOR.exec(line);
      if (match) coAuthors.push(match[1]!);
      return !match;
    })
    .join("\n")
    .trim();
  const stat = SHORTSTAT.exec(split < 0 ? output : output.slice(split + 1));
  return {
    id,
    body: body.length > 4000 ? `${body.slice(0, 3999)}…` : body,
    coAuthors,
    files: Number(stat?.[1] ?? 0),
    additions: Number(stat?.[2] ?? 0),
    deletions: Number(stat?.[3] ?? 0),
  };
}
