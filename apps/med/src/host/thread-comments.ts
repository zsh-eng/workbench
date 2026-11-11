import { randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { SentComment } from "../shared/agent-inbox";
import type { NoteAuthor } from "../shared/protocol";
import {
  agentName,
  fileCommentSchema,
  MAX_FILE_COMMENT_LINES,
  type FileComment,
  type FileCommentMutation,
} from "../shared/saved-review";
import { validateReviewNoteText } from "../shared/hunk/noteValidation";
import { HostError } from "./runtime/errors";

// Comments on lines of a file (`gc` in a file), not on a review's change.
// They belong to the thread: a session comments on its checkout's files
// before it hands off any review, and they go to its agent with the review
// comments. One small file per thread, in `thread-comments/`.

const MAX_COMMENTS = 500;
const THREAD_FILE = /^([A-Za-z0-9_-]{1,160})\.json$/;
const fileSchema = z.object({
  comments: z.array(fileCommentSchema.extend({ id: z.string().uuid() })).max(MAX_COMMENTS),
});

/** A short commit for the agent's message. */
const shortOid = (oid: string) => oid.slice(0, 12);

export type ThreadComments = ReturnType<typeof createThreadComments>;

export function createThreadComments(directory: string) {
  const writes = new Map<string, Promise<unknown>>();
  const cache = new Map<string, FileComment[]>();
  const listeners = new Set<(threadId: string) => void>();

  const file = (threadId: string) => {
    if (!/^[A-Za-z0-9_-]{1,160}$/.test(threadId))
      throw new HostError("invalid-thread", "Choose a thread by its ID.", 400);
    return join(directory, `${threadId}.json`);
  };
  const read = async (threadId: string): Promise<FileComment[]> => {
    const known = cache.get(threadId);
    if (known) return known;
    let comments: FileComment[] = [];
    try {
      comments = fileSchema.parse(JSON.parse(await readFile(file(threadId), "utf8"))).comments;
    } catch {
      /* None yet. */
    }
    cache.set(threadId, comments);
    return comments;
  };
  /** Runs changes to one thread's comments one after another. */
  const change = <T>(threadId: string, work: (comments: FileComment[]) => T) => {
    const previous = writes.get(threadId) ?? Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(async () => {
        const comments = [...(await read(threadId))];
        const result = work(comments);
        await mkdir(directory, { recursive: true });
        if (comments.length) {
          const temporary = join(directory, `.${threadId}-${randomUUID()}.tmp`);
          await writeFile(temporary, JSON.stringify({ comments }), { mode: 0o600 });
          await rename(temporary, file(threadId));
        } else await unlink(file(threadId)).catch(() => {});
        cache.set(threadId, comments);
        for (const listener of listeners) listener(threadId);
        return result;
      });
    writes.set(threadId, next);
    return next.finally(() => {
      if (writes.get(threadId) === next) writes.delete(threadId);
    });
  };
  const find = (comments: FileComment[], id: string) => {
    const wanted = id.toLowerCase();
    const named = comments.filter(
      (comment) => comment.id === wanted || (wanted.length >= 6 && comment.id.startsWith(wanted)),
    );
    const comment =
      named.find((entry) => entry.id === wanted) ?? (named.length === 1 ? named[0] : undefined);
    if (!comment)
      throw new HostError(
        named.length ? "comment-ambiguous" : "note-not-found",
        named.length
          ? "More than one comment of this thread has an ID that starts so. Give more of the ID."
          : "The comment does not exist.",
        named.length ? 409 : 404,
      );
    return comment;
  };

  return {
    /** The thread's comments on files, oldest first. */
    list: read,
    subscribe(listener: (threadId: string) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Comment on lines of a file, or edit, remove, answer, resolve, or open
     * such a comment again. */
    mutate(threadId: string, mutation: FileCommentMutation) {
      return change(threadId, (comments) => {
        const now = new Date().toISOString();
        const growing = "add" in mutation || "reply" in mutation;
        if (growing && comments.length >= MAX_COMMENTS)
          throw new HostError(
            "too-many-notes",
            `A thread can have at most ${MAX_COMMENTS} comments on files.`,
            413,
          );
        if ("add" in mutation) {
          const input = mutation.add;
          const end = input.endLine ?? input.line;
          if (end < input.line || end - input.line >= MAX_FILE_COMMENT_LINES)
            throw new HostError(
              "invalid-lines",
              `A comment covers at most ${MAX_FILE_COMMENT_LINES} lines.`,
              400,
            );
          const { endLine: _end, ...rest } = input;
          comments.push({
            ...rest,
            ...(end !== input.line && { endLine: end }),
            id: randomUUID(),
            createdAt: now,
            updatedAt: now,
            replies: [],
          });
        } else if ("edit" in mutation) {
          const comment = find(comments, mutation.edit.id);
          comment.text = mutation.edit.text;
          comment.updatedAt = now;
        } else if ("remove" in mutation) {
          comments.splice(comments.indexOf(find(comments, mutation.remove)), 1);
        } else if ("reply" in mutation) {
          // The user's reply is a change of the thread: it waits to be sent.
          const comment = find(comments, mutation.reply.id);
          comment.replies.push({ id: randomUUID(), text: mutation.reply.text, createdAt: now });
          comment.updatedAt = now;
          delete comment.resolved;
        } else if ("resolve" in mutation) {
          find(comments, mutation.resolve).resolved = { at: now };
        } else {
          delete find(comments, mutation.reopen).resolved;
        }
        return comments;
      });
    },
    /** An agent's answer to a comment (`med reply`), resolving it with `resolve`. */
    reply(
      threadId: string,
      commentId: string,
      text: string,
      author: NoteAuthor,
      options: { resolve?: boolean } = {},
    ) {
      validateReviewNoteText(text);
      return change(threadId, (comments) => {
        const comment = find(comments, commentId);
        const now = new Date().toISOString();
        comment.replies.push({ id: randomUUID(), text, author, createdAt: now });
        if (options.resolve) comment.resolved = { at: now, by: author };
        return comment;
      });
    },
    /** The threads with a comment whose ID starts with `prefix`. */
    async threadsWith(prefix: string): Promise<string[]> {
      const names = await readdir(directory).catch(() => [] as string[]);
      const found: string[] = [];
      for (const name of names) {
        const id = THREAD_FILE.exec(name)?.[1];
        if (id && (await read(id)).some((comment) => comment.id.startsWith(prefix))) found.push(id);
      }
      return found;
    },
    async remove(threadId: string) {
      await change(threadId, (comments) => comments.splice(0));
    },
    /** Deletes the named comments with their replies; returns how many went. */
    async removeComments(threadId: string, ids: ReadonlySet<string>) {
      if (!(await read(threadId)).some((comment) => ids.has(comment.id))) return 0;
      return change(threadId, (comments) => {
        const before = comments.length;
        comments.splice(0, comments.length, ...comments.filter((comment) => !ids.has(comment.id)));
        return before - comments.length;
      });
    },
    /** The comments as the agent's message has them: open ones, or those in
     * `include`. `others` are the IDs of the review comments beside them,
     * which their short IDs must not clash with. */
    async feedback(threadId: string, include?: ReadonlySet<string>, others: string[] = []) {
      const comments = await read(threadId);
      const lines: string[] = [];
      const threads = new Map<string, { version: string; comment: SentComment }>();
      const ids = [...others, ...comments.map((entry) => entry.id)];
      let example: string | undefined;
      for (const comment of comments) {
        if (include ? !include.has(comment.id) : comment.resolved) continue;
        const shortId = shortCommentId(comment.id, ids);
        example ??= shortId;
        const end = comment.endLine ?? comment.line;
        const where =
          comment.source.kind === "commit"
            ? `at commit ${shortOid(comment.source.oid)}`
            : "in the working tree";
        const repository =
          comment.source.repo.split(/[\\/]/).filter(Boolean).at(-1) ?? comment.source.repo;
        lines.push(
          `## ${shortId} · ${comment.path}:${comment.line === end ? comment.line : `${comment.line}-${end}`} (a file, not a review's change; ${where} of ${repository})`,
        );
        const quoted = comment.quote
          .split("\n")
          .slice(0, end - comment.line + 1)
          .map((line, offset) => `${comment.line + offset} | ${line}`);
        const longest = Math.max(
          2,
          ...quoted.flatMap((line) => [...line.matchAll(/`+/g)].map((match) => match[0].length)),
        );
        const fence = "`".repeat(longest + 1);
        lines.push(fence, quoted.join("\n"), fence, "", comment.text, "");
        for (const reply of comment.replies)
          lines.push(
            reply.author ? `${agentName(reply.author)} replied:` : "The user replied:",
            reply.text,
            "",
          );
        threads.set(comment.id, {
          version: comment.updatedAt,
          comment: {
            path: comment.path,
            line: comment.line,
            ...(comment.endLine ? { endLine: comment.endLine } : {}),
            text: comment.text,
          },
        });
      }
      return { lines, threads, count: threads.size, example };
    },
  };
}

/**
 * A comment's short ID: the first 6 characters of its ID, or more, until no
 * other ID in `ids` starts the same way.
 */
export function shortCommentId(id: string, ids: readonly string[]) {
  for (let length = 6; length < id.length; length++) {
    const start = id.slice(0, length);
    if (!ids.some((other) => other !== id && other.startsWith(start))) return start;
  }
  return id;
}
