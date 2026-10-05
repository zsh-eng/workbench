/**
 * One search for the whole app: books, passages and a few commands. Arrow
 * keys move, Enter opens, Escape closes.
 */
import { cn } from "@/lib/utils";
import { motion } from "motion/react";
import { CornerDownLeft, Highlighter, LibraryBig, Moon, Search } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { inkWash, TypographicCover } from "../primitives";
import { FLOATING_SURFACE, Kbd, MOTION } from "./ui";
import type { Entry, ShelfBook } from "./state";

type Item =
  | { kind: "book"; id: string; book: ShelfBook }
  | { kind: "entry"; id: string; entry: Entry; book: ShelfBook }
  | { kind: "action"; id: string; label: string; icon: ReactNode; run: () => void };

const STATUS: Record<ShelfBook["status"], string> = {
  reading: "Reading",
  "want-to-read": "Want to read",
  finished: "Finished",
  dnf: "Set aside",
};

export function CommandPalette({
  books,
  entries,
  onOpenBook,
  onOpenEntry,
  onLibrary,
  onHighlights,
  onToggleTheme,
  onClose,
}: {
  books: ShelfBook[];
  entries: Entry[];
  onOpenBook: (bookId: string) => void;
  onOpenEntry: (entry: Entry) => void;
  onLibrary: () => void;
  onHighlights: () => void;
  onToggleTheme: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const needle = query.trim().toLowerCase();

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const bookById = new Map(books.map((book) => [book.id, book]));
  const bookItems: Item[] = (needle
    ? books.filter((book) => book.title.toLowerCase().includes(needle) || book.author.toLowerCase().includes(needle))
    : books.filter((book) => book.status === "reading")
  )
    .slice(0, 6)
    .map((book) => ({ kind: "book", id: `book-${book.id}`, book }));
  const entryItems: Item[] = needle
    ? entries
        .filter((entry) => entry.text?.toLowerCase().includes(needle) || entry.note?.toLowerCase().includes(needle))
        .flatMap((entry) => {
          const book = bookById.get(entry.bookId);
          return book ? [{ kind: "entry" as const, id: `entry-${entry.id}`, entry, book }] : [];
        })
        .slice(0, 6)
    : [];
  const actions: Item[] = [
    { kind: "action", id: "go-library", label: "Go to Library", icon: <LibraryBig className="size-4" strokeWidth={1.7} />, run: onLibrary },
    { kind: "action", id: "go-highlights", label: "Go to Highlights", icon: <Highlighter className="size-4" strokeWidth={1.7} />, run: onHighlights },
    { kind: "action", id: "theme", label: "Switch light and dark", icon: <Moon className="size-4" strokeWidth={1.7} />, run: onToggleTheme },
  ];
  const actionItems = actions.filter((item) => !needle || (item.kind === "action" && item.label.toLowerCase().includes(needle)));
  const groups: { label: string; items: Item[] }[] = [
    { label: needle ? "Books" : "Reading now", items: bookItems },
    { label: "Passages and notes", items: entryItems },
    { label: "Go", items: actionItems },
  ].filter((group) => group.items.length > 0);
  const flat = groups.flatMap((group) => group.items);
  const active = Math.min(activeIndex, Math.max(0, flat.length - 1));

  const choose = (item: Item | undefined) => {
    if (!item) return;
    onClose();
    if (item.kind === "book") onOpenBook(item.book.id);
    else if (item.kind === "entry") onOpenEntry(item.entry);
    else item.run();
  };

  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop - 8;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 8;
    }
  }, [active]);

  let index = -1;

  return (
    <motion.div
      className="absolute inset-0 z-[60] flex items-start justify-center bg-black/[0.12] px-4 pt-[12%]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: MOTION.enter }}
      exit={{ opacity: 0, transition: MOTION.exit }}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <motion.div
        role="dialog"
        aria-label="Search"
        initial={{ opacity: 0, scale: 0.985 }}
        animate={{ opacity: 1, scale: 1, transition: MOTION.enter }}
        exit={{ opacity: 0, transition: MOTION.exit }}
        className={cn("w-full max-w-[560px] overflow-hidden", FLOATING_SURFACE)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setActiveIndex((value) => Math.min(flat.length - 1, value + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setActiveIndex((value) => Math.max(0, value - 1));
          } else if (event.key === "Enter") {
            event.preventDefault();
            choose(flat[active]);
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <label className="flex h-12 items-center gap-3 border-b border-foreground/[0.06] px-4">
          <Search className="size-[15px] text-muted-foreground" strokeWidth={1.8} />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            placeholder="Search books, passages and notes"
            aria-label="Search books, passages and notes"
            className="h-12 flex-1 bg-transparent text-[14.5px] outline-none placeholder:text-muted-foreground"
          />
          <Kbd>Esc</Kbd>
        </label>
        <div ref={listRef} className="xp-scroll-quiet relative max-h-[min(420px,52vh)] overflow-y-auto p-1.5">
          {flat.length === 0 && (
            <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">No results for “{query.trim()}”.</p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="pb-1">
              <p className="px-2.5 pt-2 pb-1 text-[11.5px] text-muted-foreground">{group.label}</p>
              {group.items.map((item) => {
                index += 1;
                const itemIndex = index;
                const selected = itemIndex === active;
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-index={itemIndex}
                    onPointerMove={() => setActiveIndex(itemIndex)}
                    onClick={() => choose(item)}
                    className={cn(
                      "flex min-h-10 w-full cursor-pointer items-center gap-3 rounded-md px-2.5 py-1.5 text-left outline-none",
                      selected && "bg-foreground/[0.045]",
                    )}
                  >
                    {item.kind === "book" ? (
                      <>
                        <TypographicCover book={item.book} compact className="h-[30px] w-5 shrink-0 rounded-[2px] shadow-[0_1px_2px_rgb(0_0_0/0.15)]" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13.5px]">{item.book.title}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{item.book.author}</span>
                        </span>
                        <span className="text-[11.5px] text-muted-foreground">{STATUS[item.book.status]}</span>
                      </>
                    ) : item.kind === "entry" ? (
                      <>
                        <span
                          className="w-[2px] shrink-0 self-stretch rounded-full"
                          style={{ background: item.entry.color ? inkWash(item.entry.color) : "color-mix(in oklab, var(--foreground) 18%, transparent)" }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="xp-serif line-clamp-1 block text-[14.5px]">
                            {item.entry.text ?? item.entry.note}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">{item.book.title}</span>
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="grid size-5 place-items-center text-muted-foreground">{item.icon}</span>
                        <span className="flex-1 text-[13.5px]">{item.label}</span>
                      </>
                    )}
                    {selected && <CornerDownLeft className="size-3.5 shrink-0 text-muted-foreground" />}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </motion.div>
    </motion.div>
  );
}
