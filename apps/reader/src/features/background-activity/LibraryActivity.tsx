import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { downloadBooks } from "@/lib/background-activity";
import type { Book } from "@/lib/db";
import {
  calmUpdates,
  offlineDownloads,
  useDebugSwitch,
} from "@/lib/debug-switch";
import { files } from "@/lib/files";
import { CloudDownload } from "lucide-react";
import { ActivityGlyph } from "./ActivityGlyph";
import { CoverActivity } from "./CoverActivity";
import { UpdateChip } from "./UpdateChip";

/**
 * The Library header's background parts, each behind its Debug switch: the
 * update chip (Calm updates) and the activity glyph (Offline downloads).
 */
export function LibraryActivity() {
  const calm = useDebugSwitch(calmUpdates);
  const downloads = useDebugSwitch(offlineDownloads);
  return (
    <>
      {calm && <UpdateChip className="mr-1" />}
      {downloads && <ActivityGlyph />}
    </>
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
