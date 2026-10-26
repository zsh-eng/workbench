import { useEpubImport } from "@/features/library/use-epub-import";
import { useAuth } from "@/hooks/use-auth";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { InstallSheet } from "./InstallSheet";
import {
  closeInstallSheet,
  offerDue,
  offersByItself,
  openInstallSheet,
  readOfferRecord,
  recordFirstBook,
  recordSeen,
  recordSheetClosed,
  recordVisit,
  useInstallAvailability,
  useInstallSheet,
} from "./install-offer";
import { currentTraits } from "./install-platform";
import { promptToInstall } from "./install-prompt";

/** Quiet time on the Library, without a touch or a key, before the offer. */
export const CALM_MS = 4000;

/** Anything the person is reading or answering: the offer waits for it. */
const BUSY =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [data-sonner-toast]';

/**
 * Renders the install sheet and decides when it opens by itself. It never
 * nags and never interrupts reading:
 *
 * - Only in the Library, never in a book, and only where installing takes
 *   a few taps: Safari on iPhone and iPad, and Chromium holding its prompt.
 * - After the first book is added, or on a second visit (a page load or a
 *   return after half an hour away).
 * - At a calm moment: four seconds without a touch or key, with no import,
 *   menu, dialog or toast showing, so the "Added" toast and its Open book
 *   come first.
 * - Online: iOS fetches the icon and launch screen from the network when
 *   Add to Home Screen is tapped, and the Home Screen app starts with its
 *   own empty storage, so it has to open online once.
 * - Once: closing the sheet, by Not now, a swipe or Install, is remembered,
 *   and it never opens by itself again. The account menu and Settings
 *   always offer it while Reader is not installed.
 */
export function InstallOfferHost() {
  const { pathname } = useLocation();
  const { isProcessing } = useEpubImport();
  const { isAuthenticated, status } = useAuth();
  const { platform, installed, canPrompt } = useInstallAvailability();
  const sheet = useInstallSheet();
  const [record, setRecord] = useState(readOfferRecord);
  const [hasBooks, setHasBooks] = useState(false);
  const bookCount = useRef<number | null>(null);
  const onLibrary = pathname === "/";
  const reading = pathname.startsWith("/reader/");

  useEffect(() => {
    setRecord(recordVisit());
    const onVisibility = () => {
      if (document.visibilityState === "hidden") recordSeen();
      else setRecord(recordVisit());
    };
    const onPageHide = () => recordSeen();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onPageHide);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
    };
  }, []);

  useEffect(() => {
    if (reading) closeInstallSheet();
  }, [reading]);

  const armed =
    onLibrary &&
    !isProcessing &&
    !sheet.open &&
    !installed &&
    offersByItself(platform, canPrompt) &&
    offerDue(record);
  useEffect(() => {
    if (!armed) return;
    let timer = 0;
    const wait = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(check, CALM_MS);
    };
    const check = () => {
      if (
        document.visibilityState !== "visible" ||
        !navigator.onLine ||
        document.querySelector(BUSY)
      )
        wait();
      else openInstallSheet("offer");
    };
    const inputs = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"];
    for (const input of inputs)
      window.addEventListener(input, wait, { capture: true, passive: true });
    wait();
    return () => {
      window.clearTimeout(timer);
      for (const input of inputs)
        window.removeEventListener(input, wait, { capture: true });
    };
  }, [armed]);

  const traits = currentTraits();
  return (
    <>
      {onLibrary && (
        <LibraryBookCount
          onCount={(count) => {
            if (bookCount.current === 0 && count > 0)
              setRecord(recordFirstBook());
            bookCount.current = count;
            setHasBooks(count > 0);
          }}
        />
      )}
      <InstallSheet
        isOpen={sheet.open}
        onOpenChange={(open) => {
          if (open) return;
          closeInstallSheet();
          setRecord(recordSheetClosed());
        }}
        platform={platform}
        traits={traits}
        host={window.location.host}
        onInstall={promptToInstall}
        booksStayInSafari={
          platform === "ios-safari" &&
          hasBooks &&
          !(isAuthenticated || status === "expired")
        }
      />
    </>
  );
}

/** The Library's book count, read only while the Library shows. */
function LibraryBookCount({ onCount }: { onCount: (count: number) => void }) {
  const { data } = useBooksWithStatuses();
  const count = data?.books.length;
  const report = useEffectEvent((count: number) => onCount(count));
  useEffect(() => {
    if (count !== undefined) report(count);
  }, [count]);
  return null;
}
