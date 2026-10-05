/**
 * The library. The books you are reading come first, as covers with a line
 * of progress; everything else is a quiet grid. Controls show when you need
 * them: book actions on hover, sorting and layout in one menu.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { MoreHorizontal, PanelLeft, Plus, SlidersHorizontal } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { StudioStatus } from "../data/sample-library";
import { chapterOfPage } from "../data/walden-book";
import { TypographicCover } from "../primitives";
import {
  formatMinutesLeft,
  Hairline,
  IconButton,
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MOTION,
  Popover,
  relativeDays,
  TextButton,
  TextTabs,
} from "./ui";
import { minutesForPages, type ShelfBook } from "./state";

type Filter = "all" | StudioStatus;
type Sort = "recent" | "title" | "author" | "added";
type Layout = "grid" | "list";

const STATUS_LABEL: Record<StudioStatus, string> = {
  reading: "Reading",
  "want-to-read": "Want to read",
  finished: "Finished",
  dnf: "Set aside",
};

const SORT_LABEL: Record<Sort, string> = {
  recent: "Recently read",
  title: "Title",
  author: "Author",
  added: "Date added",
};

const DAY = 86_400_000;

function daysSince(time: number | null): number | null {
  return time === null ? null : Math.max(0, Math.floor((Date.now() - time) / DAY));
}

function surname(author: string): string {
  return author.split(" ").at(-1) ?? author;
}

function sortBooks(books: ShelfBook[], sort: Sort): ShelfBook[] {
  const sorted = [...books];
  if (sort === "title") return sorted.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === "author") return sorted.sort((a, b) => surname(a.author).localeCompare(surname(b.author)));
  if (sort === "added") return sorted.sort((a, b) => b.addedAt - a.addedAt);
  return sorted.sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0) || b.addedAt - a.addedAt);
}

export function bookProgress(book: ShelfBook, page: number | undefined): number {
  if (book.status === "finished") return 1;
  return book.model && page !== undefined ? page / book.model.pages : book.progress;
}

/** Opens upward when there is no room below in the scrolling library. */
function menuSide(trigger: HTMLElement): "top" | "bottom" {
  const scroller = trigger.closest<HTMLElement>("[data-scroller]");
  const limit = scroller?.getBoundingClientRect().bottom ?? window.innerHeight;
  return limit - trigger.getBoundingClientRect().bottom < 260 ? "top" : "bottom";
}

export function LibraryView({
  books,
  pages,
  narrow,
  sidebarHidden,
  scrollMemory,
  onShowSidebar,
  onOpen,
  onSetStatus,
  onRemove,
}: {
  books: ShelfBook[];
  pages: Record<string, number>;
  narrow: boolean;
  sidebarHidden: boolean;
  /** Keeps the scroll position when you come back from a book. */
  scrollMemory: { current: number };
  onShowSidebar: () => void;
  onOpen: (bookId: string) => void;
  onSetStatus: (bookId: string, status: StudioStatus) => void;
  onRemove: (bookId: string) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState<Sort>("recent");
  const [layout, setLayout] = useState<Layout>("grid");
  const [viewOpen, setViewOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller) scroller.scrollTop = scrollMemory.current;
  }, [scrollMemory]);

  const reading = books
    .filter((book) => book.status === "reading")
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
  const shown = sortBooks(
    books.filter((book) => filter === "all" || book.status === filter),
    sort,
  );

  return (
    <div
      ref={scrollerRef}
      data-scroller=""
      onScroll={(event) => {
        scrollMemory.current = event.currentTarget.scrollTop;
      }}
      className="xp-scroll-quiet size-full overflow-y-auto overscroll-contain"
    >
      <div className={cn("mx-auto max-w-[1160px]", narrow ? "px-5 pt-5 pb-16" : "px-12 pt-12 pb-24")}>
        <header className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            {sidebarHidden && (
              <IconButton label="Show sidebar ([)" onClick={onShowSidebar} className="-ml-2">
                <PanelLeft className="size-4" strokeWidth={1.6} />
              </IconButton>
            )}
            <h1 className="xp-serif text-[30px] leading-none tracking-[-0.01em]">Library</h1>
          </div>
          <div className="flex items-center gap-1">
            <div className="relative">
              <TextButton onClick={() => setAddOpen((open) => !open)} aria-expanded={addOpen}>
                <Plus className="size-3.5" strokeWidth={1.8} />
                Add books
              </TextButton>
              <Popover open={addOpen} onClose={() => setAddOpen(false)} className="w-64 p-3">
                <p className="text-[13px] leading-relaxed text-muted-foreground">
                  Drop EPUB files anywhere in this window, or{" "}
                  <button type="button" onClick={() => setAddOpen(false)} className="cursor-pointer text-foreground underline decoration-foreground/25 underline-offset-4">
                    choose files
                  </button>
                  .
                </p>
              </Popover>
            </div>
            <div className="relative">
              <IconButton label="Sort and layout" active={viewOpen} onClick={() => setViewOpen((open) => !open)}>
                <SlidersHorizontal className="size-[15px]" strokeWidth={1.6} />
              </IconButton>
              <Popover open={viewOpen} onClose={() => setViewOpen(false)} className="w-48">
                <MenuLabel>Sort by</MenuLabel>
                {(Object.keys(SORT_LABEL) as Sort[]).map((option) => (
                  <MenuItem key={option} checked={sort === option} onSelect={() => setSort(option)}>
                    {SORT_LABEL[option]}
                  </MenuItem>
                ))}
                <MenuSeparator />
                <MenuLabel>Show as</MenuLabel>
                <MenuItem checked={layout === "grid"} onSelect={() => setLayout("grid")}>
                  Covers
                </MenuItem>
                <MenuItem checked={layout === "list"} onSelect={() => setLayout("list")}>
                  List
                </MenuItem>
              </Popover>
            </div>
          </div>
        </header>

        {reading.length > 0 && (
          <section aria-label="Reading" className={narrow ? "mt-7" : "mt-11"}>
            <h2 className="text-[12px] text-muted-foreground">Reading</h2>
            <div className={cn("xp-scroll-quiet mt-4 flex overflow-x-auto", narrow ? "-mx-5 gap-6 px-5" : "gap-12")}>
              {reading.slice(0, 4).map((book) => (
                <ReadingItem key={book.id} book={book} page={pages[book.id]} onOpen={() => onOpen(book.id)} />
              ))}
            </div>
          </section>
        )}

        <div className={cn("flex items-center justify-between gap-4", narrow ? "mt-9" : "mt-14")}>
          <TextTabs
            label="Show"
            value={filter}
            onChange={setFilter}
            className="xp-scroll-quiet overflow-x-auto"
            options={[
              { value: "all", label: "All" },
              { value: "reading", label: "Reading" },
              { value: "want-to-read", label: "Want to read" },
              { value: "finished", label: "Finished" },
              { value: "dnf", label: "Set aside" },
            ]}
          />
          <span className="shrink-0 font-numeric text-[12px] text-muted-foreground tabular-nums max-sm:hidden">
            {shown.length} {shown.length === 1 ? "book" : "books"}
          </span>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`${filter}-${sort}-${layout}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: MOTION.enter }}
            exit={{ opacity: 0, transition: MOTION.exit }}
            className="mt-6"
          >
            {shown.length === 0 ? (
              <p className="py-20 text-center text-[13px] text-muted-foreground">
                No books here. Change a book’s status from its menu to file it here.
              </p>
            ) : layout === "grid" ? (
              <ul
                className={cn(
                  "grid gap-y-10",
                  narrow ? "grid-cols-2 gap-x-5" : "gap-x-8 [grid-template-columns:repeat(auto-fill,minmax(128px,1fr))]",
                )}
              >
                {shown.map((book) => (
                  <BookTile
                    key={book.id}
                    book={book}
                    page={pages[book.id]}
                    onOpen={() => onOpen(book.id)}
                    onSetStatus={(status) => onSetStatus(book.id, status)}
                    onRemove={() => onRemove(book.id)}
                  />
                ))}
              </ul>
            ) : (
              <ul>
                {shown.map((book) => (
                  <BookRow
                    key={book.id}
                    book={book}
                    page={pages[book.id]}
                    narrow={narrow}
                    onOpen={() => onOpen(book.id)}
                    onSetStatus={(status) => onSetStatus(book.id, status)}
                    onRemove={() => onRemove(book.id)}
                  />
                ))}
              </ul>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ReadingItem({ book, page, onOpen }: { book: ShelfBook; page: number | undefined; onOpen: () => void }) {
  const progress = bookProgress(book, page);
  const chapter = book.model && page !== undefined ? book.model.chapters[chapterOfPage(page, book.model)] : null;
  const minutesLeft = book.model && page !== undefined ? minutesForPages(book.model.pages - page) : null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex w-[300px] shrink-0 cursor-pointer items-end gap-4 rounded-md text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4"
    >
      <TypographicCover
        book={book}
        className="h-[126px] w-[84px] shrink-0 rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.1),0_10px_22px_-14px_rgb(0_0_0/0.4)] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:-translate-y-0.5"
      />
      <span className="min-w-0 flex-1 pb-1">
        <span className="xp-serif line-clamp-2 block text-[18px] leading-[1.15]">{book.title}</span>
        <span className="mt-1 block truncate text-[12.5px] text-muted-foreground">
          {chapter ? chapter.title : book.author}
        </span>
        <Hairline value={progress} className="mt-3 w-full max-w-[160px]" />
        <span className="mt-1.5 block font-numeric text-[11.5px] text-muted-foreground tabular-nums">
          {Math.round(progress * 100)}%{minutesLeft !== null && ` · ${formatMinutesLeft(minutesLeft)} left`}
        </span>
      </span>
    </button>
  );
}

function BookMenu({
  book,
  open,
  side,
  onClose,
  onOpen,
  onSetStatus,
  onRemove,
}: {
  book: ShelfBook;
  open: boolean;
  side: "top" | "bottom";
  onClose: () => void;
  onOpen: () => void;
  onSetStatus: (status: StudioStatus) => void;
  onRemove: () => void;
}) {
  return (
    <Popover open={open} onClose={onClose} side={side} className="w-48">
      <MenuItem
        onSelect={() => {
          onClose();
          onOpen();
        }}
      >
        {book.status === "reading" ? "Continue reading" : "Open"}
      </MenuItem>
      <MenuSeparator />
      {(Object.keys(STATUS_LABEL) as StudioStatus[]).map((status) => (
        <MenuItem
          key={status}
          checked={book.status === status}
          onSelect={() => {
            onSetStatus(status);
            onClose();
          }}
        >
          {STATUS_LABEL[status]}
        </MenuItem>
      ))}
      <MenuSeparator />
      <MenuItem
        destructive
        onSelect={() => {
          onRemove();
          onClose();
        }}
      >
        Remove from library
      </MenuItem>
    </Popover>
  );
}

function MenuTrigger({
  title,
  open,
  className,
  onToggle,
}: {
  title: string;
  open: boolean;
  className?: string;
  onToggle: (side: "top" | "bottom") => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Actions for ${title}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(event) => onToggle(menuSide(event.currentTarget))}
      className={cn(
        "grid size-6 cursor-pointer place-items-center rounded-full outline-none transition-opacity duration-150 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
        open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        className,
      )}
    >
      <MoreHorizontal className="size-3.5" />
    </button>
  );
}

function BookTile({
  book,
  page,
  onOpen,
  onSetStatus,
  onRemove,
}: {
  book: ShelfBook;
  page: number | undefined;
  onOpen: () => void;
  onSetStatus: (status: StudioStatus) => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState<{ open: boolean; side: "top" | "bottom" }>({ open: false, side: "bottom" });
  const reading = book.status === "reading";

  return (
    <li className="group relative min-w-0">
      <button type="button" onClick={onOpen} className="block w-full cursor-pointer text-left outline-none" aria-label={`Open ${book.title}`}>
        <span
          className={cn(
            "block aspect-[2/3] overflow-hidden rounded-[3px] shadow-[0_1px_2px_rgb(0_0_0/0.08),0_8px_18px_-12px_rgb(0_0_0/0.3)] transition-transform duration-200 ease-[cubic-bezier(0.2,0,0,1)] group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 group-focus-visible:ring-2 group-focus-visible:ring-ring",
            menu.open && "-translate-y-0.5",
          )}
        >
          <TypographicCover book={book} className="size-full" />
        </span>
        {reading && <Hairline value={bookProgress(book, page)} className="mt-2.5" />}
        <span className={cn("line-clamp-2 block text-[13px] leading-snug", reading ? "mt-2" : "mt-3")}>{book.title}</span>
        <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{book.author}</span>
      </button>
      <div className="absolute top-1.5 right-1.5">
        <MenuTrigger
          title={book.title}
          open={menu.open}
          className="bg-background/90 text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.16)] backdrop-blur"
          onToggle={(side) => setMenu((current) => ({ open: !current.open, side }))}
        />
        <BookMenu
          book={book}
          open={menu.open}
          side={menu.side}
          onClose={() => setMenu((current) => ({ ...current, open: false }))}
          onOpen={onOpen}
          onSetStatus={onSetStatus}
          onRemove={onRemove}
        />
      </div>
    </li>
  );
}

function BookRow({
  book,
  page,
  narrow,
  onOpen,
  onSetStatus,
  onRemove,
}: {
  book: ShelfBook;
  page: number | undefined;
  narrow: boolean;
  onOpen: () => void;
  onSetStatus: (status: StudioStatus) => void;
  onRemove: () => void;
}) {
  const [menu, setMenu] = useState<{ open: boolean; side: "top" | "bottom" }>({ open: false, side: "bottom" });
  const progress = bookProgress(book, page);
  const lastRead = daysSince(book.lastReadAt);

  return (
    <li className="group relative flex h-14 items-center gap-4 border-b border-foreground/[0.05]">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 text-left outline-none focus-visible:underline">
        <TypographicCover book={book} compact className="h-9 w-6 shrink-0 rounded-[2px] shadow-[0_1px_2px_rgb(0_0_0/0.14)]" />
        <span className="min-w-0 truncate text-[13.5px]">
          {book.title}
          <span className="text-muted-foreground"> · {book.author}</span>
        </span>
      </button>
      {!narrow && (
        <>
          <span className="w-24 text-[12.5px] text-muted-foreground">{STATUS_LABEL[book.status]}</span>
          <span className="flex w-28 items-center gap-2">
            {book.status === "reading" && (
              <>
                <Hairline value={progress} className="w-14" />
                <span className="font-numeric text-[11.5px] text-muted-foreground tabular-nums">{Math.round(progress * 100)}%</span>
              </>
            )}
          </span>
          <span className="w-24 text-right text-[12.5px] text-muted-foreground">
            {lastRead === null ? "" : relativeDays(lastRead)}
          </span>
        </>
      )}
      <div className="relative">
        <MenuTrigger
          title={book.title}
          open={menu.open}
          className={cn("text-muted-foreground hover:text-foreground", narrow && "opacity-100")}
          onToggle={(side) => setMenu((current) => ({ open: !current.open, side }))}
        />
        <BookMenu
          book={book}
          open={menu.open}
          side={menu.side}
          onClose={() => setMenu((current) => ({ ...current, open: false }))}
          onOpen={onOpen}
          onSetStatus={onSetStatus}
          onRemove={onRemove}
        />
      </div>
    </li>
  );
}
