import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { downloadBooks } from "@/lib/background-activity";
import type { Book } from "@/lib/db";
import { offlineDownloads, useDebugSwitch } from "@/lib/debug-switch";
import { files } from "@/lib/files";
import { CloudDownload } from "lucide-react";
import { useSyncExternalStore } from "react";
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
                  message: `All ${books.length} books are on this device.`,
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
