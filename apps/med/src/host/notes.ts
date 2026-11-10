import { randomUUID } from "node:crypto";
import type { Note, NoteMutation, NoteState } from "../shared/protocol";
import {
  validateReviewNoteInput,
  removeReviewNote,
  validateReviewNoteText,
} from "../shared/hunk/noteValidation";
import { ReviewService } from "./repository/review";
import { HostError } from "./runtime/errors";
import { reviewRangeCoveredByHunks } from "../shared/hunk/geometry";

interface NoteScope {
  state: NoteState;
  identities: Map<string, string>;
}
const MAX_NOTE_BYTES = 8 * 1024 * 1024;

/** Keep notes across live review generations without claiming changed anchors are current. */
export class NoteService {
  private scopes = new Map<string, NoteScope>();
  constructor(private reviews: ReviewService) {}

  private describe(reviewId: string) {
    const review = this.reviews.get(reviewId);
    const comparison = review.response.comparison;
    const scope = JSON.stringify([
      review.response.repo,
      comparison.kind === "patch" || comparison.kind === "files"
        ? comparison
        : review.mutable
          ? comparison.kind
          : [review.response.base, review.response.head],
    ]);
    const identities = new Map(
      [...review.sources].map(([path, file]) => [
        path,
        JSON.stringify([file.oldOid, file.newOid, file.fingerprint, file.oldMode, file.newMode]),
      ]),
    );
    return { scope, identities };
  }

  adopt(reviewId: string): NoteState {
    const { scope, identities } = this.describe(reviewId);
    const previous = this.scopes.get(scope);
    if (!previous) return { reviewId, revision: 0, notes: [] };
    if (previous.state.reviewId === reviewId) return previous.state;
    const next: NoteState = {
      reviewId,
      revision: previous.state.revision + 1,
      notes: previous.state.notes.map((note): Note => ({
        ...note,
        resolution: !identities.has(note.path)
          ? "orphaned"
          : identities.get(note.path) !== previous.identities.get(note.path)
            ? "stale"
            : (note.resolution ?? "active"),
      })),
    };
    this.scopes.set(scope, {
      state: next,
      identities: new Map(
        next.notes.map((note) => [note.path, identities.get(note.path) ?? "missing"]),
      ),
    });
    return next;
  }

  get(reviewId: string): NoteState {
    const { scope } = this.describe(reviewId);
    const state = this.scopes.get(scope)?.state;
    if (state && state.reviewId !== reviewId)
      throw new HostError(
        "stale-review",
        "These notes belong to a newer review. Refresh before continuing.",
        409,
      );
    return state ?? { reviewId, revision: 0, notes: [] };
  }

  async mutate(
    reviewId: string,
    expectedRevision: number,
    mutation: NoteMutation,
    signal?: AbortSignal,
  ) {
    const state = this.get(reviewId);
    if (state.revision !== expectedRevision)
      throw new HostError("stale-notes", "The notes changed. Refresh notes before retrying.", 409);
    const notes = state.notes.map((note) => ({ ...note }));
    try {
      if (mutation.type === "add") {
        if (notes.length >= 500)
          throw new HostError("too-many-notes", "A review can contain at most 500 notes.", 413);
        const file = this.reviews.get(reviewId).sources.get(mutation.note.path);
        if (file?.sourceUnavailable) {
          validateReviewNoteText(mutation.note.text);
          const end = mutation.note.endLine ?? mutation.note.line;
          if (
            file.binary ||
            end < mutation.note.line ||
            !reviewRangeCoveredByHunks(file.noteHunks ?? [], mutation.note.side, [
              mutation.note.line,
              end,
            ])
          )
            throw new HostError("invalid-note", "This range is not present in the supplied patch.");
        } else {
          const sources = await this.reviews.sources(reviewId, mutation.note.path, signal);
          validateReviewNoteInput(mutation.note, sources, notes);
        }
        const parent = mutation.note.parentId
          ? notes.find((note) => note.id === mutation.note.parentId)
          : undefined;
        if (mutation.note.parentId && (!parent || parent.path !== mutation.note.path))
          throw new HostError("invalid-note", "A reply must refer to a note in the same file.");
        if (parent?.resolution === "orphaned")
          throw new HostError(
            "orphaned-note",
            "This reply target is no longer part of the review.",
            409,
          );
        const now = new Date().toISOString();
        notes.push({
          ...mutation.note,
          id: randomUUID(),
          createdAt: now,
          updatedAt: now,
          resolution: parent?.resolution ?? "active",
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
    // Source reads yield, so validate the authoritative revision again before commit.
    if (this.get(reviewId).revision !== expectedRevision)
      throw new HostError("stale-notes", "The notes changed. Refresh notes before retrying.", 409);
    const { scope, identities } = this.describe(reviewId);
    const next = { reviewId, revision: state.revision + 1, notes };
    let total = Buffer.byteLength(JSON.stringify(next));
    for (const [key, entry] of this.scopes)
      if (key !== scope) total += Buffer.byteLength(JSON.stringify(entry.state));
    if (total > MAX_NOTE_BYTES || (!this.scopes.has(scope) && this.scopes.size >= 128))
      throw new HostError(
        "notes-limit",
        "Session notes reached their memory limit. Remove notes before adding more.",
        413,
      );
    this.scopes.set(scope, {
      state: next,
      identities: new Map(notes.map((note) => [note.path, identities.get(note.path) ?? "missing"])),
    });
    return next;
  }

  removeRepositories(paths: ReadonlySet<string>) {
    for (const scope of this.scopes.keys())
      if (paths.has((JSON.parse(scope) as [string])[0])) this.scopes.delete(scope);
  }

  clear() {
    this.scopes.clear();
  }
}
