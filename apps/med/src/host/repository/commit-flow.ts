import { createHash } from "node:crypto";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  BranchPushRequest,
  ChangeKind,
  CommitRequest,
  CommitResult,
  FileChanges,
  ShownFile,
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

const STATUS = ["-c", "status.renames=true", "status", "--porcelain=v2", "-z", "--branch"];

interface ParsedStatus {
  head: string;
  branch: string;
  tracked: boolean;
  ahead: number;
  behind: number;
  files: WorkingFile[];
  /** HEAD and every index entry that differs from it, so a commit can prove
   * that it saw the same index. Entries equal to HEAD are HEAD's. */
  indexKey: string;
  /** The blob in the index of each staged path; zeros for a deletion. */
  objects: Map<string, string>;
}

function parseStatus(data: Buffer): ParsedStatus {
  const fields = data.toString("utf8").split("\0");
  const key = createHash("sha256");
  const result: ParsedStatus = {
    head: "",
    branch: "",
    tracked: false,
    ahead: 0,
    behind: 0,
    files: [],
    indexKey: "",
    objects: new Map(),
  };
  // Porcelain v2: fixed fields separated by spaces, then the path, which may
  // contain spaces. A rename's original path is the next NUL-separated field.
  const path = (field: string, skip: number) => field.split(" ").slice(skip).join(" ");
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index]!;
    if (field.startsWith("# branch.oid ")) {
      const oid = field.slice(13);
      result.head = oid === "(initial)" ? "" : oid;
    } else if (field.startsWith("# branch.head ")) {
      const name = field.slice(14);
      result.branch = name === "(detached)" ? "" : name;
    } else if (field.startsWith("# branch.upstream ")) result.tracked = true;
    else if (field.startsWith("# branch.ab ")) {
      const counts = /^\+(\d+) -(\d+)$/.exec(field.slice(12));
      result.ahead = Number(counts?.[1] ?? 0);
      result.behind = Number(counts?.[2] ?? 0);
    } else if (field.startsWith("1 ")) {
      // X, then HEAD's and the index's modes and objects: never the worktree's.
      const [, xy, , modeHead, modeIndex, , objectHead, objectIndex] = field.split(" ");
      if (xy![0] !== ".") {
        key.update(
          `1 ${xy![0]} ${modeHead} ${modeIndex} ${objectHead} ${objectIndex} ${path(field, 8)}\0`,
        );
        result.objects.set(path(field, 8), objectIndex!);
      }
      result.files.push({ path: path(field, 8), staged: kind(field[2]), unstaged: kind(field[3]) });
    } else if (field.startsWith("2 ")) {
      const previousPath = fields[++index];
      const [, xy, , modeHead, modeIndex, , objectHead, objectIndex, score] = field.split(" ");
      if (xy![0] !== ".") {
        key.update(
          `2 ${xy![0]} ${modeHead} ${modeIndex} ${objectHead} ${objectIndex} ${score} ${path(field, 9)}\0${previousPath}\0`,
        );
        result.objects.set(path(field, 9), objectIndex!);
      }
      result.files.push({
        path: path(field, 9),
        previousPath,
        staged: kind(field[2]),
        unstaged: kind(field[3]),
      });
    } else if (field.startsWith("u ")) {
      // The three stages of a conflict, without the worktree's mode.
      const parts = field.split(" ");
      key.update(`u ${[...parts.slice(3, 6), ...parts.slice(7)].join(" ")}\0`);
      result.files.push({ path: path(field, 10), staged: "conflicted", unstaged: "conflicted" });
    } else if (field.startsWith("? "))
      result.files.push({ path: field.slice(2), staged: null, unstaged: "untracked" });
    if (result.files.length > MAX_FILES)
      throw new HostError("too-many-files", "This checkout has more than 10,000 changes.", 413);
  }
  result.indexKey = key.update(`HEAD ${result.head}`).digest("hex");
  return result;
}

export async function workingStatus(repo: string, signal?: AbortSignal): Promise<WorkingStatus> {
  // One status and one config read, side by side: each Git process costs
  // about 10 ms to start, and staging waits for this answer.
  const [data, config] = await Promise.all([
    git(repo, [...STATUS, "--untracked-files=all"], { signal, maxBytes: 16 * 1024 * 1024 }),
    remoteConfig(repo, signal),
  ]);
  const status = parseStatus(data);
  // A path removed from the index but still on disk is two entries: one row.
  const rows = new Map<string, WorkingFile>();
  for (const file of status.files) {
    const row = rows.get(file.path);
    if (row) {
      row.staged ??= file.staged;
      row.unstaged ??= file.unstaged;
    } else rows.set(file.path, file);
  }
  const files = [...rows.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const { branch, head, ahead, behind, indexKey } = status;
  return {
    repo,
    branch,
    head,
    upstream: status.tracked && branch ? config.upstream(branch) : null,
    ahead,
    behind,
    pushRemote: branch ? config.pushRemote(branch) : null,
    indexKey,
    files,
  };
}

/** The remotes and the branch settings that choose where a push goes. */
async function remoteConfig(repo: string, signal?: AbortSignal) {
  const data = await git(
    repo,
    [
      "config",
      "-z",
      "--get-regexp",
      "^(branch\\..*\\.(remote|merge|pushremote)|remote\\.pushdefault|remote\\..*\\.(url|pushurl))$",
    ],
    { signal, maxBytes: 1024 * 1024, acceptedExitCodes: [0, 1] },
  );
  // Each entry is the key, a newline, and the value. Git lowercases section and
  // variable names; branch and remote names keep their case.
  const values = new Map<string, string>();
  const remotes = new Set<string>();
  for (const entry of data.toString("utf8").split("\0")) {
    const newline = entry.indexOf("\n");
    if (newline < 0) continue;
    const key = entry.slice(0, newline);
    if (!values.has(key)) values.set(key, entry.slice(newline + 1));
    const remote = /^remote\.(.+)\.(url|pushurl)$/.exec(key);
    if (remote) remotes.add(remote[1]!);
  }
  return {
    upstream(branch: string) {
      const remote = values.get(`branch.${branch}.remote`);
      const ref = values.get(`branch.${branch}.merge`);
      // A local upstream (remote ".") has no remote to push to.
      return remote && remote !== "." && ref?.startsWith("refs/heads/")
        ? { remote, branch: ref.slice("refs/heads/".length) }
        : null;
    },
    /** Git's own choice for a branch without an upstream: its push remote, the
     * default push remote, then origin, then the only remote. */
    pushRemote(branch: string) {
      const chosen = values.get(`branch.${branch}.pushremote`) || values.get("remote.pushdefault");
      if (chosen && remotes.has(chosen)) return chosen;
      if (remotes.has("origin")) return "origin";
      return remotes.size === 1 ? [...remotes][0]! : null;
    },
  };
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

/** Paths go on standard input: a command line holds about 1 MB, and Commit
 * all can name every changed file. */
const pathspecInput = (paths: readonly string[]) => ({
  args: ["--pathspec-from-file=-", "--pathspec-file-nul"],
  input: paths.join("\0"),
});

/** Stage or unstage paths, or every change. Deleted and new files count. */
export async function stagePaths(input: StageRequest, signal?: AbortSignal) {
  const paths = input.paths ? checkedPaths(input.repo, input.paths) : null;
  const options = { signal, maxBytes: 1024 * 1024, env: LITERAL };
  const named = paths ? pathspecInput(paths) : null;
  if (input.stage) {
    await git(input.repo, ["add", "--all", ...(named?.args ?? [])], {
      ...options,
      input: named?.input,
    });
    return;
  }
  // Almost every checkout has a first commit; ask Git about HEAD only when the
  // usual command fails.
  try {
    if (named)
      await git(input.repo, ["restore", "--staged", ...named.args], {
        ...options,
        input: named.input,
      });
    else await git(input.repo, ["reset", "--quiet"], options);
    return;
  } catch (error) {
    const born =
      (
        await git(input.repo, ["rev-parse", "--verify", "--quiet", "HEAD"], {
          ...options,
          acceptedExitCodes: [0, 1],
        })
      ).length > 0;
    if (born) throw error;
  }
  // Before the first commit, the index is all there is to unstage from.
  await git(
    input.repo,
    ["rm", "--cached", "-r", "--quiet", "--ignore-unmatch", ...(named?.args ?? ["--", "."])],
    { ...options, input: named?.input },
  );
}

// Hook output keeps its text, not its terminal colors.
// oxlint-disable-next-line no-control-regex
const ansi = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;

/** Commit the index with this message. Hooks run as they do in a terminal.
 * Commit all stages its files in a copy of the index, as `git commit -a`
 * does, and the index takes them only when the commit completes. */
export async function commitStaged(
  input: CommitRequest,
  signal?: AbortSignal,
): Promise<CommitResult> {
  const message = input.message.replace(/\s+$/, "");
  if (!message.trim()) throw new HostError("empty-message", "Write a commit message.", 422);
  const readStatus = async (env?: Record<string, string>) =>
    parseStatus(
      await git(input.repo, [...STATUS, "--untracked-files=no"], {
        signal,
        env,
        maxBytes: 16 * 1024 * 1024,
      }),
    );
  let status = await readStatus();
  if (status.indexKey !== input.indexKey)
    throw new HostError(
      "index-changed",
      "The staged files or the branch changed since this view loaded. Check them, then commit again.",
      409,
    );
  const paths = input.files
    ? checkedPaths(input.repo, [...new Set(input.files.map((file) => file.path))])
    : [];
  if (input.all && !paths.length)
    throw new HostError("nothing-staged", "Choose the changes to commit.", 422);
  const copy = input.all ? await indexCopy(input.repo, signal) : null;
  const env = copy ? { GIT_INDEX_FILE: copy.path } : undefined;
  try {
    if (copy) {
      const named = pathspecInput(paths);
      await git(input.repo, ["add", "--all", ...named.args], {
        signal,
        maxBytes: 1024 * 1024,
        env: { ...LITERAL, ...env },
        input: named.input,
      });
      status = await readStatus(env);
    }
    if (input.files) await checkShown(input.repo, status, input.files);
    if (!status.files.some((file) => file.staged))
      throw new HostError("nothing-staged", "Stage the changes to commit.", 422);
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
        env: { GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", ...env },
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
    // The index takes the committed files as HEAD now has them.
    if (copy) await resetPaths(input.repo, paths, committed);
    return { head: committed, summary: message.split("\n", 1)[0]! };
  } finally {
    if (copy) await rm(copy.directory, { recursive: true, force: true });
  }
}

/** A copy of the checkout's index, which Git can change without touching it. */
async function indexCopy(repo: string, signal?: AbortSignal) {
  const index = (
    await git(repo, ["rev-parse", "--path-format=absolute", "--git-path", "index"], {
      signal,
      maxBytes: 8192,
    })
  )
    .toString("utf8")
    .trim();
  const directory = await mkdtemp(join(tmpdir(), "med-commit-"));
  const path = join(directory, "index");
  try {
    await copyFile(index, path);
  } catch (error) {
    // Before anything is staged, a new checkout has no index.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      await rm(directory, { recursive: true, force: true });
      throw error;
    }
  }
  return { directory, path };
}

/** Set these paths in the index to HEAD. Another Git process can hold the
 * index for a moment, so this tries again for about two seconds. */
async function resetPaths(repo: string, paths: readonly string[], head: string) {
  const named = pathspecInput(paths);
  for (let attempt = 0; ; attempt++) {
    try {
      await git(repo, ["reset", "--quiet", ...named.args], {
        maxBytes: 1024 * 1024,
        env: LITERAL,
        input: named.input,
      });
      return;
    } catch (error) {
      if (attempt < 10 && error instanceof ProcessFailure && /index\.lock/.test(error.message)) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        continue;
      }
      throw new HostError(
        "index-not-updated",
        `Committed ${head.slice(0, 7)}, but Med could not update the staged files, so Git shows the commit's changes undone as staged. Run \`git reset\` in the checkout to fix this.\n\n${error instanceof Error ? error.message : String(error)}`,
        500,
      );
    }
  }
}

/** The commit holds the files that the tab showed, as it showed them, or it
 * stops. A file that the tab could not show, such as a binary one, has no
 * content to check. */
async function checkShown(repo: string, status: ParsedStatus, files: readonly ShownFile[]) {
  const staged = new Set(
    status.files
      .filter((file) => file.staged && file.staged !== "conflicted")
      .flatMap((file) => (file.previousPath ? [file.path, file.previousPath] : [file.path])),
  );
  const named = new Set(files.map((file) => file.path));
  if (staged.size !== named.size || [...named].some((path) => !staged.has(path)))
    throw new HostError(
      "staged-changed",
      "The staged files changed since you pressed Commit. Check them, then commit again.",
      409,
    );
  for (const file of files) {
    const same =
      file.object !== undefined
        ? status.objects.get(file.path) === file.object
        : file.text !== undefined
          ? (await workingTextHash(repo, file.path)) === file.text
          : true;
    if (!same)
      throw new HostError(
        "shown-changed",
        "A file changed after the tab showed it. Check the changes, then commit again.",
        409,
      );
  }
}

/** The SHA-256 of a working file's text as the review shows it, or null. */
async function workingTextHash(repo: string, path: string) {
  try {
    return createHash("sha256")
      .update(await readWorkingFile(repo, path), "utf8")
      .digest("hex");
  } catch {
    return null;
  }
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
