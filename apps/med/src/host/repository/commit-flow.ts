import { createHash } from "node:crypto";
import { copyFile, lstat, mkdtemp, realpath, rm, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import type {
  BranchPushRequest,
  ChangeKind,
  CommitRequest,
  CommitResult,
  DiscardRequest,
  FileChanges,
  HunkStageRequest,
  ShownFile,
  StageRequest,
  WorkingFile,
  WorkingStatus,
} from "../../shared/git-actions";
import { hunkBody, splitPatch, wholeFilePatch, type PatchHunk } from "../../shared/patch-hunks";
import { HostError } from "../runtime/errors";
import { git, ProcessFailure, runProcess } from "../runtime/process";
import { pushBranch } from "./git-actions";
import { addedPatch, DIFF_FLAGS, readWorkingFile, safeRepoPath } from "./review";

// The Commit tab writes Git state: the index, commits, and one branch on a
// remote. It discards a file's changes, or one hunk, only when the user
// confirms; it never checks out a branch or forces a push.

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

/** Patch text, and whether bytes that are not UTF-8 became U+FFFD in it:
 * such text cannot go back to `git apply` as it is. */
function decodedPatch(data: Buffer) {
  const text = data.toString("utf8");
  return { text, lossy: text.includes("\uFFFD") && !Buffer.from(text, "utf8").equals(data) };
}

/** The staged and the unstaged changes of one file, as unified patches. */
export async function workingFileChanges(
  repo: string,
  file: { path: string; previousPath?: string },
  signal?: AbortSignal,
): Promise<FileChanges> {
  return (await readFileChanges(repo, file, signal)).changes;
}

async function readFileChanges(
  repo: string,
  file: { path: string; previousPath?: string },
  signal?: AbortSignal,
) {
  const paths = checkedPaths(repo, [file.path, ...(file.previousPath ? [file.previousPath] : [])]);
  const diff = async (args: string[]) => {
    try {
      return decodedPatch(
        await git(
          repo,
          ["diff", ...DIFF_FLAGS, "--patch", "--full-index", ...args, "--", ...paths],
          {
            signal,
            maxBytes: MAX_FILE_PATCH,
            env: LITERAL,
          },
        ),
      );
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
  const none = { text: "", lossy: false };
  const [stagedPatch, unstagedPatch] = await Promise.all([
    diff(["--cached"]),
    untracked ? none : diff([]),
  ]);
  let staged = stagedPatch?.text ?? "";
  let unstaged = unstagedPatch?.text ?? "";
  let binary = false;
  let tooLarge = !stagedPatch || !unstagedPatch;
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
  // The patches name the changes, unless they are too large to read or a
  // file that Git does not track is binary: then the index's entries and
  // the working files' sizes and times name them.
  const stamp = createHash("sha256").update(JSON.stringify([staged, unstaged]));
  if (tooLarge || binary) {
    stamp.update(
      await git(repo, ["ls-files", "--stage", "-z", "--", ...paths], {
        signal,
        maxBytes: 64 * 1024,
        env: LITERAL,
      }),
    );
    for (const path of paths) {
      const stat = await lstat(safeRepoPath(repo, path)).catch(() => null);
      stamp.update(stat ? `\0${stat.mode} ${stat.size} ${stat.mtimeMs} ${stat.ino}` : "\0none");
    }
  }
  return {
    changes: {
      path: file.path,
      staged,
      unstaged,
      binary,
      tooLarge,
      stamp: stamp.digest("hex"),
    } satisfies FileChanges,
    lossy: { staged: !!stagedPatch?.lossy, unstaged: !!unstagedPatch?.lossy },
  };
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

/** The hunk of this patch that the tab showed: the same text, or after
 * another hunk of the file was staged, the same lines at new numbers. */
function shownHunk(patch: string, shown: string) {
  const { header, hunks } = splitPatch(patch);
  const sent = splitPatch(shown).hunks[0];
  if (!sent) throw new HostError("invalid-hunk", "Choose a hunk of this file.");
  const body = hunkBody(sent.text);
  const hunk =
    hunks.find((entry) => entry.text === sent.text) ??
    hunks
      .filter((entry) => hunkBody(entry.text) === body)
      .toSorted(
        (a, b) => Math.abs(a.oldStart - sent.oldStart) - Math.abs(b.oldStart - sent.oldStart),
      )[0];
  if (!hunk)
    throw new HostError(
      "hunk-changed",
      "The hunk changed since the tab showed it. Check it, then try again.",
      409,
    );
  return { header, hunk };
}

/** One hunk as a patch of its own, for `git apply`: a change to the file's
 * new path, without the header's mode, rename, and index lines, so the rest
 * of the file's change stays as it is. The names keep Git's quoting. */
export function hunkPatch(header: string, hunk: PatchHunk) {
  const target = /^\+\+\+ (.+)$/m.exec(header)?.[1];
  if (!target || target === "/dev/null")
    throw new HostError("invalid-hunk", "This change has no hunks to choose.", 422);
  const source = target.replace(/^("?)b\//, "$1a/");
  // A name with a space ends with a tab on the --- and +++ lines only.
  const name = (side: string) => side.replace(/\t$/, "");
  return `diff --git ${name(source)} ${name(target)}\n--- ${source}\n+++ ${target}\n${hunk.text}`;
}

/** Apply a patch to the index (`--cached`) or the working files. */
async function applyPatch(repo: string, patch: string, args: string[], signal?: AbortSignal) {
  try {
    await git(repo, ["apply", "--whitespace=nowarn", ...args, "-"], {
      signal,
      input: patch,
      maxBytes: 1024 * 1024,
    });
  } catch (error) {
    if (!(error instanceof ProcessFailure) || error.code !== "command-failed") throw error;
    throw new HostError(
      "hunk-not-applied",
      `Git could not apply the hunk. Check the file, then try again.\n\n${error.stderr}`,
      409,
    );
  }
}

/** The hunk that the tab showed, from the part of the file's changes that
 * holds it, as text that can go back to Git. */
async function readHunk(
  repo: string,
  file: { path: string; previousPath?: string },
  part: "staged" | "unstaged",
  shown: string,
  signal?: AbortSignal,
) {
  const { changes, lossy } = await readFileChanges(repo, file, signal);
  const found = shownHunk(changes[part], shown);
  if (lossy[part] && found.hunk.text.includes("\uFFFD"))
    throw new HostError(
      "not-utf8",
      `This hunk of ${file.path} has bytes that are not UTF-8 text, so Med cannot apply it alone. Stage or discard the whole file.`,
      422,
    );
  return found;
}

/** Stage one hunk of a file's unstaged changes, or unstage one of its staged
 * hunks. A new or deleted file is one hunk, and stages whole. */
export async function stageHunk(input: HunkStageRequest, signal?: AbortSignal) {
  const file = { path: input.path, previousPath: input.previousPath };
  const part = input.stage ? "unstaged" : "staged";
  const { header, hunk } = await readHunk(input.repo, file, part, input.hunk, signal);
  if (wholeFilePatch(header))
    return stagePaths(
      {
        repo: input.repo,
        paths: [input.path, ...(input.previousPath ? [input.previousPath] : [])],
        stage: input.stage,
      },
      signal,
    );
  await applyPatch(
    input.repo,
    hunkPatch(header, hunk),
    input.stage ? ["--cached"] : ["--cached", "--reverse"],
    signal,
  );
}

/**
 * Discard a file's changes, or one hunk of them. The index changes only
 * with `staged`. A file that Git does not track is deleted; a tracked file
 * goes back to the index, or with `staged`, to HEAD. An unstaged hunk goes
 * back to the index; a staged one leaves the index and the working file.
 * The discard stops when Git no longer has what the confirmation showed,
 * and it changes no path but the file's own and, with `staged`, the path
 * that a rename left.
 */
export async function discardChanges(input: DiscardRequest, signal?: AbortSignal) {
  const { repo } = input;
  const file = { path: input.path, previousPath: input.previousPath };
  const paths = checkedPaths(repo, [file.path, ...(file.previousPath ? [file.previousPath] : [])]);
  // Git would replace a folder, such as a submodule or one that took a
  // deleted file's place, and everything in it.
  for (const path of paths)
    if ((await lstat(safeRepoPath(repo, path)).catch(() => null))?.isDirectory())
      throw new HostError(
        "unsupported-source",
        `${path} is a folder. Med discards only files, not folders or submodules.`,
        422,
      );
  if (input.hunk !== undefined) {
    const part = input.staged ? "staged" : "unstaged";
    const { header, hunk } = await readHunk(repo, file, part, input.hunk, signal);
    // A new or deleted file is one hunk: the confirmation names the whole
    // file for it.
    if (wholeFilePatch(header))
      throw new HostError("whole-file", "Discard this change as a whole file.", 422);
    const patch = hunkPatch(header, hunk);
    if (input.staged) {
      // Check both before either changes, so a working file with other
      // changes in the same lines keeps the hunk staged.
      await applyPatch(repo, patch, ["--cached", "--reverse", "--check"], signal);
      await applyPatch(repo, patch, ["--reverse", "--check"], signal);
      await applyPatch(repo, patch, ["--reverse"], signal);
      await applyPatch(repo, patch, ["--cached", "--reverse"], signal);
    } else await applyPatch(repo, patch, ["--reverse"], signal);
    return;
  }
  if (input.stamp !== (await workingFileChanges(repo, file, signal)).stamp)
    throw new HostError(
      "shown-changed",
      "The file changed after the tab showed it. Check the changes, then discard again.",
      409,
    );

  const status = parseStatus(
    await git(repo, [...STATUS, "--untracked-files=all", "--", ...paths], {
      signal,
      maxBytes: 1024 * 1024,
      env: LITERAL,
    }),
  );
  if (status.files.some((entry) => entry.staged === "conflicted"))
    throw new HostError("conflicted", "Resolve the conflict in this file first.", 422);
  // The file's own entries: what Git tracks of it, and a working file that
  // Git does not track. A staged deletion can have both.
  const own = status.files.filter((entry) => entry.path === file.path);
  const tracked = own.find((entry) => entry.unstaged !== "untracked");
  const loose = own.some((entry) => entry.unstaged === "untracked");
  const options = { signal, maxBytes: 1024 * 1024, env: LITERAL };
  const restore = (args: string[], named: string[]) => {
    const input = pathspecInput(named);
    return git(repo, ["restore", ...args, ...input.args], { ...options, input: input.input });
  };
  if (tracked && !tracked.staged && tracked.unstaged === "added") {
    // `git add -N`: the index has the name only, so the file goes as an
    // untracked one does.
    await git(repo, ["rm", "--cached", "--quiet", "--", file.path], options);
    await removeWorkingFile(repo, file.path);
  } else if (input.staged && tracked) {
    const previous = tracked.previousPath;
    // The rename's old path comes back from HEAD: it must not hold a new file.
    if (
      previous &&
      status.files.some((entry) => entry.path === previous && entry.unstaged === "untracked")
    )
      throw new HostError(
        "previous-path-taken",
        `${previous} is a new file that Git does not track. Move it, then discard again.`,
        409,
      );
    await restore(
      ["--source", await headTree(repo, signal), "--staged", "--worktree"],
      [file.path, ...(previous ? [previous] : [])],
    );
  } else if (tracked && tracked.staged !== "deleted")
    // The working file takes the index's version.
    await restore(["--worktree"], [file.path]);
  else if (loose) await removeWorkingFile(repo, file.path);
}

/** HEAD, or before the first commit, the empty tree. */
async function headTree(repo: string, signal?: AbortSignal) {
  const head = (
    await git(repo, ["rev-parse", "--verify", "--quiet", "HEAD"], {
      signal,
      maxBytes: 1024,
      acceptedExitCodes: [0, 1],
    })
  )
    .toString("utf8")
    .trim();
  if (head) return head;
  return (await git(repo, ["hash-object", "-t", "tree", "/dev/null"], { signal, maxBytes: 1024 }))
    .toString("utf8")
    .trim();
}

/** Delete a file that Git does not track: a file or a link, never a folder,
 * such as a nested repository, and never through a linked folder. */
async function removeWorkingFile(repo: string, path: string) {
  const absolute = safeRepoPath(repo, path);
  const [realRepo, realParent] = await Promise.all([realpath(repo), realpath(dirname(absolute))]);
  const parent = relative(realRepo, realParent);
  const stat = await lstat(absolute).catch(() => null);
  if (!stat) return;
  if (parent === ".." || parent.startsWith(`..${sep}`) || isAbsolute(parent) || stat.isDirectory())
    throw new HostError("unsupported-source", "Med deletes only files inside this checkout.", 422);
  await unlink(absolute);
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
