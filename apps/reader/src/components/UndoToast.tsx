import { Toast, UNDO_SECONDS, UndoCountdown } from "@workbench/elements/toast";
import "@workbench/elements/toast.css";
import { toast } from "sonner";

// The toast and its countdown are Workbench's, shared with Arctic for the web
// (packages/elements/src/toast.tsx). The notes island shows the same ring.
export { UNDO_SECONDS, UndoCountdown };

/** How long a toast that says the change was undone stays. */
const DONE_MS = 1600;

/** One toast offering Undo, for as long as it is on screen. */
export type UndoToast = {
  /** Whether Undo is still on offer: the countdown has not run out, the toast
   * was not swiped away, and the change was not undone. */
  readonly offering: boolean;
  /** Takes in another change: new words, and the countdown starts again. */
  update: (message: string) => void;
  /** The change was undone. The same toast says so with a check and leaves.
   * With the toast gone, a short one says it. */
  done: (message?: string) => void;
  dismiss: () => void;
};

let toasts = 0;

/** Shows a toast with Undo and its countdown. The action is already saved:
 * the timeout ends the offer, not the change. Pointing at the toast, focus
 * in it, or a hidden tab holds the count. The toast keeps its identity:
 * `update` and `done` change it in place rather than showing another. */
export function showUndoToast({
  message,
  onUndo,
  onEnd,
  seconds = UNDO_SECONDS,
}: {
  message: string;
  onUndo: () => void;
  /** The offer ended: the countdown ran out, or the toast was dismissed. */
  onEnd?: () => void;
  seconds?: number;
}): UndoToast {
  const id = `undo-${++toasts}`;
  let words = message;
  let round = 0;
  let done = false;
  let offering = true;
  let onScreen = true;
  let leaving = 0;
  const end = () => {
    if (!offering) return;
    offering = false;
    onEnd?.();
  };
  const leave = () => {
    onScreen = false;
    end();
    toast.dismiss(id);
  };
  const render = () =>
    toast.custom(
      () => (
        <Toast
          role="status"
          className="reader-toast"
          message={words}
          done={done}
          undo={{ seconds, round, onUndo, onDone: leave }}
        />
      ),
      // The toast is its own surface. The toaster's padding for plain toasts
      // would push it past the right edge of a phone.
      {
        id,
        duration: Infinity,
        style: { padding: 0, minHeight: 0 },
        onDismiss: () => {
          onScreen = false;
          end();
        },
      },
    );
  render();
  return {
    get offering() {
      return offering;
    },
    update(next) {
      if (!offering) return;
      words = next;
      round += 1;
      render();
    },
    done(next = "Restored") {
      end();
      if (!onScreen) return showDoneToast(next);
      words = next;
      done = true;
      render();
      window.clearTimeout(leaving);
      leaving = window.setTimeout(leave, DONE_MS);
    },
    dismiss: leave,
  };
}

/** A change undone after its toast left: a short toast, already done. */
function showDoneToast(message: string) {
  toast.custom(
    () => (
      <Toast
        role="status"
        className="reader-toast"
        message={message}
        done
        undo={{ onUndo: () => {} }}
      />
    ),
    {
      id: `undo-${++toasts}`,
      duration: DONE_MS,
      style: { padding: 0, minHeight: 0 },
    },
  );
}
