import { useCallback, useRef } from "react";
import { useHotkey } from "@tanstack/react-hotkeys";
import { toast } from "sonner";

type Deletion = { id: string; dismiss: () => void };

/** Book-scoped deletion history. Toast, island and keyboard Undo share one
 * stack; failed restores stay available. Text fields retain their native undo
 * history. A caller with its own Undo surface passes `notify` instead of a toast. */
export function useNotebookDeletion({
  remove,
  restore,
  shortcutEnabled,
}: {
  remove: (id: string) => Promise<boolean>;
  restore: (id: string) => Promise<void>;
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
        await restore(deletion.id);
        deletions.current = deletions.current.filter(
          (item) => item !== deletion,
        );
        deletion.dismiss();
      } catch {
        restoredEntries.current.delete(deletion.id);
        toast.error("Could not restore note.");
      } finally {
        restoring.current = false;
      }
    },
    [restore],
  );
  const deleteNote = useCallback(
    async (id: string, notify?: (undo: () => void) => () => void) => {
      if (!(await remove(id))) return false;
      const deletion: Deletion = { id, dismiss: () => {} };
      const undoDeletion = () => void undo(deletion);
      if (notify) deletion.dismiss = notify(undoDeletion);
      else {
        const toastId = toast("Deleted note.", {
          duration: 8000,
          action: {
            label: "Undo",
            onClick: (event) => {
              event.preventDefault();
              undoDeletion();
            },
          },
        });
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
        name: "Undo note deletion",
        description: "Restore the last deleted note while the notebook is open",
      },
    },
  );
  return { deleteNote, restoredEntries };
}
