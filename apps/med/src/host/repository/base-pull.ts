import type { RegisteredRepository } from "../../shared/protocol";
import { baseOf } from "../../shared/protocol";
import { git, ProcessFailure } from "../runtime/process";

/** What a pull of one repository's base branch did. */
export interface BasePull {
  repository: string;
  branch?: string;
  /**
   * `updated`: the branch moved forward to its remote's. `current`: it was
   * the remote's already. `fetched`: Med fetched the remote's branch but left
   * the local one, which has commits of its own or a checkout with changes.
   * `skipped`: there is nothing to pull from. `failed`: Git failed, such as
   * an unreachable remote.
   */
  outcome: "updated" | "current" | "fetched" | "skipped" | "failed";
  /** Why Med left the branch: said for `fetched`, `skipped`, and `failed`. */
  reason?: string;
  from?: string;
  to?: string;
}

export interface BasePullHost {
  repositories(): RegisteredRepository[];
  /** Whether the reader keeps the pulls on (`sources.pullBase`). */
  enabled(): Promise<boolean>;
  /** Reads the repositories again after a branch moved. */
  refresh(): Promise<unknown>;
}

/** The names a base branch goes by, after the remote's default and Med's base. */
const USUAL = ["main", "master", "develop", "trunk"];
const FETCH_MS = 120_000;
// A fetch must not ask for a password or a key's passphrase, in the terminal
// or in a window: no one is there to answer. Git runs without a terminal, and
// a key in the SSH agent or a password in the keychain still works.
const QUIET = { GIT_TERMINAL_PROMPT: "0", SSH_ASKPASS_REQUIRE: "never", GCM_INTERACTIVE: "never" };

const text = (output: Buffer) => output.toString("utf8").trim();
const failure = (reason: unknown) =>
  reason instanceof ProcessFailure
    ? (reason.stderr.trim().split("\n").at(-1) ?? reason.message)
    : reason instanceof Error
      ? reason.message
      : String(reason);

/**
 * Keeps each registered repository's base branch (main, master, develop, or
 * whatever its remote names) up to date, as `git pull --ff-only` would: Med
 * fetches it from its upstream and moves the local branch forward when it
 * can do so without losing anything. A branch with commits of its own, or
 * checked out with uncommitted changes, stays as it is; its remote branch is
 * still fetched.
 */
export class BasePulls {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running: Promise<BasePull[]> | undefined;
  private closed = false;
  /** The last pull of each repository, by its path. */
  readonly last = new Map<string, BasePull & { at: string }>();

  constructor(
    private host: BasePullHost,
    private options: { delayMs?: number; intervalMs?: number } = {},
  ) {}

  /** Pulls a minute after the host starts, then every 15 minutes. */
  start() {
    this.schedule(this.options.delayMs ?? 60_000);
  }

  private schedule(ms: number) {
    if (this.closed) return;
    this.timer = setTimeout(() => {
      void this.run().finally(() => this.schedule(this.options.intervalMs ?? 15 * 60_000));
    }, ms);
    this.timer.unref?.();
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
  }

  /** Pulls each repository's base branch once; a pull under way is shared. */
  run(): Promise<BasePull[]> {
    this.running ??= this.pullAll().finally(() => (this.running = undefined));
    return this.running;
  }

  private async pullAll() {
    if (!(await this.host.enabled().catch(() => false))) return [];
    const results: BasePull[] = [];
    for (const repository of this.host.repositories()) {
      if (this.closed) break;
      if (repository.error) continue;
      const result = await pullBase(repository).catch((reason: unknown): BasePull => ({
        repository: repository.path,
        outcome: "failed",
        reason: failure(reason),
      }));
      results.push(result);
      this.last.set(repository.path, { ...result, at: new Date().toISOString() });
    }
    if (results.some((result) => result.outcome === "updated"))
      await this.host.refresh().catch(() => {});
    return results;
  }
}

/** The branch to pull and its upstream, or why there is none. */
async function baseBranch(repository: RegisteredRepository) {
  const path = repository.path;
  const remoteDefault = text(
    await git(path, ["symbolic-ref", "--quiet", "--short", "refs/remotes/origin/HEAD"], {
      acceptedExitCodes: [0, 1, 128],
      maxBytes: 4096,
    }),
  ).replace(/^origin\//, "");
  const base = baseOf(repository);
  const names = [
    ...new Set([remoteDefault, base, ...USUAL].filter((name): name is string => !!name)),
  ].filter((name) => name !== "Detached HEAD");
  for (const name of names) {
    const row = text(
      await git(
        path,
        [
          "for-each-ref",
          "--format=%(objectname)%00%(upstream)%00%(upstream:remotename)%00%(upstream:remoteref)",
          `refs/heads/${name}`,
        ],
        { maxBytes: 4096 },
      ),
    );
    if (!row) continue;
    const [head, upstream, remote, remoteRef] = row.split("\0");
    // A branch that follows another local branch has nothing to fetch.
    if (!upstream || !remote || remote === "." || !remoteRef) continue;
    return { name, head: head!, upstream, remote, remoteRef };
  }
  return undefined;
}

/** The checkout that has `branch` out, from Git's own list. */
async function checkoutOf(repository: string, branch: string) {
  const list = text(await git(repository, ["worktree", "list", "--porcelain"], { maxBytes: 1e6 }));
  for (const block of list.split("\n\n")) {
    const lines = block.split("\n");
    const tree = lines.find((line) => line.startsWith("worktree "))?.slice("worktree ".length);
    if (tree && lines.includes(`branch refs/heads/${branch}`)) return tree;
  }
  return undefined;
}

export async function pullBase(repository: RegisteredRepository): Promise<BasePull> {
  const path = repository.path;
  const branch = await baseBranch(repository);
  if (!branch)
    return { repository: path, outcome: "skipped", reason: "No base branch with a remote." };
  const result = { repository: path, branch: branch.name };
  try {
    await git(
      path,
      ["fetch", "--quiet", "--no-tags", branch.remote, `+${branch.remoteRef}:${branch.upstream}`],
      { env: QUIET, timeoutMs: FETCH_MS },
    );
  } catch (reason) {
    return { ...result, outcome: "failed", reason: failure(reason) };
  }
  const remote = text(
    await git(path, ["rev-parse", "--verify", "--quiet", `${branch.upstream}^{commit}`], {
      maxBytes: 4096,
    }),
  );
  if (remote === branch.head) return { ...result, outcome: "current" };
  // The local branch is behind when it is where the two meet. Histories
  // with nothing in common have no merge base (exit code 1).
  const behind =
    text(
      await git(path, ["merge-base", branch.head, remote], {
        acceptedExitCodes: [0, 1],
        maxBytes: 4096,
      }),
    ) === branch.head;
  if (!behind)
    return { ...result, outcome: "fetched", reason: `${branch.name} has commits of its own.` };
  const checkout = await checkoutOf(path, branch.name);
  if (checkout) {
    const changes = text(
      await git(checkout, ["status", "--porcelain", "--untracked-files=no"], { maxBytes: 1e6 }),
    );
    if (changes)
      return {
        ...result,
        outcome: "fetched",
        reason: `${branch.name} is checked out with uncommitted changes.`,
      };
    try {
      await git(checkout, ["merge", "--ff-only", "--quiet", remote], { timeoutMs: FETCH_MS });
    } catch (reason) {
      return { ...result, outcome: "fetched", reason: failure(reason) };
    }
  } else {
    // Moves the branch only if it is still where Med read it.
    await git(path, [
      "update-ref",
      "-m",
      `med: fast-forward ${branch.name} to ${branch.upstream}`,
      `refs/heads/${branch.name}`,
      remote,
      branch.head,
    ]);
  }
  return { ...result, outcome: "updated", from: branch.head, to: remote };
}
