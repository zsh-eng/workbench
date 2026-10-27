import { useCallback, useEffect, useState } from "react";
import type { ReaderSheetId } from "../types";

/**
 * Opens a Reader sheet from the chrome. The chrome shows before the Reader
 * takes taps (`ready`), as it does on a slow device while the first page
 * settles; a tap then opens its sheet as soon as the Reader is ready rather
 * than being lost. `requested` is that sheet until it opens, so the button
 * can show that it took the tap. The last tap wins; a repeat changes nothing.
 */
export function useReaderSheetRequest({
  bookId,
  ready,
  openSheet,
}: {
  bookId: string | undefined;
  ready: boolean;
  openSheet: (sheet: ReaderSheetId) => void;
}) {
  const [request, setRequest] = useState<{
    bookId: string | undefined;
    sheet: ReaderSheetId;
  } | null>(null);
  // A request belongs to the book it was made in.
  const requested = request?.bookId === bookId ? request.sheet : null;

  useEffect(() => {
    if (!ready || requested === null) return;
    setRequest(null);
    openSheet(requested);
  }, [openSheet, ready, requested]);

  const requestSheet = useCallback(
    (sheet: ReaderSheetId) => {
      if (ready) {
        openSheet(sheet);
        return;
      }
      setRequest({ bookId, sheet });
    },
    [bookId, openSheet, ready],
  );

  return { requested, requestSheet };
}
