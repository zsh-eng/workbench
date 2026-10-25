import { BlurHashCanvas } from "@/components/BlurHashCanvas";
import {
  READING_STATUS_LABELS,
  READING_STATUS_OPTIONS,
} from "@/components/BookStatusSheet";
import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";
import { RemoveBookDialog } from "@/components/RemoveBookDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DownloadForOfflineItem,
  LibraryCoverActivity,
} from "@/features/background-activity/LibraryActivity";
import { useSetReadingStatus } from "@/hooks/use-reading-status";
import { useToast } from "@/hooks/use-toast";
import type { Book, ReadingStatus } from "@/lib/db";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import { cn } from "@/lib/utils";
import { formatDistanceToNowStrict } from "date-fns";
import { MoreHorizontal, Trash2 } from "lucide-react";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

// Living covers load their engine only when Debug mode turns them on.
const LivingCover = lazy(() =>
  import("@/features/living-covers/LivingCover").then((module) => ({
    default: module.LivingCover,
  })),
);

/** What each book part needs from the Library page. */
export interface LibraryBookProps {
  book: Book;
  status: ReadingStatus | null;
  coverUrl: string | undefined;
  /** Draw the cover as a lit object (Debug mode). */
  living?: boolean;
  onCoverRequest: (book: Book) => void;
  onPrefetch: (book: Book) => void;
  onRemove: (bookId: string) => Promise<void>;
}

export const COVER_SHADOW =
  "shadow-[0_1px_2px_rgb(0_0_0/0.1),0_10px_22px_-14px_rgb(0_0_0/0.4)]";

/** Loads a cover once its book nears the screen. */
export function useCoverRequest(
  element: HTMLElement | null,
  book: Book,
  coverUrl: string | undefined,
  onCoverRequest: (book: Book) => void,
) {
  useEffect(() => {
    if (coverUrl || !book.cover || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        onCoverRequest(book);
        observer.disconnect();
      },
      { rootMargin: "400px 0px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [book, coverUrl, element, onCoverRequest]);
}

/** The cover image, its blurred placeholder, or the title set in type. */
export function BookCover({
  book,
  coverUrl,
  compact = false,
  living = false,
  className,
}: {
  book: Book;
  coverUrl: string | undefined;
  compact?: boolean;
  living?: boolean;
  className?: string;
}) {
  if (coverUrl && living) {
    const plain = (
      <BookCover book={book} coverUrl={coverUrl} className={className} />
    );
    return (
      <Suspense fallback={plain}>
        {/* The living cover draws its own shadow. */}
        <LivingCover
          coverUrl={coverUrl}
          coverFileId={book.cover?.fileId}
          className={cn(className, "shadow-none")}
        />
      </Suspense>
    );
  }
  if (coverUrl) {
    return (
      <span className={cn("block overflow-hidden bg-secondary", className)}>
        <img
          src={coverUrl}
          alt=""
          draggable={false}
          className="image-outline pointer-events-none size-full object-cover select-none"
        />
      </span>
    );
  }
  if (book.cover?.blurHash) {
    return (
      <span className={cn("block overflow-hidden bg-secondary", className)}>
        <BlurHashCanvas blurHash={book.cover.blurHash} className="size-full" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex flex-col justify-between overflow-hidden bg-secondary text-left text-secondary-foreground",
        compact ? "p-1" : "p-[9%]",
        className,
      )}
      style={{ containerType: "inline-size" }}
    >
      <span
        className="line-clamp-5 font-serif leading-[0.95] font-medium tracking-tight text-balance"
        style={{ fontSize: compact ? "6px" : "clamp(9px, 14cqi, 28px)" }}
      >
        {book.title}
      </span>
      {!compact && (
        <span
          className="line-clamp-2 text-muted-foreground"
          style={{ fontSize: "clamp(6px, 7cqi, 12px)" }}
        >
          {book.author}
        </span>
      )}
    </span>
  );
}

/** A thin line of reading progress. */
export function Hairline({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "relative block h-[2px] overflow-hidden rounded-full bg-foreground/[0.08]",
        className,
      )}
    >
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-foreground/55"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </span>
  );
}

/**
 * A book's actions: open, reading status, and remove. Pointer devices show
 * the button on hover and open the same menu on a right click; on a phone,
 * these actions live in the Reader's tools.
 */
function BookActions({
  book,
  status,
  open,
  onOpenChange,
  onRemove,
  className,
}: {
  book: Book;
  status: ReadingStatus | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemove: (bookId: string) => Promise<void>;
  className?: string;
}) {
  const { toast } = useToast();
  const setStatus = useSetReadingStatus(book.id);
  const [removeOpen, setRemoveOpen] = useState(false);
  // The mutation owns the optimistic value until refreshed queries take over.
  const displayStatus = setStatus.isPending ? setStatus.variables! : status;

  const handleSetStatus = (next: ReadingStatus) => {
    if (next === displayStatus || setStatus.isPending) return;
    setStatus.mutate(next, {
      onSuccess: () =>
        toast({
          message: (
            <ReadingStatusChangeMessage
              previousStatus={displayStatus}
              status={next}
            />
          ),
        }),
      onError: () =>
        toast({
          message: "Could not change reading status.",
          variant: "destructive",
        }),
    });
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger
          aria-label={`Actions for ${book.title}`}
          className={cn(
            "grid size-7 place-items-center rounded-full outline-none transition-opacity duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:opacity-100 [@media(hover:none)]:hidden",
            "opacity-0 group-hover:opacity-100",
            className,
          )}
        >
          <MoreHorizontal className="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem
            render={<Link to={`/reader/${book.id}`} />}
            onClick={() =>
              beginReaderTrace({
                bookId: book.id,
                bookTitle: book.title,
                source: "library-menu",
              })
            }
          >
            {displayStatus === "reading" ? "Continue reading" : "Open"}
          </DropdownMenuItem>
          <DownloadForOfflineItem book={book} />
          <DropdownMenuSeparator />
          <DropdownMenuRadioGroup
            value={displayStatus ?? ""}
            onValueChange={(value) => handleSetStatus(value as ReadingStatus)}
          >
            {READING_STATUS_OPTIONS.map((option) => (
              <DropdownMenuRadioItem
                key={option.value}
                value={option.value}
                disabled={setStatus.isPending}
              >
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setRemoveOpen(true)}
          >
            <Trash2 />
            Remove book…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <RemoveBookDialog
        open={removeOpen}
        onOpenChange={setRemoveOpen}
        bookTitle={book.title}
        onConfirm={() => onRemove(book.id)}
      />
    </>
  );
}

/** Opens the book; shared by the shelf, the covers and the list. */
function BookLink({
  book,
  source,
  onPrefetch,
  onContextMenu,
  linkRef,
  className,
  children,
}: {
  book: Book;
  source: string;
  onPrefetch: (book: Book) => void;
  onContextMenu?: () => void;
  linkRef?: (element: HTMLAnchorElement | null) => void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link
      ref={linkRef}
      to={`/reader/${book.id}`}
      aria-label={`Open ${book.title}`}
      onClick={() =>
        beginReaderTrace({ bookId: book.id, bookTitle: book.title, source })
      }
      onFocusCapture={() => onPrefetch(book)}
      onPointerEnter={(event) => {
        if (event.pointerType !== "touch") onPrefetch(book);
      }}
      onContextMenu={(event) => {
        if (!onContextMenu || !window.matchMedia("(hover: hover)").matches)
          return;
        event.preventDefault();
        onContextMenu();
      }}
      className={cn("outline-none", className)}
    >
      {children}
    </Link>
  );
}

/** The books you are reading, in one row that scrolls sideways. */
export function ReadingShelf({
  count,
  children,
}: {
  count: number;
  children: ReactNode;
}) {
  return (
    <section aria-label="Reading" className="mt-5 md:mt-8">
      <h2 className="text-[12px] text-muted-foreground">
        Reading
        <span className="ml-1.5 font-numeric text-muted-foreground/60 tabular-nums">
          {count}
        </span>
      </h2>
      <div className="-mx-4 mt-4 flex gap-4 overflow-x-auto px-4 pb-2 [scrollbar-width:none] md:mx-0 md:gap-12 md:px-0">
        {children}
      </div>
    </section>
  );
}

/**
 * A book you are reading, on the shelf. With room: cover, title and
 * progress. On a phone: a smaller cover with the progress under it, so three
 * or four books show at once. The cover carries the title there.
 */
export function ShelfBook({
  book,
  status,
  coverUrl,
  living,
  progress,
  onCoverRequest,
  onPrefetch,
  onRemove,
}: LibraryBookProps & { progress: number }) {
  const [element, setElement] = useState<HTMLAnchorElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useCoverRequest(element, book, coverUrl, onCoverRequest);
  return (
    <div className="group relative w-[92px] shrink-0 md:w-[300px]">
      <BookLink
        book={book}
        source="library-shelf"
        onPrefetch={onPrefetch}
        onContextMenu={() => setMenuOpen(true)}
        linkRef={setElement}
        className="flex flex-col rounded-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 md:flex-row md:items-end md:gap-4"
      >
        <BookCover
          book={book}
          coverUrl={coverUrl}
          living={living}
          className={cn(
            "h-[138px] w-[92px] shrink-0 rounded-[3px] md:h-[126px] md:w-[84px] transition-transform duration-200 ease-out [@media(hover:hover)]:group-hover:-translate-y-0.5 [@media(hover:hover)]:group-has-[[data-popup-open]]:-translate-y-0.5",
            COVER_SHADOW,
          )}
        />
        <span className="min-w-0 flex-1 md:pr-6 md:pb-1">
          <h3 className="line-clamp-2 font-serif text-[18px] leading-[1.15] font-normal max-md:sr-only">
            {book.title}
          </h3>
          <span className="mt-1 block truncate text-[12.5px] text-muted-foreground max-md:sr-only">
            {book.author}
          </span>
          <Hairline value={progress} className="mt-3 w-full md:max-w-[160px]" />
          <span className="mt-1.5 block font-numeric text-[11.5px] text-muted-foreground tabular-nums">
            {Math.round(progress * 100)}%
          </span>
        </span>
      </BookLink>
      <LibraryCoverActivity
        bookId={book.id}
        className="top-0 left-0 h-[138px] w-[92px] overflow-hidden rounded-[3px] md:h-[126px] md:w-[84px]"
      />
      {/* On a narrow window with a pointer, the button sits on the cover. */}
      <div className="absolute top-1 right-1 md:top-0 md:right-0">
        <BookActions
          book={book}
          status={status}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onRemove={onRemove}
          className="text-muted-foreground hover:text-foreground max-md:bg-background/90 max-md:shadow-sm"
        />
      </div>
    </div>
  );
}

/** A book in the covers layout. */
export function BookTile({
  book,
  status,
  coverUrl,
  living,
  onCoverRequest,
  onPrefetch,
  onRemove,
}: LibraryBookProps) {
  const [element, setElement] = useState<HTMLAnchorElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useCoverRequest(element, book, coverUrl, onCoverRequest);
  return (
    <li className="group relative min-w-0">
      <BookLink
        book={book}
        source="library-card"
        onPrefetch={onPrefetch}
        onContextMenu={() => setMenuOpen(true)}
        linkRef={setElement}
        className="block"
      >
        <BookCover
          book={book}
          coverUrl={coverUrl}
          living={living}
          className={cn(
            "aspect-[2/3] w-full rounded-[3px] transition-transform duration-200 ease-out group-focus-visible:ring-2 group-focus-visible:ring-ring [@media(hover:hover)]:group-hover:-translate-y-0.5 [@media(hover:hover)]:group-has-[[data-popup-open]]:-translate-y-0.5",
            COVER_SHADOW,
          )}
        />
        <h3 className="mt-3 line-clamp-2 text-[13px] leading-snug font-normal">
          {book.title}
        </h3>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
          {book.author}
        </span>
      </BookLink>
      <LibraryCoverActivity
        bookId={book.id}
        className="inset-x-0 top-0 aspect-[2/3] overflow-hidden rounded-[3px] transition-transform duration-200 ease-out [@media(hover:hover)]:group-hover:-translate-y-0.5 [@media(hover:hover)]:group-has-[[data-popup-open]]:-translate-y-0.5"
      />
      <div className="absolute top-1.5 right-1.5">
        <BookActions
          book={book}
          status={status}
          open={menuOpen}
          onOpenChange={setMenuOpen}
          onRemove={onRemove}
          className="bg-background/90 text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.16)] backdrop-blur"
        />
      </div>
    </li>
  );
}

/** A book in the list layout. */
export function BookRow({
  book,
  status,
  coverUrl,
  lastRead,
  onCoverRequest,
  onPrefetch,
  onRemove,
}: LibraryBookProps & { lastRead: number | undefined }) {
  const [element, setElement] = useState<HTMLAnchorElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  useCoverRequest(element, book, coverUrl, onCoverRequest);
  return (
    <li className="group relative flex h-14 items-center gap-4 border-b border-foreground/[0.06]">
      <BookLink
        book={book}
        source="library-row"
        onPrefetch={onPrefetch}
        onContextMenu={() => setMenuOpen(true)}
        linkRef={setElement}
        className="flex min-w-0 flex-1 items-center gap-3 focus-visible:underline"
      >
        <BookCover
          book={book}
          coverUrl={coverUrl}
          compact
          className="h-9 w-6 shrink-0 rounded-[2px] shadow-[0_1px_2px_rgb(0_0_0/0.14)]"
        />
        <span className="min-w-0 truncate text-[13.5px]">
          {book.title}
          <span className="text-muted-foreground"> · {book.author}</span>
        </span>
      </BookLink>
      <LibraryCoverActivity
        bookId={book.id}
        compact
        className="top-[10px] left-0 h-9 w-6"
      />
      <span className="w-28 text-[12.5px] text-muted-foreground max-md:hidden">
        {READING_STATUS_LABELS[status ?? "want-to-read"]}
      </span>
      <span className="w-28 text-right text-[12.5px] text-muted-foreground max-md:hidden">
        {lastRead
          ? formatDistanceToNowStrict(lastRead, { addSuffix: true })
          : ""}
      </span>
      <BookActions
        book={book}
        status={status}
        open={menuOpen}
        onOpenChange={setMenuOpen}
        onRemove={onRemove}
        className="text-muted-foreground hover:text-foreground"
      />
    </li>
  );
}
