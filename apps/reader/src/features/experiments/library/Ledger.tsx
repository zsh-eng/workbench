/**
 * Ledger: the library as a quiet, sortable list.
 *
 * Rows group by status and reorder with layout animation when the sort or a
 * status changes. A larger cover follows the pointer after a short dwell, so
 * the list stays compact without losing the covers. Arrow keys move through
 * rows; Enter opens.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
} from "motion/react";
import { Check, ChevronDown, ChevronRight, Highlighter, LayoutGrid, List, RotateCcw, Search } from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import type { StudioBook, StudioLibrary, StudioStatus } from "../data/sample-library";
import { StageSurface, TypographicCover, useElementSize } from "../primitives";
import {
  ProgressLine,
  QUIET_EASE,
  QUIET_SPRING,
  QuietCover,
  QuietKbd,
  STATUS_LABEL,
  STATUS_ORDER,
  activityByBook,
  formatDuration,
  percent,
  relativeDay,
  shelfBooks,
  shortDate,
} from "../quiet";

type SortKey = "title" | "progress" | "lastRead" | "time" | "notes" | "added";

const COLUMNS: { key: SortKey; label: string; align?: "right" }[] = [
  { key: "title", label: "Title" },
  { key: "progress", label: "Progress" },
  { key: "lastRead", label: "Last read", align: "right" },
  { key: "time", label: "Time", align: "right" },
  { key: "notes", label: "Notes", align: "right" },
  { key: "added", label: "Added", align: "right" },
];

const GRID = "grid grid-cols-[minmax(0,2.4fr)_minmax(5rem,1fr)_6rem_4.5rem_3.5rem_5.5rem] items-center gap-x-4";
const NARROW_GRID = "grid grid-cols-[minmax(0,1fr)_4.5rem] items-center gap-x-3";

function Highlight({ text, query }: { text: string; query: string }): ReactNode {
  const needle = query.trim().toLowerCase();
  const index = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (index < 0) return text;
  return (
    <>
      {text.slice(0, index)}
      <span className="rounded-[2px] bg-foreground/10 text-foreground">{text.slice(index, index + needle.length)}</span>
      {text.slice(index + needle.length)}
    </>
  );
}

export function Ledger({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const baseBooks = useMemo(() => shelfBooks(library), [library]);
  const activity = useMemo(() => activityByBook(library), [library]);
  const [overrides, setOverrides] = useState<Record<string, StudioStatus>>({});
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean }>({ key: "lastRead", descending: true });
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<StudioStatus>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const [peekId, setPeekId] = useState<string | null>(null);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const wide = size.width >= 820;
  const dwellRef = useRef<number | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const peekX = useMotionValue(0);
  const peekY = useMotionValue(0);
  const springX = useSpring(peekX, { stiffness: 500, damping: 45 });
  const springY = useSpring(peekY, { stiffness: 500, damping: 45 });

  useEffect(() => () => {
    if (dwellRef.current) window.clearTimeout(dwellRef.current);
  }, []);

  const books = useMemo(
    () => baseBooks.map((book) => (overrides[book.id] ? { ...book, status: overrides[book.id], progress: overrides[book.id] === "finished" ? 1 : book.progress } : book)),
    [baseBooks, overrides],
  );

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const value = (book: StudioBook): number | string => {
      const stats = activity.get(book.id);
      switch (sort.key) {
        case "title":
          // File titles the way libraries do, ignoring a leading article.
          return book.title.toLowerCase().replace(/^(the|a|an)\s+/, "");
        case "progress":
          return book.progress;
        case "lastRead":
          return book.lastReadAt ?? 0;
        case "time":
          return stats?.minutes ?? 0;
        case "notes":
          return stats?.highlights ?? 0;
        case "added":
          return book.addedAt;
      }
    };
    const compare = (a: StudioBook, b: StudioBook) => {
      const left = value(a);
      const right = value(b);
      const order = typeof left === "string" ? left.localeCompare(right as string) : left - (right as number);
      return sort.descending ? -order : order;
    };
    return STATUS_ORDER.map((status) => ({
      status,
      books: books
        .filter((book) => book.status === status)
        .filter((book) => !needle || `${book.title} ${book.author}`.toLowerCase().includes(needle))
        .sort(compare),
    })).filter((group) => group.books.length > 0);
  }, [activity, books, query, sort]);

  const visibleRows = groups.flatMap((group) => (collapsed.has(group.status) ? [] : group.books));
  const activeIndex = visibleRows.findIndex((book) => book.id === activeId);

  const toggleSort = (key: SortKey) =>
    setSort((current) =>
      current.key === key ? { key, descending: !current.descending } : { key, descending: key !== "title" },
    );

  const open = (id: string) => {
    setOpened(id);
    window.setTimeout(() => setOpened((current) => (current === id ? null : current)), 900);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement) {
      if (event.key === "ArrowDown" || event.key === "Escape") {
        event.preventDefault();
        (event.currentTarget as HTMLElement).focus();
        if (event.key === "ArrowDown") setActiveId(visibleRows[0]?.id ?? null);
      }
      return;
    }
    if (event.key === "/") {
      event.preventDefault();
      searchRef.current?.focus();
    } else if (event.key === "ArrowDown" || event.key === "j") {
      event.preventDefault();
      setActiveId(visibleRows[Math.min(visibleRows.length - 1, activeIndex + 1)]?.id ?? null);
    } else if (event.key === "ArrowUp" || event.key === "k") {
      event.preventDefault();
      setActiveId(visibleRows[Math.max(0, activeIndex - 1)]?.id ?? null);
    } else if (event.key === "Enter" && activeId) {
      open(activeId);
    }
  };

  const handleRowPointer = (event: PointerEvent<HTMLDivElement>, bookId: string) => {
    if (!wide || event.pointerType === "touch") return;
    const stage = event.currentTarget.closest("[data-ledger-root]")?.getBoundingClientRect();
    if (!stage) return;
    peekX.set(event.clientX - stage.left + 28);
    peekY.set(event.clientY - stage.top - 90);
    if (peekId !== null) {
      setPeekId(bookId);
      return;
    }
    if (dwellRef.current) window.clearTimeout(dwellRef.current);
    // A short dwell keeps the preview out of the way while scanning quickly.
    dwellRef.current = window.setTimeout(() => setPeekId(bookId), 380);
  };

  const hidePeek = () => {
    if (dwellRef.current) window.clearTimeout(dwellRef.current);
    setPeekId(null);
  };

  const peekBook = books.find((book) => book.id === peekId);

  return (
    <StageSurface tone="inherit" className="relative size-full">
      <div
        ref={sizeRef}
        data-ledger-root
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="absolute inset-0 flex flex-col outline-none"
      >
        {/* Toolbar */}
        <div className="flex h-14 shrink-0 items-center gap-3 border-b px-5 md:px-8">
          <p className="text-[15px] font-medium">Library</p>
          <label className="relative ml-2 flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg bg-muted/50 px-2.5 text-sm transition-colors focus-within:bg-muted md:max-w-xs">
            <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter"
              aria-label="Filter books"
              className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            />
            {!query && <QuietKbd>/</QuietKbd>}
          </label>
          <div className="ml-auto flex items-center rounded-lg bg-muted/50 p-0.5" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked="true" aria-label="List view" className="grid size-7 place-items-center rounded-md bg-background text-foreground shadow-sm">
              <List className="size-3.5" />
            </button>
            <button type="button" role="radio" aria-checked="false" aria-label="Grid view" className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:text-foreground">
              <LayoutGrid className="size-3.5" />
            </button>
          </div>
        </div>

        {/* Header */}
        <div className={cn(wide ? GRID : NARROW_GRID, "h-9 shrink-0 border-b px-5 text-[11px] text-muted-foreground md:px-8")}>
          {(wide ? COLUMNS : [COLUMNS[0], COLUMNS[2]]).map((column) => {
            const active = sort.key === column.key;
            return (
              <button
                key={column.key}
                type="button"
                onClick={() => toggleSort(column.key)}
                className={cn(
                  "flex cursor-pointer items-center gap-1 outline-none transition-colors hover:text-foreground focus-visible:text-foreground",
                  column.align === "right" && "justify-end",
                  active && "text-foreground",
                )}
              >
                {column.label}
                <motion.span
                  animate={{ opacity: active ? 1 : 0, rotate: sort.descending ? 0 : 180 }}
                  transition={QUIET_SPRING}
                  className="inline-flex"
                >
                  <ChevronDown className="size-3" />
                </motion.span>
              </button>
            );
          })}
        </div>

        {/* Rows */}
        <div className="xp-scroll-quiet relative min-h-0 flex-1 overflow-y-auto" onPointerLeave={hidePeek}>
          <LayoutGroup id="ledger">
            {groups.map((group) => {
              const isCollapsed = collapsed.has(group.status);
              return (
                <Fragment key={group.status}>
                  <motion.button
                    layout="position"
                    transition={QUIET_SPRING}
                    type="button"
                    onClick={() =>
                      setCollapsed((current) => {
                        const next = new Set(current);
                        if (next.has(group.status)) next.delete(group.status);
                        else next.add(group.status);
                        return next;
                      })
                    }
                    className="sticky top-0 z-10 flex h-9 w-full cursor-pointer items-center gap-1.5 bg-background/90 px-5 text-left text-xs font-medium backdrop-blur outline-none focus-visible:bg-muted md:px-8"
                  >
                    <motion.span animate={{ rotate: isCollapsed ? 0 : 90 }} transition={QUIET_SPRING} className="inline-flex text-muted-foreground">
                      <ChevronRight className="size-3.5" />
                    </motion.span>
                    {STATUS_LABEL[group.status]}
                    <span className="font-normal text-muted-foreground tabular-nums">{group.books.length}</span>
                  </motion.button>
                  <AnimatePresence initial={false}>
                    {!isCollapsed &&
                      group.books.map((book) => {
                        const stats = activity.get(book.id);
                        const active = activeId === book.id;
                        return (
                          <motion.div
                            key={book.id}
                            layout="position"
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0, transition: { duration: 0.12 } }}
                            transition={reducedMotion ? { duration: 0 } : QUIET_SPRING}
                            role="row"
                            aria-selected={active}
                            onPointerMove={(event) => handleRowPointer(event, book.id)}
                            onPointerEnter={() => setActiveId(book.id)}
                            onDoubleClick={() => open(book.id)}
                            className={cn(
                              wide ? GRID : NARROW_GRID,
                              "group relative h-14 cursor-default px-5 md:px-8",
                            )}
                          >
                            {active && (
                              <motion.span layoutId="ledger-active" transition={QUIET_SPRING} className="absolute inset-x-2 inset-y-0.5 rounded-lg bg-muted/70 md:inset-x-4" />
                            )}
                            <AnimatePresence>
                              {opened === book.id && (
                                <motion.span
                                  initial={{ opacity: 0.6, scaleX: 0 }}
                                  animate={{ opacity: 0, scaleX: 1 }}
                                  exit={{ opacity: 0 }}
                                  transition={{ duration: 0.8, ease: QUIET_EASE }}
                                  className="absolute inset-x-2 inset-y-0.5 origin-left rounded-lg bg-foreground/10 md:inset-x-4"
                                />
                              )}
                            </AnimatePresence>
                            <div className="relative flex min-w-0 items-center gap-3">
                              <TypographicCover book={book} compact className="aspect-[2/3] w-[26px] shrink-0 rounded-[2px] shadow-sm" />
                              <div className="min-w-0">
                                <p className="truncate text-[13.5px] font-medium">
                                  <Highlight text={book.title} query={query} />
                                </p>
                                <p className="truncate text-xs text-muted-foreground">
                                  <Highlight text={book.author} query={query} />
                                </p>
                              </div>
                            </div>
                            {wide && (
                              <div className="relative flex items-center gap-2.5">
                                {book.status === "want-to-read" ? (
                                  <span className="text-xs text-muted-foreground/70">Not started</span>
                                ) : (
                                  <>
                                    <ProgressLine value={book.progress} className="w-16" />
                                    <span className="text-xs text-muted-foreground tabular-nums">{percent(book.progress)}</span>
                                  </>
                                )}
                              </div>
                            )}
                            <span className="relative text-right text-xs text-muted-foreground tabular-nums">{relativeDay(book.lastReadAt)}</span>
                            {wide && (
                              <>
                                <span className="relative text-right text-xs text-muted-foreground tabular-nums">
                                  {stats?.minutes ? formatDuration(stats.minutes) : "—"}
                                </span>
                                <span className="relative flex items-center justify-end gap-1 text-xs text-muted-foreground tabular-nums">
                                  {stats?.highlights ? (
                                    <>
                                      <Highlighter className="size-3 opacity-60" />
                                      {stats.highlights}
                                    </>
                                  ) : (
                                    "—"
                                  )}
                                </span>
                                <span className="relative flex justify-end text-xs text-muted-foreground tabular-nums">
                                  <span className={cn("transition-opacity duration-150", active && "opacity-0")}>{shortDate(book.addedAt)}</span>
                                  <span className={cn("absolute inset-y-0 right-0 flex items-center gap-0.5 opacity-0 transition-opacity duration-150", active && "opacity-100")}>
                                    <button
                                      type="button"
                                      aria-label={book.status === "finished" ? `Mark ${book.title} as reading` : `Mark ${book.title} as finished`}
                                      title={book.status === "finished" ? "Mark as reading" : "Mark as finished"}
                                      onClick={() =>
                                        setOverrides((current) => ({
                                          ...current,
                                          [book.id]: book.status === "finished" ? "reading" : "finished",
                                        }))
                                      }
                                      className="grid size-7 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"
                                    >
                                      {book.status === "finished" ? <RotateCcw className="size-3.5" /> : <Check className="size-3.5" />}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => open(book.id)}
                                      className="h-7 cursor-pointer rounded-md px-2 text-xs font-medium text-foreground hover:bg-background"
                                    >
                                      Open
                                    </button>
                                  </span>
                                </span>
                              </>
                            )}
                          </motion.div>
                        );
                      })}
                  </AnimatePresence>
                </Fragment>
              );
            })}
            {groups.length === 0 && (
              <p className="py-16 text-center text-sm text-muted-foreground">No book matches “{query}”.</p>
            )}
          </LayoutGroup>
        </div>

        <div className="flex h-9 shrink-0 items-center gap-4 border-t px-5 text-[11px] text-muted-foreground md:px-8">
          <span className="tabular-nums">{visibleRows.length} books</span>
          <span className="ml-auto flex items-center gap-1.5 max-sm:hidden">
            <QuietKbd>↑</QuietKbd>
            <QuietKbd>↓</QuietKbd> move
          </span>
          <span className="flex items-center gap-1.5 max-sm:hidden">
            <QuietKbd>↵</QuietKbd> open
          </span>
          <span className="flex items-center gap-1.5 max-sm:hidden">
            <QuietKbd>/</QuietKbd> filter
          </span>
        </div>

        {/* Cover preview that follows the pointer */}
        <AnimatePresence>
          {peekBook && (
            <motion.div
              key="peek"
              className="pointer-events-none absolute top-0 left-0 z-30"
              style={{ x: springX, y: springY }}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.12 } }}
              transition={{ duration: 0.18, ease: QUIET_EASE }}
            >
              <AnimatePresence mode="popLayout" initial={false}>
                <motion.div
                  key={peekBook.id}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.14 }}
                >
                  <QuietCover book={peekBook} className="h-[180px] w-[120px] shadow-[0_2px_4px_rgba(0,0,0,0.08),0_24px_40px_-16px_rgba(0,0,0,0.45)]" />
                </motion.div>
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </StageSurface>
  );
}
