import { mediaType, MAX_IMAGE_BYTES } from "../../shared/media";
import { markdownAsset } from "../markdown-assets";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, open, readlink, realpath, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { devNull, tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import type {
  ReviewFile,
  ReviewRequest,
  ReviewResponse,
  SourceResponse,
} from "../../shared/protocol";
import { ByteCache } from "../runtime/cache";
import { HostError } from "../runtime/errors";
import { git, measureGit, ProcessFailure } from "../runtime/process";
import { resolveCommit } from "./history";
import { parsePatchFiles } from "@pierre/diffs";
import type { ReviewHunkSpan } from "../../shared/hunk/geometry";

export const MAX_PATCH_BYTES = 16 * 1024 * 1024;
export const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
const ZERO_OID = /^0+$/;
export const DIFF_FLAGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-color",
  "--find-renames",
  `-O${devNull}`,
  "--src-prefix=a/",
  "--dst-prefix=b/",
];

interface SourceFile extends ReviewFile {
  oldOid: string;
  newOid: string;
  oldMode: string;
  newMode: string;
  fingerprint?: string;
  sourceUnavailable?: boolean;
  noteHunks?: ReviewHunkSpan[];
}
export interface StoredReview {
  response: ReviewResponse;
  sources: Map<string, SourceFile>;
  mutable: boolean;
  indexState: string;
  frozenSources?: Map<string, SourceResponse>;
  frozenImages?: { old: Buffer; new: Buffer };
}

export function safeRepoPath(repo: string, path: string) {
  const absolute = resolve(repo, path);
  const rel = relative(repo, absolute);
  if (isAbsolute(path) || !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new HostError("invalid-path", "The file path must stay inside this worktree.");
  }
  return absolute;
}

async function fingerprint(repo: string, path: string) {
  try {
    const stat = await lstat(safeRepoPath(repo, path), { bigint: true });
    return `${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
}

/** Read symlink text, never follow a link outside the selected worktree. */
export async function readWorkingFile(repo: string, path: string) {
  const absolute = safeRepoPath(repo, path);
  const [realRepo, realParent] = await Promise.all([realpath(repo), realpath(dirname(absolute))]);
  const parentRelative = relative(realRepo, realParent);
  if (
    parentRelative === ".." ||
    parentRelative.startsWith(`..${sep}`) ||
    isAbsolute(parentRelative)
  )
    throw new HostError(
      "invalid-path",
      "A source directory points outside the selected worktree.",
      403,
    );
  const stat = await lstat(absolute);
  if (stat.isSymbolicLink()) return readlink(absolute);
  if (!stat.isFile())
    throw new HostError("unsupported-source", "This path is not a regular text file.", 422);
  if (stat.size > MAX_SOURCE_BYTES)
    throw new HostError("source-too-large", "Source text exceeds the 8 MiB limit.", 413);
  const handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes: Buffer;
  try {
    if (!(await handle.stat()).isFile())
      throw new HostError("unsupported-source", "This path is not a regular text file.", 422);
    const chunks: Buffer[] = [];
    let count = 0;
    while (count <= MAX_SOURCE_BYTES) {
      const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, MAX_SOURCE_BYTES + 1 - count));
      const read = await handle.read(buffer, 0, buffer.byteLength, null);
      if (read.bytesRead === 0) break;
      count += read.bytesRead;
      chunks.push(buffer.subarray(0, read.bytesRead));
    }
    if (count > MAX_SOURCE_BYTES)
      throw new HostError("source-too-large", "Source text exceeds the 8 MiB limit.", 413);
    bytes = Buffer.concat(chunks, count);
  } finally {
    await handle.close();
  }
  if (bytes.includes(0))
    throw new HostError("binary-source", "Binary content cannot expand as text.", 422);
  return bytes.toString("utf8");
}

/** Parse NUL-delimited raw Git records without splitting filenames on whitespace. */
export function parseRawDiff(data: Buffer): SourceFile[] {
  const fields = data.toString("utf8").split("\0");
  const files: SourceFile[] = [];
  for (let i = 0; i < fields.length;) {
    const header = fields[i++]!;
    if (!header) continue;
    const match = /^:(\d+) (\d+) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])\d*$/.exec(header);
    if (!match)
      throw new HostError("unsupported-diff", "Git returned an unsupported raw diff record.", 422);
    const firstPath = fields[i++];
    if (firstPath === undefined)
      throw new HostError("invalid-diff", "Git returned an incomplete file record.", 422);
    const previousPath = match[5] === "R" || match[5] === "C" ? firstPath : undefined;
    const path = previousPath === undefined ? firstPath : fields[i++];
    if (path === undefined)
      throw new HostError("invalid-diff", "Git returned an incomplete rename record.", 422);
    files.push({
      path,
      ...(previousPath !== undefined ? { previousPath } : {}),
      status: match[5]!,
      oldMode: match[1]!,
      newMode: match[2]!,
      oldOid: match[3]!,
      newOid: match[4]!,
      additions: 0,
      deletions: 0,
      binary: false,
    });
  }
  return files;
}

function applyPatchStats(files: SourceFile[], patch: string) {
  const sections = patch
    .split(/(?=^diff --git )/m)
    .filter((part) => part.startsWith("diff --git "));
  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const section = sections[i] ?? "";
    file.binary = /^Binary files .* differ$/m.test(section) || /^GIT binary patch$/m.test(section);
    let inHunk = false;
    for (const line of section.split("\n")) {
      if (line.startsWith("@@")) {
        inHunk = true;
        continue;
      }
      if (!inHunk) continue;
      if (line.startsWith("+")) file.additions++;
      else if (line.startsWith("-")) file.deletions++;
    }
  }
}

const quotedPath = (path: string) => (/[\s"\\]/.test(path) ? JSON.stringify(path) : path);
export function addedPatch(path: string, text: string) {
  const lines = text ? text.split("\n") : [];
  const hasFinalNewline = text.endsWith("\n");
  if (hasFinalNewline) lines.pop();
  const a = quotedPath(`a/${path}`),
    b = quotedPath(`b/${path}`);
  let patch = `diff --git ${a} ${b}\nnew file mode 100644\n--- /dev/null\n+++ ${b}\n`;
  if (lines.length)
    patch += `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => `+${line}`).join("\n")}\n${hasFinalNewline ? "" : "\\ No newline at end of file\n"}`;
  return { patch, lines: lines.length };
}

/** Keep immutable comparisons and source bytes separate from bounded review retention. */
export class ReviewService {
  private reviews = new ByteCache<StoredReview>(64 * 1024 * 1024);
  private immutable = new Map<string, string>();
  private immutableRequests = new Map<string, string>();
  private sourceCache = new ByteCache<SourceResponse>(32 * 1024 * 1024);
  constructor(private allowedInputPaths: ReadonlySet<string> = new Set()) {}

  private async inputPath(repo: string, path: string) {
    const absolute = resolve(repo, path);
    const canonical = await realpath(absolute);
    if (this.allowedInputPaths.has(absolute) || this.allowedInputPaths.has(canonical))
      return canonical;
    const realRepo = await realpath(repo);
    const rel = relative(realRepo, canonical);
    if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
      throw new HostError(
        "input-not-allowed",
        "Choose an input inside this directory, or explicitly pass its path to the CLI.",
        403,
      );
    return canonical;
  }

  private async inputBytes(path: string, maxBytes: number) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const info = await handle.stat();
      if (!info.isFile()) throw new HostError("invalid-input", "Choose a regular input file.", 422);
      if (info.size > maxBytes)
        throw new HostError(
          "input-too-large",
          `The input exceeds its ${maxBytes}-byte limit.`,
          413,
        );
      const chunks: Buffer[] = [];
      let bytes = 0;
      while (bytes <= maxBytes) {
        const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1 - bytes));
        const read = await handle.read(buffer, 0, buffer.byteLength, null);
        if (!read.bytesRead) break;
        bytes += read.bytesRead;
        chunks.push(buffer.subarray(0, read.bytesRead));
      }
      if (bytes > maxBytes)
        throw new HostError(
          "input-too-large",
          `The input exceeds its ${maxBytes}-byte limit.`,
          413,
        );
      return Buffer.concat(chunks, bytes);
    } finally {
      await handle.close();
    }
  }

  private async externalInput(
    request: ReviewRequest,
    signal?: AbortSignal,
  ): Promise<ReviewResponse> {
    const started = performance.now();
    const comparison = request.comparison;
    if (comparison.kind !== "patch" && comparison.kind !== "files")
      throw new Error("Expected file input.");
    let patch: string;
    let frozen: { old: string; new: string } | undefined;
    let binaryPair = false;
    let frozenImages: { old: Buffer; new: Buffer } | undefined;
    let label: string;
    let displayPath: string | undefined;
    let base: string;
    let head: string;
    if (comparison.kind === "patch") {
      const path = await this.inputPath(request.repo, comparison.path);
      const bytes = await this.inputBytes(path, MAX_PATCH_BYTES);
      if (bytes.includes(0))
        throw new HostError("invalid-patch", "A patch input must contain text.", 422);
      patch = bytes.toString("utf8");
      label = basename(path);
      base = "patch";
      head = path;
      if (/^diff --(?:cc|combined) /m.test(patch))
        throw new HostError(
          "unsupported-diff",
          "Combined merge patches need a dedicated conflict view.",
          422,
        );
    } else {
      const [oldPath, newPath] = await Promise.all([
        this.inputPath(request.repo, comparison.oldPath),
        this.inputPath(request.repo, comparison.newPath),
      ]);
      const [oldBytes, newBytes] = await Promise.all([
        this.inputBytes(oldPath, MAX_SOURCE_BYTES),
        this.inputBytes(newPath, MAX_SOURCE_BYTES),
      ]);
      signal?.throwIfAborted();
      base = createHash("sha256").update(oldBytes).digest("hex");
      head = createHash("sha256").update(newBytes).digest("hex");
      label = `${basename(oldPath)} → ${basename(newPath)}`;
      displayPath = basename(newPath);
      if (mediaType(newPath)?.kind === "image") frozenImages = { old: oldBytes, new: newBytes };
      binaryPair = oldBytes.includes(0) || newBytes.includes(0);
      if (!binaryPair) frozen = { old: oldBytes.toString("utf8"), new: newBytes.toString("utf8") };
      const temporary = await mkdtemp(join(tmpdir(), "med-file-pair-"));
      try {
        await Promise.all([
          writeFile(join(temporary, "old"), oldBytes),
          writeFile(join(temporary, "new"), newBytes),
        ]);
        patch = (
          await git(
            request.repo,
            [
              "diff",
              "--no-index",
              ...DIFF_FLAGS,
              "--",
              join(temporary, "old"),
              join(temporary, "new"),
            ],
            { signal, acceptedExitCodes: [0, 1], maxBytes: MAX_PATCH_BYTES },
          )
        ).toString("utf8");
      } finally {
        await rm(temporary, { recursive: true, force: true });
      }
      const a = quotedPath(`a/${basename(oldPath)}`),
        b = quotedPath(`b/${basename(newPath)}`);
      patch = patch
        .replace(/^diff --git [^\n]*\n/, `diff --git ${a} ${b}\n`)
        .replace(/^--- [^\n]*\n/m, `--- ${a}\n`)
        .replace(/^\+\+\+ [^\n]*\n/m, `+++ ${b}\n`)
        .replace(/^Binary files [^\n]* differ$/m, `Binary files ${a} and ${b} differ`);
    }
    let metadata: ReturnType<typeof parsePatchFiles>;
    try {
      metadata = parsePatchFiles(patch);
    } catch {
      throw new HostError("invalid-patch", "The patch could not be parsed.", 422);
    }
    const files: SourceFile[] = metadata
      .flatMap((entry) => entry.files)
      .map((file) => ({
        path: file.name,
        ...(file.prevName !== undefined ? { previousPath: file.prevName } : {}),
        status:
          file.type === "new"
            ? "A"
            : file.type === "deleted"
              ? "D"
              : file.type.startsWith("rename")
                ? "R"
                : "M",
        additions: file.hunks
          .flatMap((hunk) => hunk.hunkContent)
          .reduce((sum, block) => sum + (block.type === "change" ? block.additions : 0), 0),
        deletions: file.hunks
          .flatMap((hunk) => hunk.hunkContent)
          .reduce((sum, block) => sum + (block.type === "change" ? block.deletions : 0), 0),
        binary: false,
        oldOid: base,
        newOid: head,
        oldMode: "100644",
        newMode: "100644",
        sourceUnavailable: !frozen,
        noteHunks: file.hunks.map(
          ({ additionStart, additionCount, deletionStart, deletionCount }) => ({
            additionStart,
            additionCount,
            deletionStart,
            deletionCount,
          }),
        ),
        fingerprint:
          comparison.kind === "patch"
            ? createHash("sha256").update(patch).digest("hex")
            : undefined,
      }));
    if (!files.length && patch.trim() && !binaryPair)
      throw new HostError("invalid-patch", "The input contains no supported file diff.", 422);
    if (binaryPair && !files.length)
      files.push({
        path: displayPath!,
        status: "M",
        additions: 0,
        deletions: 0,
        binary: true,
        oldOid: base,
        newOid: head,
        oldMode: "100644",
        newMode: "100644",
        sourceUnavailable: true,
      });
    if (files.length > 10_000)
      throw new HostError("too-many-files", "This input exceeds 10,000 changed files.", 413);
    const sections = patch
      .split(/(?=^diff --git )/m)
      .filter((part) => part.startsWith("diff --git "));
    for (let index = 0; index < files.length; index++)
      files[index]!.binary =
        binaryPair ||
        /^Binary files .* differ$/m.test(sections[index] ?? "") ||
        /^GIT binary patch$/m.test(sections[index] ?? "");
    const id = createHash("sha256")
      .update(request.repo)
      .update(JSON.stringify(comparison))
      .update(patch)
      .update(base)
      .update(head)
      .digest("hex");
    const response: ReviewResponse = {
      id,
      repo: request.repo,
      comparison,
      base,
      head,
      label,
      patch,
      files: files.map(
        ({
          oldOid: _o,
          newOid: _n,
          oldMode: _om,
          newMode: _nm,
          sourceUnavailable: _s,
          noteHunks: _h,
          fingerprint: _f,
          ...file
        }) => file,
      ),
      metrics: {
        gitMs: 0,
        totalMs: performance.now() - started,
        patchBytes: Buffer.byteLength(patch),
        cacheHit: false,
      },
      warnings:
        comparison.kind === "patch"
          ? ["Patch inputs have no complete source files. Context expansion is unavailable."]
          : [],
    };
    const frozenSources = new Map<string, SourceResponse>();
    if (frozen && files[0])
      frozenSources.set(files[0].path, { reviewId: id, path: files[0].path, ...frozen });
    this.reviews.set(
      id,
      {
        response,
        sources: new Map(files.map((file) => [file.path, file])),
        mutable: true,
        indexState: "",
        frozenSources,
        frozenImages,
      },
      Buffer.byteLength(JSON.stringify(response)) * 2 +
        (frozen ? Buffer.byteLength(frozen.old) + Buffer.byteLength(frozen.new) : 0) +
        (frozenImages ? frozenImages.old.length + frozenImages.new.length : 0),
    );
    return response;
  }

  get(id: string) {
    const review = this.reviews.get(id);
    if (!review)
      throw new HostError(
        "review-expired",
        "This review is no longer cached. Refresh it before continuing.",
        409,
      );
    return review;
  }

  async load(request: ReviewRequest, signal?: AbortSignal): Promise<ReviewResponse> {
    const measured = await measureGit(() => this.build(request, signal));
    measured.value.metrics.gitMs = measured.gitMs;
    return measured.value;
  }

  private async build(request: ReviewRequest, signal?: AbortSignal): Promise<ReviewResponse> {
    if (request.comparison.kind === "patch" || request.comparison.kind === "files")
      return this.externalInput(request, signal);
    const started = performance.now();
    const { repo, comparison } = request;
    const fullOid = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
    const requestKey =
      (comparison.kind === "commit" && fullOid.test(comparison.commit)) ||
      (comparison.kind === "range" &&
        fullOid.test(comparison.base) &&
        fullOid.test(comparison.head))
        ? JSON.stringify(request)
        : undefined;
    if (requestKey) {
      const id = this.immutableRequests.get(requestKey);
      const cached = id ? this.reviews.get(id) : undefined;
      if (cached)
        return {
          ...cached.response,
          comparison,
          metrics: {
            ...cached.response.metrics,
            cacheHit: true,
            gitMs: 0,
            totalMs: performance.now() - started,
          },
        };
    }
    const emptyTree = async () =>
      (
        await git(repo, ["hash-object", "-t", "tree", "--stdin"], {
          signal,
          input: "",
          maxBytes: 256,
        })
      )
        .toString("utf8")
        .trim();
    let base: string;
    let head: string;
    let args: string[];
    let label: string;
    const mutable =
      comparison.kind === "working" ||
      comparison.kind === "unstaged" ||
      comparison.kind === "staged";
    const parentOrEmpty = async (commit: string) => {
      // The raw object retains real parents even when a shallow boundary hides them from log.
      const commitObject = (
        await git(repo, ["cat-file", "commit", commit], { signal, maxBytes: 1024 * 1024 })
      )
        .toString("utf8")
        .split("\n\n", 1)[0]!;
      const parents = [...commitObject.matchAll(/^parent ([0-9a-f]+)$/gm)].map(
        (match) => match[1]!,
      );
      const parent = parents[0] ?? (await emptyTree());
      if (parents[0]) {
        try {
          await git(repo, ["cat-file", "-e", `${parent}^{tree}`], { signal, maxBytes: 1024 });
        } catch {
          signal?.throwIfAborted();
          throw new HostError(
            "parent-unavailable",
            "The parent commit is unavailable in this shallow repository. Fetch more history before reviewing this commit.",
            422,
          );
        }
      }
      return { parent, root: !parents.length };
    };
    if (comparison.kind === "commit") {
      head = await resolveCommit(repo, comparison.commit, signal);
      const { parent, root } = await parentOrEmpty(head);
      base = parent;
      args = [base, head];
      label = `${head.slice(0, 8)} · ${root ? "root commit" : "first parent"}`;
    } else if (comparison.kind === "range") {
      [base, head] = await Promise.all([
        resolveCommit(repo, comparison.base, signal),
        resolveCommit(repo, comparison.head, signal),
      ]);
      const oldest = base;
      if (comparison.mergeBase) {
        if (comparison.includeBase)
          throw new HostError(
            "invalid-comparison",
            "Choose merge-base or inclusive range, not both.",
          );
        const ancestors = (
          await git(repo, ["merge-base", "--all", base, head], {
            signal,
            maxBytes: 8192,
            acceptedExitCodes: [0, 1],
          })
        )
          .toString("utf8")
          .trim()
          .split("\n")
          .filter(Boolean);
        if (ancestors.length !== 1)
          throw new HostError(
            "merge-base-unavailable",
            ancestors.length
              ? "This comparison has multiple merge bases. Choose an exact base commit."
              : "These branches have no available common ancestor. Fetch more history or choose an exact base commit.",
            422,
          );
        base = ancestors[0]!;
      }
      if (comparison.includeBase) base = (await parentOrEmpty(base)).parent;
      args = [base, head];
      label = comparison.mergeBase
        ? `${comparison.base} … ${head.slice(0, 8)} · merge base ${base.slice(0, 8)}`
        : comparison.includeBase
          ? `${oldest.slice(0, 8)}…${head.slice(0, 8)} · inclusive`
          : `${base.slice(0, 8)} → ${head.slice(0, 8)}`;
    } else if (comparison.kind === "unstaged") {
      base = "index";
      head = "worktree";
      args = [];
      label = "Unstaged changes";
    } else {
      base = await resolveCommit(repo, "HEAD", signal).catch(async (error) => {
        signal?.throwIfAborted();
        const refs = await git(repo, ["rev-parse", "--verify", "HEAD"], {
          signal,
          acceptedExitCodes: [0, 128],
          maxBytes: 8192,
        });
        if (refs.length) throw error;
        return emptyTree();
      });
      head = comparison.kind === "staged" ? "index" : "worktree";
      args = comparison.kind === "staged" ? ["--cached", base] : [base];
      label = comparison.kind === "staged" ? "Staged changes" : "Working changes";
    }
    const cacheKey = JSON.stringify([repo, base, head]);
    if (!mutable) {
      const cachedId = this.immutable.get(cacheKey);
      const cached = cachedId ? this.reviews.get(cachedId) : undefined;
      if (cached)
        return {
          ...cached.response,
          comparison,
          label,
          metrics: {
            ...cached.response.metrics,
            cacheHit: true,
            totalMs: performance.now() - started,
          },
        };
    }
    const rawArgs = ["diff", ...DIFF_FLAGS, "--raw", "-z", "--no-abbrev", ...args, "--"];
    const raw = await git(repo, rawArgs, { signal, maxBytes: 4 * 1024 * 1024 });
    const files = parseRawDiff(raw);
    if (files.some((file) => file.status === "U"))
      throw new HostError(
        "unmerged-files",
        "Resolve merge conflicts before opening an ordinary two-sided review.",
        422,
      );
    if (files.length > 10_000)
      throw new HostError("too-many-files", "This comparison exceeds 10,000 changed files.", 413);
    const live = head === "worktree";
    if (live) for (const file of files) file.fingerprint = await fingerprint(repo, file.path);
    const warnings: string[] = [];
    let patch = "";
    try {
      patch = (
        await git(repo, ["diff", ...DIFF_FLAGS, "--patch", "--full-index", ...args, "--"], {
          signal,
          maxBytes: MAX_PATCH_BYTES,
        })
      ).toString("utf8");
    } catch (error) {
      if (!(error instanceof ProcessFailure) || error.code !== "output-too-large") throw error;
      for (const file of files) file.tooLarge = true;
      warnings.push(
        "The tracked patch exceeds 16 MiB. All changed paths are listed, but their content and counts are omitted.",
      );
    }
    applyPatchStats(files, patch);
    // Raster and SVG media use lazy image responses, never text parsing/highlighting.
    patch = patch
      .split(/(?=^diff --git )/m)
      .filter((part) => part.startsWith("diff --git "))
      .filter((_, i) => !mediaType(files[i]?.path ?? ""))
      .join("");
    if (comparison.kind === "working" || comparison.kind === "unstaged") {
      const untracked = (
        await git(repo, ["ls-files", "--others", "--exclude-standard", "-z"], {
          signal,
          maxBytes: 2 * 1024 * 1024,
        })
      )
        .toString("utf8")
        .split("\0")
        .filter(Boolean);
      if (files.length + untracked.length > 10_000)
        throw new HostError("too-many-files", "This comparison exceeds 10,000 changed files.", 413);
      for (const path of untracked) {
        signal?.throwIfAborted();
        const before = await fingerprint(repo, path);
        const file: SourceFile = {
          path,
          status: "A",
          additions: 0,
          deletions: 0,
          binary: false,
          untracked: true,
          oldOid: "0",
          newOid: "0",
          oldMode: "000000",
          newMode: "100644",
          fingerprint: before,
        };
        if (mediaType(path)) {
          const info = await lstat(safeRepoPath(repo, path));
          if (!info.isFile()) file.newMode = info.isSymbolicLink() ? "120000" : "000000";
          file.binary = true;
          files.push(file);
          continue;
        }
        try {
          const text = await readWorkingFile(repo, path);
          const added = addedPatch(path, text);
          if (Buffer.byteLength(patch) + Buffer.byteLength(added.patch) > MAX_PATCH_BYTES) {
            file.tooLarge = true;
            warnings.push(`${path}: omitted because the review reached its 16 MiB patch limit`);
          } else {
            patch += added.patch;
            file.additions = added.lines;
          }
        } catch (error) {
          if (error instanceof HostError && error.code === "binary-source") file.binary = true;
          else if (error instanceof HostError && error.code === "source-too-large")
            file.tooLarge = true;
          else throw error;
          warnings.push(`${path}: ${file.binary ? "binary content" : "file exceeds source limit"}`);
        }
        files.push(file);
      }
    }
    if (mutable) {
      const afterRaw = await git(repo, rawArgs, { signal, maxBytes: 4 * 1024 * 1024 });
      if (!raw.equals(afterRaw))
        throw new HostError(
          "source-changed",
          "Files or staging changed while loading. Retry the review.",
          409,
        );
      if (live)
        for (const file of files) {
          if (file.fingerprint !== (await fingerprint(repo, file.path)))
            throw new HostError(
              "source-changed",
              "A file changed while loading. Retry the review.",
              409,
            );
        }
    }
    const id = createHash("sha256")
      .update(cacheKey)
      .update(raw)
      .update(patch)
      .update(JSON.stringify(files.map((file) => file.fingerprint)))
      .digest("hex");
    const response: ReviewResponse = {
      id,
      repo,
      comparison,
      base,
      head,
      label,
      patch,
      files: files.map(
        ({ oldOid: _old, newOid: _new, oldMode: _om, newMode: _nm, fingerprint: _fp, ...file }) =>
          file,
      ),
      warnings,
      metrics: {
        gitMs: 0,
        totalMs: performance.now() - started,
        patchBytes: Buffer.byteLength(patch),
        cacheHit: false,
      },
    };
    this.reviews.set(
      id,
      {
        response,
        sources: new Map(files.map((file) => [file.path, file])),
        mutable,
        indexState: raw.toString("base64"),
      },
      Buffer.byteLength(JSON.stringify(response)) * 2 + Buffer.byteLength(raw),
    );
    if (!mutable) {
      this.immutable.set(cacheKey, id);
      if (this.immutable.size > 512) this.immutable.delete(this.immutable.keys().next().value!);
      if (requestKey) {
        this.immutableRequests.set(requestKey, id);
        if (this.immutableRequests.size > 512)
          this.immutableRequests.delete(this.immutableRequests.keys().next().value!);
      }
    }
    return response;
  }

  async image(reviewId: string, path: string, side: "old" | "new", signal?: AbortSignal) {
    const review = this.get(reviewId);
    const file = review.sources.get(path);
    const media = mediaType(side === "old" ? (file?.previousPath ?? path) : path);
    if (!file || media?.kind !== "image")
      throw new HostError("unsupported-media", "This review file has no image preview.", 422);
    const mode = side === "old" ? file.oldMode : file.newMode;
    if (!/^100[0-7]{3}$/.test(mode))
      throw new HostError("image-unavailable", "This side has no image.", 404);
    if (review.frozenImages) return { bytes: review.frozenImages[side], mime: media.mime };
    if (file.sourceUnavailable)
      throw new HostError("image-unavailable", "Image bytes are unavailable for this patch.", 422);
    const repo = review.response.repo;
    const current = () => fingerprint(repo, path);
    if (file.fingerprint !== undefined && file.fingerprint !== (await current()))
      throw new HostError("source-changed", "Refresh the review to load the changed image.", 409);
    const oid = side === "old" ? file.oldOid : file.newOid;
    const bytes =
      side === "new" && review.response.head === "worktree"
        ? (
            await markdownAsset(
              { kind: "worktree", repo },
              "_",
              path.split("/").map(encodeURIComponent).join("/"),
              signal,
              MAX_IMAGE_BYTES,
            )
          ).bytes
        : await git(repo, ["cat-file", "blob", oid], { signal, maxBytes: MAX_IMAGE_BYTES });
    if (file.fingerprint !== undefined && file.fingerprint !== (await current()))
      throw new HostError(
        "source-changed",
        "The image changed while loading. Refresh the review.",
        409,
      );
    return { bytes, mime: media.mime };
  }

  async sources(reviewId: string, path: string, signal?: AbortSignal): Promise<SourceResponse> {
    const review = this.get(reviewId);
    const file = review.sources.get(path);
    if (!file) throw new HostError("file-not-found", "This file is not part of the review.", 404);
    const frozen = review.frozenSources?.get(path);
    if (frozen) return frozen;
    if (file.sourceUnavailable)
      throw new HostError(
        "source-unavailable",
        "This patch does not include complete source files for context expansion.",
        422,
      );
    if (file.binary || file.tooLarge || file.oldMode === "160000" || file.newMode === "160000")
      throw new HostError(
        "unsupported-source",
        "This file does not have expandable text content.",
        422,
      );
    const repo = review.response.repo;
    if (file.fingerprint !== undefined && file.fingerprint !== (await fingerprint(repo, path)))
      throw new HostError(
        "source-changed",
        "The file has changed. Refresh the review before expanding context.",
        409,
      );
    const key = `${reviewId}:${path}`;
    const cached = this.sourceCache.get(key);
    if (cached) return cached;
    const readBlob = async (oid: string) => {
      if (ZERO_OID.test(oid)) return "";
      const value = await git(repo, ["cat-file", "blob", oid], {
        signal,
        maxBytes: MAX_SOURCE_BYTES,
      });
      if (value.includes(0))
        throw new HostError("binary-source", "Binary content cannot expand as text.", 422);
      return value.toString("utf8");
    };
    const [old, next] = await Promise.all([
      readBlob(file.oldOid),
      review.response.head === "worktree" && file.status !== "D"
        ? readWorkingFile(repo, path)
        : readBlob(file.newOid),
    ]);
    if (file.fingerprint !== undefined && file.fingerprint !== (await fingerprint(repo, path)))
      throw new HostError(
        "source-changed",
        "The file changed during context loading. Refresh the review.",
        409,
      );
    const result = { reviewId, path, old, new: next };
    this.sourceCache.set(key, result, Buffer.byteLength(old) + Buffer.byteLength(next));
    return result;
  }

  removeRepositories(paths: ReadonlySet<string>) {
    const removed = new Set<string>();
    this.reviews.deleteWhere((review, id) => {
      if (!paths.has(review.response.repo)) return false;
      removed.add(id);
      return true;
    });
    for (const [key, id] of this.immutable) if (removed.has(id)) this.immutable.delete(key);
    for (const [key, id] of this.immutableRequests)
      if (removed.has(id)) this.immutableRequests.delete(key);
    this.sourceCache.deleteWhere((source) => removed.has(source.reviewId));
  }

  clear() {
    this.reviews.clear();
    this.immutable.clear();
    this.immutableRequests.clear();
    this.sourceCache.clear();
  }
}
