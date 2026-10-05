/**
 * The app sidebar: one search, two places, and the books you are reading.
 * In the library it is part of the screen; while reading it floats.
 */
import { cn } from "@/lib/utils";
import { Highlighter, Keyboard, LibraryBig, Moon, Search, Sun } from "lucide-react";
import { useState, type ReactNode } from "react";
import { chapterOfPage } from "../data/walden-book";
import { TypographicCover } from "../primitives";
import { IconButton, Kbd, Popover } from "./ui";
import type { ShelfBook } from "./state";

export type SystemView = { kind: "library" } | { kind: "highlights" } | { kind: "reader"; bookId: string };

export function Sidebar({
  books,
  pages,
  view,
  isDark,
  onNavigate,
  onOpenBook,
  onSearch,
  onToggleTheme,
}: {
  books: ShelfBook[];
  pages: Record<string, number>;
  view: SystemView;
  isDark: boolean;
  onNavigate: (view: SystemView) => void;
  onOpenBook: (bookId: string) => void;
  onSearch: () => void;
  onToggleTheme: () => void;
}) {
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const reading = books
    .filter((book) => book.status === "reading")
    .sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));

  return (
    <div className="flex h-full flex-col p-3">
      <button
        type="button"
        onClick={onSearch}
        className="flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Search className="size-[14px]" strokeWidth={1.8} />
        Search
        <Kbd className="ml-auto">⌘K</Kbd>
      </button>

      <nav aria-label="Sections" className="mt-1 space-y-px">
        <NavItem
          icon={<LibraryBig className="size-[15px]" strokeWidth={1.7} />}
          label="Library"
          active={view.kind === "library"}
          onClick={() => onNavigate({ kind: "library" })}
        />
        <NavItem
          icon={<Highlighter className="size-[15px]" strokeWidth={1.7} />}
          label="Highlights"
          active={view.kind === "highlights"}
          onClick={() => onNavigate({ kind: "highlights" })}
        />
      </nav>

      {reading.length > 0 && (
        <section aria-label="Reading" className="mt-6 flex min-h-0 flex-1 flex-col">
          <h3 className="mb-1 px-2 text-[11.5px] text-muted-foreground">Reading</h3>
          <ul className="min-h-0 space-y-px overflow-y-auto [scrollbar-width:none]">
            {reading.map((book) => {
              const active = view.kind === "reader" && view.bookId === book.id;
              const page = pages[book.id];
              const chapter =
                book.model && page !== undefined ? book.model.chapters[chapterOfPage(page, book.model)] : null;
              const progress = book.model && page !== undefined ? page / book.model.pages : book.progress;
              return (
                <li key={book.id}>
                  <button
                    type="button"
                    onClick={() => onOpenBook(book.id)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-11 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-foreground/[0.05]" : "hover:bg-foreground/[0.035]",
                    )}
                  >
                    <TypographicCover
                      book={book}
                      compact
                      className="h-[30px] w-5 shrink-0 rounded-[2px] shadow-[0_1px_2px_rgb(0_0_0/0.14)]"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] leading-tight">{book.title}</span>
                      <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
                        {chapter ? chapter.title : book.author}
                      </span>
                    </span>
                    <span className="font-numeric text-[11px] text-muted-foreground tabular-nums">
                      {Math.round(progress * 100)}%
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <div className="mt-auto flex items-center justify-end gap-0.5 pt-3">
        <div className="relative">
          <IconButton label="Keyboard shortcuts" active={shortcutsOpen} onClick={() => setShortcutsOpen((open) => !open)}>
            <Keyboard className="size-[15px]" strokeWidth={1.7} />
          </IconButton>
          <Popover open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} side="top" align="end" className="w-56 p-1.5">
            <ShortcutRow label="Search" keys="⌘K" />
            <ShortcutRow label="Turn the page" keys="← →" />
            <ShortcutRow label="Contents" keys="T" />
            <ShortcutRow label="Notes" keys="N" />
            <ShortcutRow label="Appearance" keys="A" />
            <ShortcutRow label="Search in the book" keys="/" />
            <ShortcutRow label="Bookmark" keys="B" />
            <ShortcutRow label="Sidebar" keys="[" />
            <ShortcutRow label="Close" keys="Esc" />
          </Popover>
        </div>
        <IconButton label={isDark ? "Light appearance" : "Dark appearance"} onClick={onToggleTheme}>
          {isDark ? <Sun className="size-[15px]" strokeWidth={1.7} /> : <Moon className="size-[15px]" strokeWidth={1.7} />}
        </IconButton>
      </div>
    </div>
  );
}

function NavItem({
  icon,
  label,
  active,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2.5 rounded-md px-2 text-left text-[13.5px] outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-foreground/[0.05] text-foreground" : "text-foreground/75 hover:bg-foreground/[0.035] hover:text-foreground",
      )}
    >
      <span className={active ? "text-foreground" : "text-muted-foreground"}>{icon}</span>
      {label}
    </button>
  );
}

function ShortcutRow({ label, keys }: { label: string; keys: string }) {
  return (
    <div className="flex h-7 items-center justify-between gap-3 px-2 text-[12.5px]">
      <span className="text-foreground/80">{label}</span>
      <span className="font-sans text-[12px] text-muted-foreground">{keys}</span>
    </div>
  );
}
