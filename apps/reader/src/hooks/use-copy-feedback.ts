import { copyText } from "@/lib/clipboard";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

const COPIED_MS = 1400;

/**
 * Copy for a control that confirms in place: `copied` holds for a moment
 * after each copy, and a failure shows a toast. Call `copy` from the tap or
 * click itself, so the clipboard write stays inside the user's gesture.
 */
export function useCopyFeedback(failureMessage: string) {
  const [copiedAt, setCopiedAt] = useState(0);
  useEffect(() => {
    if (!copiedAt) return;
    const timer = window.setTimeout(() => setCopiedAt(0), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copiedAt]);

  const copy = useCallback(
    (text: string) => {
      void copyText(text).then((copied) => {
        if (copied) setCopiedAt(Date.now());
        else toast.error(failureMessage, { id: "copy-failed" });
      });
    },
    [failureMessage],
  );

  return { copied: copiedAt > 0, copy };
}
