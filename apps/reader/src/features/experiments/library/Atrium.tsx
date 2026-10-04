/**
 * Atrium: one book in front, the rest arranged quietly behind it.
 *
 * The current book is the only large element. Other books in progress sit
 * beside it as small covers; choosing one moves its cover into place with a
 * shared layout transition. Shelves scroll horizontally. A filter turns the
 * page into a grid that reflows in place, and ⌘K opens a finder.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import {
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import type { StudioBook, StudioLibrary } from "../data/sample-library";
import { StageSurface, TypographicCover } from "../primitives";
import {
  ProgressLine,
  QUIET_EASE,
  QUIET_FADE,
  QUIET_SPRING,
  QuietCover,
  QuietKbd,
  STATUS_LABEL,
  activityByBook,
  estimateMinutesLeft,
  formatDuration,
  percent,
  relativeDay,
  shelfBooks,
} from "../quiet";

type Filter = "all" | "reading" | "want-to-read" | "finished";

const FILTERS: { value: Filter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "reading", label: "Reading" },
  { value: "want-to-read", label: "Up next" },
  { value: "finished", label: "Finished" },
];

const HERO_EYEBROW: Record<StudioBook["status"], string> = {
  reading: "Continue reading",
  "want-to-read": "Start reading",
  finished: "Read again",
  dnf: "Pick up again",
};

/** A cover that tilts a few degrees toward the pointer, with a soft sheen. */
function TiltCover({ book }: { book: StudioBook }) {
  const reducedMotion = useReducedMotion() ?? false;
  const px = useMotionValue(0.5);
  const py = useMotionValue(0.5);
  const springX = useSpring(px, { stiffness: 220, damping: 26 });
  const springY = useSpring(py, { stiffness: 220, damping: 26 });
  const glare = useSpring(0, { stiffness: 200, damping: 30 });
  const rotateY = useTransform(springX, [0, 1], [-5, 5]);
  const rotateX = useTransform(springY, [0, 1], [4, -4]);
  const sheen = useTransform(
    [springX, springY],
    ([x, y]) =>
      `radial-gradient(70% 55% at ${(x as number) * 100}% ${(y as number) * 100}%, rgba(255,255,255,0.16), transparent 70%)`,
  );

  const handleMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType === "touch") return;
    const rect = event.currentTarget.getBoundingClientRect();
    px.set((event.clientX - rect.left) / rect.width);
    py.set((event.clientY - rect.top) / rect.height);
    glare.set(1);
  };

  return (
    <div
      className="relative"
      style={{ perspective: 900 }}
      onPointerMove={handleMove}
      onPointerLeave={() => {
        px.set(0.5);
        py.set(0.5);
        glare.set(0);
      }}
    >
      <motion.div
        layoutId={`atrium-cover-${book.id}`}
        transition={QUIET_SPRING}
        className="relative h-[260px] w-[174px] md:h-[300px] md:w-[200px]"
        style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      >
        <QuietCover book={book} className="size-full shadow-[0_2px_4px_rgba(0,0,0,0.06),0_28px_50px_-24px_rgba(0,0,0,0.55)]" />
        <motion.span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[5px]" style={{ background: sheen, opacity: glare }} />
      </motion.div>
    </div>
  );
}

function Rail({
  title,
  books,
  minutes,
  onSeeAll,
  onSelect,
}: {
  title: string;
  books: StudioBook[];
  minutes: Map<string, number>;
  onSeeAll: () => void;
  onSelect: (book: StudioBook) => void;
}) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scrollBy = (direction: number) =>
    scrollerRef.current?.scrollBy({ left: direction * 420, behavior: "smooth" });

  if (books.length === 0) return null;
  return (
    <section className="group/rail py-5">
      <div className="mb-3 flex items-baseline justify-between px-6 md:px-10">
        <h4 className="text-[13px] font-medium">
          {title} <span className="ml-1 text-muted-foreground tabular-nums">{books.length}</span>
        </h4>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onSeeAll}
            className="cursor-pointer rounded-md px-2 py-1 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          >
            See all
          </button>
          {[-1, 1].map((direction) => (
            <button
              key={direction}
              type="button"
              aria-label={direction < 0 ? "Scroll back" : "Scroll forward"}
              onClick={() => scrollBy(direction)}
              className="grid size-7 cursor-pointer place-items-center rounded-full text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color] duration-200 group-hover/rail:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring max-md:hidden"
            >
              {direction < 0 ? <ChevronLeft className="size-4" /> : <ChevronRight className="size-4" />}
            </button>
          ))}
        </div>
      </div>
      <div
        ref={scrollerRef}
        className="xp-scroll-quiet flex snap-x snap-mandatory scroll-px-6 gap-5 overflow-x-auto px-6 pt-1 pb-3 md:scroll-px-10 md:px-10"
        style={{
          maskImage: "linear-gradient(to right, transparent, #000 1.5rem, #000 calc(100% - 3rem), transparent)",
          WebkitMaskImage: "linear-gradient(to right, transparent, #000 1.5rem, #000 calc(100% - 3rem), transparent)",
        }}
      >
        {books.map((book) => (
          <button
            key={book.id}
            type="button"
            onClick={() => onSelect(book)}
            className="group w-[118px] shrink-0 cursor-pointer snap-start self-start text-left outline-none"
          >
            <span className="block transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] group-hover:-translate-y-1 group-focus-visible:-translate-y-1">
              <QuietCover book={book} className="aspect-[2/3] w-full group-focus-visible:ring-2 group-focus-visible:ring-ring" />
            </span>
            {book.status === "reading" && <ProgressLine value={book.progress} className="mt-2.5" />}
            <span className="mt-2.5 line-clamp-2 block text-[13px] leading-snug font-medium">{book.title}</span>
            <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">
              {book.status === "finished" && minutes.get(book.id)
                ? formatDuration(minutes.get(book.id) ?? 0)
                : book.author}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}

function Finder({
  books,
  onClose,
  onChoose,
}: {
  books: StudioBook[];
  onClose: () => void;
  onChoose: (book: StudioBook) => void;
}) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? books.filter((book) => `${book.title} ${book.author}`.toLowerCase().includes(needle))
      : [...books].sort((a, b) => (b.lastReadAt ?? 0) - (a.lastReadAt ?? 0));
    return list.slice(0, 7);
  }, [books, query]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((value) => Math.min(results.length - 1, value + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((value) => Math.max(0, value - 1));
    } else if (event.key === "Enter" && results[active]) {
      onChoose(results[active]);
    }
  };

  return (
    <motion.div
      className="absolute inset-0 z-40 flex items-start justify-center bg-background/50 px-4 pt-[14%] backdrop-blur-[2px]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.12 } }}
      transition={QUIET_FADE}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <motion.div
        role="dialog"
        aria-label="Find a book"
        initial={{ opacity: 0, scale: 0.98, y: -6 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.12 } }}
        transition={{ duration: 0.2, ease: QUIET_EASE }}
        className="w-full max-w-[34rem] overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-[0_24px_60px_-20px_rgba(0,0,0,0.35)]"
      >
        <label className="flex items-center gap-3 border-b px-4">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(0);
            }}
            placeholder="Find a book or author"
            aria-label="Find a book or author"
            className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
          />
          <QuietKbd>esc</QuietKbd>
        </label>
        <ul className="max-h-80 overflow-y-auto p-1.5" role="listbox" aria-label="Books">
          {results.length === 0 && (
            <li className="px-3 py-8 text-center text-sm text-muted-foreground">No book matches “{query}”.</li>
          )}
          {results.map((book, index) => (
            <li key={book.id} role="option" aria-selected={index === active}>
              <button
                type="button"
                onPointerMove={() => setActive(index)}
                onClick={() => onChoose(book)}
                className="relative flex w-full cursor-pointer items-center gap-3 rounded-xl px-2.5 py-2 text-left outline-none"
              >
                {index === active && (
                  <motion.span layoutId="atrium-finder-active" transition={QUIET_SPRING} className="absolute inset-0 rounded-xl bg-muted" />
                )}
                <TypographicCover book={book} compact className="relative aspect-[2/3] w-6 shrink-0 rounded-[2px]" />
                <span className="relative min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{book.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{book.author}</span>
                </span>
                <span className="relative text-[11px] text-muted-foreground">{STATUS_LABEL[book.status]}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="flex items-center gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <QuietKbd>↑</QuietKbd>
            <QuietKbd>↓</QuietKbd> move
          </span>
          <span className="flex items-center gap-1.5">
            <QuietKbd>↵</QuietKbd> open
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function Atrium({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const books = useMemo(() => shelfBooks(library), [library]);
  const activity = useMemo(() => activityByBook(library), [library]);
  const minutes = useMemo(
    () => new Map([...activity.entries()].map(([id, value]) => [id, value.minutes])),
    [activity],
  );
  const groups = useMemo(() => {
    const byRecent = (a: StudioBook, b: StudioBook) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt);
    return {
      reading: books.filter((book) => book.status === "reading").sort(byRecent),
      next: books.filter((book) => book.status === "want-to-read").sort((a, b) => b.addedAt - a.addedAt),
      finished: books.filter((book) => book.status === "finished").sort(byRecent),
      aside: books.filter((book) => book.status === "dnf").sort(byRecent),
    };
  }, [books]);
  const [filter, setFilter] = useState<Filter>("all");
  const [heroId, setHeroId] = useState<string | null>(null);
  const [finderOpen, setFinderOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll({ container: scrollerRef });
  const barBorder = useTransform(scrollY, [0, 24], [0, 1]);

  const hero = books.find((book) => book.id === heroId) ?? groups.reading[0] ?? groups.next[0] ?? books[0];
  const alsoReading = groups.reading.filter((book) => book.id !== hero?.id).slice(0, 4);
  const filtered =
    filter === "all" ? [] : books.filter((book) => book.status === filter).sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt));

  const choose = (book: StudioBook) => {
    setHeroId(book.id);
    setFilter("all");
    setFinderOpen(false);
    scrollerRef.current?.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
  };

  if (!hero) return null;
  const heroMinutes = minutes.get(hero.id) ?? 0;
  const minutesLeft = estimateMinutesLeft(heroMinutes, hero.progress);

  return (
    <StageSurface
      tone="inherit"
      className="relative size-full"
      onKeyDown={(event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
          event.preventDefault();
          setFinderOpen(true);
        }
      }}
    >
      <LayoutGroup id="atrium">
        <div ref={scrollerRef} tabIndex={-1} className="xp-scroll-quiet absolute inset-0 overflow-y-auto overscroll-contain outline-none">
          {/* Top bar: a hairline appears only once content scrolls under it. */}
          <div className="sticky top-0 z-20 bg-background/80 backdrop-blur-xl">
            <div className="flex min-h-14 flex-wrap items-center gap-x-3 gap-y-2 px-6 py-3 sm:flex-nowrap sm:py-0 md:px-10">
              <p className="text-[15px] font-medium">
                Library <span className="ml-1 text-muted-foreground tabular-nums">{books.length}</span>
              </p>
              <div className="order-last flex items-center gap-1 rounded-full bg-muted/60 p-0.5 text-[12px] font-medium max-sm:basis-full sm:order-none sm:ml-auto" role="radiogroup" aria-label="Show">
                {FILTERS.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    role="radio"
                    aria-checked={filter === option.value}
                    onClick={() => setFilter(option.value)}
                    className={cn(
                      "relative cursor-pointer rounded-full px-3 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring max-sm:flex-1",
                      filter === option.value ? "text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {filter === option.value && (
                      <motion.span layoutId="atrium-filter" transition={QUIET_SPRING} className="absolute inset-0 rounded-full bg-background shadow-sm ring-1 ring-border/60" />
                    )}
                    <span className="relative">{option.label}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setFinderOpen(true)}
                className="flex h-8 cursor-pointer items-center gap-2 rounded-full border border-border/70 pr-1.5 pl-3 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-sm:ml-auto max-sm:pr-3 sm:ml-2"
              >
                <Search className="size-3.5" />
                <span>Find</span>
                <span className="max-sm:hidden">
                  <QuietKbd>⌘K</QuietKbd>
                </span>
              </button>
              <button
                type="button"
                aria-label="Add books"
                className="grid size-8 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus className="size-4" />
              </button>
            </div>
            <motion.div className="h-px bg-border" style={{ opacity: barBorder }} />
          </div>

          <AnimatePresence mode="popLayout" initial={false}>
            {filter === "all" ? (
              <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={QUIET_FADE}>
                {/* Hero */}
                <section className="grid items-center gap-8 px-6 pt-8 pb-6 md:grid-cols-[auto_minmax(0,1fr)] md:gap-14 md:px-10 md:pt-12">
                  <div className="max-md:mx-auto">
                    <TiltCover key={hero.id} book={hero} />
                  </div>
                  <div className="min-w-0">
                    <AnimatePresence mode="popLayout" initial={false}>
                      <motion.div
                        key={hero.id}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.25, ease: QUIET_EASE }}
                      >
                        <p className="text-xs font-medium text-muted-foreground">{HERO_EYEBROW[hero.status]}</p>
                        <h4 className="xp-serif mt-2 text-[clamp(2rem,4vw,3.25rem)] leading-[1.02] tracking-[-0.02em] text-balance">
                          {hero.title}
                        </h4>
                        <p className="mt-2 text-[15px] text-muted-foreground">{hero.author}</p>

                        {hero.status === "reading" && (
                          <div className="mt-7 max-w-sm">
                            <div className="mb-2 flex justify-between text-xs text-muted-foreground">
                              <span>{hero.lastReadAt ? `Last read ${relativeDay(hero.lastReadAt).toLowerCase()}` : "Not opened yet"}</span>
                              <span className="tabular-nums text-foreground">{percent(hero.progress)}</span>
                            </div>
                            <ProgressLine value={hero.progress} />
                            {minutesLeft !== null && (
                              <p className="mt-2 text-xs text-muted-foreground">About {formatDuration(minutesLeft)} left at your pace</p>
                            )}
                          </div>
                        )}

                        <div className="mt-7 flex items-center gap-2">
                          <button
                            type="button"
                            className="h-10 cursor-pointer rounded-full bg-foreground px-5 text-sm font-medium text-background outline-none transition-transform duration-150 active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            {hero.status === "reading" ? "Continue" : hero.status === "finished" ? "Open" : "Start"}
                          </button>
                          <button
                            type="button"
                            className="h-10 cursor-pointer rounded-full px-4 text-sm text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            Details
                          </button>
                        </div>
                      </motion.div>
                    </AnimatePresence>

                    {alsoReading.length > 0 && (
                      <div className="mt-10">
                        <p className="mb-3 text-xs text-muted-foreground">Also reading</p>
                        <div className="flex items-end gap-3">
                          {alsoReading.map((book) => (
                            <button
                              key={book.id}
                              type="button"
                              onClick={() => setHeroId(book.id)}
                              aria-label={`Show ${book.title}`}
                              title={book.title}
                              className="group cursor-pointer rounded-[4px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                              <motion.span layoutId={`atrium-cover-${book.id}`} transition={QUIET_SPRING} className="block h-[66px] w-[44px]">
                                <QuietCover book={book} compact className="size-full transition-transform duration-200 group-hover:-translate-y-0.5" />
                              </motion.span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </section>

                <div className="mx-6 h-px bg-border/70 md:mx-10" />
                <Rail title="Up next" books={groups.next} minutes={minutes} onSeeAll={() => setFilter("want-to-read")} onSelect={choose} />
                <Rail title="Finished" books={groups.finished} minutes={minutes} onSeeAll={() => setFilter("finished")} onSelect={choose} />
                <Rail title="Set aside" books={groups.aside} minutes={minutes} onSeeAll={() => setFilter("all")} onSelect={choose} />
                <div className="h-8" />
              </motion.div>
            ) : (
              <motion.div key="grid" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={QUIET_FADE} className="px-6 pt-8 pb-12 md:px-10">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(118px,1fr))] gap-x-6 gap-y-8">
                  <AnimatePresence mode="popLayout" initial={false}>
                    {filtered.map((book) => (
                      <motion.button
                        key={book.id}
                        type="button"
                        layout
                        initial={{ opacity: 0, scale: 0.97 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.97 }}
                        transition={QUIET_SPRING}
                        onClick={() => choose(book)}
                        className="group cursor-pointer self-start text-left outline-none"
                      >
                        <span className="block transition-transform duration-300 ease-[cubic-bezier(0.2,0,0,1)] group-hover:-translate-y-1">
                          <QuietCover book={book} className="aspect-[2/3] w-full group-focus-visible:ring-2 group-focus-visible:ring-ring" />
                        </span>
                        {book.status === "reading" && <ProgressLine value={book.progress} className="mt-2.5" />}
                        <span className="mt-2.5 line-clamp-2 block text-[13px] leading-snug font-medium">{book.title}</span>
                        <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{book.author}</span>
                      </motion.button>
                    ))}
                  </AnimatePresence>
                </div>
                {filtered.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">Nothing here yet.</p>}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {finderOpen && <Finder books={books} onClose={() => setFinderOpen(false)} onChoose={choose} />}
        </AnimatePresence>
      </LayoutGroup>
    </StageSurface>
  );
}
