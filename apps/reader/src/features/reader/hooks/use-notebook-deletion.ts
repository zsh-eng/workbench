import { useCallback, useRef } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { toast } from "sonner";

/** A notebook entry: a note, or a highlight without a note. */
export type NotebookEntryRef = { kind: "note" | "highlight"; id: string };
type Deletion = NotebookEntryRef & { dismiss: () => void };

const NOUN = { note: "note", highlight: "highlight" } as const;

/** Book-scoped deletion history. Toast, island and keyboard Undo share one
 * stack for notes and highlights; failed restores stay available. Text fields
 * retain their native undo history. A caller with its own Undo surface passes
 * `notify` instead of a toast. */
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
  const restoring = useRef(false);
  // Exiting rows must not clear a pending Undo entrance or scroll it to the end.
  const restoredEntries = useRef(new Set<string>());
  const undo = useCallback(
    async (deletion: Deletion) => {
      if (restoring.current || !deletions.current.includes(deletion)) return;
      restoring.current = true;
      restoredEntries.current.add(deletion.id);
      try {
        await restore(deletion);
        deletions.current = deletions.current.filter(
          (item) => item !== deletion,
        );
        deletion.dismiss();
      } catch {
        restoredEntries.current.delete(deletion.id);
        toast.error(`Could not restore the ${NOUN[deletion.kind]}.`);
      } finally {
        restoring.current = false;
      }
    },
    [restore],
  );
  const deleteEntry = useCallback(
    async (
      entry: NotebookEntryRef,
      notify?: (undo: () => void) => () => void,
    ) => {
      if (!(await remove(entry))) return false;
      const deletion: Deletion = { ...entry, dismiss: () => {} };
      const undoDeletion = () => void undo(deletion);
      if (notify) deletion.dismiss = notify(undoDeletion);
      else {
        const noun = NOUN[entry.kind];
        const toastId = toast(
          `${noun[0].toUpperCase()}${noun.slice(1)} deleted`,
          {
            duration: 8000,
            action: {
              label: "Undo",
              onClick: (event) => {
                event.preventDefault();
                undoDeletion();
              },
            },
          },
        );
        deletion.dismiss = () => toast.dismiss(toastId);
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
      void undo(deletion);
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
