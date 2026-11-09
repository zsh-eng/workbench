import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Shared removal confirmation; cancellation does not change the book. */
export function RemoveBookDialog({
  open,
  onOpenChange,
  bookTitle,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bookTitle: string;
  onConfirm: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function confirm() {
    setPending(true);
    setError("");
    try {
      await onConfirm();
      onOpenChange(false);
    } catch {
      setError("Couldn’t remove this book. Try again.");
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setError("");
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={false} forceBackdrop>
        <DialogHeader>
          <DialogTitle>Remove book?</DialogTitle>
          <DialogDescription className="text-pretty break-words">
            Remove “{bookTitle}” and its reading data from your library? This
            cannot be undone.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            className="min-h-11 sm:min-h-9"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            className="min-h-11 sm:min-h-9"
            variant="destructive"
            disabled={pending}
            onClick={() => void confirm()}
          >
            {pending ? "Removing…" : "Remove book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
