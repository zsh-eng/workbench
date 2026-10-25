/** Durable notebook entries. Each mutation uses the ordinary sync outbox path. */
import type { Highlight } from "@/types/highlight";
import type { Note, NoteAnchor, NoteTarget } from "@/types/note";
import { MAX_SYNC_VALUE_BYTES } from "@zsh-eng/local-sync";
import { db, isNotDeleted } from "./database";

export type { Note, NoteAnchor, NoteTarget } from "@/types/note";

function validateRecord(value: object) {
  if (
    new TextEncoder().encode(JSON.stringify(value)).byteLength >
    MAX_SYNC_VALUE_BYTES
  )
    throw new Error("Note exceeds the sync record size limit");
}

export function validateNoteContent(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) throw new Error("A note must contain text");
  return trimmed;
}

export function validateNoteAnchor(anchor: NoteAnchor) {
  if (
    !anchor.spineItemId ||
    !Number.isInteger(anchor.startOffset) ||
    !Number.isInteger(anchor.endOffset) ||
    anchor.startOffset < 0 ||
    anchor.endOffset < anchor.startOffset
  )
    throw new Error("Invalid note anchor");
}

export async function addNote(note: Note): Promise<string> {
  validateNoteAnchor(note.anchor);
  const row = {
    ...note,
    ...(note.kind === "note"
      ? { content: validateNoteContent(note.content) }
      : {}),
    isDeleted: false,
  };
  validateRecord(row);
  return db.notes.add(row);
}

/** A selected range and its note become durable together; drafts create no highlights. */
export async function createNote(
  bookId: string,
  content: string,
  target: NoteTarget,
): Promise<string> {
  const now = Date.now();
  const note: Note = {
    id: crypto.randomUUID(),
    bookId,
    kind: "note",
    content: validateNoteContent(content),
    anchor: target.anchor,
    createdAt: now,
    updatedAt: now,
  };
  return db.transaction("rw", [db.notes, db.highlights], async () => {
    if (target.kind === "highlight") {
      note.highlightId = target.highlightId;
      note.quote = { ...target.quote };
    }
    if (target.kind === "selection") {
      if (!target.text.trim())
        throw new Error("A selected range must contain text");
      const highlight: Highlight = {
        id: crypto.randomUUID(),
        bookId,
        ...target.anchor,
        selectedText: target.text,
        color: "invisible",
        createdAt: now,
        updatedAt: now,
      };
      validateRecord({ ...highlight, isDeleted: false });
      await db.highlights.add({ ...highlight, isDeleted: false });
      note.highlightId = highlight.id;
      note.quote = { text: target.text, color: "invisible" };
    }
    return addNote(note);
  });
}

export async function createBookmark(
  bookId: string,
  anchor: NoteAnchor,
): Promise<string> {
  const now = Date.now();
  return addNote({
    id: crypto.randomUUID(),
    bookId,
    kind: "bookmark",
    anchor,
    createdAt: now,
    updatedAt: now,
  });
}

function ordered(notes: Note[]): Note[] {
  return notes.sort(
    (a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id),
  );
}

export async function getBookNotes(bookId: string): Promise<Note[]> {
  return ordered(
    await db.notes
      .where("bookId")
      .equals(bookId)
      .filter(isNotDeleted)
      .toArray(),
  );
}

export async function getNotesByHighlight(
  highlightId: string,
): Promise<Note[]> {
  return ordered(
    await db.notes
      .where("highlightId")
      .equals(highlightId)
      .filter(isNotDeleted)
      .toArray(),
  );
}

export async function getAllNotes(): Promise<Note[]> {
  return ordered(await db.notes.filter(isNotDeleted).toArray());
}

export async function updateNote(id: string, content: string): Promise<void> {
  const text = validateNoteContent(content);
  await db.transaction("rw", db.notes, async () => {
    const note = await db.notes.get(id);
    if (!note || !isNotDeleted(note)) throw new Error("Note no longer exists");
    if (note.kind !== "note")
      throw new Error("Bookmarks do not contain note text");
    const updated = { ...note, content: text, updatedAt: Date.now() };
    validateRecord(updated);
    await db.notes.put(updated);
  });
}

/** Deleting a note retains its highlight; a local unfinished edit is removed. */
export async function deleteNote(id: string): Promise<void> {
  await db.transaction("rw", [db.notes, db.noteDrafts], async () => {
    await db.noteDrafts.delete(`edit:${id}`);
    const note = await db.notes.get(id);
    if (note && isNotDeleted(note)) await db.notes.delete(id);
  });
}

/** Undo a deletion through the same synced write path. A live row is left intact,
 * so an already received restore or edit is never replaced by an older snapshot.
 */
export async function restoreNote(id: string): Promise<void> {
  await db.transaction("rw", db.notes, async () => {
    const note = await db.notes.get(id);
    if (!note) throw new Error("Deleted note is no longer available");
    if (isNotDeleted(note)) return;
    await db.notes.put({ ...note, isDeleted: false, updatedAt: Date.now() });
  });
}
