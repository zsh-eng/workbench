import { randomBytes, randomUUID } from "node:crypto";
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
  MAX_BRIEF_LENGTH,
  MAX_ITERATIONS,
  MAX_SESSIONS,
  type AgentSession,
  type SavedReview,
  type SavedReviewCreate,
  type CapturedReviewTarget,
} from "../shared/saved-review";

const REVIEW_ID = /^r_[a-f0-9]{24}$/;
const TARGET_ID = /^t_[a-f0-9]{24}$/;
const MAX_RECORD_BYTES = 64 * 1024 * 1024;
const MAX_TOTAL_BYTES = 512 * 1024 * 1024;
const MAX_REVIEWS = 128;
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
});
const briefSchema = z.object({ text: text.max(MAX_BRIEF_LENGTH), updatedAt: text });
const savedSchema = z.object({
  id: z.string().regex(REVIEW_ID),
  key: text.optional(),
  title: text,
  pullRequestUrl: pullRequestUrlSchema.optional(),
  pullRequestTitle: text.optional(),
  brief: briefSchema.optional(),
  sessions: z.array(agentSessionSchema).max(MAX_SESSIONS).optional(),
  iterations: z
    .array(
      z.object({
        number: z.number().int().positive(),
        createdAt: text,
        targetIds: z.array(z.string().regex(TARGET_ID)),
        brief: briefSchema.optional(),
      }),
    )
    .max(MAX_ITERATIONS)
    .optional(),
  createdAt: text,
  revision: natural,
  commentCount: natural,
  targets: z.array(targetSchema).min(1).max(128),
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
    .min(1)
    .max(128),
});
type SavedRecord = z.infer<typeof recordSchema>;

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

/** Disk records own frozen sources and notes; live repository services are never consulted. */
export class SavedReviewStore {
  private pending: Promise<unknown> = Promise.resolve();
  // Reads skip the parse while the file keeps its identity. A write renames a
  // new file into place, so its next read parses again.
  private cache = new Map<string, { identity: string; size: number; record: SavedRecord }>();
  constructor(private readonly directory: string) {}

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
      if (
        record.saved.commentCount !==
        record.captures.reduce((sum, capture) => sum + capture.notes.notes.length, 0)
      )
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
    if (!files.includes(filename) && files.length >= MAX_REVIEWS)
      throw new HostError(
        "saved-review-limit",
        "Saved reviews reached the limit of 128 reviews.",
        413,
      );
    let total = size;
    for (const name of files)
      if (name !== filename) total += (await stat(join(this.directory, name))).size;
    if (total > MAX_TOTAL_BYTES)
      throw new HostError(
        "saved-review-limit",
        "Saved reviews exceed the 512 MiB storage limit.",
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
          createdAt: new Date().toISOString(),
          revision: 0,
          commentCount: 0,
          targets: [],
        },
        captures: [],
      };
      for (const requested of input.targets) {
        const result = await capture(requested);
        this.appendCapture(record, result);
      }
      addSessions(record.saved, input.sessions);
      if (input.key) {
        record.saved.key = input.key;
        record.saved.iterations = [
          {
            number: 1,
            createdAt: record.saved.createdAt,
            targetIds: record.saved.targets.map((target) => target.id),
            ...(record.saved.brief ? { brief: record.saved.brief } : {}),
          },
        ];
      }
      await this.write(record, beforeCommit);
      if (input.key) await this.setKey(input.key, id);
      return this.describe(record);
    }, beforeCommit);
  }

  /** The agent's next round on a keyed review: new comparisons and brief as a
   * new iteration. Comments, earlier briefs, and earlier comparisons stay. */
  private async iterate(
    record: SavedRecord,
    input: SavedReviewCreate,
    capture: (target: SavedReviewCreate["targets"][number]) => Promise<CapturedReviewTarget>,
    beforeCommit?: () => void,
  ): Promise<SavedReview> {
    const saved = record.saved;
    const iterations = saved.iterations ?? [
      {
        number: 1,
        createdAt: saved.createdAt,
        targetIds: saved.targets.filter((target) => !target.commentReviewId).map((t) => t.id),
        ...(saved.brief ? { brief: saved.brief } : {}),
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
    const brief = input.brief ? { text: input.brief, updatedAt: now } : undefined;
    iterations.push({
      number: iterations.at(-1)!.number + 1,
      createdAt: now,
      targetIds,
      ...(brief ? { brief } : {}),
    });
    saved.iterations = iterations;
    saved.title = input.title.trim();
    if (brief) saved.brief = brief;
    if (input.pullRequestUrl) linkPullRequest(saved, input.pullRequestUrl, input.pullRequestTitle);
    addSessions(saved, input.sessions);
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

  /** Changes the title or the pull request link, such as once a PR is open. */
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
    return { ...record.saved, totals };
  }

  get(id: string): Promise<SavedReview> {
    return this.serial(async () => this.describe(await this.read(id)));
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
      record.saved.commentCount = record.captures.reduce(
        (sum, item) => sum + item.notes.notes.length,
        0,
      );
      await this.write(record, beforeCommit);
      return target.notes;
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

  feedback(
    id: string,
  ): Promise<{ text: string; count: number; repositoryCount: number; revision: number }> {
    return this.serial(async () => {
      const record = await this.read(id);
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
        if (!target.notes.notes.length) continue;
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
        for (const note of target.notes.notes.filter((item) => !item.parentId)) append(note);
      }
      if (!index) appendText("No comments.");
      return {
        text: output.join("\n"),
        count: index,
        repositoryCount: repositories.size,
        revision: record.saved.revision,
      };
    });
  }
}
