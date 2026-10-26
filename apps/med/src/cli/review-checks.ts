import { execFile } from "node:child_process";
import { open, realpath } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import { findTranscript } from "../host/agent-transcripts";
import { createSessionEdits } from "../host/session-edits";
import { reviewKeySchema, type AgentSession } from "../shared/saved-review";

// The checks that `med review` makes before and after a hand-off
// (docs/PRACTICES.md). Each one says what to do next. They read Git and the
// agent's transcript on this computer; a check that cannot run stays silent.

const exec = promisify(execFile);

/** Git's output, or undefined when the command fails. */
export async function git(repo: string, ...args: string[]) {
  try {
    const { stdout } = await exec("git", args, {
      cwd: repo,
      timeout: 30_000,
      maxBuffer: 16 * 1024 * 1024,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    return stdout.trim();
  } catch {
    return undefined;
  }
}

/** Whether Git exits with 0, for --quiet and --is-ancestor checks. */
async function gitSucceeds(repo: string, ...args: string[]) {
  try {
    await exec("git", args, {
      cwd: repo,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    return true;
  } catch {
    return false;
  }
}

/** The root of the checkout that holds `path`, so that `--repo src/` works. */
export async function repositoryRoot(path: string) {
  const root = await git(resolve(path), "rev-parse", "--show-toplevel");
  return root || resolve(path);
}

const real = (path: string) => realpath(path).catch(() => resolve(path));

/** Refuses a repository that Med does not know, and names the next step. */
export async function requireRegistered(repos: readonly string[], listing: unknown) {
  const known = new Set<string>();
  const entries =
    (listing as { repositories?: { path?: string; worktrees?: { path?: string }[] }[] })
      ?.repositories ?? [];
  for (const entry of entries) {
    if (entry.path) known.add(await real(entry.path));
    for (const tree of entry.worktrees ?? []) if (tree.path) known.add(await real(tree.path));
  }
  // An unknown listing shape leaves the decision to the host.
  if (!known.size) return;
  for (const repo of repos) {
    const root = await real(await repositoryRoot(repo));
    if (!known.has(root))
      throw new Error(
        `${root} is not registered in Med. Ask the user before you add it; with their OK, run: med add ${shellWord(root)}`,
      );
  }
}

/** A word that the shell reads back as itself. */
export const shellWord = (word: string) =>
  /^[\w./@:+#=,-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;

/** What Git says of a range before Med captures it. */
export async function rangeFacts(repo: string, base: string, head: string) {
  const [baseCommit, headCommit] = await Promise.all([
    git(repo, "rev-parse", "--verify", "--quiet", `${base}^{commit}`),
    git(repo, "rev-parse", "--verify", "--quiet", `${head}^{commit}`),
  ]);
  if (!baseCommit || !headCommit) return undefined;
  const ahead = Number(await git(repo, "rev-list", "--count", `${headCommit}..${baseCommit}`));
  const mergeBase = await git(repo, "merge-base", baseCommit, headCommit);
  return {
    baseCommit,
    headCommit,
    /** Commits of the base that the head does not have. */
    baseAhead: Number.isFinite(ahead) ? ahead : 0,
    mergeBase: mergeBase || undefined,
  };
}

/** Whether a comparison has no changes; undefined when Git cannot tell. */
export async function comparisonEmpty(
  repo: string,
  comparison: { kind: string; base?: string; head?: string; mergeBase?: boolean; paths?: string[] },
) {
  const paths = comparison.paths ? ["--", ...comparison.paths] : [];
  if (comparison.paths && !comparison.paths.length) return true;
  if (comparison.kind === "working") {
    const status = await git(repo, "status", "--porcelain", "--untracked-files=all", ...paths);
    return status === undefined ? undefined : status === "";
  }
  if (comparison.kind === "range" && comparison.base && comparison.head) {
    const facts = await rangeFacts(repo, comparison.base, comparison.head);
    if (!facts) return undefined;
    const from = comparison.mergeBase ? facts.mergeBase : facts.baseCommit;
    if (!from) return undefined;
    return gitSucceeds(repo, "diff", "--quiet", from, facts.headCommit, ...paths);
  }
  return undefined;
}

/** The branch that a comparison's head names, if it is a branch. */
export async function headBranch(repo: string, comparison: { kind: string; head?: string }) {
  if (comparison.kind === "working" || comparison.head === "HEAD")
    return (await git(repo, "symbolic-ref", "--short", "-q", "HEAD")) || undefined;
  if (comparison.kind === "range" && comparison.head)
    return (await gitSucceeds(
      repo,
      "show-ref",
      "--verify",
      "--quiet",
      `refs/heads/${comparison.head}`,
    ))
      ? comparison.head
      : undefined;
  return undefined;
}

/** The repository's usual base branch: the remote's default, or main, master,
 * trunk, or develop, the first that exists and is not one of `except`. */
export async function usualBase(repo: string, except: readonly string[] = []) {
  const remote = (
    await git(repo, "symbolic-ref", "--short", "-q", "refs/remotes/origin/HEAD")
  )?.replace(/^origin\//, "");
  for (const name of [remote, "main", "master", "trunk", "develop"]) {
    if (!name || except.includes(name)) continue;
    if (await gitSucceeds(repo, "show-ref", "--verify", "--quiet", `refs/heads/${name}`))
      return name;
  }
  return undefined;
}

/** A key from a branch name, when the branch name makes a valid key. */
export const keyFromBranch = (branch: string | undefined) =>
  branch && reviewKeySchema.safeParse(branch).success ? branch : undefined;

/** When a session started, from the first time in its transcript. */
export async function sessionStart(session: Pick<AgentSession, "agent" | "id">, home?: string) {
  const path = await findTranscript(session, home);
  if (!path) return undefined;
  let text = "";
  try {
    const handle = await open(path, "r");
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      text = buffer.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
  } catch {
    return undefined;
  }
  const match = /"timestamp":"([^"]+)"/.exec(text);
  const time = match ? Date.parse(match[1]!) : NaN;
  return Number.isFinite(time) ? time : undefined;
}

/** The commits on HEAD since a time: the agent's commits on main. */
export async function commitsSince(repo: string, time: number) {
  const count = Number(
    await git(repo, "rev-list", "--count", `--since=${Math.floor(time / 1000)}`, "HEAD"),
  );
  return Number.isFinite(count) ? count : 0;
}

/** Why an empty hand-off cannot be right, and what to run instead. */
export async function emptyMessage(
  repo: string,
  comparison: { kind: string; base?: string; head?: string; paths?: string[] },
  session?: Pick<AgentSession, "agent" | "id">,
  home?: string,
) {
  const scope = comparison.paths ? " in the files that --paths names" : "";
  if (comparison.kind === "working")
    return `${repo} has no uncommitted changes${scope}, so there is nothing to review. For work that you committed, pass the commit before your work: --base <commit> --head HEAD.`;
  const facts = await rangeFacts(repo, comparison.base ?? "", comparison.head ?? "");
  const start = session && (await sessionStart(session, home));
  const made = start ? await commitsSince(repo, start) : 0;
  const hint = made
    ? ` This session made ${made} ${made === 1 ? "commit" : "commits"} on HEAD: --base HEAD~${made} --head HEAD.`
    : " Such as --base HEAD~1 --head HEAD for one commit.";
  if (facts && facts.baseCommit === facts.headCommit)
    return `${comparison.base} and ${comparison.head} are the same commit, so there is nothing to review${scope}. For commits that you made on this branch, pass the commit before your work as --base.${hint}`;
  return `${comparison.base}..${comparison.head} has no changes${scope}, so there is nothing to review. Pass the commit before your work as --base.${hint}`;
}

/** What is wrong with a review title, or undefined. */
export function titleProblem(title: string, repos: readonly string[]) {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const lower = title.toLowerCase();
  const name = repos
    .map((repo) => basename(repo).toLowerCase())
    .find(
      (repo) =>
        repo.length > 1 && new RegExp(`(?:^|[^a-z0-9])${escape(repo)}(?:$|[^a-z0-9])`).test(lower),
    );
  if (name) return `names the repository (${name})`;
  const filler = /\b(review|changes)\b/i.exec(title);
  if (filler) return `has the word "${filler[1]!.toLowerCase()}"`;
  if (words.length < 2) return "has 1 word";
  if (words.length > 4) return `has ${words.length} words`;
  return undefined;
}
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The changed files of a working capture that the session never edited, and
 * the ones it did. Undefined without the session's transcript, or when it
 * edited nothing in the checkout (it can write files with commands).
 */
export async function sessionScope(
  session: { agent: "claude" | "codex"; id: string },
  checkout: string,
  changed: readonly string[],
  home?: string,
) {
  if (!(await findTranscript(session, home))) return undefined;
  const edits = createSessionEdits(home ? { home: () => home } : {});
  const edited = new Set(await edits.paths(session, checkout));
  if (!edited.size) return undefined;
  return {
    others: changed.filter((path) => !edited.has(path)),
    own: changed.filter((path) => edited.has(path)),
  };
}

/** The suggestions that a repository turned into checks (`git config med.checks`). */
export const OPT_IN_CHECKS = ["proof", "explainer", "findings"] as const;
export type OptInCheck = (typeof OPT_IN_CHECKS)[number];
export async function optInChecks(repos: readonly string[]) {
  const found = new Set<OptInCheck>();
  for (const repo of new Set(repos)) {
    const value = await git(repo, "config", "--get-all", "med.checks");
    for (const word of (value ?? "").split(/[\s,]+/))
      if ((OPT_IN_CHECKS as readonly string[]).includes(word.toLowerCase()))
        found.add(word.toLowerCase() as OptInCheck);
  }
  return found;
}
