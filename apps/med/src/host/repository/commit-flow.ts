import { createHash } from "node:crypto";
import type {
  BranchPushRequest,
  ChangeKind,
  CommitRequest,
  CommitResult,
  FileChanges,
  StageRequest,
  WorkingFile,
  WorkingStatus,
} from "../../shared/git-actions";
import { HostError } from "../runtime/errors";
import { git, ProcessFailure, runProcess } from "../runtime/process";
import { pushBranch } from "./git-actions";
import { addedPatch, DIFF_FLAGS, readWorkingFile, safeRepoPath } from "./review";

// The Commit tab writes Git state: the index, commits, and one branch on a
// remote. It never checks out, resets the working files, or forces a push.

const MAX_FILES = 10_000;
const MAX_FILE_PATCH = 2 * 1024 * 1024;
/** Every path is a literal file name, never a pattern or a magic pathspec. */
const LITERAL = { GIT_LITERAL_PATHSPECS: "1" };
const kinds: Record<string, ChangeKind> = {
  M: "modified",
  T: "typechange",
  A: "added",
  D: "deleted",
  R: "renamed",
  C: "copied",
  U: "conflicted",
};
const kind = (code: string | undefined) =>
  !code || code === "." ? null : (kinds[code] ?? "modified");

/** HEAD and every index entry, so a commit can prove it saw the same state. */
async function stateKey(repo: string, head: string, signal?: AbortSignal) {
  const index = await git(repo, ["ls-files", "--stage", "-z"], {
    signal,
    maxBytes: 64 * 1024 * 1024,
  });
  return createHash("sha256").update(head).update("\0").update(index).digest("hex");
}

export async function workingStatus(repo: string, signal?: AbortSignal): Promise<WorkingStatus> {
  const data = await git(
    repo,
    [
      "-c",
      "status.renames=true",
      "status",
      "--porcelain=v2",
      "-z",
      "--branch",
      "--untracked-files=all",
    ],
    { signal, maxBytes: 16 * 1024 * 1024 },
  );
  const fields = data.toString("utf8").split("\0");
  let head = "";
  let branch = "";
  let ahead = 0;
  let behind = 0;
  let tracked = false;
  const files: WorkingFile[] = [];
  // Porcelain v2: fixed fields separated by spaces, then the path, which may
  // contain spaces. A rename's original path is the next NUL-separated field.
  const path = (field: string, skip: number) => field.split(" ").slice(skip).join(" ");
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    if (field.startsWith("# branch.oid ")) {
      const oid = field.slice(13);
      head = oid === "(initial)" ? "" : oid;
    } else if (field.startsWith("# branch.head ")) {
      const name = field.slice(14);
      branch = name === "(detached)" ? "" : name;
    } else if (field.startsWith("# branch.upstream ")) tracked = true;
    else if (field.startsWith("# branch.ab ")) {
      const counts = /^\+(\d+) -(\d+)$/.exec(field.slice(12));
      ahead = Number(counts?.[1] ?? 0);
      behind = Number(counts?.[2] ?? 0);
    } else if (field.startsWith("1 "))
      files.push({ path: path(field, 8), staged: kind(field[2]), unstaged: kind(field[3]) });
    else if (field.startsWith("2 "))
      files.push({
        path: path(field, 9),
        previousPath: fields[++index],
        staged: kind(field[2]),
        unstaged: kind(field[3]),
      });
    else if (field.startsWith("u "))
      files.push({ path: path(field, 10), staged: "conflicted", unstaged: "conflicted" });
    else if (field.startsWith("? "))
      files.push({ path: field.slice(2), staged: null, unstaged: "untracked" });
    if (files.length > MAX_FILES)
      throw new HostError("too-many-files", "This checkout has more than 10,000 changes.", 413);
  }
  // A path removed from the index but still on disk is two entries: one row.
  const rows = new Map<string, WorkingFile>();
  for (const file of files) {
    const row = rows.get(file.path);
    if (row) {
      row.staged ??= file.staged;
      row.unstaged ??= file.unstaged;
    } else rows.set(file.path, file);
  }
  const merged = [...rows.values()].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  const [upstream, pushRemote, indexKey] = await Promise.all([
    tracked && branch ? upstreamOf(repo, branch, signal) : null,
    branch ? pushRemoteOf(repo, branch, signal) : null,
    stateKey(repo, head, signal),
  ]);
  return { repo, branch, head, upstream, ahead, behind, pushRemote, indexKey, files: merged };
}

async function upstreamOf(repo: string, branch: string, signal?: AbortSignal) {
  const [remote, ref] = (
    await git(
      repo,
      [
        "for-each-ref",
        "--format=%(upstream:remotename)%00%(upstream:remoteref)",
        `refs/heads/${branch}`,
      ],
      { signal, maxBytes: 64 * 1024 },
    )
  )
    .toString("utf8")
    .trim()
    .split("\0");
  // A local upstream (remote ".") has no remote to push to.
  return remote && remote !== "." && ref?.startsWith("refs/heads/")
    ? { remote, branch: ref.slice("refs/heads/".length) }
    : null;
}

/** Git's own choice for a branch without an upstream: its push remote, the
 * default push remote, then origin, then the only remote. */
async function pushRemoteOf(repo: string, branch: string, signal?: AbortSignal) {
  const config = async (key: string) =>
    (
      await git(repo, ["config", "--get", key], {
        signal,
        maxBytes: 4096,
        acceptedExitCodes: [0, 1],
      })
    )
      .toString("utf8")
      .trim();
  const remotes = (await git(repo, ["remote"], { signal, maxBytes: 64 * 1024 }))
    .toString("utf8")
    .split("\n")
    .filter(Boolean);
  const chosen =
    (await config(`branch.${branch}.pushRemote`)) || (await config("remote.pushDefault"));
  if (chosen && remotes.includes(chosen)) return chosen;
  if (remotes.includes("origin")) return "origin";
  return remotes.length === 1 ? remotes[0]! : null;
}

function checkedPaths(repo: string, paths: readonly string[]) {
  for (const path of paths) {
    if (path.includes("\0")) throw new HostError("invalid-path", "Choose a file in this checkout.");
    safeRepoPath(repo, path);
  }
  return paths;
}

/** The staged and the unstaged changes of one file, as unified patches. */
export async function workingFileChanges(
  repo: string,
  file: { path: string; previousPath?: string },
  signal?: AbortSignal,
): Promise<FileChanges> {
  const paths = checkedPaths(repo, [file.path, ...(file.previousPath ? [file.previousPath] : [])]);
  const diff = async (args: string[]) => {
    try {
      return (
        await git(
          repo,
          ["diff", ...DIFF_FLAGS, "--patch", "--full-index", ...args, "--", ...paths],
          {
            signal,
            maxBytes: MAX_FILE_PATCH,
            env: LITERAL,
          },
        )
      ).toString("utf8");
    } catch (error) {
      if (error instanceof ProcessFailure && error.code === "output-too-large") return null;
      throw error;
    }
  };
  const untracked =
    (
      await git(repo, ["ls-files", "--others", "--exclude-standard", "-z", "--", file.path], {
        signal,
        maxBytes: 64 * 1024,
        env: LITERAL,
      })
    ).length > 0;
  let [staged, unstaged] = await Promise.all([diff(["--cached"]), untracked ? "" : diff([])]);
  let binary = false;
  let tooLarge = staged === null || unstaged === null;
  if (untracked) {
    try {
      unstaged = addedPatch(file.path, await readWorkingFile(repo, file.path)).patch;
    } catch (error) {
      if (!(error instanceof HostError)) throw error;
      binary = error.code === "binary-source";
      tooLarge ||= error.code === "source-too-large";
      unstaged = "";
    }
  }
  binary ||= /^(Binary files .* differ|GIT binary patch)$/m.test(`${staged}\n${unstaged}`);
  return { path: file.path, staged: staged ?? "", unstaged: unstaged ?? "", binary, tooLarge };
}

/** Stage or unstage paths, or every change. Deleted and new files count. */
export async function stagePaths(input: StageRequest, signal?: AbortSignal) {
  const paths = input.paths ? checkedPaths(input.repo, input.paths) : null;
  const options = { signal, maxBytes: 1024 * 1024, env: LITERAL };
  if (input.stage) {
    await git(input.repo, ["add", "--all", "--", ...(paths ?? [])], options);
    return;
  }
  const born =
    (
      await git(input.repo, ["rev-parse", "--verify", "--quiet", "HEAD"], {
        ...options,
        acceptedExitCodes: [0, 1],
      })
    ).length > 0;
  // Before the first commit, the index is all there is to unstage from.
  if (!born)
    await git(
      input.repo,
      ["rm", "--cached", "-r", "--quiet", "--ignore-unmatch", "--", ...(paths ?? ["."])],
      options,
    );
  else if (paths) await git(input.repo, ["restore", "--staged", "--", ...paths], options);
  else await git(input.repo, ["reset", "--quiet"], options);
}

// Hook output keeps its text, not its terminal colors.
// oxlint-disable-next-line no-control-regex
const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Commit the index with this message. Hooks run as they do in a terminal. */
export async function commitStaged(
  input: CommitRequest,
  signal?: AbortSignal,
): Promise<CommitResult> {
  const message = input.message.replace(/\s+$/, "");
  if (!message.trim()) throw new HostError("empty-message", "Write a commit message.", 422);
  const head = (
    await git(input.repo, ["rev-parse", "--verify", "--quiet", "HEAD"], {
      signal,
      maxBytes: 1024,
      acceptedExitCodes: [0, 1],
    })
  )
    .toString("utf8")
    .trim();
  if ((await stateKey(input.repo, head, signal)) !== input.indexKey)
    throw new HostError(
      "index-changed",
      "The staged files or the branch changed since this view loaded. Check them, then commit again.",
      409,
    );
  const staged = await git(input.repo, ["diff", "--cached", "--name-only", "-z"], {
    signal,
    maxBytes: 16 * 1024 * 1024,
  });
  if (!staged.length) throw new HostError("nothing-staged", "Stage the changes to commit.", 422);
  const result = await runProcess(
    "git",
    ["-c", "core.fsmonitor=false", "commit", "--quiet", "--file=-"],
    {
      cwd: input.repo,
      signal,
      input: `${message}\n`,
      maxBytes: 1024 * 1024,
      timeoutMs: 10 * 60_000,
      acceptedExitCodes: [0, 1, 128],
      // No terminal prompt or editor; hooks keep the user's locale.
      env: { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
    },
  );
  if (result.exitCode !== 0) {
    const output = `${result.stdout.toString("utf8")}\n${result.stderr}`
      .replace(ansi, "")
      .trim()
      .slice(-8000);
    throw new HostError(
      "commit-failed",
      `The commit did not complete.${output ? `\n\n${output}` : ""}`,
      422,
    );
  }
  const committed = (await git(input.repo, ["rev-parse", "HEAD"], { signal, maxBytes: 1024 }))
    .toString("utf8")
    .trim();
  return { head: committed, summary: message.split("\n", 1)[0]! };
}

/** Push the checked-out branch to its upstream. A branch without one goes to
 * its push remote under the same name and tracks it, when the user agrees. */
export async function pushCurrentBranch(input: BranchPushRequest, signal?: AbortSignal) {
  const status = await workingStatus(input.repo, signal);
  if (!status.branch) throw new HostError("detached-head", "Check out a branch to push.", 422);
  if (status.head !== input.head)
    throw new HostError(
      "head-changed",
      "The branch moved since this view loaded. Check it, then push again.",
      409,
    );
  let target = status.upstream;
  if (!target) {
    if (!status.pushRemote)
      throw new HostError("no-remote", "Add a remote to push this branch.", 422);
    if (!input.track)
      throw new HostError(
        "needs-upstream",
        `${status.branch} has no upstream. Push it to ${status.pushRemote}/${status.branch} and track it.`,
        409,
      );
    target = { remote: status.pushRemote, branch: status.branch };
  }
  const result = await pushBranch(
    { repo: input.repo, head: input.head, remote: target.remote, branch: target.branch },
    signal,
  );
  // What `git push --set-upstream` records.
  if (!status.upstream) {
    await git(input.repo, ["config", `branch.${status.branch}.remote`, target.remote], { signal });
    await git(
      input.repo,
      ["config", `branch.${status.branch}.merge`, `refs/heads/${target.branch}`],
      {
        signal,
      },
    );
  }
  return result;
}
