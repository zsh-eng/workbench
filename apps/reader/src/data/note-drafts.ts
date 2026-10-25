import type { NoteDraft, NoteTarget } from "@/types/note";
import { db, isNotDeleted } from "./database";
import { createNote, updateNote, validateNoteAnchor } from "./notes";

export type { NoteDraft } from "@/types/note";
export const createNoteDraftId = (bookId: string) => `create:${bookId}`;
export const editNoteDraftId = (noteId: string) => `edit:${noteId}`;

export async function getNoteDraft(id: string): Promise<NoteDraft | undefined> {
  return db.noteDrafts.get(id);
}

/** Resume the existing compose draft without replacing its captured location. */
export async function beginNoteDraft(
  bookId: string,
  target: NoteTarget,
): Promise<NoteDraft> {
  validateNoteAnchor(target.anchor);
  return db.transaction("rw", db.noteDrafts, async () => {
    const id = createNoteDraftId(bookId);
    const existing = await db.noteDrafts.get(id);
    if (existing) return existing;
    const draft: NoteDraft = {
      id,
      bookId,
      purpose: "create",
      target,
      content: "",
      updatedAt: Date.now(),
    };
    await db.noteDrafts.add(draft);
    return draft;
  });
}

/** An edit has its own draft and original text for detecting received remote edits. */
export async function beginNoteEdit(noteId: string): Promise<NoteDraft> {
  return db.transaction("rw", [db.notes, db.noteDrafts], async () => {
    const note = await db.notes.get(noteId);
    if (!note || !isNotDeleted(note) || note.kind !== "note")
      throw new Error("Editable note no longer exists");
    const id = editNoteDraftId(noteId);
    const existing = await db.noteDrafts.get(id);
    if (existing) return existing;
    const draft: NoteDraft = {
      id,
      bookId: note.bookId,
      purpose: "edit",
      noteId,
      originalContent: note.content,
      content: note.content,
      updatedAt: Date.now(),
    };
    await db.noteDrafts.add(draft);
    return draft;
  });
}

export async function saveNoteDraft(
  id: string,
  content: string,
  target?: NoteTarget,
): Promise<void> {
  await db.transaction("rw", db.noteDrafts, async () => {
    const draft = await db.noteDrafts.get(id);
    if (!draft) throw new Error("Draft no longer exists");
    if (target) validateNoteAnchor(target.anchor);
    await db.noteDrafts.put({
      ...draft,
      content,
      ...(draft.purpose === "create" && target ? { target } : {}),
      updatedAt: Date.now(),
    });
  });
}

export async function discardNoteDraft(id: string): Promise<void> {
  await db.noteDrafts.delete(id);
}

export type SubmitNoteDraftResult =
  | { status: "saved"; noteId: string }
  | { status: "missing-draft" | "deleted-note" }
  | { status: "conflict"; currentContent: string };

/** Commit and remove only this draft atomically. Failed edits retain the draft.
 * Callers must await pending draft writes before submitting. No unload write is required.
 */
export async function submitNoteDraft(
  id: string,
): Promise<SubmitNoteDraftResult> {
  return db.transaction(
    "rw",
    [db.notes, db.highlights, db.noteDrafts],
    async () => {
      const draft = await db.noteDrafts.get(id);
      if (!draft) return { status: "missing-draft" };
      if (draft.purpose === "edit") {
        const note = await db.notes.get(draft.noteId);
        if (!note || !isNotDeleted(note) || note.kind !== "note")
          return { status: "deleted-note" };
        if (note.content !== draft.originalContent)
          return { status: "conflict", currentContent: note.content };
        await updateNote(note.id, draft.content);
        await db.noteDrafts.delete(id);
        return { status: "saved", noteId: note.id };
      }
      const noteId = await createNote(
        draft.bookId,
        draft.content,
        draft.target,
      );
      await db.noteDrafts.delete(id);
      return { status: "saved", noteId };
    },
  );
}
