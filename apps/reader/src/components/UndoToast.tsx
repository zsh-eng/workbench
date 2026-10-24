import { Toast, UNDO_SECONDS, UndoCountdown } from "@workbench/elements/toast";
import "@workbench/elements/toast.css";
import { toast } from "sonner";

// The toast and its countdown are Workbench's, shared with Arctic for the web
// (packages/elements/src/toast.tsx). The notes island shows the same ring.
export { UNDO_SECONDS, UndoCountdown };

/** Shows a toast with Undo and its countdown; returns its dismissal. The
 * action is already saved: the timeout dismisses the offer, not the change.
 * Pointing at the toast, focus in it, or a hidden tab holds the count. */
export function showUndoToast({
  message,
  onUndo,
  seconds = UNDO_SECONDS,
}: {
  message: string;
  onUndo: () => void;
  seconds?: number;
}): () => void {
  const id = toast.custom(
    (id) => (
      <Toast
        role="status"
        className="reader-toast"
        message={message}
        undo={{ seconds, onUndo, onDone: () => toast.dismiss(id) }}
      />
    ),
    // The toast is its own surface. The toaster's padding for plain toasts
    // would push it past the right edge of a phone.
    { duration: Infinity, style: { padding: 0, minHeight: 0 } },
  );
  return () => toast.dismiss(id);
}
