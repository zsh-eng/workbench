import { SessionExpiredBackdrop } from "@/components/session-expired-banner";
import { BookmarkIcon, ChevronsRight, Redo2, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ReviewScreen } from "./ReviewSpecimen";
import type { FrameSpecimenProps } from "./selection";

/** The messages and icons that the app's actions show, on sample data. */
function showToast(state: string) {
  switch (state) {
    case "created":
      return toast.success("Flashcard created");
    case "saved":
      return toast("Saved", {
        icon: (
          <BookmarkIcon className="size-4 text-primary" fill="currentColor" />
        ),
      });
    case "skipped":
      return toast("Skipped for 10 minutes", {
        icon: <ChevronsRight className="size-4" />,
      });
    case "deleted":
      return toast("Card deleted", {
        icon: <Trash className="size-4" />,
        action: { label: "Undo", onClick: () => {} },
      });
    case "undo":
      return toast("Undo successful", { icon: <Redo2 className="size-4" /> });
    case "error":
      return toast.error("Could not save your review. Please try again.");
    case "sync":
      return toast.promise(
        new Promise((resolve) => window.setTimeout(resolve, 1500)),
        { loading: "Syncing...", success: "Synced!", error: "Error syncing" },
      );
  }
}

/**
 * The app's Toaster over the review screen. Each choice shows its toast once;
 * Replay shows it again. Toasts sit top right on desktop and top centre on a
 * phone.
 */
export function ToastSpecimen({ state }: FrameSpecimenProps) {
  useEffect(() => {
    toast.dismiss();
    // A short wait lets the screen settle, and lets Strict Mode's second
    // mount show one toast, not two.
    const timer = window.setTimeout(() => showToast(state), 300);
    return () => window.clearTimeout(timer);
  }, [state]);
  return <ReviewScreen state="question" />;
}

/**
 * The banner that asks the user to sign in again. The real banner reads the
 * session expiry from IndexedDB, so this shows its backdrop alone. Sign in
 * and close both dismiss it here; Reset shows it again.
 */
export function SessionSpecimen() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <ReviewScreen state="question" />
      {open && (
        <SessionExpiredBackdrop
          onClose={() => setOpen(false)}
          onAction={() => setOpen(false)}
        />
      )}
    </>
  );
}
