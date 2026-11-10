import type { Note, NoteInput } from '../protocol';
import { utf8ByteLength } from './validation';

/** Validate note text before any state change. Limits apply to UTF-8 bytes. */
export function validateReviewNoteText(text: string): void {
  if (!text.trim()) throw new Error('A note must contain text.');
  if (utf8ByteLength(text) > 16_384) throw new Error('A note must not exceed 16 KiB.');
}

export function reviewSourceLineCount(source: string): number {
  if (!source.length) return 0;
  return source.split('\n').length - (source.endsWith('\n') ? 1 : 0);
}

/** Sources must be the exact versions named by the addressed review. */
export function validateReviewNoteInput(
  note: NoteInput,
  sources: { old: string; new: string },
  existingNotes: readonly Note[] = [],
): void {
  validateReviewNoteText(note.text);
  const end = note.endLine ?? note.line;
  const count = reviewSourceLineCount(sources[note.side]);
  if (!Number.isInteger(note.line) || !Number.isInteger(end) || note.line < 1 || end < note.line || end > count) {
    throw new Error('The note range is outside this file version.');
  }
  if (note.parentId) {
    const parent = existingNotes.find((candidate) => candidate.id === note.parentId);
    if (!parent || parent.path !== note.path) throw new Error('A reply must refer to a note in the same file.');
  }
}

export function validateReviewNoteRemoval(id: string, notes: readonly Note[]): void {
  if (!notes.some((note) => note.id === id)) throw new Error('This note no longer exists.');
}

/** What a removal takes: the note, and the replies under it, the agent's too,
 * so a thread goes in one step. */
export function reviewNoteThread(id: string, notes: readonly Note[]): Set<string> {
  const gone = new Set([id]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const note of notes)
      if (note.parentId && gone.has(note.parentId) && !gone.has(note.id)) {
        gone.add(note.id);
        grew = true;
      }
  }
  return gone;
}

/** Removes a note with its replies, in place. */
export function removeReviewNote(id: string, notes: Note[]): void {
  validateReviewNoteRemoval(id, notes);
  const gone = reviewNoteThread(id, notes);
  for (let index = notes.length - 1; index >= 0; index--)
    if (gone.has(notes[index]!.id)) notes.splice(index, 1);
}
