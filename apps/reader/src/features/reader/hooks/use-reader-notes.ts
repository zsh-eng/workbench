import { useBookNotesQuery, noteKeys } from "@/hooks/use-notes-query";
import { useQueryClient } from "@tanstack/react-query";
import {
  beginNoteDraft,
  beginNoteEdit,
  discardNoteDraft,
  createNoteDraftId,
  getNoteDraft,
  saveNoteDraft,
  submitNoteDraft,
} from "@/data/note-drafts";
import { deleteNote, restoreNote } from "@/data/notes";
import type { Note, NoteTarget } from "@/types/note";
import { SyncValueTooLargeError } from "@zsh-eng/local-sync";
import { useCallback, useEffect, useRef, useState } from "react";

type ReaderDraft = {
  content: string;
  target: NoteTarget;
  editId?: string;
  noteId?: string;
};

/** Book-scoped draft writer. Calls are serialized; typing never updates the book query.
 * The Reader mounts this below its pagination owner, so keystrokes do not render Reader.
 * Compose and edit drafts have independent storage identities. Switching flushes first.
 */
export function useReaderNotes(bookId: string) {
  const query = useBookNotesQuery(bookId);
  const client = useQueryClient();
  const [draft, setDraft] = useState<ReaderDraft | null>(null);
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const current = useRef(draft);
  const compose = useRef<ReaderDraft | null>(null);
  const writing = useRef(Promise.resolve());
  const submitting = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const mounted = useRef(false);
  const id = createNoteDraftId(bookId);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const snapshot = current.current;
    if (!snapshot) return writing.current;
    const work = writing.current
      .catch(() => {})
      .then(async () => {
        if (!snapshot.editId) await beginNoteDraft(bookId, snapshot.target);
        await saveNoteDraft(
          snapshot.editId ?? id,
          snapshot.content,
          snapshot.target,
        );
      });
    writing.current = work;
    void work.catch(() => {
      if (mounted.current)
        setError(
          "Could not save the draft. Try again before leaving this book.",
        );
    });
    return work;
  }, [bookId, id]);
  // Closing during Save/Cancel must not queue a write behind draft deletion.
  const flushWhenIdle = useCallback(
    () => (submitting.current ? writing.current : flush()),
    [flush],
  );
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    let active = true;
    void getNoteDraft(id)
      .then((saved) => {
        if (!active) return;
        if (saved?.purpose === "create") {
          const value = { content: saved.content, target: saved.target };
          current.current = value;
          setDraft(value);
        }
        setReady(true);
      })
      .catch(() => {
        if (active)
          setError(
            "Could not restore the draft. Reopen this book to try again.",
          );
      });
    const flushOnHide = () => {
      if (document.visibilityState === "hidden" && !submitting.current)
        void flushRef.current().catch(() => {});
    };
    document.addEventListener("visibilitychange", flushOnHide);
    return () => {
      active = false;
      mounted.current = false;
      document.removeEventListener("visibilitychange", flushOnHide);
      if (!submitting.current) void flushRef.current().catch(() => {});
    };
  }, [id]);

  function change(content: string, target: NoteTarget) {
    if (!ready || submitting.current) return;
    const value = current.current?.editId
      ? { ...current.current, content }
      : { content, target };
    current.current = value;
    setDraft(value);
    setError("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void flushRef.current().catch(() => {});
    }, 150);
  }

  // Finish the active write before changing draft identity. Compose text stays intact
  // while one of the independently stored edit drafts is open.
  const edit = useCallback(
    async (noteId: string) => {
      if (submitting.current) return false;
      const note = query.data?.find((item) => item.id === noteId);
      if (!note || note.kind !== "note") return false;
      submitting.current = true;
      setSaving(true);
      setError("");
      try {
        await flush();
        const saved = await beginNoteEdit(noteId);
        if (!current.current?.editId) compose.current = current.current;
        const target: NoteTarget = note.quote
          ? { kind: "selection", anchor: note.anchor, text: note.quote.text }
          : { kind: "page", anchor: note.anchor };
        const value = {
          content: saved.content,
          target,
          editId: saved.id,
          noteId,
        };
        current.current = value;
        if (mounted.current) setDraft(value);
        return true;
      } catch {
        if (mounted.current)
          setError(
            "Could not open this note for editing. Your draft is still here.",
          );
        return false;
      } finally {
        submitting.current = false;
        if (mounted.current) setSaving(false);
      }
    },
    [flush, query.data],
  );

  // Leaving the desktop editor preserves its draft and restores the composer.
  const pauseEdit = useCallback(async () => {
    if (!current.current?.editId || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      await flush();
      current.current = compose.current;
      if (mounted.current) setDraft(compose.current);
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }, [flush]);

  const remove = useCallback(
    async (noteId: string) => {
      if (submitting.current) return false;
      submitting.current = true;
      setSaving(true);
      setError("");
      try {
        await flush();
        await deleteNote(noteId);
        if (current.current?.noteId === noteId) {
          current.current = compose.current;
          if (mounted.current) setDraft(compose.current);
        }
        await client.invalidateQueries({ queryKey: noteKeys.book(bookId) });
        return true;
      } catch {
        if (mounted.current) setError("Could not delete the note. Try again.");
        return false;
      } finally {
        submitting.current = false;
        if (mounted.current) setSaving(false);
      }
    },
    [flush, client, bookId],
  );

  // Undo can still complete after the Reader unmounts; it needs no UI draft state.
  const restore = useCallback(
    async (noteId: string) => {
      await restoreNote(noteId);
      await client.invalidateQueries({ queryKey: noteKeys.book(bookId) });
    },
    [client, bookId],
  );

  async function cancelEdit() {
    const active = current.current;
    if (!active?.editId || submitting.current) return;
    submitting.current = true;
    setSaving(true);
    try {
      clearTimeout(timer.current);
      await writing.current.catch(() => {});
      await discardNoteDraft(active.editId);
      current.current = compose.current;
      if (mounted.current) {
        setDraft(compose.current);
        setError("");
      }
    } catch {
      if (mounted.current) setError("Could not cancel the edit. Try again.");
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }

  async function send() {
    if (!ready || submitting.current || !current.current?.content.trim())
      return false;
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      await flush();
      const active = current.current!;
      const result = await submitNoteDraft(active.editId ?? id);
      if (result.status === "conflict" || result.status === "deleted-note") {
        if (mounted.current)
          setError(
            result.status === "conflict"
              ? "This note changed on another device. Your edit is kept. Copy your text before cancelling and reopening the note."
              : "This note was deleted. Your edit is kept so you can copy the text.",
          );
        return false;
      }
      if (result.status !== "saved") throw new Error(result.status);
      current.current = active.editId ? compose.current : null;
      if (mounted.current) setDraft(current.current);
      await client.invalidateQueries({ queryKey: noteKeys.book(bookId) });
      return true;
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof SyncValueTooLargeError
            ? "This note is too long to sync. Shorten it, or quote a shorter passage. Your draft is still here."
            : "Could not save the note. Your draft is still here; try sending again.",
        );
      return false;
    } finally {
      submitting.current = false;
      if (mounted.current) setSaving(false);
    }
  }
  return {
    notes: query.data ?? EMPTY_NOTES,
    draft,
    composeDraft: draft?.editId ? compose.current : draft,
    ready,
    saving,
    error: error || (query.isError ? "Could not load notes." : ""),
    change,
    edit,
    cancelEdit,
    pauseEdit,
    remove,
    restore,
    editingId: draft?.noteId,
    send,
    flush: flushWhenIdle,
  };
}
const EMPTY_NOTES: Note[] = [];
