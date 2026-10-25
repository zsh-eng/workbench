import { useCallback, useRef } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { toast } from "sonner";
import { showUndoToast, type UndoToast } from "@/components/UndoToast";

/** A notebook entry: a note, or a highlight without a note. */
export type NotebookEntryRef = { kind: "note" | "highlight"; id: string };

/** One deletion, in the keyboard's Undo history. */
type Deletion = NotebookEntryRef & { batch: Batch };

/** Deletions that one toast describes, or one island notice. Its entries are
 * the ones still deleted. */
type Batch = {
  entries: Deletion[];
  toast: UndoToast | null;
  /** The island's Undo: called once the entry is back. */
  restored?: () => void;
};

/** "Highlight deleted", "3 highlights deleted", "1 note and 2 highlights
 * deleted". */
export function describeDeletion(entries: NotebookEntryRef[]): string {
  const notes = entries.filter((entry) => entry.kind === "note").length;
  const highlights = entries.length - notes;
  const count = (n: number, word: string) =>
    `${n} ${n === 1 ? word : `${word}s`}`;
  if (entries.length === 1) return notes ? "Note deleted" : "Highlight deleted";
  if (!highlights) return `${count(notes, "note")} deleted`;
  if (!notes) return `${count(highlights, "highlight")} deleted`;
  return `${count(notes, "note")} and ${count(highlights, "highlight")} deleted`;
}

/** Book-scoped deletion history. Toast, island and keyboard Undo share one
 * stack for notes and highlights; failed restores stay available. Text fields
 * retain their native undo history. A caller with its own Undo surface passes
 * `notify` instead of a toast.
 *
 * Deletions in quick succession share one toast: while it offers Undo, each
 * one joins it ("3 highlights deleted") and starts its countdown again. Its
 * Undo takes them all back, and the same toast then says "Restored". The
 * keyboard's Undo takes back one deletion at a time, and the toast counts
 * down what is left. */
export function useNotebookDeletion({
  remove,
  restore,
  shortcutEnabled,
}: {
  remove: (entry: NotebookEntryRef) => Promise<boolean>;
  restore: (entry: NotebookEntryRef) => Promise<void>;
  shortcutEnabled: boolean;
}) {
  const deletions = useRef<Deletion[]>([]);
  /** The batch whose toast still offers Undo, which a new deletion joins. */
  const open = useRef<Batch | null>(null);
  const restoring = useRef(false);
  // Exiting rows must not clear a pending Undo entrance or scroll it to the end.
  const restoredEntries = useRef(new Set<string>());
  const undo = useCallback(
    async (items: Deletion[]) => {
      const pending = items.filter((item) => deletions.current.includes(item));
      if (restoring.current || !pending.length) return;
      restoring.current = true;
      const failed: Deletion[] = [];
      const changed = new Set<Batch>();
      // The newest first, so each comes back where it was.
      for (const item of [...pending].reverse()) {
        restoredEntries.current.add(item.id);
        try {
          await restore({ kind: item.kind, id: item.id });
          deletions.current = deletions.current.filter((d) => d !== item);
          item.batch.entries = item.batch.entries.filter((d) => d !== item);
          changed.add(item.batch);
        } catch {
          restoredEntries.current.delete(item.id);
          failed.push(item);
        }
      }
      for (const batch of changed) {
        if (batch.entries.length) {
          batch.toast?.update(describeDeletion(batch.entries));
          continue;
        }
        if (open.current === batch) open.current = null;
        if (batch.toast) batch.toast.done();
        else batch.restored?.();
      }
      if (failed.length)
        toast.error(
          failed.length === 1
            ? `Could not restore the ${failed[0].kind}.`
            : `Could not restore ${failed.length} entries.`,
          { id: "notebook-restore-failed" },
        );
      restoring.current = false;
    },
    [restore],
  );
  const deleteEntry = useCallback(
    async (
      entry: NotebookEntryRef,
      notify?: (undo: () => void) => () => void,
    ) => {
      if (!(await remove(entry))) return false;
      const joining = notify ? null : open.current;
      if (joining?.toast?.offering) {
        const deletion: Deletion = { ...entry, batch: joining };
        joining.entries.push(deletion);
        deletions.current.push(deletion);
        joining.toast.update(describeDeletion(joining.entries));
        return true;
      }
      const batch: Batch = { entries: [], toast: null };
      const deletion: Deletion = { ...entry, batch };
      batch.entries.push(deletion);
      const undoBatch = () => void undo(batch.entries);
      if (notify) batch.restored = notify(undoBatch);
      else {
        batch.toast = showUndoToast({
          message: describeDeletion(batch.entries),
          onUndo: undoBatch,
          onEnd: () => {
            if (open.current === batch) open.current = null;
          },
        });
        open.current = batch;
      }
      deletions.current.push(deletion);
      return true;
    },
    [remove, undo],
  );
  useHotkey(
    "Mod+Z",
    (event) => {
      const deletion = deletions.current.at(-1);
      if (event.defaultPrevented || event.isComposing || !deletion) return;
      event.preventDefault();
      void undo([deletion]);
    },
    {
      target: window,
      enabled: shortcutEnabled,
      ignoreInputs: true,
      preventDefault: false,
      stopPropagation: false,
      requireReset: true,
      meta: {
        name: "Undo notebook deletion",
        description:
          "Restore the last deleted note or highlight while the notebook is open",
      },
    },
  );
  return { deleteEntry, restoredEntries };
}
