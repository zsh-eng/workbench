import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { activity, downloadBooks } from "@/lib/background-activity";
import type { Book } from "@/lib/db";
import { offlineDownloads, useDebugSwitch } from "@/lib/debug-switch";
import { files } from "@/lib/files";
import { CloudDownload } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { ActivityGlyph } from "./ActivityGlyph";
import { CoverActivity } from "./CoverActivity";
import { UpdateChip } from "./UpdateChip";

/**
 * The Library's background parts: the update chip, and the activity glyph
 * (Debug → Offline downloads). With room,
 * both sit in the header. A phone's header is full with the places, so the
 * glyph joins Sort and layout in the filter row, where Download all starts,
 * and the chip floats at the bottom of the page.
 */
export function LibraryActivity({ place }: { place: "header" | "row" }) {
  const downloads = useDebugSwitch(offlineDownloads);
  const phone = usePhoneLayout();
  if (place === "row") return downloads && phone ? <ActivityGlyph /> : null;
  if (phone) return <UpdateChip floating />;
  return (
    <>
      <UpdateChip className="mr-1" />
      {downloads && <ActivityGlyph />}
    </>
  );
}

const PHONE_QUERY = "(max-width: 767px)";

/** The phone layout, from the first render, so one chip mounts, not two. */
function usePhoneLayout(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const query = window.matchMedia(PHONE_QUERY);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    },
    () => window.matchMedia(PHONE_QUERY).matches,
  );
}

/** A cover's download, with Debug -> Offline downloads. */
export function LibraryCoverActivity(props: {
  bookId: string;
  className?: string;
  compact?: boolean;
}) {
  const downloads = useDebugSwitch(offlineDownloads);
  return downloads ? <CoverActivity {...props} /> : null;
}

async function missingBooks(books: readonly Book[]): Promise<Book[]> {
  const missing: Book[] = [];
  for (const book of books)
    if (!(await files.hasLocal(book.sourceFileId))) missing.push(book);
  return missing;
}

/** "Download all for offline", in the Library's view menu. */
export function DownloadAllForOffline({ books }: { books: readonly Book[] }) {
  const downloads = useDebugSwitch(offlineDownloads);
  const { toast } = useToast();
  if (!downloads) return null;
  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel className="pt-2 pb-1 text-xs font-normal text-muted-foreground">
          Offline
        </DropdownMenuLabel>
        <DropdownMenuItem
          onClick={() => {
            void missingBooks(books).then((missing) => {
              if (missing.length === 0) {
                toast({
                  message:
                    books.length === 1
                      ? "Your book is on this device."
                      : `All ${books.length} books are on this device.`,
                });
                return;
              }
              downloadBooks(missing);
            });
          }}
        >
          <CloudDownload />
          Download all for offline
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </>
  );
}

/** "Download for offline", in a book's menu. */
export function DownloadForOfflineItem({ book }: { book: Book }) {
  const downloads = useDebugSwitch(offlineDownloads);
  const { toast } = useToast();
  if (!downloads) return null;
  return (
    <DropdownMenuItem
      onClick={() => {
        void missingBooks([book]).then((missing) => {
          if (missing.length === 0)
            toast({ message: `${book.title} is on this device.` });
          else downloadBooks(missing);
        });
      }}
    >
      <CloudDownload />
      Download for offline
    </DropdownMenuItem>
  );
}

/** The Library's filter for books you can open offline. */
export const ON_DEVICE_FILTER = {
  value: "on-device",
  label: "On this device",
} as const;

/** The download jobs that have finished, as one string that changes with them. */
function finishedDownloads(): string {
  return activity
    .getSnapshot()
    .jobs.filter((job) => job.kind === "book-download" && job.state === "done")
    .map((job) => job.id)
    .join();
}

/** The ids of the books on this device; null until they are known. */
function useBooksOnDevice(
  books: readonly Book[] | undefined,
  enabled: boolean,
): ReadonlySet<string> | null {
  // Only a finished download changes the answer; progress does not render.
  const finished = useSyncExternalStore(
    activity.subscribe,
    finishedDownloads,
    finishedDownloads,
  );
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  useEffect(() => {
    if (!enabled || !books) return;
    let cancelled = false;
    void Promise.all(
      books.map(
        async (book) =>
          [book.id, await files.hasLocal(book.sourceFileId)] as const,
      ),
    ).then((results) => {
      if (cancelled) return;
      setIds(new Set(results.filter(([, here]) => here).map(([id]) => id)));
    });
    return () => {
      cancelled = true;
    };
  }, [books, enabled, finished]);
  return ids;
}

/**
 * "On this device", with Debug -> Offline downloads. While the grid is on
 * screen it keeps the books it showed when you chose it: a download that
 * finishes does not push a cover in between the others. The filter takes
 * in what changed when you choose it again or come back to the app.
 * `ids` is null while the filter is off or not yet known.
 */
export function useOnDeviceFilter(
  books: readonly Book[] | undefined,
  active: boolean,
): { enabled: boolean; ids: ReadonlySet<string> | null } {
  const enabled = useDebugSwitch(offlineDownloads);
  const live = useBooksOnDevice(books, enabled);
  const [view, setView] = useState<{
    active: boolean;
    held: ReadonlySet<string> | null;
    fresh: boolean;
  }>({ active, held: null, fresh: false });
  let current = view;
  if (current.active !== active)
    current = { active, held: active ? null : current.held, fresh: false };
  if (active && live && !current.fresh)
    current = { ...current, held: live, fresh: true };
  if (current !== view) setView(current);

  // Back from another app: the next look takes in what finished meanwhile.
  useEffect(() => {
    if (!active) return;
    const onChange = () => {
      if (document.visibilityState === "visible")
        setView((now) => ({ ...now, fresh: false }));
    };
    document.addEventListener("visibilitychange", onChange);
    return () => document.removeEventListener("visibilitychange", onChange);
  }, [active]);

  return { enabled, ids: enabled && active ? current.held : null };
}
