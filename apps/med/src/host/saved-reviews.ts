import { createHash, randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  readFile,
  rmdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { parsePatchFiles, type FileDiffMetadata } from "@pierre/diffs";
import type { SentComment } from "../shared/agent-inbox";
import { lastSaid, type LastSaid } from "../shared/comment-thread";
import { ByteLru } from "../shared/byte-lru";
import { generatedMarkSchema } from "../shared/generated";
import { normalizeDiffMetadataPaths } from "../shared/hunk/diffPaths";
import {
  comparisonSchema,
  noteAuthorSchema,
  noteInputSchema,
  noteMutationSchema,
  type Note,
  type NoteAuthor,
  type NoteMutation,
  type NoteState,
  type ReviewResponse,
  type SourceResponse,
} from "../shared/protocol";
import {
  validateReviewNoteInput,
  removeReviewNote,
  validateReviewNoteText,
} from "../shared/hunk/noteValidation";
import { HostError } from "./runtime/errors";
import { shortCommentId } from "./thread-comments";
import { lineChanges, mapLine, replay, textPatch, type LineChange } from "./repository/text-diff";
import {
  savedReviewCreateSchema,
  pullRequestUrlSchema,
  savedReviewDetailsSchema,
  agentSessionSchema,
  MAX_ITERATIONS,
  endpointNamesSchema,
  type SavedReview,
  type Since,
  type SavedReviewCreate,
  type CapturedReviewTarget,
  agentName,
} from "../shared/saved-review";
import {
  guideError,
  reviewGuideSchema,
  savedCommitSchema,
  savedGuideSchema,
  MAX_SAVED_COMMITS,
  type ReviewGuide,
} from "../shared/review-guide";

const REVIEW_ID = /^r_[a-f0-9]{24}$/;
const TARGET_ID = /^t_[a-f0-9]{24}$/;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
/** The byte budget of all records. Past it, the oldest closed threads give
 * up their captures (`evictable`); open threads never do. */
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_NOTES = 500;
const MAX_FEEDBACK_BYTES = 8 * 1024 * 1024;
// Parsed records stay in memory up to this many file bytes, four at most.
const CACHED_RECORD_BYTES = 64 * 1024 * 1024;
const text = z.string();
const natural = z.number().int().nonnegative();
const responseSchema = z.object({
  id: text,
  repo: text,
  comparison: comparisonSchema,
  base: text,
  head: text,
  label: text,
  files: z.array(
    z.object({
      path: text,
      previousPath: text.optional(),
      status: text,
      additions: natural,
      deletions: natural,
      binary: z.boolean(),
      tooLarge: z.boolean().optional(),
      untracked: z.boolean().optional(),
      generated: z.union([generatedMarkSchema, z.literal(false)]).optional(),
    }),
  ),
  patch: text,
  metrics: z.object({
    gitMs: z.number(),
    totalMs: z.number(),
    patchBytes: natural,
    cacheHit: z.boolean(),
  }),
  warnings: z.array(text),
});
const sourceSchema = z.object({ reviewId: text, path: text, old: text, new: text });
const noteSchema = noteInputSchema.extend({
  id: text,
  createdAt: text,
  updatedAt: text,
  resolution: z.enum(["active", "stale", "orphaned"]).optional(),
  author: noteAuthorSchema.optional(),
});
const targetSchema = z.object({
  id: z.string().regex(TARGET_ID),
  repositoryId: text,
  repo: text,
  branch: text.nullable(),
  label: text,
  comparison: comparisonSchema,
  base: text,
  head: text,
  captured: z.boolean(),
  commentReviewId: text.optional(),
  commits: z.array(savedCommitSchema).max(MAX_SAVED_COMMITS).optional(),
  moreCommits: z.boolean().optional(),
  names: endpointNamesSchema.optional(),
});
const savedSchema = z.object({
  id: z.string().regex(REVIEW_ID),
  key: text.optional(),
  title: text,
  pullRequestUrl: pullRequestUrlSchema.optional(),
  pullRequestTitle: text.optional(),
  guide: savedGuideSchema.optional(),
  session: agentSessionSchema.optional(),
  iterations: z
    .array(
      z.object({
        number: z.number().int().positive(),
        createdAt: text,
        targetIds: z.array(z.string().regex(TARGET_ID)),
        guide: savedGuideSchema.optional(),
      }),
    )
    .max(MAX_ITERATIONS)
    .optional(),
  readVersions: z.array(z.number().int().positive()).max(MAX_ITERATIONS).optional(),
  createdAt: text,
  revision: natural,
  commentCount: natural,
  targets: z.array(targetSchema).max(128),
});
/** A record as an older Med wrote it: a list of sessions, of which the last
 * handed off the review, becomes its one session. */
const savedFromDisk = z.preprocess((value) => {
  const raw = value as { sessions?: unknown; session?: unknown } | null;
  if (!raw || typeof raw !== "object" || raw.session || !Array.isArray(raw.sessions)) return value;
  const { sessions, ...rest } = raw as { sessions: unknown[] };
  return sessions.length ? { ...rest, session: sessions.at(-1) } : rest;
}, savedSchema);
const recordSchema = z.object({
  version: z.literal(1),
  saved: savedFromDisk,
  captures: z
    .array(
      z.object({
        targetId: z.string().regex(TARGET_ID),
        review: responseSchema,
        sources: z.array(sourceSchema),
        images: z
          .array(z.object({ path: text, side: z.enum(["old", "new"]), mime: text, data: text }))
          .default([]),
        notes: z.object({
          reviewId: text,
          revision: natural,
          notes: z.array(noteSchema).max(MAX_NOTES),
        }),
      }),
    )
    .max(128),
});
type SavedRecord = z.infer<typeof recordSchema>;
type SavedTarget = SavedRecord["saved"]["targets"][number];
type SavedIteration = NonNullable<SavedRecord["saved"]["iterations"]>[number];

/** What a target holds that its counterpart in an earlier version did not. */
interface Delta {
  /** The files to read again, with each one's diff and texts. */
  files: {
    file: ReviewResponse["files"][number];
    change: "changed" | "new";
    section: string;
    source?: SourceResponse;
  }[];
  /** Files of the earlier version that this one no longer changes. */
  gone: string[];
  /** Files that changed only because their base moved. */
  moved: string[];
  /** Files whose base moved where Med could not take the base's changes out. */
  mixed: string[];
  /** Commits that the earlier version did not have. */
  commits: string[];
}

/** A commit that the Review shows from a target's range (`lens`). */
export interface CommitLens {
  reviewId: string;
  files: ReviewResponse["files"];
  /** The commit's texts of a file, when it has them. */
  source(path: string): Promise<{ old: string; new: string } | undefined>;
  /** Whether the commit's diff shows any of these lines. */
  shown(path: string, side: "old" | "new", line: number, endLine: number): boolean;
}

/** Each file's part of a patch, by its new path. */
function patchSections(patch: string) {
  const sections = new Map<string, string>();
  for (const section of patch.split(/(?=^diff --git )/m)) {
    if (!section.startsWith("diff --git ")) continue;
    try {
      const file = parsePatchFiles(section, { throwOnError: true })[0]?.files[0];
      if (file) sections.set(normalizeDiffMetadataPaths(file).name, section);
    } catch {
      /* A part that does not parse shows nothing. */
    }
  }
  return sections;
}

/** What a captured file's new side is: its text, else its blob ID, else its counts. */
function sideKey(capture: SavedRecord["captures"][number], path: string) {
  const source = capture.sources.find((entry) => entry.path === path);
  if (source) return createHash("sha1").update(source.new).digest("hex");
  const file = capture.review.files.find((entry) => entry.path === path);
  const section = patchSections(capture.review.patch).get(path);
  const oid = section && /^index [0-9a-f]+\.\.([0-9a-f]+)/m.exec(section)?.[1];
  return oid && !/^0+$/.test(oid) ? oid : `${file?.status}:${file?.additions}:${file?.deletions}`;
}

/** A guide as the record keeps it: comment sides and kinds filled in. */
function savedGuide(guide: ReviewGuide, updatedAt = new Date().toISOString()) {
  return savedGuideSchema.parse({ ...guide, updatedAt });
}

/** Comments on the captured comparisons, on the Notes, and on files, with
 * their replies, as a review's notes count theirs. */
const countComments = (record: SavedRecord) =>
  record.captures.reduce((sum, capture) => sum + capture.notes.notes.length, 0);

/** Rebuild only a selected slice of captured patch rows. Large added files must
 * not repeat their complete initial-add hunk for every comment. */
function* commentDiffExcerpt(file: FileDiffMetadata, note: Note): Generator<string> {
  const end = note.endLine ?? note.line;
  for (const hunk of file.hunks) {
    const start = note.side === "old" ? hunk.deletionStart : hunk.additionStart;
    const count = note.side === "old" ? hunk.deletionCount : hunk.additionCount;
    if (!count || start > end || start + count <= note.line) continue;
    const segments: {
      prefix: " " | "-" | "+";
      count: number;
      old: number;
      new: number;
      row: number;
      lines: string[];
      offset: number;
    }[] = [];
    let oldLine = hunk.deletionStart + (hunk.deletionCount ? 0 : 1);
    let newLine = hunk.additionStart + (hunk.additionCount ? 0 : 1);
    let row = 0;
    const add = (prefix: " " | "-" | "+", count: number, offset: number) => {
      if (!count) return;
      segments.push({
        prefix,
        count,
        old: oldLine,
        new: newLine,
        row,
        lines: prefix === "-" ? file.deletionLines : file.additionLines,
        offset,
      });
      if (prefix !== "+") oldLine += count;
      if (prefix !== "-") newLine += count;
      row += count;
    };
    for (const block of hunk.hunkContent) {
      if (block.type === "context") add(" ", block.lines, block.additionLineIndex);
      else {
        add("-", block.deletions, block.deletionLineIndex);
        add("+", block.additions, block.additionLineIndex);
      }
    }
    let first = Infinity;
    let last = -1;
    for (const segment of segments) {
      if (segment.prefix === (note.side === "old" ? "+" : "-")) continue;
      const line = segment[note.side];
      const from = Math.max(0, note.line - line);
      const to = Math.min(segment.count - 1, end - line);
      if (from <= to) {
        first = Math.min(first, segment.row + from);
        last = Math.max(last, segment.row + to);
      }
    }
    if (last < 0) continue;
    first = Math.max(0, first - 3);
    last = Math.min(row - 1, last + 3);
    const slices = segments.flatMap((segment) => {
      const from = Math.max(0, first - segment.row);
      const to = Math.min(segment.count, last + 1 - segment.row);
      return from < to ? [{ segment, from, to }] : [];
    });
    const firstSlice = slices[0]!;
    const oldCount = slices.reduce(
      (sum, { segment, from, to }) => sum + (segment.prefix === "+" ? 0 : to - from),
      0,
    );
    const newCount = slices.reduce(
      (sum, { segment, from, to }) => sum + (segment.prefix === "-" ? 0 : to - from),
      0,
    );
    const oldStart =
      firstSlice.segment.old +
      (firstSlice.segment.prefix === "+" ? 0 : firstSlice.from) -
      (oldCount ? 0 : 1);
    const newStart =
      firstSlice.segment.new +
      (firstSlice.segment.prefix === "-" ? 0 : firstSlice.from) -
      (newCount ? 0 : 1);
    yield `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
    for (const { segment, from, to } of slices) {
      for (let offset = from; offset < to; offset++) {
        const index = segment.offset + offset;
        yield segment.prefix + segment.lines[index]!.replace(/\n$/, "");
        if (
          index === segment.lines.length - 1 &&
          (segment.prefix === "-" ? hunk.noEOFCRDeletions : hunk.noEOFCRAdditions)
        )
          yield "\\ No newline at end of file";
      }
    }
  }
}

function patchCoversSelection(file: FileDiffMetadata, note: Note): boolean {
  let next = note.line;
  const end = note.endLine ?? note.line;
  for (const hunk of file.hunks) {
    const start = note.side === "old" ? hunk.deletionStart : hunk.additionStart;
    const count = note.side === "old" ? hunk.deletionCount : hunk.additionCount;
    if (start <= next && start + count > next) next = start + count;
    if (next > end) return true;
  }
  return false;
}

/** Links a PR. A title read for another PR does not stay with a new link. */
function linkPullRequest(
  saved: { pullRequestUrl?: string; pullRequestTitle?: string },
  url: string,
  title?: string,
) {
  if (title) saved.pullRequestTitle = title;
  else if (saved.pullRequestUrl !== url) delete saved.pullRequestTitle;
  saved.pullRequestUrl = url;
}

/** Disk records own frozen sources and notes; live repository services are never consulted. */
export class SavedReviewStore {
  private pending: Promise<unknown> = Promise.resolve();
  // Reads skip the parse while the file keeps its identity. A write renames a
  // new file into place, so its next read parses again.
  private cache = new Map<string, { identity: string; size: number; record: SavedRecord }>();
  // Each review's description while its file keeps its identity. Lists and
  // status streams read every review often; a description is small, and a
  // record can take megabytes to parse.
  private described = new Map<string, { identity: string; review: SavedReview }>();
  /** Each review's comment IDs, by the file's identity, for `reviewsWithComment`. */
  private commentIds = new Map<string, { identity: string; ids: string[] }>();
  /** What changed since an earlier version, by target: at most 8, and 32 MiB. */
  private deltas = new ByteLru<Delta>(32 * 1024 * 1024, 8);
  private deltaJobs = new Map<string, Promise<Delta>>();
  /** Counts the writes and deletes of this store, so a reader can tell when
   * its list of reviews is old. */
  changes = 0;
  private listeners = new Set<() => void>();
  /** Hears each write and delete, as the thread list does. */
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  private touched() {
    this.changes++;
    for (const listener of this.listeners) listener();
  }
  constructor(
    private readonly directory: string,
    private readonly budget: {
      /** Reviews that may give up their captures, the first to go first. */
      evictable(): readonly string[];
      /** Keeps what history needs of a review before its file goes. */
      evicted(review: SavedReview): void;
    } = { evictable: () => [], evicted: () => {} },
  ) {}

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.pending.then(work);
    this.pending = next.catch(() => undefined);
    return next;
  }

  /** Publish a populated lock directory with one atomic rename. A dead owner's
   * unique file can be removed safely: a successor always has a different name,
   * and rmdir cannot remove that successor's populated directory. */
  private async lock(beforeCommit?: () => void): Promise<() => Promise<void>> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const lock = join(this.directory, ".writer-lock");
    const owner = `owner-${process.pid}-${randomUUID()}`;
    const candidate = join(this.directory, `.writer-candidate-${randomUUID()}`);
    await mkdir(candidate, { mode: 0o700 });
    try {
      await writeFile(join(candidate, owner), "", { flag: "wx", mode: 0o600 });
      const deadline = Date.now() + 10_000;
      for (;;) {
        if (Date.now() >= deadline)
          throw new HostError(
            "saved-review-busy",
            "Another med host is updating saved reviews. Retry shortly.",
            503,
          );
        beforeCommit?.();
        try {
          await rename(candidate, lock);
          return async () => {
            await unlink(join(lock, owner)).catch(() => undefined);
            // Another contender may already have installed its populated lock.
            await rmdir(lock).catch(() => undefined);
          };
        } catch (error) {
          if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? ""))
            throw error;
        }
        let owners: string[];
        try {
          owners = await readdir(lock);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        if (owners.length === 1) {
          const match = /^owner-(\d+)-[a-f0-9-]{36}$/.exec(owners[0]!);
          if (match) {
            let dead = false;
            try {
              process.kill(Number(match[1]), 0);
            } catch (error) {
              dead = (error as NodeJS.ErrnoException).code === "ESRCH";
            }
            if (dead) {
              await unlink(join(lock, owners[0]!)).catch(() => undefined);
              await rmdir(lock).catch(() => undefined);
              continue;
            }
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    } finally {
      await rm(candidate, { recursive: true, force: true });
    }
  }

  private writing<T>(work: () => Promise<T>, beforeCommit?: () => void): Promise<T> {
    return this.serial(async () => {
      const release = await this.lock(beforeCommit);
      try {
        beforeCommit?.();
        return await work();
      } finally {
        await release();
      }
    });
  }

  private file(id: string): string {
    if (!REVIEW_ID.test(id))
      throw new HostError("invalid-saved-review", "The review ID is not valid.");
    return join(this.directory, `${id}.json`);
  }

  private remember(id: string, identity: string, size: number, record: SavedRecord) {
    this.cache.delete(id);
    if (size > CACHED_RECORD_BYTES) return;
    this.cache.set(id, { identity, size, record });
    let total = 0;
    for (const entry of this.cache.values()) total += entry.size;
    for (const [key, entry] of this.cache) {
      if (total <= CACHED_RECORD_BYTES && this.cache.size <= 4) break;
      this.cache.delete(key);
      total -= entry.size;
    }
  }

  /** Writers ask for a `fresh` copy to change; the cached copy stays as on disk. */
  private async read(id: string, fresh = false): Promise<SavedRecord> {
    const file = this.file(id);
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
      const info = await handle.stat();
      if (!info.isFile() || info.size > MAX_RECORD_BYTES) throw new Error("Invalid record size.");
      const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
      const cached = this.cache.get(id);
      if (!fresh && cached?.identity === identity) {
        this.remember(id, identity, info.size, cached.record);
        return cached.record;
      }
      const record = recordSchema.parse(JSON.parse(await handle.readFile("utf8")));
      if (record.saved.id !== id || record.saved.targets.length !== record.captures.length)
        throw new Error("Record identity does not match.");
      const ids = new Set(record.saved.targets.map((target) => target.id));
      if (
        ids.size !== record.captures.length ||
        new Set(record.captures.map((item) => item.targetId)).size !== ids.size
      )
        throw new Error("Duplicate targets.");
      for (const capture of record.captures) {
        const target = record.saved.targets.find((item) => item.id === capture.targetId);
        if (
          !target ||
          target.repo !== capture.review.repo ||
          capture.notes.reviewId !== capture.review.id ||
          capture.review.id !== `${id}:${target.id}` ||
          capture.sources.some((source) => source.reviewId !== capture.review.id)
        )
          throw new Error("Capture identity does not match.");
        const noteIds = new Set(capture.notes.notes.map((note) => note.id));
        if (noteIds.size !== capture.notes.notes.length) throw new Error("Duplicate notes.");
        for (const note of capture.notes.notes) {
          const source = capture.sources.find((item) => item.path === note.path);
          if (!source) throw new Error("Note source is missing.");
          validateReviewNoteInput(note, source, capture.notes.notes);
          const ancestors = new Set([note.id]);
          let parentId = note.parentId;
          while (parentId) {
            if (ancestors.has(parentId)) throw new Error("Note replies form a cycle.");
            ancestors.add(parentId);
            parentId = capture.notes.notes.find((item) => item.id === parentId)?.parentId;
          }
        }
      }
      if (record.saved.commentCount !== countComments(record))
        throw new Error("Comment count does not match.");
      if (!fresh) this.remember(id, identity, info.size, record);
      return record;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        throw new HostError("saved-review-not-found", "This saved review does not exist.", 404);
      if (error instanceof HostError) throw error;
      throw new HostError(
        "saved-review-corrupt",
        "This saved review could not be read. Its saved file has not been changed.",
        422,
      );
    } finally {
      await handle?.close();
    }
  }

  private async write(record: SavedRecord, beforeCommit?: () => void): Promise<void> {
    const bytes = JSON.stringify(record);
    const size = Buffer.byteLength(bytes);
    if (size > MAX_RECORD_BYTES)
      throw new HostError(
        "saved-review-limit",
        "This review exceeds the 64 MiB snapshot limit.",
        413,
      );
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const filename = `${record.saved.id}.json`;
    const files = (await readdir(this.directory)).filter((name) =>
      /^r_[a-f0-9]{24}\.json$/.test(name),
    );
    const sizes = new Map<string, number>();
    let total = size;
    for (const name of files)
      if (name !== filename) {
        const bytes = (await stat(join(this.directory, name)).catch(() => undefined))?.size ?? 0;
        sizes.set(name.slice(0, -5), bytes);
        total += bytes;
      }
    // Over the budget, the oldest closed threads give up their captures.
    for (const id of total > MAX_TOTAL_BYTES ? this.budget.evictable() : []) {
      if (total <= MAX_TOTAL_BYTES) break;
      if (id === record.saved.id || !sizes.has(id)) continue;
      const review = await this.read(id).then(
        (found) => this.describe(found),
        () => undefined,
      );
      if (review) this.budget.evicted(review);
      await this.remove(id);
      total -= sizes.get(id)!;
    }
    if (total > MAX_TOTAL_BYTES)
      throw new HostError(
        "saved-review-limit",
        "Saved reviews exceed the 512 MiB storage limit. Close or delete threads you no longer need.",
        413,
      );
    const temporary = join(this.directory, `.${record.saved.id}-${randomUUID()}.tmp`);
    try {
      const handle = await open(temporary, "wx", 0o600);
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      beforeCommit?.();
      await rename(temporary, this.file(record.saved.id));
      this.cache.delete(record.saved.id);
      this.touched();
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }

  private target(record: SavedRecord, id: string) {
    if (!TARGET_ID.test(id))
      throw new HostError("invalid-saved-target", "The target ID is not valid.");
    const target = record.captures.find((item) => item.targetId === id);
    if (!target)
      throw new HostError(
        "saved-target-not-found",
        "This target does not belong to the review.",
        404,
      );
    return target;
  }

  private appendCapture(
    record: SavedRecord,
    result: CapturedReviewTarget,
    commentReviewId?: string,
    limit = true,
  ) {
    const id = record.saved.id;
    const targetId = `t_${randomBytes(12).toString("hex")}`;
    const reviewId = `${id}:${targetId}`;
    // Freeze symbolic refs after capture. Inclusive range resolution has already
    // shifted the base to its parent, so do not apply includeBase a second time.
    const comparison =
      result.review.comparison.kind === "range"
        ? {
            kind: "range" as const,
            base: result.review.base,
            head: result.review.head,
            includeBase: false,
          }
        : result.review.comparison.kind === "commit"
          ? { kind: "commit" as const, commit: result.review.head }
          : result.review.comparison;
    const review = responseSchema.parse({
      ...result.review,
      comparison,
      id: reviewId,
      repo: result.repo,
    });
    const images = result.images ?? [];
    const sources = result.sources.map((source) => sourceSchema.parse({ ...source, reviewId }));
    if (
      new Set(sources.map((source) => source.path)).size !== sources.length ||
      sources.some((source) => !review.files.some((file) => file.path === source.path))
    )
      throw new HostError("invalid-capture", "Captured source paths do not match the review.");
    if (Buffer.byteLength(JSON.stringify({ review, sources, images })) > MAX_RECORD_BYTES)
      throw new HostError(
        "saved-review-limit",
        "This review exceeds the 64 MiB snapshot limit.",
        413,
      );
    record.saved.targets.push({
      id: targetId,
      ...(commentReviewId ? { commentReviewId } : {}),
      repositoryId: result.repositoryId,
      repo: result.repo,
      branch: result.branch,
      label: review.label,
      comparison: review.comparison,
      base: review.base,
      head: review.head,
      captured: ["working", "staged", "unstaged"].includes(review.comparison.kind),
      ...(result.commits?.list.length ? { commits: result.commits.list } : {}),
      ...(result.commits?.more ? { moreCommits: true } : {}),
      ...(result.names ? { names: result.names } : {}),
    });
    record.captures.push({
      targetId,
      review,
      sources,
      images,
      notes: { reviewId, revision: 0, notes: [] },
    });
    // An iteration checks once all its comparisons are in; see fit().
    if (limit && Buffer.byteLength(JSON.stringify(record)) > MAX_RECORD_BYTES)
      throw new HostError(
        "saved-review-limit",
        "This review exceeds the 64 MiB snapshot limit.",
        413,
      );
    return record.saved.targets.at(-1)!;
  }

  /** A new review, or a new version of the review with its key. */
  create(
    input: SavedReviewCreate,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const parsed = savedReviewCreateSchema.safeParse(input);
      if (!parsed.success) throw new HostError("invalid-saved-review", parsed.error.message);
      input = parsed.data;
      const known = input.key ? await this.findKey(input.key, true) : undefined;
      if (known) return this.iterate(known, input, capture, beforeCommit);
      const results: CapturedReviewTarget[] = [];
      for (const requested of input.targets) results.push(await capture(requested));
      const id = `r_${randomBytes(12).toString("hex")}`;
      const record: SavedRecord = {
        version: 1,
        saved: {
          id,
          title: input.title.trim(),
          ...(input.pullRequestUrl ? { pullRequestUrl: input.pullRequestUrl } : {}),
          ...(input.pullRequestUrl && input.pullRequestTitle
            ? { pullRequestTitle: input.pullRequestTitle }
            : {}),
          ...(input.guide ? { guide: savedGuide(input.guide) } : {}),
          ...(input.session ? { session: input.session } : {}),
          createdAt: new Date().toISOString(),
          revision: 0,
          commentCount: 0,
          targets: [],
        },
        captures: [],
      };
      for (const result of results) this.appendCapture(record, result);
      if (input.key) {
        record.saved.key = input.key;
        // The first hand-off of a keyed review is version 1.
        record.saved.iterations = [
          {
            number: 1,
            createdAt: record.saved.createdAt,
            targetIds: record.saved.targets.map((target) => target.id),
            ...(record.saved.guide ? { guide: record.saved.guide } : {}),
          },
        ];
      }
      await this.write(record, beforeCommit);
      if (input.key) await this.setKey(input.key, id);
      return this.describe(record);
    }, beforeCommit);
  }

  /** The review's comparisons captured again as a new version: Refresh. */
  refresh(
    id: string,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const saved = record.saved;
      const current = new Set(
        saved.iterations?.at(-1)?.targetIds ??
          saved.targets.filter((target) => !target.commentReviewId).map((target) => target.id),
      );
      // Saved reviews hold Git comparisons and working changes only. Files
      // that the hand-off marked generated stay marked (docs/GENERATED.md).
      const declared = (id: string) =>
        record.captures
          .find((capture) => capture.targetId === id)
          ?.review.files.flatMap((file) =>
            file.generated && file.generated.kind === "declared" ? [file.path] : [],
          );
      const targets = saved.targets.flatMap(({ id, repo, comparison }) => {
        if (!current.has(id) || comparison.kind === "files" || comparison.kind === "patch")
          return [];
        const generated = declared(id);
        return [{ repo, comparison, ...(generated?.length ? { generated } : {}) }];
      });
      if (!targets.length)
        throw new HostError("saved-review-empty", "This review has no comparison to capture.", 409);
      return this.iterate(record, { title: saved.title, targets }, capture, beforeCommit);
    }, beforeCommit);
  }

  /** A new version of a review: what the agent shows now (`med thread show`). */
  addVersion(
    id: string,
    input: Omit<SavedReviewCreate, "title"> & { title?: string },
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const parsed = savedReviewCreateSchema.safeParse({ ...input, title: record.saved.title });
      if (!parsed.success) throw new HostError("invalid-saved-review", parsed.error.message);
      if (!parsed.data.targets.length)
        throw new HostError("saved-review-empty", "A new version needs a comparison.", 400);
      return this.iterate(record, parsed.data, capture, beforeCommit);
    }, beforeCommit);
  }

  /** The agent's next round on a keyed review: new comparisons and guide as a
   * new version. Comments and earlier comparisons stay. */
  private async iterate(
    record: SavedRecord,
    input: SavedReviewCreate,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    const saved = record.saved;
    const own = saved.targets.filter((target) => !target.commentReviewId);
    const iterations = saved.iterations ?? [
      {
        number: 1,
        createdAt: saved.createdAt,
        targetIds: own.map((target) => target.id),
        ...(saved.guide ? { guide: saved.guide } : {}),
      },
    ];
    if (iterations.length >= MAX_ITERATIONS)
      throw new HostError(
        "saved-review-limit",
        `A review can have at most ${MAX_ITERATIONS} iterations. Use a new key.`,
        413,
      );
    const targetIds: string[] = [];
    for (const requested of input.targets) {
      const result = await capture(requested);
      targetIds.push(this.appendCapture(record, result, undefined, false).id);
    }
    const now = new Date().toISOString();
    const guide = input.guide ? savedGuide(input.guide, now) : undefined;
    iterations.push({
      number: (iterations.at(-1)?.number ?? 0) + 1,
      createdAt: now,
      targetIds,
      ...(guide ? { guide } : {}),
    });
    saved.iterations = iterations;
    saved.title = input.title.trim();
    if (guide) saved.guide = guide;
    if (input.pullRequestUrl) linkPullRequest(saved, input.pullRequestUrl, input.pullRequestTitle);
    if (input.session) saved.session = input.session;
    this.fit(record);
    await this.write(record, beforeCommit);
    return this.describe(record);
  }

  /** Keeps a record under its size and target limits by dropping the oldest
   * earlier comparisons that have no comments. Their briefs stay. */
  private fit(record: SavedRecord) {
    const latest = new Set(record.saved.iterations?.at(-1)?.targetIds);
    const fits = () =>
      record.captures.length <= 128 &&
      Buffer.byteLength(JSON.stringify(record)) <= MAX_RECORD_BYTES;
    for (const capture of [...record.captures]) {
      if (fits()) return;
      const target = record.saved.targets.find((item) => item.id === capture.targetId);
      if (!target || latest.has(target.id) || target.commentReviewId || capture.notes.notes.length)
        continue;
      record.captures.splice(record.captures.indexOf(capture), 1);
      record.saved.targets.splice(record.saved.targets.indexOf(target), 1);
      for (const iteration of record.saved.iterations ?? [])
        iteration.targetIds = iteration.targetIds.filter((id) => id !== target.id);
    }
    if (!fits())
      throw new HostError(
        "saved-review-limit",
        "This review exceeds the 64 MiB snapshot limit. Use a new key.",
        413,
      );
  }

  /** Keys map to review IDs in a small index beside the records. */
  private keysFile() {
    return join(this.directory, ".keys.json");
  }
  private async readKeys(): Promise<Record<string, string>> {
    try {
      const parsed = z
        .record(z.string(), z.string().regex(REVIEW_ID))
        .safeParse(JSON.parse(await readFile(this.keysFile(), "utf8")));
      return parsed.success ? parsed.data : {};
    } catch {
      return {};
    }
  }
  private async setKey(key: string, id: string) {
    const keys = await this.readKeys();
    keys[key] = id;
    await this.writeKeys(keys);
  }
  private async writeKeys(keys: Record<string, string>) {
    const temporary = join(this.directory, `.keys-${randomUUID()}.tmp`);
    try {
      await writeFile(temporary, JSON.stringify(keys), { mode: 0o600, flag: "wx" });
      await rename(temporary, this.keysFile());
    } finally {
      await unlink(temporary).catch(() => undefined);
    }
  }
  private async findKey(key: string, fresh = false): Promise<SavedRecord | undefined> {
    const id = (await this.readKeys())[key];
    if (!id) return undefined;
    try {
      const record = await this.read(id, fresh);
      return record.saved.key === key ? record : undefined;
    } catch (error) {
      if (error instanceof HostError && error.code === "saved-review-not-found") return undefined;
      throw error;
    }
  }

  /** The review that an agent created with this key. */
  byKey(key: string): Promise<SavedReview> {
    return this.serial(async () => {
      const record = await this.findKey(key);
      if (!record) throw new HostError("saved-review-not-found", "No review has this key.", 404);
      return this.describe(record);
    });
  }

  /** Changes the title or the pull request link, such as once a PR is open, or
   * the thread's checkout and the base of its Changes. */
  details(id: string, input: unknown, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      const parsed = savedReviewDetailsSchema.safeParse(input);
      if (!parsed.success)
        throw new HostError("invalid-saved-review", parsed.error.issues[0]!.message);
      const record = await this.read(id, true);
      if (parsed.data.title) record.saved.title = parsed.data.title;
      if (parsed.data.pullRequestUrl === null) {
        delete record.saved.pullRequestUrl;
        delete record.saved.pullRequestTitle;
      } else if (parsed.data.pullRequestUrl)
        linkPullRequest(record.saved, parsed.data.pullRequestUrl, parsed.data.pullRequestTitle);
      if (parsed.data.session) record.saved.session = parsed.data.session;
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  private describe(record: SavedRecord): SavedReview {
    // Browsed commits are retained for comments, not added to the review scope.
    // With iterations, the totals are the current iteration's.
    const current = record.saved.iterations?.at(-1)?.targetIds;
    const targets = new Set(
      record.saved.targets
        .filter((target) => !target.commentReviewId && (!current || current.includes(target.id)))
        .map((target) => target.id),
    );
    const totals = { additions: 0, deletions: 0, files: 0, comparisons: targets.size };
    for (const capture of record.captures) {
      if (!targets.has(capture.targetId)) continue;
      totals.files += capture.review.files.length;
      for (const file of capture.review.files) {
        totals.additions += file.additions;
        totals.deletions += file.deletions;
      }
    }
    return { ...record.saved, totals };
  }

  get(id: string): Promise<SavedReview> {
    return this.serial(async () => this.describe(await this.read(id)));
  }

  /** Record that the reader read a version: they opened it.
   * "Since" then starts from it, as from an approved version. */
  markRead(id: string, version: number, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const versions = record.saved.iterations?.map((entry) => entry.number) ?? [1];
      if (!versions.includes(version))
        throw new HostError("version-not-found", `This review has no version ${version}.`, 404);
      const read = record.saved.readVersions ?? [];
      if (!read.includes(version)) {
        record.saved.readVersions = [...read, version].sort((a, b) => a - b);
        await this.write(record, beforeCommit);
      }
      return this.describe(record);
    }, beforeCommit);
  }

  /** The versions with captures, and the earlier version that the reader
   * last reviewed before `version`. */
  private reviewed(record: SavedRecord, version?: number) {
    const versions = (record.saved.iterations ?? []).filter((entry) => entry.targetIds.length);
    const to = version ? versions.find((entry) => entry.number === version) : versions.at(-1);
    if (!to) return undefined;
    const earlier = versions.filter((entry) => entry.number < to.number);
    if (!earlier.length) return undefined;
    const capture = (targetId: string) =>
      record.captures.find((entry) => entry.targetId === targetId);
    const read = new Set(record.saved.readVersions ?? []);
    const commented = (entry: (typeof versions)[number]) =>
      entry.targetIds.some((target) => (capture(target)?.notes.notes.length ?? 0) > 0);
    const reviewed = earlier.findLast((entry) => commented(entry) || read.has(entry.number));
    const from = reviewed ?? earlier.at(-1)!;
    const basis: Since["basis"] = !reviewed ? "previous" : commented(from) ? "commented" : "viewed";
    return { versions, to, from, basis };
  }

  /** A target's counterpart in another version: the same repository. */
  private counterpart(record: SavedRecord, version: SavedIteration, target: SavedTarget) {
    const candidates = version.targetIds
      .map((id) => record.saved.targets.find((entry) => entry.id === id))
      .filter(
        (entry): entry is SavedTarget =>
          !!entry && !entry.commentReviewId && entry.repositoryId === target.repositoryId,
      );
    return candidates.find((entry) => entry.repo === target.repo) ?? candidates[0];
  }

  /**
   * What a target holds that its counterpart in an earlier version did not,
   * by the captured text, never by Git ancestry, so a rebase or a force push
   * does not matter. A file whose base also moved compares with the earlier
   * change replayed on the new base: a file that changed only with its base
   * is left out, in `moved`. Kept for a few calls: captures do not change.
   */
  private delta(record: SavedRecord, target: SavedTarget, earlier?: SavedTarget) {
    const key = `${record.saved.id}\0${target.id}\0${earlier?.id ?? ""}`;
    const kept = this.deltas.get(key);
    if (kept) return Promise.resolve(kept);
    let job = this.deltaJobs.get(key);
    if (!job) {
      job = this.computeDelta(record, target, earlier)
        .then((delta) => {
          // The texts are most of its size.
          this.deltas.set(key, delta, Buffer.byteLength(JSON.stringify(delta)));
          return delta;
        })
        .finally(() => this.deltaJobs.delete(key));
      this.deltaJobs.set(key, job);
    }
    return job;
  }

  private async computeDelta(
    record: SavedRecord,
    target: SavedTarget,
    earlier?: SavedTarget,
  ): Promise<Delta> {
    const now = this.target(record, target.id);
    const before =
      earlier && earlier.id !== target.id ? this.target(record, earlier.id) : undefined;
    const delta: Delta = { files: [], gone: [], moved: [], mixed: [], commits: [] };
    if (earlier?.id === target.id) return delta;
    const sections = patchSections(now.review.patch);
    const oldFiles = new Map(before?.review.files.map((file) => [file.path, file]));
    const matched = new Set<string>();
    for (const file of now.review.files) {
      const path = oldFiles.has(file.path)
        ? file.path
        : file.previousPath && oldFiles.has(file.previousPath)
          ? file.previousPath
          : undefined;
      const source = now.sources.find((entry) => entry.path === file.path);
      const whole = {
        file,
        change: "new" as const,
        section: sections.get(file.path) ?? "",
        source,
      };
      if (!before || !path) {
        delta.files.push(whole);
        continue;
      }
      matched.add(path);
      const old = before.sources.find((entry) => entry.path === path);
      if (!source || !old || file.status === "D") {
        // No text to compare: the whole change shows, when it is not the same.
        if (sideKey(before, path) !== sideKey(now, file.path))
          delta.files.push({ ...whole, change: "changed" });
        continue;
      }
      if (old.new === source.new) continue;
      let from = old.new;
      if (old.old !== source.old) {
        const replayed = await replay(old.new, old.old, source.old);
        if (replayed === undefined) delta.mixed.push(file.path);
        else if (replayed === source.new) {
          delta.moved.push(file.path);
          continue;
        } else from = replayed;
      }
      const blob = /^index [0-9a-f]+\.\.([0-9a-f]+)/m.exec(whole.section)?.[1];
      let section = await textPatch(file.path, from, source.new);
      if (blob) section = section.replace(/^(index [0-9a-f]+\.\.)[0-9a-f]+/m, `$1${blob}`);
      let additions = 0;
      let deletions = 0;
      for (const line of section.split("\n").slice(4)) {
        if (line.startsWith("+")) additions++;
        else if (line.startsWith("-")) deletions++;
      }
      delta.files.push({
        file: { ...file, previousPath: undefined, status: "M", additions, deletions },
        change: "changed",
        section,
        source: { ...source, old: from },
      });
    }
    for (const file of before?.review.files ?? [])
      if (!matched.has(file.path)) delta.gone.push(file.path);
    // A rebase gives a commit a new ID; its author time and subject stay.
    const known = new Set(
      (earlier?.commits ?? []).flatMap((commit) => [
        commit.id,
        `${commit.timestamp}\0${commit.author}\0${commit.subject}`,
      ]),
    );
    delta.commits = (target.commits ?? [])
      .filter(
        (commit) =>
          !known.has(commit.id) &&
          !known.has(`${commit.timestamp}\0${commit.author}\0${commit.subject}`),
      )
      .map((commit) => commit.id);
    return delta;
  }

  /**
   * The files of a version that changed since the reader's last review: the
   * last earlier version that they approved, commented on, or opened, or else
   * the one before. Undefined before version 2.
   */
  async since(id: string, version?: number): Promise<Since | undefined> {
    const record = await this.serial(() => this.read(id));
    const found = this.reviewed(record, version);
    if (!found) return undefined;
    const { to, from, basis } = found;
    const targets = (version: SavedIteration) =>
      version.targetIds
        .map((targetId) => record.saved.targets.find((entry) => entry.id === targetId))
        .filter((entry): entry is SavedTarget => !!entry && !entry.commentReviewId);
    const pairs = targets(to).map((target) => ({
      target,
      earlier: this.counterpart(record, from, target),
    }));
    // A part or a repository that the later version no longer has: all of its files went.
    const kept = new Set(pairs.map((pair) => pair.earlier?.id));
    const dropped = targets(from).filter((entry) => !kept.has(entry.id));
    const repos = new Set([...targets(to), ...targets(from)].map((entry) => entry.repo));
    const files: Since["files"] = [];
    const moved: string[] = [];
    const commits: string[] = [];
    const place = (target: SavedTarget) => ({
      target: target.id,
      ...(repos.size > 1 && { repo: target.repo }),
    });
    for (const { target, earlier } of pairs) {
      const delta = await this.delta(record, target, earlier);
      for (const entry of delta.files)
        files.push({ path: entry.file.path, change: entry.change, ...place(target) });
      for (const path of delta.gone) files.push({ path, change: "gone", ...place(target) });
      moved.push(...delta.moved);
      commits.push(...delta.commits);
    }
    for (const target of dropped)
      for (const file of this.target(record, target.id).review.files)
        files.push({ path: file.path, change: "gone", ...place(target) });
    files.sort(
      (a, b) => (a.repo ?? "").localeCompare(b.repo ?? "") || a.path.localeCompare(b.path),
    );
    return {
      from: from.number,
      to: to.number,
      basis,
      files,
      ...(moved.length && { moved }),
      ...(commits.length && { commits }),
    };
  }

  /**
   * A target as only what changed since version `from`: each file's diff
   * from that version's text to this one's. Its new side is the target's, so
   * comments on new lines keep their lines.
   */
  async sinceView(
    id: string,
    targetId: string,
    from: number,
  ): Promise<{ review: ReviewResponse; sources: SourceResponse[] }> {
    const record = await this.serial(() => this.read(id));
    const target = record.saved.targets.find(
      (entry) => entry.id === targetId && !entry.commentReviewId,
    );
    const version = record.saved.iterations?.find((entry) => entry.number === from);
    if (!target || !version)
      throw new HostError("version-not-found", `This review has no version ${from}.`, 404);
    const delta = await this.delta(record, target, this.counterpart(record, version, target));
    const capture = this.target(record, targetId);
    const reviewId = `${capture.review.id}:since:${from}`;
    return {
      review: {
        ...capture.review,
        id: reviewId,
        label: `Since version ${from}`,
        files: delta.files.map((entry) => entry.file),
        patch: delta.files.map((entry) => entry.section).join(""),
        warnings: delta.mixed.length
          ? [
              `The base changed in ${delta.mixed.join(", ")} too, and Med could not take its changes out, so the diff can show them.`,
            ]
          : [],
      },
      sources: delta.files.flatMap((entry) =>
        entry.source ? [{ ...entry.source, reviewId, path: entry.file.path }] : [],
      ),
    };
  }

  /**
   * A commit of a target's range, as the Review shows it: the commit's own
   * comments, and the target's comments on the lines that the commit shows,
   * which Git's diff between the two texts places. `place` maps a line of
   * the target to the commit, or back with `reverse`.
   */
  private async lens(record: SavedRecord, targetId: string, view: CommitLens) {
    if (!record.saved.targets.some((entry) => entry.id === targetId && !entry.commentReviewId))
      throw new HostError(
        "saved-target-not-found",
        "This target does not belong to the review.",
        404,
      );
    const capture = this.target(record, targetId);
    const own = record.saved.targets.find((entry) => entry.commentReviewId === view.reviewId);
    const ownCapture = own ? this.target(record, own.id) : undefined;
    const maps = new Map<string, Promise<LineChange[] | null>>();
    const changes = (path: string, side: "old" | "new") => {
      const key = `${side}\0${path}`;
      let found = maps.get(key);
      if (!found) {
        found = (async () => {
          const ours = capture.sources.find((entry) => entry.path === path);
          const theirs = view.files.some((file) => file.path === path)
            ? await view.source(path)
            : undefined;
          return ours && theirs ? lineChanges(ours[side], theirs[side]) : null;
        })();
        maps.set(key, found);
      }
      return found;
    };
    const place = async (
      note: { path: string; side: "old" | "new"; line: number; endLine?: number },
      reverse = false,
    ) => {
      const list = await changes(note.path, note.side);
      if (!list) return null;
      const line = mapLine(list, note.line, reverse);
      const end = mapLine(list, note.endLine ?? note.line, reverse);
      return line !== null && end !== null && end >= line
        ? { line, ...(note.endLine ? { endLine: end } : {}) }
        : null;
    };
    return { capture, ownCapture, place };
  }

  private async lensState(record: SavedRecord, targetId: string, view: CommitLens) {
    const { capture, ownCapture, place } = await this.lens(record, targetId, view);
    const placed: Note[] = [];
    let hidden = 0;
    for (const note of capture.notes.notes) {
      const spot = await place(note);
      if (spot && view.shown(note.path, note.side, spot.line, spot.endLine ?? spot.line))
        placed.push({ ...note, ...spot });
      else if (!note.parentId) hidden++;
    }
    const shown = new Set(placed.map((note) => note.id));
    return {
      reviewId: view.reviewId,
      // Each part only grows, so their sum tells any change.
      revision: (ownCapture?.notes.revision ?? 0) + capture.notes.revision,
      notes: [
        ...(ownCapture?.notes.notes ?? []),
        ...placed.filter((note) => !note.parentId || shown.has(note.parentId)),
      ],
      ...(hidden && { hidden }),
    };
  }

  /** The comments that a commit of a target's range shows. */
  async lensNotes(id: string, targetId: string, view: CommitLens): Promise<NoteState> {
    return this.lensState(await this.serial(() => this.read(id)), targetId, view);
  }

  /**
   * A change to a comment in a commit of a target's range. A new comment on a
   * line that the target still has goes to the target, so the whole range
   * shows it too; one on a line that a later commit changed stays with the
   * commit, as before.
   */
  async lensMutate(
    id: string,
    targetId: string,
    view: CommitLens,
    expectedRevision: number,
    input: NoteMutation,
    beforeCommit?: () => void,
    commentCapture?: () => Promise<CapturedReviewTarget>,
  ): Promise<NoteState> {
    const record = await this.serial(() => this.read(id, true));
    const { capture, ownCapture, place } = await this.lens(record, targetId, view);
    const ownRevision = ownCapture?.notes.revision ?? 0;
    if (ownRevision + capture.notes.revision !== expectedRevision)
      throw new HostError("stale-notes", "The notes changed. Refresh before retrying.", 409);
    const mutation = noteMutationSchema.parse(input);
    const onTarget = (noteId?: string) =>
      !!noteId && capture.notes.notes.some((note) => note.id === noteId);
    const spot = mutation.type === "add" ? await place(mutation.note, true) : null;
    if (
      mutation.type === "add" &&
      spot &&
      (!mutation.note.parentId || onTarget(mutation.note.parentId))
    )
      await this.mutate(
        id,
        targetId,
        capture.notes.revision,
        { type: "add", note: { ...mutation.note, ...spot } },
        beforeCommit,
      );
    else if (mutation.type !== "add" && onTarget(mutation.id))
      await this.mutate(id, targetId, capture.notes.revision, mutation, beforeCommit);
    else await this.mutate(id, view.reviewId, ownRevision, mutation, beforeCommit, commentCapture);
    return this.lensState(await this.serial(() => this.read(id, true)), targetId, view);
  }

  /** Lines of a target, such as the guide's comments, on a commit of its range. */
  async lensPlace(
    id: string,
    targetId: string,
    view: CommitLens,
    lines: readonly { path: string; side: "old" | "new"; line: number; endLine?: number }[],
  ) {
    const { place } = await this.lens(await this.serial(() => this.read(id)), targetId, view);
    return Promise.all(
      lines.map(async (line) => {
        const spot = await place(line);
        return spot && view.shown(line.path, line.side, spot.line, spot.endLine ?? spot.line)
          ? spot
          : null;
      }),
    );
  }

  /** A review's description, read again only when its file changes, with
   * the time of that change. */
  async summary(id: string): Promise<SavedReview & { modifiedAt: number }> {
    const info = await stat(this.file(id)).catch(() => {
      throw new HostError("saved-review-not-found", "This saved review does not exist.", 404);
    });
    const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
    let known = this.described.get(id);
    if (known?.identity !== identity) {
      known = { identity, review: await this.get(id) };
      this.described.set(id, known);
    }
    return { ...known.review, modifiedAt: info.mtimeMs };
  }

  /** Every review's description, for a caller that holds the lock. */
  private async listUnlocked() {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    const reviews: (SavedReview & { modifiedAt: number })[] = [];
    for (const name of names) {
      const id = /^(r_[a-f0-9]{24})\.json$/.exec(name)?.[1];
      if (!id) continue;
      const info = await stat(this.file(id)).catch(() => undefined);
      if (!info) continue;
      const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
      let known = this.described.get(id);
      if (known?.identity !== identity) {
        const review = await this.read(id).then(
          (record) => this.describe(record),
          () => undefined,
        );
        if (!review) continue;
        known = { identity, review };
        this.described.set(id, known);
      }
      reviews.push({ ...known.review, modifiedAt: info.mtimeMs });
    }
    return reviews;
  }

  /**
   * The reviews with a comment whose ID starts with `prefix`, newest first:
   * `med reply` finds the review by the comment's short ID.
   */
  async reviewsWithComment(prefix: string): Promise<string[]> {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    const found: { id: string; at: number }[] = [];
    for (const name of names) {
      const id = /^(r_[a-f0-9]{24})\.json$/.exec(name)?.[1];
      if (!id) continue;
      const info = await stat(this.file(id)).catch(() => undefined);
      if (!info) continue;
      const identity = `${info.dev}:${info.ino}:${info.size}:${info.mtimeMs}`;
      let known = this.commentIds.get(id);
      if (known?.identity !== identity) {
        const ids = await this.read(id).then(
          (record) => [
            ...record.captures.flatMap((target) => target.notes.notes.map((note) => note.id)),
          ],
          () => undefined,
        );
        if (!ids) continue;
        known = { identity, ids };
        this.commentIds.set(id, known);
      }
      if (known.ids.some((noteId) => noteId.startsWith(prefix)))
        found.push({ id, at: info.mtimeMs });
    }
    return found.sort((a, b) => b.at - a.at).map((entry) => entry.id);
  }

  /** Every saved review's description. A review that cannot be read is left out. */
  async list(): Promise<(SavedReview & { modifiedAt: number })[]> {
    const names = await readdir(this.directory).catch(() => [] as string[]);
    const ids = names.flatMap((name) => /^(r_[a-f0-9]{24})\.json$/.exec(name)?.[1] ?? []);
    for (const id of this.described.keys()) if (!ids.includes(id)) this.described.delete(id);
    const reviews = [];
    for (const id of ids) {
      const review = await this.summary(id).catch(() => undefined);
      if (review) reviews.push(review);
    }
    return reviews;
  }
  review(id: string, targetId: string): Promise<ReviewResponse> {
    return this.serial(async () => this.target(await this.read(id), targetId).review);
  }
  notes(id: string, targetId: string): Promise<NoteState> {
    return this.serial(async () => this.target(await this.read(id), targetId).notes);
  }
  image(id: string, targetId: string, path: string, side: "old" | "new") {
    return this.serial(async () => {
      const record = await this.read(id);
      const target = record.saved.targets.find((item) => item.id === targetId);
      const image = this.target(record, targetId).images.find(
        (item) => item.path === path && item.side === side,
      );
      if (!image)
        throw new HostError(
          "image-unavailable",
          "This image was not captured in this saved review.",
          404,
        );
      return {
        repositoryId: target!.repositoryId,
        mime: image.mime,
        bytes: Buffer.from(image.data, "base64"),
      };
    });
  }
  source(id: string, targetId: string, path: string): Promise<SourceResponse> {
    return this.serial(async () => {
      const source = this.target(await this.read(id), targetId).sources.find(
        (item) => item.path === path,
      );
      if (!source)
        throw new HostError(
          "saved-source-unavailable",
          "Full text was not captured for this file. The saved patch remains available.",
          422,
        );
      return source;
    });
  }

  mutate(
    id: string,
    targetId: string,
    expectedRevision: number,
    input: NoteMutation,
    beforeCommit?: () => void,
    commentCapture?: () => Promise<CapturedReviewTarget>,
  ): Promise<NoteState> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      if (commentCapture) {
        let attached = record.saved.targets.find((item) => item.commentReviewId === targetId);
        if (!attached) {
          if (expectedRevision !== 0 || input.type !== "add")
            throw new HostError(
              "stale-notes",
              "Refresh this comparison before changing comments.",
              409,
            );
          if (record.saved.targets.length >= 128)
            throw new HostError(
              "saved-review-limit",
              "A review can contain at most 128 commented comparisons.",
              413,
            );
          const result = await commentCapture();
          if (result.review.id !== targetId)
            throw new HostError("invalid-capture", "The comment comparison changed.", 409);
          attached = this.appendCapture(record, result, targetId);
        }
        targetId = attached.id;
      }
      const target = this.target(record, targetId);
      if (target.notes.revision !== expectedRevision)
        throw new HostError("stale-notes", "The notes changed. Refresh before retrying.", 409);
      const notes = target.notes.notes;
      try {
        const mutation = noteMutationSchema.parse(input);
        if (mutation.type === "add") {
          if (record.saved.commentCount >= MAX_NOTES)
            throw new HostError(
              "too-many-notes",
              "A saved review can contain at most 500 notes.",
              413,
            );
          const source = target.sources.find((item) => item.path === mutation.note.path);
          const file = target.review.files.find((item) => item.path === mutation.note.path);
          if (!source || file?.binary || file?.tooLarge)
            throw new HostError(
              "saved-source-unavailable",
              "Comments require captured text for this file.",
              422,
            );
          validateReviewNoteInput(mutation.note, source, notes);
          const now = new Date().toISOString();
          notes.push({
            ...mutation.note,
            id: randomUUID(),
            createdAt: now,
            updatedAt: now,
            resolution: "active",
          });
        } else if (mutation.type === "edit") {
          validateReviewNoteText(mutation.text);
          const note = notes.find((item) => item.id === mutation.id);
          if (!note) throw new HostError("note-not-found", "The note does not exist.", 404);
          note.text = mutation.text;
          note.updatedAt = new Date().toISOString();
        } else {
          removeReviewNote(mutation.id, notes);
        }
      } catch (error) {
        if (error instanceof HostError) throw error;
        throw new HostError(
          "invalid-note",
          error instanceof Error ? error.message : "The note is not valid.",
        );
      }
      target.notes.revision++;
      record.saved.revision++;
      record.saved.commentCount = countComments(record);
      await this.write(record, beforeCommit);
      return target.notes;
    }, beforeCommit);
  }

  /** Removes a record file and what remembers it. The caller holds the lock. */
  private async remove(id: string) {
    await unlink(this.file(id)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
    this.cache.delete(id);
    this.described.delete(id);
    this.touched();
    const keys = await this.readKeys();
    const left = Object.entries(keys).filter(([, value]) => value !== id);
    if (left.length !== Object.keys(keys).length) await this.writeKeys(Object.fromEntries(left));
  }

  /** Deletes a review with its captures, comments, and key. */
  delete(id: string, beforeCommit?: () => void): Promise<void> {
    return this.writing(async () => {
      this.file(id);
      await this.remove(id);
    }, beforeCommit);
  }

  /** Replace or remove the current iteration's guide. */
  setGuide(id: string, guide: unknown, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      let next: ReturnType<typeof savedGuide> | undefined;
      if (guide !== null) {
        const parsed = reviewGuideSchema.safeParse(guide);
        if (!parsed.success) throw new HostError("invalid-guide", guideError(parsed.error), 400);
        next = savedGuide(parsed.data);
      }
      const owner = record.saved.iterations?.at(-1);
      for (const holder of owner ? [record.saved, owner] : [record.saved]) {
        if (next) holder.guide = next;
        else delete holder.guide;
      }
      // Without its own guide, the review shows the latest guide an iteration still has.
      if (!next && owner) {
        const latest = record.saved.iterations!.findLast((entry) => entry.guide)?.guide;
        if (latest) record.saved.guide = latest;
      }
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  clear(id: string, expectedRevision: number, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      if (record.saved.revision !== expectedRevision)
        throw new HostError(
          "stale-notes",
          "The review changed. Refresh before clearing comments.",
          409,
        );
      for (const target of record.captures) {
        target.notes.notes = [];
        target.notes.revision++;
      }
      record.saved.commentCount = 0;
      record.saved.revision++;
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /**
   * Deletes the named comments with their replies, from the message box of
   * the review's session; an ID that the review lacks is skipped. Returns how
   * many went.
   */
  removeComments(id: string, ids: ReadonlySet<string>, beforeCommit?: () => void) {
    return this.writing(async () => {
      const record = await this.read(id, true);
      let removed = 0;
      for (const target of record.captures) {
        const notes = target.notes.notes;
        const named = notes.filter((note) => !note.parentId && ids.has(note.id));
        if (!named.length) continue;
        for (const note of named) removeReviewNote(note.id, notes);
        removed += named.length;
        target.notes.revision++;
      }
      if (!removed) return 0;
      record.saved.revision++;
      record.saved.commentCount = countComments(record);
      await this.write(record, beforeCommit);
      return removed;
    }, beforeCommit);
  }

  /** Top-level comments across the review's targets, for the agent's drafts. */
  comments(id: string): Promise<(Note & { replies: number; said: LastSaid })[]> {
    return this.serial(async () => {
      const record = await this.read(id);
      return record.captures.flatMap((target) =>
        target.notes.notes
          .filter((note) => !note.parentId)
          .map((note) => {
            const replies = target.notes.notes.filter((item) => item.parentId === note.id);
            return {
              ...note,
              updatedAt: threadVersion(target.notes.notes, note),
              replies: replies.filter((item) => !item.author).length,
              said: lastSaid(note, replies),
            };
          }),
      );
    });
  }

  /**
   * An agent's answer to a comment on a line, under it in the comment's
   * thread (`med review reply`). A reply's ID answers its thread.
   */
  reply(
    id: string,
    commentId: string,
    text: string,
    author: NoteAuthor,
    beforeCommit?: () => void,
    options: { resolve?: boolean } = {},
  ): Promise<Note> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const wanted = commentId.toLowerCase();
      const named = (other: string) =>
        other === wanted || (wanted.length >= 6 && other.startsWith(wanted));
      const matches = record.captures.flatMap((target) =>
        target.notes.notes.filter((note) => named(note.id)).map((note) => ({ target, note })),
      );
      const found =
        matches.find((match) => match.note.id === wanted) ??
        (matches.length === 1 ? matches[0] : undefined);
      if (options.resolve)
        throw new HostError(
          "resolve-unsupported",
          "Only a comment on a file can be resolved. A comment on the review is done when you hand off the next version.",
          409,
        );
      if (matches.length > 1 && !found)
        throw new HostError(
          "comment-ambiguous",
          "More than one comment of this review has an ID that starts so. Give more of the ID.",
          409,
        );
      if (!found)
        throw new HostError("note-not-found", "This review has no comment with that ID.", 404);
      if (record.saved.commentCount >= MAX_NOTES)
        throw new HostError("too-many-notes", "A saved review can contain at most 500 notes.", 413);
      const parent = found.note.parentId
        ? found.target.notes.notes.find((note) => note.id === found.note.parentId)!
        : found.note;
      validateReviewNoteText(text);
      const now = new Date().toISOString();
      const note: Note = {
        path: parent.path,
        side: parent.side,
        line: parent.line,
        ...(parent.endLine ? { endLine: parent.endLine } : {}),
        text,
        parentId: parent.id,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
        resolution: parent.resolution ?? "active",
        author,
      };
      found.target.notes.notes.push(note);
      found.target.notes.revision++;
      record.saved.revision++;
      record.saved.commentCount = countComments(record);
      await this.write(record, beforeCommit);
      return note;
    }, beforeCommit);
  }

  /** The comments as text for an agent; `include` limits it to those threads. */
  feedback(
    id: string,
    include?: ReadonlySet<string>,
    { help = true }: { help?: boolean } = {},
  ): Promise<{
    text: string;
    count: number;
    repositoryCount: number;
    revision: number;
    /** A comment's short ID, for how to answer one; the comments' IDs. */
    example?: string;
    ids: string[];
    /** Each thread in the text, by ID: its version (as `comments` gives its
     * `updatedAt`) and the comment as the text has it. */
    threads: Map<string, { version: string; comment: SentComment }>;
  }> {
    return this.serial(async () => {
      const record = await this.read(id);
      const threadsOut = new Map<string, { version: string; comment: SentComment }>();
      const output: string[] = [];
      let outputBytes = 0;
      const checkBytes = (bytes: number) => {
        if (bytes > MAX_FEEDBACK_BYTES)
          throw new HostError(
            "saved-feedback-too-large",
            "Comment export exceeds the 8 MiB export limit. Narrow selected line ranges or remove some comments, then copy again. No comments were copied or truncated.",
            413,
          );
      };
      const appendText = (...parts: string[]) => {
        for (const part of parts) {
          outputBytes += Buffer.byteLength(part) + (output.length ? 1 : 0);
          checkBytes(outputBytes);
          output.push(part);
        }
      };
      appendText(`# Comments on the review "${record.saved.title}"`, "");
      // Each thread goes by the shortest start of its ID, from 6 characters,
      // that no other comment of the review shares (`med reply` takes it).
      const ids = record.captures.flatMap((target) => target.notes.notes.map((note) => note.id));
      const several = new Set(record.saved.targets.map((target) => target.repo)).size > 1;
      const repositories = new Set<string>();
      let index = 0;
      let example: string | undefined;
      for (const target of record.captures) {
        const threads = target.notes.notes.filter(
          (note) => !note.parentId && (!include || include.has(note.id)),
        );
        if (!threads.length) continue;
        const info = record.saved.targets.find((item) => item.id === target.targetId)!;
        repositories.add(info.repositoryId);
        let parsed: FileDiffMetadata[] = [];
        try {
          parsed = parsePatchFiles(target.review.patch, { throwOnError: true })
            .flatMap((patch) => patch.files)
            .map(normalizeDiffMetadataPaths);
        } catch {
          // A captured source excerpt remains usable if an older patch cannot be parsed.
        }
        const appendCode = (label: string | null, language: string, lines: Iterable<string>) => {
          const snippet: string[] = [];
          let snippetBytes = 0;
          let longest = 2;
          for (const line of lines) {
            snippetBytes += Buffer.byteLength(line) + (snippet.length ? 1 : 0);
            checkBytes(outputBytes + snippetBytes);
            snippet.push(line);
            for (const match of line.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
          }
          const fence = "`".repeat(longest + 1);
          appendText(...(label ? [label] : []), `${fence}${language}`, snippet.join("\n"), fence);
        };
        const append = (note: Note) => {
          index++;
          const id = shortCommentId(note.id, ids);
          example ??= id;
          const file = target.review.files.find((item) => item.path === note.path)!;
          const path = note.side === "old" ? (file.previousPath ?? note.path) : note.path;
          const end = note.endLine ?? note.line;
          const about = [
            note.side === "old" ? "before the change" : "",
            file.previousPath
              ? note.side === "old"
                ? `renamed to ${file.path}`
                : `renamed from ${file.previousPath}`
              : "",
            several ? `in ${info.repo}` : "",
          ].filter(Boolean);
          appendText(
            `## ${id} · ${path}:${note.line === end ? note.line : `${note.line}-${end}`}${about.length ? ` (${about.join(", ")})` : ""}`,
          );
          if (note.guideComment)
            appendText(
              `In reply to ${note.guideComment.author}'s comment in the guide:`,
              ...note.guideComment.text.split("\n").map((line) => `> ${line}`),
            );
          const diff = parsed.find((item) => item.name === note.path);
          const covered = diff && patchCoversSelection(diff, note);
          if (covered) appendCode(null, "diff", commentDiffExcerpt(diff, note));
          const source = target.sources.find((item) => item.path === note.path);
          if (!covered && source) {
            const lines = source[note.side].split("\n");
            if (lines.at(-1) === "") lines.pop();
            const from = Math.max(1, note.line - 3);
            const to = Math.min(lines.length, end + 3);
            appendCode(
              "The source (the saved diff does not cover these lines):",
              "",
              (function* () {
                for (let position = from; position <= to; position++)
                  yield `${position >= note.line && position <= end ? ">" : " "} ${position} | ${lines[position - 1]!}`;
              })(),
            );
          } else if (!covered) appendText("Med did not capture this file's source.");
          appendText("", note.text, "");
          for (const reply of target.notes.notes.filter((item) => item.parentId === note.id)) {
            // The user's replies count as comments, as the review's count has them.
            if (!reply.author) index++;
            appendText(
              reply.author ? `${agentName(reply.author)} replied:` : "The user replied:",
              reply.text,
              "",
            );
          }
        };
        for (const note of threads) {
          append(note);
          threadsOut.set(note.id, {
            version: threadVersion(target.notes.notes, note),
            comment: {
              path: note.path,
              line: note.line,
              ...(note.endLine ? { endLine: note.endLine } : {}),
              ...lastSaid(
                note,
                target.notes.notes.filter((item) => item.parentId === note.id),
              ),
            },
          });
        }
      }
      if (example && help) appendText(...replyHelp(example));
      if (!index && help) appendText("No comments.");
      return {
        text: output.join("\n"),
        count: index,
        repositoryCount: repositories.size,
        revision: record.saved.revision,
        ...(example && { example }),
        ids,
        threads: threadsOut,
      };
    });
  }
}

/** How the agent answers a comment, for the end of a message with an
 * example ID; `file` names a comment on a file, which `--resolve` closes. */
export function replyHelp(example: string, file?: string) {
  return [
    "Answer a comment in its thread with `med reply <id>`, the answer on standard input:",
    "",
    "```sh",
    `med reply ${example} <<'END'`,
    "<your answer>",
    "END",
    "```",
    "",
    "A comment can be a question or a request. Answer a question there and change nothing for it; do what a request asks, and answer there to say why you left a change out. Your final message still says what you did.",
    ...(file
      ? [
          "",
          `A comment on a file has no next review version to show the change, so add \`--resolve\` when you have done what it asks: \`med reply ${file} --resolve <<'END'\`, then what you did. The user can open it again.`,
        ]
      : []),
  ];
}

/** A comment thread's version: its newest change. A reply changes the thread. */
/** A thread's last change by the user. An agent's reply leaves it sent. */
function threadVersion(notes: readonly Note[], note: Note) {
  return [note, ...notes.filter((item) => item.parentId === note.id && !item.author)]
    .map((item) => item.updatedAt)
    .sort()
    .at(-1)!;
}
