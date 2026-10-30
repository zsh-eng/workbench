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
import { attemptRefSchema } from "../shared/attempts";
import { generatedMarkSchema } from "../shared/generated";
import { normalizeDiffMetadataPaths } from "../shared/hunk/diffPaths";
import {
  comparisonSchema,
  noteInputSchema,
  noteMutationSchema,
  type Note,
  type NoteMutation,
  type NoteState,
  type ReviewResponse,
  type SourceResponse,
} from "../shared/protocol";
import {
  validateReviewNoteInput,
  validateReviewNoteRemoval,
  validateReviewNoteText,
} from "../shared/hunk/noteValidation";
import { HostError } from "./runtime/errors";
import {
  savedReviewCreateSchema,
  pullRequestUrlSchema,
  briefTextSchema,
  savedReviewDetailsSchema,
  agentSessionSchema,
  savedCheckoutSchema,
  MAX_BRIEF_LENGTH,
  MAX_ITERATIONS,
  approvalSchema,
  MAX_PINS,
  MAX_SESSIONS,
  pinSourceSchema,
  briefCommentSchema,
  savedPrDraftSchema,
  type SavedPrDraft,
  endpointNamesSchema,
  partsProblem,
  savedPartsSchema,
  MAX_PARTS,
  type AgentSession,
  type PartInput,
  type PartShape,
  type SavedPart,
  type SavedParts,
  type BriefCommentMutation,
  type PinMutation,
  type SavedReview,
  type Since,
  type SavedReviewCreate,
  type SavedCheckout,
  type CapturedReviewTarget,
  threadCheckout,
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
const PART_ID = /^l_[a-f0-9]{12}$/;
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
  part: z.string().regex(PART_ID).optional(),
});
const briefSchema = z.object({ text: text.max(MAX_BRIEF_LENGTH), updatedAt: text });
const pinsSchema = z
  .array(
    z.object({
      id: z.string().regex(/^p_[a-f0-9]{12}$/),
      text: text.max(MAX_BRIEF_LENGTH),
      createdAt: text,
      source: pinSourceSchema.optional(),
    }),
  )
  .max(MAX_PINS);
const savedSchema = z.object({
  id: z.string().regex(REVIEW_ID),
  key: text.optional(),
  title: text,
  pullRequestUrl: pullRequestUrlSchema.optional(),
  pullRequestTitle: text.optional(),
  brief: briefSchema.optional(),
  guide: savedGuideSchema.optional(),
  pins: pinsSchema.optional(),
  briefComments: z
    .array(briefCommentSchema.extend({ id: z.string().regex(/^c_[a-f0-9]{12}$/) }))
    .max(MAX_NOTES)
    .optional(),
  prDraft: savedPrDraftSchema.optional(),
  sessions: z.array(agentSessionSchema).max(MAX_SESSIONS).optional(),
  iterations: z
    .array(
      z.object({
        number: z.number().int().positive(),
        createdAt: text,
        targetIds: z.array(z.string().regex(TARGET_ID)),
        brief: briefSchema.optional(),
        guide: savedGuideSchema.optional(),
        pins: pinsSchema.optional(),
        fresh: z.boolean().optional(),
        guides: z.record(z.string().regex(PART_ID), savedGuideSchema).optional(),
      }),
    )
    .max(MAX_ITERATIONS)
    .optional(),
  parts: savedPartsSchema
    .extend({
      /** Med named the thread from its parts; it names it again when they change. */
      autoTitle: z.boolean().optional(),
    })
    .optional(),
  approvals: z.array(approvalSchema).max(MAX_ITERATIONS).optional(),
  createdAt: text,
  revision: natural,
  commentCount: natural,
  // A thread that the agent has not handed off yet has no target.
  targets: z.array(targetSchema).max(128),
  checkout: savedCheckoutSchema.optional(),
  archivedAt: text.optional(),
  group: attemptRefSchema.optional(),
});
const recordSchema = z.object({
  version: z.literal(1),
  saved: savedSchema,
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

/** A guide as the record keeps it: comment sides and kinds filled in. */
function savedGuide(guide: ReviewGuide, updatedAt = new Date().toISOString()) {
  return savedGuideSchema.parse({ ...guide, updatedAt });
}

/** Comments on the captured comparisons and on the Notes. */
const countComments = (record: SavedRecord) =>
  record.captures.reduce((sum, capture) => sum + capture.notes.notes.length, 0) +
  (record.saved.briefComments?.length ?? 0);

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

/** Adds sessions that the review does not have yet; the newest are kept. */
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

function addSessions(saved: { sessions?: AgentSession[] }, sessions: AgentSession[] = []) {
  const all = [...(saved.sessions ?? [])];
  for (const session of sessions) {
    const index = all.findIndex(
      (entry) => entry.agent === session.agent && entry.id === session.id,
    );
    if (index >= 0) all.splice(index, 1);
    all.push(session);
  }
  if (all.length) saved.sessions = all.slice(-MAX_SESSIONS);
}

/** A single hand-off's details as a part's. */
const partOf = (input: SavedReviewCreate): Partial<PartInput> => ({
  ...(input.pullRequestUrl ? { pullRequestUrl: input.pullRequestUrl } : {}),
  ...(input.pullRequestTitle
    ? { pullRequestTitle: input.pullRequestTitle, title: input.pullRequestTitle }
    : {}),
  ...(input.guide ? { guide: input.guide } : {}),
});

/** The current version's own comparisons in order: a stack's layers, bottom
 * first, or a single review's comparisons. */
function currentLayers(saved: Pick<SavedReview, "targets" | "iterations">) {
  const ids =
    saved.iterations?.at(-1)?.targetIds ??
    saved.targets.filter((target) => !target.commentReviewId).map((target) => target.id);
  return ids.flatMap(
    (id) => saved.targets.find((target) => target.id === id && !target.commentReviewId) ?? [],
  );
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
  /** Counts the writes and deletes of this store, so a reader can tell when
   * its list of reviews is old. */
  changes = 0;
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
      this.changes++;
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

  /** A new review, or a new version of the review with its key. A thread
   * without targets names its `checkout`: it has no Review until the agent
   * hands off one. `joinable` names the open threads that a hand-off of one
   * range can join as a layer (docs/STACKS.md, detection). */
  create(
    input: SavedReviewCreate,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
    checkout?: SavedCheckout,
    joinable?: (id: string) => boolean,
  ): Promise<SavedReview & { joined?: { layer: number; of: number } }> {
    return this.writing(async () => {
      const parsed = savedReviewCreateSchema.safeParse(input);
      if (!parsed.success) throw new HostError("invalid-saved-review", parsed.error.message);
      input = parsed.data;
      const problem = partsProblem(input);
      if (problem) throw new HostError("invalid-saved-review", problem, 400);
      const known = input.key ? await this.findKey(input.key, true) : undefined;
      if (known) {
        if (!input.targets.length)
          throw new HostError("saved-review-empty", "A new version needs a comparison.", 400);
        return this.iterate(known, input, capture, beforeCommit);
      }
      if (!input.targets.length && !checkout)
        throw new HostError("saved-review-empty", "Name the thread's checkout.", 400);
      const results: CapturedReviewTarget[] = [];
      for (const requested of input.targets) results.push(await capture(requested));
      // One range from the agent of an open thread, or a pull request on top
      // of one, is that thread's next layer.
      if (
        joinable &&
        !input.parts &&
        !input.group &&
        results.length === 1 &&
        results[0]!.review.comparison.kind === "range"
      ) {
        const joined = await this.joinChain(input, results[0]!, joinable, beforeCommit);
        if (joined) return joined;
      }
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
          ...(input.brief
            ? { brief: { text: input.brief, updatedAt: new Date().toISOString() } }
            : {}),
          ...(input.guide ? { guide: savedGuide(input.guide) } : {}),
          ...(input.group ? { group: input.group } : {}),
          ...(checkout ? { checkout } : {}),
          createdAt: new Date().toISOString(),
          revision: 0,
          commentCount: 0,
          targets: [],
        },
        captures: [],
      };
      for (const result of results) this.appendCapture(record, result);
      addSessions(record.saved, input.sessions);
      if (input.key) record.saved.key = input.key;
      // The first hand-off is version 1. A stack or a set always has
      // versions, which keep each part's guide.
      if ((input.key || input.parts) && record.saved.targets.length) {
        record.saved.iterations = [
          {
            number: 1,
            createdAt: record.saved.createdAt,
            targetIds: record.saved.targets.map((target) => target.id),
            ...(record.saved.brief ? { brief: record.saved.brief } : {}),
            ...(record.saved.guide ? { guide: record.saved.guide } : {}),
          },
        ];
      }
      if (input.parts) {
        const iteration = record.saved.iterations![0]!;
        record.saved.parts = {
          shape: input.parts.shape,
          items: input.parts.items.map((item, index) =>
            this.placePart(record, iteration, record.saved.targets[index]!.id, item),
          ),
        };
      }
      await this.write(record, beforeCommit);
      if (input.key) await this.setKey(input.key, id);
      for (const part of record.saved.parts?.items ?? []) await this.setKey(part.key, id);
      return this.describe(record);
    }, beforeCommit);
  }

  /** A new part, or the part with the same key in `known`, for the target
   * `targetId` of `iteration`; its guide goes to the iteration. */
  private placePart(
    record: SavedRecord,
    iteration: NonNullable<SavedRecord["saved"]["iterations"]>[number],
    targetId: string,
    item: PartInput,
    known?: readonly SavedPart[],
  ): SavedPart {
    const before = known?.find((part) => part.key === item.key);
    const target = record.saved.targets.find((entry) => entry.id === targetId)!;
    const { guide, ...details } = item;
    const part: SavedPart = {
      ...before,
      ...details,
      id: before?.id ?? `l_${randomBytes(6).toString("hex")}`,
      title: item.title ?? item.pullRequestTitle ?? before?.title ?? target.label,
    };
    target.part = part.id;
    if (guide) iteration.guides = { ...iteration.guides, [part.id]: savedGuide(guide) };
    return part;
  }

  /** The current version of `record`, made if the record has none yet, as a
   * second hand-off makes it (iterate). */
  private currentIteration(record: SavedRecord) {
    const saved = record.saved;
    if (!saved.iterations?.length) {
      const own = saved.targets.filter((target) => !target.commentReviewId);
      saved.iterations = [
        {
          number: 1,
          createdAt: saved.createdAt,
          targetIds: own.map((target) => target.id),
          ...(saved.brief ? { brief: saved.brief } : {}),
          ...(saved.guide ? { guide: saved.guide } : {}),
          ...(saved.pins ? { pins: saved.pins } : {}),
        },
      ];
      delete saved.pins;
      for (const comment of saved.briefComments ?? [])
        if (comment.section === "brief") comment.iteration = 1;
    }
    return saved.iterations.at(-1)!;
  }

  /** Makes a single review a stack of its one comparison, which keeps its
   * pull request, key, and guide as the first part's. */
  private makeParts(record: SavedRecord) {
    const saved = record.saved;
    const iteration = this.currentIteration(record);
    if (saved.parts) return saved.parts;
    const own = iteration.targetIds.flatMap(
      (id) => saved.targets.find((target) => target.id === id && !target.commentReviewId) ?? [],
    );
    if (own.length !== 1)
      throw new HostError(
        "parts-unsupported",
        "Only a thread with one comparison can become a stack.",
        409,
      );
    const target = own[0]!;
    const part: SavedPart = {
      id: `l_${randomBytes(6).toString("hex")}`,
      key: saved.key ?? saved.pullRequestUrl ?? `review-${target.id}`,
      title: saved.pullRequestTitle ?? saved.title,
      ...(saved.pullRequestUrl ? { pullRequestUrl: saved.pullRequestUrl } : {}),
      ...(saved.pullRequestTitle ? { pullRequestTitle: saved.pullRequestTitle } : {}),
      ...(target.names?.base ? { base: target.names.base } : {}),
      ...(target.names?.head ? { head: target.names.head } : {}),
    };
    target.part = part.id;
    if (iteration.guide) iteration.guides = { [part.id]: iteration.guide };
    delete iteration.guide;
    delete saved.guide;
    // The pull request is the layer's now; the title band shows the shown layer's.
    delete saved.pullRequestUrl;
    delete saved.pullRequestTitle;
    saved.parts = { shape: "stack", items: [part], autoTitle: true };
    return saved.parts;
  }

  /** Med's name for a thread of parts: its bottom part's, and how many. */
  private nameParts(record: SavedRecord) {
    const parts = record.saved.parts;
    if (!parts?.autoTitle || !parts.items.length) return;
    const first = parts.items[0]!.title;
    record.saved.title =
      `${first} · ${parts.items.length} ${parts.shape === "stack" ? "layers" : "parts"}`.slice(
        0,
        200,
      );
  }

  /**
   * Detection (docs/STACKS.md): an open thread whose top layer's head is the
   * new range's base, or whose bottom layer's base is its head, in the same
   * repository, made by the same agent session or also a pull request. The
   * range becomes its layer. The caller holds the lock.
   */
  private async joinChain(
    input: SavedReviewCreate,
    result: CapturedReviewTarget,
    joinable: (id: string) => boolean,
    beforeCommit?: () => void,
  ) {
    const sessions = new Set((input.sessions ?? []).map((entry) => `${entry.agent}:${entry.id}`));
    const candidates: { id: string; at: "top" | "bottom"; time: number }[] = [];
    for (const summary of await this.listUnlocked()) {
      if (!joinable(summary.id) || summary.group) continue;
      const shared = (summary.sessions ?? []).some((entry) =>
        sessions.has(`${entry.agent}:${entry.id}`),
      );
      const pulls =
        !!input.pullRequestUrl &&
        (!!summary.pullRequestUrl || !!summary.parts?.items.some((part) => part.pullRequestUrl));
      if (!shared && !pulls) continue;
      const layers = currentLayers(summary);
      if (!layers.length || (summary.parts && summary.parts.shape !== "stack")) continue;
      if (!summary.parts && layers.length !== 1) continue;
      const top = layers.at(-1)!;
      const bottom = layers[0]!;
      const same = (target: { repositoryId: string; comparison: { kind: string } }) =>
        target.repositoryId === result.repositoryId && target.comparison.kind === "range";
      if (same(top) && top.head === result.review.base)
        candidates.push({ id: summary.id, at: "top", time: summary.modifiedAt });
      else if (same(bottom) && bottom.base === result.review.head)
        candidates.push({ id: summary.id, at: "bottom", time: summary.modifiedAt });
    }
    const chosen = candidates.sort((a, b) => b.time - a.time)[0];
    if (!chosen) return undefined;
    const { at } = chosen;
    const record = await this.read(chosen.id, true);
    const parts = this.makeParts(record);
    const iteration = this.currentIteration(record);
    const target = this.appendCapture(record, result);
    const part = this.placePart(record, iteration, target.id, {
      key: input.key ?? input.pullRequestUrl ?? `review-${target.id}`,
      title: input.pullRequestTitle ?? input.title,
      ...(input.pullRequestUrl ? { pullRequestUrl: input.pullRequestUrl } : {}),
      ...(input.pullRequestTitle ? { pullRequestTitle: input.pullRequestTitle } : {}),
      ...(result.names?.base ? { base: result.names.base } : {}),
      ...(result.names?.head ? { head: result.names.head } : {}),
      ...(input.guide ? { guide: input.guide } : {}),
    });
    if (at === "top") {
      iteration.targetIds.push(target.id);
      parts.items.push(part);
    } else {
      iteration.targetIds.unshift(target.id);
      parts.items.unshift(part);
    }
    if (parts.items.length > MAX_PARTS)
      throw new HostError("saved-review-limit", `A stack can have up to ${MAX_PARTS} layers.`, 413);
    addSessions(record.saved, input.sessions);
    this.nameParts(record);
    await this.write(record, beforeCommit);
    await this.setKey(part.key, record.saved.id);
    if (input.key && input.key !== part.key) await this.setKey(input.key, record.saved.id);
    return {
      ...this.describe(record),
      joined: { layer: at === "top" ? parts.items.length : 1, of: parts.items.length },
    };
  }

  /** New notes from the reader: the current iteration's comparisons, captured
   * again as a new, empty iteration. Later pins go to it. */
  startNotes(
    id: string,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const saved = record.saved;
      if (saved.parts) {
        // A stack's comparisons are frozen commits: the new notes keep them.
        const previous = this.currentIteration(record);
        if (saved.iterations!.length >= MAX_ITERATIONS)
          throw new HostError(
            "saved-review-limit",
            `A review can have at most ${MAX_ITERATIONS} iterations. Use a new key.`,
            413,
          );
        saved.iterations!.push({
          number: previous.number + 1,
          createdAt: new Date().toISOString(),
          targetIds: [...previous.targetIds],
          fresh: true,
        });
        await this.write(record, beforeCommit);
        return this.describe(record);
      }
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
      return this.iterate(record, { title: saved.title, targets }, capture, beforeCommit, true);
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

  /** The agent's next round on a keyed review: new comparisons and brief as a
   * new iteration. Comments, earlier briefs, and earlier comparisons stay. */
  private async iterate(
    record: SavedRecord,
    input: SavedReviewCreate,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
    fresh = false,
  ): Promise<SavedReview> {
    if (input.parts || record.saved.parts)
      return this.iterateParts(record, input, capture, beforeCommit);
    const saved = record.saved;
    const own = saved.targets.filter((target) => !target.commentReviewId);
    // A thread without a hand-off yet starts at version 1, which keeps the
    // replies that the reader pinned before it.
    const first = !saved.iterations && !own.length;
    const pinned = first ? saved.pins : undefined;
    const iterations =
      saved.iterations ??
      (first
        ? []
        : [
            {
              number: 1,
              createdAt: saved.createdAt,
              targetIds: own.map((t) => t.id),
              ...(saved.brief ? { brief: saved.brief } : {}),
              ...(saved.guide ? { guide: saved.guide } : {}),
              ...(saved.pins ? { pins: saved.pins } : {}),
            },
          ]);
    delete saved.pins;
    // The brief of a review without iterations becomes the first iteration's.
    if (!saved.iterations)
      for (const comment of saved.briefComments ?? [])
        if (comment.section === "brief") comment.iteration = 1;
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
    const brief = input.brief ? { text: input.brief, updatedAt: now } : undefined;
    const guide = input.guide ? savedGuide(input.guide, now) : undefined;
    iterations.push({
      number: (iterations.at(-1)?.number ?? 0) + 1,
      createdAt: now,
      targetIds,
      ...(brief ? { brief } : {}),
      ...(guide ? { guide } : {}),
      ...(pinned ? { pins: pinned } : {}),
      ...(fresh ? { fresh } : {}),
    });
    saved.iterations = iterations;
    saved.title = input.title.trim();
    if (brief) saved.brief = brief;
    if (guide) saved.guide = guide;
    if (input.pullRequestUrl) linkPullRequest(saved, input.pullRequestUrl, input.pullRequestTitle);
    addSessions(saved, input.sessions);
    this.fit(record);
    await this.write(record, beforeCommit);
    return this.describe(record);
  }

  /**
   * A new version of a stack or a set. A hand-off with parts replaces them
   * all; one comparison with a part's key replaces that part only. A part
   * whose comparison did not change keeps its target, so its comments and
   * viewed marks stay.
   */
  private async iterateParts(
    record: SavedRecord,
    input: SavedReviewCreate,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    const saved = record.saved;
    const previous = this.currentIteration(record);
    const known = saved.parts?.items ?? [];
    if (!saved.parts) {
      // A single review becomes a stack: its pull request and guide were the
      // whole thread's, and each part has its own now.
      delete saved.pullRequestUrl;
      delete saved.pullRequestTitle;
      delete saved.guide;
    }
    let items: PartInput[];
    let requested = input.targets;
    if (input.parts) items = input.parts.items;
    else {
      const part = known.find((entry) => entry.key === input.key);
      if (!part || input.targets.length !== 1)
        throw new HostError(
          "parts-key",
          "This thread is a stack or a set. Hand off all its parts with --stack or --set, or one part with its own key.",
          409,
        );
      // The other parts keep their comparisons; this one gets the new one.
      items = known.map((entry) => ({ ...entry, ...(entry.id === part.id ? partOf(input) : {}) }));
      requested = known.map((entry) =>
        entry.id === part.id ? input.targets[0]! : { repo: "", comparison: { kind: "working" } },
      );
    }
    if (previous.number >= MAX_ITERATIONS || (saved.iterations?.length ?? 0) >= MAX_ITERATIONS)
      throw new HostError(
        "saved-review-limit",
        `A review can have at most ${MAX_ITERATIONS} iterations. Use a new key.`,
        413,
      );
    const now = new Date().toISOString();
    const iteration: NonNullable<SavedRecord["saved"]["iterations"]>[number] = {
      number: previous.number + 1,
      createdAt: now,
      targetIds: [],
    };
    const before = (key: string) => {
      const part = known.find((entry) => entry.key === key);
      const id =
        part &&
        previous.targetIds.find((targetId) =>
          saved.targets.some((target) => target.id === targetId && target.part === part.id),
        );
      return id ? saved.targets.find((target) => target.id === id) : undefined;
    };
    const parts: SavedPart[] = [];
    for (const [index, item] of items.entries()) {
      const old = before(item.key);
      const replace = input.parts || item.key === input.key;
      let targetId: string;
      if (!replace) {
        if (!old) throw new HostError("parts-key", "A part of this thread has no comparison.", 409);
        targetId = old.id;
      } else {
        const result = await capture(requested[index]!);
        // The same commits keep the same target.
        targetId =
          old &&
          old.repositoryId === result.repositoryId &&
          old.comparison.kind === "range" &&
          result.review.comparison.kind === "range" &&
          old.base === result.review.base &&
          old.head === result.review.head
            ? old.id
            : this.appendCapture(record, result, undefined, false).id;
      }
      iteration.targetIds.push(targetId);
      parts.push(this.placePart(record, iteration, targetId, item, known));
    }
    if (input.brief) iteration.brief = { text: input.brief, updatedAt: now };
    saved.iterations = [...(saved.iterations ?? []), iteration];
    saved.parts = {
      ...(saved.parts ?? {}),
      shape: input.parts?.shape ?? saved.parts?.shape ?? "stack",
      items: parts,
    };
    if (input.parts && input.title.trim() !== saved.title) {
      saved.title = input.title.trim();
      delete saved.parts.autoTitle;
    }
    if (iteration.brief) saved.brief = iteration.brief;
    addSessions(saved, input.sessions);
    this.nameParts(record);
    this.fit(record);
    await this.write(record, beforeCommit);
    for (const part of parts) await this.setKey(part.key, saved.id);
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
      return record.saved.key === key || record.saved.parts?.items.some((part) => part.key === key)
        ? record
        : undefined;
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
      if (parsed.data.checkout) record.saved.checkout = parsed.data.checkout;
      if (parsed.data.pullRequestUrl === null) {
        delete record.saved.pullRequestUrl;
        delete record.saved.pullRequestTitle;
      } else if (parsed.data.pullRequestUrl)
        linkPullRequest(record.saved, parsed.data.pullRequestUrl, parsed.data.pullRequestTitle);
      addSessions(record.saved, parsed.data.sessions);
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
    const parts = record.saved.parts;
    const partTotals: NonNullable<SavedReview["partTotals"]> = {};
    for (const capture of parts ? record.captures : []) {
      if (!targets.has(capture.targetId)) continue;
      const part = record.saved.targets.find((target) => target.id === capture.targetId)?.part;
      if (!part) continue;
      partTotals[part] = {
        targetId: capture.targetId,
        files: capture.review.files.length,
        additions: capture.review.files.reduce((sum, file) => sum + file.additions, 0),
        deletions: capture.review.files.reduce((sum, file) => sum + file.deletions, 0),
        comments: capture.notes.notes.length,
      };
    }
    const { autoTitle: _auto, ...shown } = parts ?? {};
    return {
      ...record.saved,
      ...(parts ? { parts: shown as SavedParts, partTotals } : {}),
      totals,
    };
  }

  get(id: string): Promise<SavedReview> {
    return this.serial(async () => this.describe(await this.read(id)));
  }

  /** Approve a version, or take the approval back: a record for the reader,
   * which nothing else waits on (docs/PRACTICES.md). */
  approve(
    id: string,
    version: number,
    approved: boolean,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const versions = record.saved.iterations?.map((entry) => entry.number) ?? [1];
      if (!versions.includes(version))
        throw new HostError("version-not-found", `This review has no version ${version}.`, 404);
      const others = (record.saved.approvals ?? []).filter((entry) => entry.version !== version);
      const approvals = approved
        ? [...others, { version, at: new Date().toISOString() }].sort(
            (a, b) => a.version - b.version,
          )
        : others;
      if (approvals.length) record.saved.approvals = approvals;
      else delete record.saved.approvals;
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /**
   * The files of a version that changed since the reader's last review: the
   * last earlier version that they approved or commented on, or else the one
   * before. Files compare by their new side's blob, so a file that changed
   * only on the base side counts as unchanged. Undefined before version 2.
   */
  since(id: string, version?: number): Promise<Since | undefined> {
    return this.serial(async () => {
      const record = await this.read(id);
      const versions = (record.saved.iterations ?? []).filter((entry) => entry.targetIds.length);
      const to = version ? versions.find((entry) => entry.number === version) : versions.at(-1);
      if (!to) return undefined;
      const earlier = versions.filter((entry) => entry.number < to.number);
      if (!earlier.length) return undefined;
      const capture = (targetId: string) =>
        record.captures.find((entry) => entry.targetId === targetId);
      const approved = new Set((record.saved.approvals ?? []).map((entry) => entry.version));
      const commented = (entry: (typeof versions)[number]) =>
        entry.targetIds.some((target) => (capture(target)?.notes.notes.length ?? 0) > 0) ||
        !!record.saved.briefComments?.some((comment) => comment.iteration === entry.number);
      const reviewed = earlier.findLast((entry) => approved.has(entry.number) || commented(entry));
      const from = reviewed ?? earlier.at(-1)!;
      const basis = !reviewed ? "previous" : approved.has(from.number) ? "approved" : "commented";
      // Each file's new side, by repository and part, for both versions.
      const sides = (entry: (typeof versions)[number]) => {
        const files = new Map<string, { repo: string; path: string; side: string }>();
        for (const targetId of entry.targetIds) {
          const target = record.saved.targets.find((candidate) => candidate.id === targetId);
          const captured = capture(targetId);
          if (!target || !captured) continue;
          let parsed: FileDiffMetadata[] = [];
          try {
            parsed = parsePatchFiles(captured.review.patch, undefined, true)
              .flatMap((patch) => patch.files)
              .map(normalizeDiffMetadataPaths);
          } catch {
            /* A file without a patch compares by its counts. */
          }
          for (const file of captured.review.files) {
            const meta = parsed.find((candidate) => candidate.name === file.path);
            // The captured new side, else its blob ID (an untracked file has none), else its counts.
            const source = captured.sources.find((entry) => entry.path === file.path);
            const blob = meta?.newObjectId && !/^0+$/.test(meta.newObjectId) && meta.newObjectId;
            const side =
              meta?.type === "deleted"
                ? "deleted"
                : source
                  ? createHash("sha1").update(source.new).digest("hex")
                  : blob || `${file.status}:${file.additions}:${file.deletions}`;
            files.set(`${target.repositoryId}\0${target.part ?? ""}\0${file.path}`, {
              repo: target.repo,
              path: file.path,
              side,
            });
          }
        }
        return files;
      };
      const before = sides(from);
      const after = sides(to);
      const repos = new Set([...after.values(), ...before.values()].map((file) => file.repo));
      const files: Since["files"] = [];
      for (const [key, file] of after) {
        const old = before.get(key);
        if (!old || old.side !== file.side)
          files.push({
            path: file.path,
            change: old ? "changed" : "new",
            ...(repos.size > 1 && { repo: file.repo }),
          });
      }
      for (const [key, file] of before)
        if (!after.has(key))
          files.push({
            path: file.path,
            change: "gone",
            ...(repos.size > 1 && { repo: file.repo }),
          });
      files.sort(
        (a, b) => (a.repo ?? "").localeCompare(b.repo ?? "") || a.path.localeCompare(b.path),
      );
      return { from: from.number, to: to.number, basis, files };
    });
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
          validateReviewNoteRemoval(mutation.id, notes);
          notes.splice(
            notes.findIndex((item) => item.id === mutation.id),
            1,
          );
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
    this.changes++;
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

  /** Moves a target and its capture, with its comments, from one record to
   * another, under a new ID. The caller holds the lock and writes both. */
  private transplant(from: SavedRecord, to: SavedRecord, targetId: string) {
    const target = from.saved.targets.find((entry) => entry.id === targetId)!;
    const capture = from.captures.find((entry) => entry.targetId === targetId)!;
    const id = `t_${randomBytes(12).toString("hex")}`;
    const reviewId = `${to.saved.id}:${id}`;
    to.saved.targets.push({ ...target, id });
    to.captures.push({
      ...capture,
      targetId: id,
      review: { ...capture.review, id: reviewId },
      sources: capture.sources.map((source) => ({ ...source, reviewId })),
      notes: { ...capture.notes, reviewId },
    });
    from.saved.targets.splice(from.saved.targets.indexOf(target), 1);
    from.captures.splice(from.captures.indexOf(capture), 1);
    for (const iteration of from.saved.iterations ?? [])
      iteration.targetIds = iteration.targetIds.filter((entry) => entry !== targetId);
    return to.saved.targets.at(-1)!;
  }

  /**
   * Manual grouping: thread `source` goes on top of thread `onto` as its next
   * layer, or layers when it is a stack itself. Its current comparisons move
   * with their comments and guides, and so do its pull request, keys, and
   * sessions; the rest of it (its brief, pins, and older versions) stays in
   * its own record. Returns `onto`.
   */
  group(sourceId: string, ontoId: string, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      if (sourceId === ontoId)
        throw new HostError("parts-unsupported", "Choose another thread to group with.", 400);
      const [source, onto] = [await this.read(sourceId, true), await this.read(ontoId, true)];
      if (source.saved.group || onto.saved.group)
        throw new HostError("parts-unsupported", "Attempts cannot join a stack.", 409);
      const layers = currentLayers(source.saved);
      if (!layers.length)
        throw new HostError("saved-review-empty", "That thread has no Review to add.", 409);
      if (!source.saved.parts && layers.length !== 1)
        throw new HostError(
          "parts-unsupported",
          "A Review of several comparisons cannot be one layer.",
          409,
        );
      const ontoTarget = currentLayers(onto.saved)[0];
      if (ontoTarget && ontoTarget.repositoryId !== layers[0]!.repositoryId)
        throw new HostError("parts-unsupported", "Group threads of the same repository.", 409);
      const parts = onto.saved.parts ?? this.makeParts(onto);
      const iteration = this.currentIteration(onto);
      const sourceIteration = source.saved.iterations?.at(-1);
      const sourceParts = source.saved.parts?.items;
      const keys: string[] = [];
      for (const layer of layers) {
        const known = sourceParts?.find((part) => part.id === layer.part);
        const guide = known
          ? source.saved.iterations?.findLast((entry) => entry.guides?.[known.id])?.guides?.[
              known.id
            ]
          : (sourceIteration?.guide ?? source.saved.guide);
        const moved = this.transplant(source, onto, layer.id);
        const part: SavedPart = known
          ? { ...known }
          : {
              id: `l_${randomBytes(6).toString("hex")}`,
              key: source.saved.key ?? source.saved.pullRequestUrl ?? `review-${moved.id}`,
              title: source.saved.pullRequestTitle ?? source.saved.title,
              ...(source.saved.pullRequestUrl
                ? { pullRequestUrl: source.saved.pullRequestUrl }
                : {}),
              ...(source.saved.pullRequestTitle
                ? { pullRequestTitle: source.saved.pullRequestTitle }
                : {}),
              ...(moved.names?.base ? { base: moved.names.base } : {}),
              ...(moved.names?.head ? { head: moved.names.head } : {}),
            };
        if (parts.items.some((entry) => entry.key === part.key))
          part.key = `${part.key}-${moved.id.slice(2, 8)}`;
        moved.part = part.id;
        if (guide) iteration.guides = { ...iteration.guides, [part.id]: guide };
        iteration.targetIds.push(moved.id);
        parts.items.push(part);
        keys.push(part.key);
      }
      if (parts.items.length > MAX_PARTS)
        throw new HostError(
          "saved-review-limit",
          `A stack can have up to ${MAX_PARTS} layers.`,
          413,
        );
      // Commits that the reader commented on while browsing go too.
      for (const target of source.saved.targets.filter((entry) => entry.commentReviewId))
        this.transplant(source, onto, target.id);
      addSessions(onto.saved, source.saved.sessions);
      this.nameParts(onto);
      // The source keeps what history needs: its checkout and its notes.
      const checkout = threadCheckout(source.saved) ?? threadCheckout(onto.saved);
      if (checkout && !source.saved.checkout)
        source.saved.checkout = savedCheckoutSchema.parse(checkout);
      delete source.saved.parts;
      delete source.saved.pullRequestUrl;
      delete source.saved.pullRequestTitle;
      if (source.saved.key) keys.push(source.saved.key);
      delete source.saved.key;
      onto.saved.commentCount = countComments(onto);
      source.saved.commentCount = countComments(source);
      onto.saved.revision++;
      source.saved.revision++;
      this.fit(onto);
      // The layer is in its stack before it leaves its thread.
      await this.write(onto, beforeCommit);
      await this.write(source, beforeCommit);
      for (const key of keys) await this.setKey(key, onto.saved.id);
      return this.describe(onto);
    }, beforeCommit);
  }

  /**
   * Ungroup: each part above the first becomes a thread of its own again,
   * with its comparison, comments, guide, pull request, and key. The thread
   * keeps the first part and becomes a single review. Returns the new threads.
   */
  ungroup(id: string, beforeCommit?: () => void): Promise<SavedReview[]> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const parts = record.saved.parts;
      if (!parts)
        throw new HostError("parts-unsupported", "This thread is not a stack or a set.", 409);
      const iteration = this.currentIteration(record);
      const layers = currentLayers(record.saved);
      const made: SavedRecord[] = [];
      for (const layer of layers.slice(1)) {
        const part = parts.items.find((entry) => entry.id === layer.part);
        const guide = part
          ? record.saved.iterations?.findLast((entry) => entry.guides?.[part.id])?.guides?.[part.id]
          : undefined;
        const created: SavedRecord = {
          version: 1,
          saved: {
            id: `r_${randomBytes(12).toString("hex")}`,
            title: part?.title ?? layer.label,
            ...(part?.pullRequestUrl ? { pullRequestUrl: part.pullRequestUrl } : {}),
            ...(part?.pullRequestTitle ? { pullRequestTitle: part.pullRequestTitle } : {}),
            ...(guide ? { guide } : {}),
            ...(part ? { key: part.key } : {}),
            createdAt: new Date().toISOString(),
            revision: 0,
            commentCount: 0,
            targets: [],
          },
          captures: [],
        };
        const moved = this.transplant(record, created, layer.id);
        delete moved.part;
        if (part)
          created.saved.iterations = [
            {
              number: 1,
              createdAt: created.saved.createdAt,
              targetIds: [moved.id],
              ...(guide ? { guide } : {}),
            },
          ];
        created.saved.commentCount = countComments(created);
        made.push(created);
      }
      // The first part is the thread's own review again.
      const first = parts.items.find((entry) => entry.id === layers[0]?.part);
      const firstGuide = first
        ? record.saved.iterations?.findLast((entry) => entry.guides?.[first.id])?.guides?.[first.id]
        : undefined;
      for (const target of record.saved.targets) delete target.part;
      for (const entry of record.saved.iterations ?? []) delete entry.guides;
      if (firstGuide) iteration.guide = record.saved.guide = firstGuide;
      if (first?.pullRequestUrl)
        linkPullRequest(record.saved, first.pullRequestUrl, first.pullRequestTitle);
      if (parts.autoTitle && first) record.saved.title = first.title;
      delete record.saved.parts;
      record.saved.commentCount = countComments(record);
      record.saved.revision++;
      for (const created of made) await this.write(created, beforeCommit);
      await this.write(record, beforeCommit);
      for (const created of made)
        if (created.saved.key) await this.setKey(created.saved.key, created.saved.id);
      return made.map((created) => this.describe(created));
    }, beforeCommit);
  }

  /** A thread of parts is a stack or a set. */
  setShape(id: string, shape: PartShape, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      if (!record.saved.parts)
        throw new HostError("parts-unsupported", "This thread is not a stack or a set.", 409);
      record.saved.parts.shape = shape;
      this.nameParts(record);
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /** Replace or remove the brief. Comments and their revision stay unchanged. */
  setBrief(id: string, brief: string | null, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      if (brief === null) delete record.saved.brief;
      else {
        const parsed = briefTextSchema.safeParse(brief);
        if (!parsed.success)
          throw new HostError("invalid-brief", parsed.error.issues[0]!.message, 400);
        record.saved.brief = { text: parsed.data, updatedAt: new Date().toISOString() };
      }
      // A pasted brief replaces the current iteration's.
      const iteration = record.saved.iterations?.at(-1);
      if (iteration) {
        if (record.saved.brief) iteration.brief = record.saved.brief;
        else delete iteration.brief;
      }
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /** Replace or remove the current iteration's guide, or a part's: the part
   * with the key `part`. */
  setGuide(
    id: string,
    guide: unknown,
    beforeCommit?: () => void,
    part?: string,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      let next: ReturnType<typeof savedGuide> | undefined;
      if (guide !== null) {
        const parsed = reviewGuideSchema.safeParse(guide);
        if (!parsed.success) throw new HostError("invalid-guide", guideError(parsed.error), 400);
        next = savedGuide(parsed.data);
      }
      if (record.saved.parts) {
        const found = record.saved.parts.items.find(
          (entry) => entry.key === part || entry.id === part,
        );
        if (!found)
          throw new HostError(
            "parts-key",
            "This thread is a stack or a set. Give the guide with the key of one part.",
            409,
          );
        const iteration = this.currentIteration(record);
        const guides = { ...iteration.guides };
        if (next) guides[found.id] = next;
        else delete guides[found.id];
        iteration.guides = guides;
        await this.write(record, beforeCommit);
        return this.describe(record);
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

  /** Pin an agent reply to the current iteration, or remove a pin. Pinning
   * the same reply again keeps one pin. */
  pin(id: string, mutation: PinMutation, beforeCommit?: () => void): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const saved = record.saved;
      if ("add" in mutation) {
        const owner = saved.iterations?.at(-1) ?? saved;
        const pins = owner.pins ?? [];
        const { text: body, source } = mutation.add;
        const same = pins.some(
          (pin) =>
            source?.itemId &&
            pin.source?.itemId === source.itemId &&
            pin.source.sessionId === source.sessionId,
        );
        if (!same) {
          if (pins.length >= MAX_PINS)
            throw new HostError(
              "pin-limit",
              `An iteration can have at most ${MAX_PINS} pinned replies.`,
              413,
            );
          pins.push({
            id: `p_${randomBytes(6).toString("hex")}`,
            text: body,
            createdAt: new Date().toISOString(),
            ...(source ? { source } : {}),
          });
        }
        owner.pins = pins;
      } else {
        for (const owner of [saved, ...(saved.iterations ?? [])]) {
          if (!owner.pins) continue;
          owner.pins = owner.pins.filter((pin) => pin.id !== mutation.remove);
          if (!owner.pins.length) delete owner.pins;
        }
      }
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /**
   * Delete the Notes that show for an iteration: its brief and pins, and a
   * brief that it shows from an earlier iteration (`briefFrom`), with the
   * comments on them. Without iterations, the review's own Notes go. Notes
   * that the reader started go with their iteration and its comparisons,
   * unless those have comments.
   */
  deleteNotes(
    id: string,
    { iteration, briefFrom }: { iteration?: number; briefFrom?: number },
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const saved = record.saved;
      const find = (number: number | undefined) =>
        number === undefined
          ? saved.iterations
            ? undefined
            : saved
          : saved.iterations?.find((entry) => entry.number === number);
      const owner = find(iteration);
      if (!owner) throw new HostError("notes-not-found", "These notes do not exist.", 404);
      const earlier = briefFrom !== iteration ? find(briefFrom) : undefined;
      const pins = new Set(owner.pins?.map((pin) => pin.id));
      const briefs = new Set([iteration, ...(earlier ? [briefFrom] : [])]);
      const comments = (saved.briefComments ?? []).filter((comment) =>
        comment.section === "brief" ? !briefs.has(comment.iteration) : !pins.has(comment.section),
      );
      if (comments.length) saved.briefComments = comments;
      else delete saved.briefComments;
      delete owner.brief;
      delete owner.pins;
      if (earlier) delete earlier.brief;
      if (saved.iterations) {
        const started = saved.iterations.find((entry) => entry === owner && entry.fresh);
        const captures = record.captures.filter((capture) =>
          started?.targetIds.includes(capture.targetId),
        );
        if (started && captures.every((capture) => !capture.notes.notes.length)) {
          saved.iterations = saved.iterations.filter((entry) => entry !== started);
          record.captures = record.captures.filter((capture) => !captures.includes(capture));
          saved.targets = saved.targets.filter((target) => !started.targetIds.includes(target.id));
        }
        // The review's brief is the latest one that an iteration still has.
        const latest = saved.iterations.findLast((entry) => entry.brief)?.brief;
        if (latest) saved.brief = latest;
        else delete saved.brief;
      }
      saved.commentCount = countComments(record);
      saved.revision++;
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /** Sets the pull request draft that the agent wrote, as its next revision;
   * `created` records the pull request that Create opened from it. */
  setPrDraft(
    id: string,
    change:
      | { draft: Omit<SavedPrDraft, "revision" | "updatedAt" | "pullRequestUrl"> }
      | { created: string },
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const saved = record.saved;
      if ("created" in change) {
        if (!saved.prDraft)
          throw new HostError("no-pr-draft", "This review has no pull request draft.", 404);
        saved.prDraft.pullRequestUrl = change.created;
        saved.pullRequestUrl = change.created;
      } else
        saved.prDraft = {
          ...change.draft,
          revision: (saved.prDraft?.revision ?? 0) + 1,
          updatedAt: new Date().toISOString(),
          ...(saved.prDraft?.pullRequestUrl
            ? { pullRequestUrl: saved.prDraft.pullRequestUrl }
            : {}),
        };
      saved.revision++;
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /** Comment on a passage of the Notes, or edit or remove such a comment. */
  commentBrief(
    id: string,
    mutation: BriefCommentMutation,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    return this.writing(async () => {
      const record = await this.read(id, true);
      const saved = record.saved;
      const comments = saved.briefComments ?? [];
      const now = new Date().toISOString();
      if ("add" in mutation) {
        const { iteration, ...input } = mutation.add;
        const brief =
          iteration === undefined
            ? saved.iterations
              ? undefined
              : saved.brief
            : saved.iterations?.find((entry) => entry.number === iteration)?.brief;
        const shown =
          input.section === "pr"
            ? !!saved.prDraft
            : input.section === "brief"
              ? brief !== undefined
              : [saved, ...(saved.iterations ?? [])].some((owner) =>
                  owner.pins?.some((pin) => pin.id === input.section),
                );
        if (!shown)
          throw new HostError("notes-not-found", "These notes are no longer in the review.", 404);
        if (saved.commentCount >= MAX_NOTES)
          throw new HostError(
            "too-many-notes",
            "A saved review can contain at most 500 notes.",
            413,
          );
        comments.push({
          ...input,
          ...(input.section === "brief" && iteration ? { iteration } : {}),
          id: `c_${randomBytes(6).toString("hex")}`,
          createdAt: now,
          updatedAt: now,
        });
      } else {
        const target = "edit" in mutation ? mutation.edit.id : mutation.remove;
        const index = comments.findIndex((comment) => comment.id === target);
        if (index < 0) throw new HostError("note-not-found", "The note does not exist.", 404);
        if ("edit" in mutation)
          comments[index] = { ...comments[index]!, text: mutation.edit.text, updatedAt: now };
        else comments.splice(index, 1);
      }
      if (comments.length) saved.briefComments = comments;
      else delete saved.briefComments;
      saved.commentCount = countComments(record);
      saved.revision++;
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
      delete record.saved.briefComments;
      record.saved.commentCount = 0;
      record.saved.revision++;
      await this.write(record, beforeCommit);
      return this.describe(record);
    }, beforeCommit);
  }

  /** Top-level comments across the review's targets, for the agent's drafts. */
  comments(id: string): Promise<(Note & { replies: number })[]> {
    return this.serial(async () => {
      const record = await this.read(id);
      return record.captures.flatMap((target) =>
        target.notes.notes
          .filter((note) => !note.parentId)
          .map((note) => ({
            ...note,
            updatedAt: threadVersion(target.notes.notes, note),
            replies: target.notes.notes.filter((item) => item.parentId === note.id).length,
          })),
      );
    });
  }

  /** The comments as text for an agent; `include` limits it to those threads. */
  feedback(
    id: string,
    include?: ReadonlySet<string>,
  ): Promise<{
    text: string;
    count: number;
    repositoryCount: number;
    revision: number;
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
      appendText(
        "# Diff comments:",
        "",
        `Review: ${record.saved.title}`,
        `Review ID: ${id}`,
        `Captured: ${record.saved.createdAt}`,
        "",
      );
      const repositories = new Set<string>();
      let index = 0;
      for (const target of record.captures) {
        const threads = target.notes.notes.filter(
          (note) => !note.parentId && (!include || include.has(note.id)),
        );
        if (!threads.length) continue;
        const info = record.saved.targets.find((item) => item.id === target.targetId)!;
        repositories.add(info.repositoryId);
        let parsed: FileDiffMetadata[] = [];
        try {
          parsed = parsePatchFiles(target.review.patch, undefined, true)
            .flatMap((patch) => patch.files)
            .map(normalizeDiffMetadataPaths);
        } catch {
          // A captured source excerpt remains usable if an older patch cannot be parsed.
        }
        const appendCode = (label: string, language: string, lines: Iterable<string>) => {
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
          appendText(label, `${fence}${language}`, snippet.join("\n"), fence);
        };
        const append = (note: Note, parentNumber?: number) => {
          const number = ++index;
          const file = target.review.files.find((item) => item.path === note.path)!;
          const path = note.side === "old" ? (file.previousPath ?? note.path) : note.path;
          const end = note.endLine ?? note.line;
          appendText(
            `## User Comment ${number}`,
            `File: ${path}`,
            `Workspace: ${info.repo}`,
            `Side: ${note.side === "old" ? "L" : "R"}`,
            `Lines: ${note.line === end ? note.line : `${note.line}-${end}`}`,
            `Comparison: ${info.base} → ${info.head}`,
            `Comparison kind: ${info.comparison.kind}`,
            `Captured working state: ${info.captured ? "yes" : "no"}`,
            `Repository ID: ${info.repositoryId}`,
            `Target ID: ${info.id}`,
            `Comment ID: ${note.id}`,
          );
          if (parentNumber) appendText(`Reply to: User Comment ${parentNumber}`);
          if (file.previousPath) appendText(`Rename: ${file.previousPath} → ${file.path}`);
          const diff = parsed.find((item) => item.name === note.path);
          const covered = diff && patchCoversSelection(diff, note);
          if (covered) appendCode("Diff hunk:", "diff", commentDiffExcerpt(diff, note));
          const source = target.sources.find((item) => item.path === note.path);
          if (!covered && source) {
            const lines = source[note.side].split("\n");
            if (lines.at(-1) === "") lines.pop();
            const from = Math.max(1, note.line - 3);
            const to = Math.min(lines.length, end + 3);
            appendCode(
              "Captured source (saved diff does not cover the full selection):",
              "",
              (function* () {
                for (let position = from; position <= to; position++)
                  yield `${position >= note.line && position <= end ? ">" : " "} ${position} | ${lines[position - 1]!}`;
              })(),
            );
          } else if (!covered) appendText("Source context was not captured for this file.");
          appendText("", "Comment:", note.text, "");
          for (const reply of target.notes.notes.filter((item) => item.parentId === note.id))
            append(reply, number);
        };
        for (const note of threads) {
          append(note);
          threadsOut.set(note.id, {
            version: threadVersion(target.notes.notes, note),
            comment: {
              path: note.path,
              line: note.line,
              ...(note.endLine ? { endLine: note.endLine } : {}),
              text: note.text,
            },
          });
        }
      }
      const pins = [record.saved, ...(record.saved.iterations ?? [])].flatMap(
        (owner) => owner.pins ?? [],
      );
      for (const comment of record.saved.briefComments ?? []) {
        if (include && !include.has(comment.id)) continue;
        threadsOut.set(comment.id, {
          version: comment.updatedAt,
          comment: {
            path: comment.section === "pr" ? "PR draft" : "Notes",
            quote: comment.quote,
            text: comment.text,
          },
        });
        const pin = pins.find((item) => item.id === comment.section);
        appendText(
          `## User Comment ${++index}`,
          comment.section === "pr"
            ? `On: the pull request draft${record.saved.prDraft ? ` (revision ${record.saved.prDraft.revision}; revise it and run med pr draft again)` : ""}`
            : comment.section === "brief"
              ? `On: the review's brief${comment.iteration ? ` (iteration ${comment.iteration})` : ""}`
              : `On: an agent reply pinned to the review${pin ? ` (${pin.createdAt})` : ""}`,
          `Comment ID: ${comment.id}`,
          "",
          "Quote:",
          ...comment.quote.split("\n").map((line) => `> ${line}`),
          "",
          "Comment:",
          comment.text,
          "",
        );
      }
      if (!index) appendText("No comments.");
      return {
        text: output.join("\n"),
        count: index,
        repositoryCount: repositories.size,
        revision: record.saved.revision,
        threads: threadsOut,
      };
    });
  }
}

/** A comment thread's version: its newest change. A reply changes the thread. */
function threadVersion(notes: readonly Note[], note: Note) {
  return [note, ...notes.filter((item) => item.parentId === note.id)]
    .map((item) => item.updatedAt)
    .sort()
    .at(-1)!;
}
