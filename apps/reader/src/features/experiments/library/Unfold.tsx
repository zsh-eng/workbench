/**
 * Unfold: a calm cover grid that opens details in place.
 *
 * Choosing a cover inserts a detail band directly under its row instead of
 * navigating away. A small notch slides to the chosen column. Moving to
 * another book in the same row swaps the band's content; another row closes
 * the band and opens it there.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { X } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { StudioLibrary, StudioStatus } from "../data/sample-library";
import { StageSurface, inkColor, useElementSize } from "../primitives";
import {
  ProgressLine,
  QUIET_EASE,
  QUIET_SPRING,
  QuietCover,
  STATUS_LABEL,
  activityByBook,
  estimateMinutesLeft,
  formatDuration,
  percent,
  relativeDay,
  shelfBooks,
  shortDate,
} from "../quiet";

type Filter = "all" | StudioStatus;

const MIN_COLUMN = 128;
const GAP = 24;
const STATUS_CHOICES: StudioStatus[] = ["want-to-read", "reading", "finished"];

export function Unfold({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const baseBooks = useMemo(() => shelfBooks(library), [library]);
  const activity = useMemo(() => activityByBook(library), [library]);
  const [overrides, setOverrides] = useState<Record<string, StudioStatus>>({});
  const [filter, setFilter] = useState<Filter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const scrollerRef = useRef<HTMLDivElement>(null);

  const books = useMemo(
    () =>
      baseBooks
        .map((book) => (overrides[book.id] ? { ...book, status: overrides[book.id] } : book))
        .filter((book) => filter === "all" || book.status === filter)
        .sort((a, b) => (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt)),
    [baseBooks, filter, overrides],
  );
  const counts = useMemo(() => {
    const result: Record<Filter, number> = { all: baseBooks.length, reading: 0, "want-to-read": 0, finished: 0, dnf: 0 };
    for (const book of baseBooks) result[overrides[book.id] ?? book.status] += 1;
    return result;
  }, [baseBooks, overrides]);

  const innerWidth = Math.max(0, size.width - 2 * (size.width >= 640 ? 40 : 24));
  const columns = Math.max(2, Math.floor((innerWidth + GAP) / (MIN_COLUMN + GAP)));
  const selectedIndex = books.findIndex((book) => book.id === selectedId);
  const selected = selectedIndex >= 0 ? books[selectedIndex] : null;
  const selectedRow = selectedIndex >= 0 ? Math.floor(selectedIndex / columns) : -1;
  const selectedColumn = selectedIndex >= 0 ? selectedIndex % columns : 0;
  const bandAfter = selectedRow >= 0 ? Math.min(books.length - 1, (selectedRow + 1) * columns - 1) : -1;
  const highlights = selected
    ? library.highlights.filter((highlight) => highlight.bookId === selected.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 3)
    : [];

  // Bring an opened band into view once it has expanded.
  useEffect(() => {
    if (!selectedId) return;
    const timeout = window.setTimeout(() => {
      // Scroll only the grid; scrollIntoView would also move the page.
      const scroller = scrollerRef.current;
      const band = scroller?.querySelector<HTMLElement>("[data-band]");
      if (!scroller || !band) return;
      const bandBottom = band.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + scroller.scrollTop;
      const overflow = bandBottom + 24 - (scroller.scrollTop + scroller.clientHeight);
      if (overflow > 0) {
        scroller.scrollTo({ top: scroller.scrollTop + overflow, behavior: reducedMotion ? "auto" : "smooth" });
      }
    }, 340);
    return () => window.clearTimeout(timeout);
  }, [reducedMotion, selectedId]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (selectedIndex < 0) return;
    const moves: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns };
    if (event.key === "Escape") {
      setSelectedId(null);
      return;
    }
    const delta = moves[event.key];
    if (delta === undefined) return;
    event.preventDefault();
    const next = books[Math.min(books.length - 1, Math.max(0, selectedIndex + delta))];
    if (next) setSelectedId(next.id);
  };

  const stats = selected ? activity.get(selected.id) : undefined;
  const minutesLeft = selected ? estimateMinutesLeft(stats?.minutes ?? 0, selected.progress) : null;

  return (
    <StageSurface tone="inherit" className="relative size-full">
      <div ref={sizeRef} className="absolute inset-0 flex flex-col" onKeyDown={handleKeyDown}>
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-6 pt-6 pb-4 sm:px-10">
          {(["all", "reading", "want-to-read", "finished"] as const).map((option) => {
            const active = filter === option;
            return (
              <button
                key={option}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setFilter(option);
                  setSelectedId(null);
                }}
                className={cn(
                  "h-8 cursor-pointer rounded-full border px-3.5 text-[13px] outline-none transition-[background-color,border-color,color] duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-border text-muted-foreground hover:border-foreground/30 hover:text-foreground",
                )}
              >
                {option === "all" ? "All" : STATUS_LABEL[option]}
                <span className={cn("ml-1.5 tabular-nums", active ? "opacity-60" : "opacity-50")}>{counts[option]}</span>
              </button>
            );
          })}
        </div>

        <div ref={scrollerRef} className="xp-scroll-quiet min-h-0 flex-1 overflow-y-auto px-6 pb-12 sm:px-10">
          <div
            className="grid gap-y-8"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP }}
          >
            {books.map((book, index) => {
              const isSelected = book.id === selectedId;
              const dimmed = selected !== null && !isSelected;
              return (
                <Fragment key={book.id}>
                  <button
                    type="button"
                    aria-expanded={isSelected}
                    onClick={() => setSelectedId(isSelected ? null : book.id)}
                    className="group cursor-pointer self-start text-left outline-none"
                  >
                    <motion.span
                      className="block"
                      animate={{ y: isSelected ? -4 : 0, opacity: dimmed ? 0.55 : 1 }}
                      transition={QUIET_SPRING}
                    >
                      <QuietCover
                        book={book}
                        className={cn(
                          "aspect-[2/3] w-full transition-shadow duration-300 group-focus-visible:ring-2 group-focus-visible:ring-ring",
                          isSelected && "shadow-[0_2px_4px_rgba(0,0,0,0.08),0_22px_40px_-18px_rgba(0,0,0,0.5)]",
                        )}
                      />
                    </motion.span>
                    {book.status === "reading" && <ProgressLine value={book.progress} className="mt-2.5" />}
                    <span className={cn("mt-2.5 line-clamp-2 block text-[13px] leading-snug transition-colors", isSelected ? "font-medium text-foreground" : "text-foreground/85")}>
                      {book.title}
                    </span>
                    <span className="mt-0.5 line-clamp-1 block text-xs text-muted-foreground">{book.author}</span>
                  </button>

                  {/* Each row end owns a presence slot so a band can close where it was. */}
                  {((index + 1) % columns === 0 || index === books.length - 1) && (
                    <AnimatePresence initial={false}>
                      {index === bandAfter && selected && (
                      <motion.div
                        key="band"
                        data-band
                        className="relative col-span-full"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.32, ease: QUIET_EASE }}
                      >
                        {/* Notch pointing at the chosen cover */}
                        <motion.span
                          aria-hidden="true"
                          className="absolute top-[3px] z-10 size-3 rotate-45 border-t border-l bg-muted/40 backdrop-blur"
                          initial={false}
                          animate={{ left: `calc(${((selectedColumn + 0.5) / columns) * 100}% - 6px)` }}
                          transition={QUIET_SPRING}
                        />
                        <div className="mt-2 overflow-hidden rounded-2xl border bg-muted/40">
                          <AnimatePresence mode="popLayout" initial={false}>
                            <motion.div
                              key={selected.id}
                              initial={{ opacity: 0, y: 6 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0 }}
                              transition={{ duration: 0.22, ease: QUIET_EASE }}
                              className="grid gap-8 p-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:p-8"
                            >
                              <div className="min-w-0">
                                <div className="flex items-start justify-between gap-4">
                                  <div className="min-w-0">
                                    <h4 className="xp-serif text-[clamp(1.6rem,3vw,2.2rem)] leading-[1.05] tracking-[-0.015em] text-balance">{selected.title}</h4>
                                    <p className="mt-1.5 text-sm text-muted-foreground">{selected.author}</p>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label="Close details"
                                    onClick={() => setSelectedId(null)}
                                    className="grid size-8 shrink-0 cursor-pointer place-items-center rounded-full text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring md:hidden"
                                  >
                                    <X className="size-4" />
                                  </button>
                                </div>

                                <div className="mt-5 inline-flex rounded-full bg-background p-0.5 text-xs shadow-sm ring-1 ring-border/60" role="radiogroup" aria-label="Status">
                                  {STATUS_CHOICES.map((status) => {
                                    const active = selected.status === status;
                                    return (
                                      <button
                                        key={status}
                                        type="button"
                                        role="radio"
                                        aria-checked={active}
                                        onClick={() => setOverrides((current) => ({ ...current, [selected.id]: status }))}
                                        className={cn(
                                          "relative cursor-pointer rounded-full px-3 py-1 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                                          active ? "text-background" : "text-muted-foreground hover:text-foreground",
                                        )}
                                      >
                                        {active && <motion.span layoutId="unfold-status" transition={QUIET_SPRING} className="absolute inset-0 rounded-full bg-foreground" />}
                                        <span className="relative">{STATUS_LABEL[status]}</span>
                                      </button>
                                    );
                                  })}
                                </div>

                                <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4 md:grid-cols-2 lg:grid-cols-4">
                                  {[
                                    { label: "Progress", value: selected.status === "want-to-read" ? "—" : percent(selected.progress) },
                                    { label: "Time", value: stats?.minutes ? formatDuration(stats.minutes) : "—" },
                                    { label: "Last read", value: relativeDay(selected.lastReadAt) },
                                    { label: "Added", value: shortDate(selected.addedAt) },
                                  ].map((item) => (
                                    <div key={item.label}>
                                      <dt className="text-[11px] text-muted-foreground">{item.label}</dt>
                                      <dd className="mt-0.5 text-sm tabular-nums">{item.value}</dd>
                                    </div>
                                  ))}
                                </dl>
                                {selected.status === "reading" && (
                                  <div className="mt-5">
                                    <ProgressLine value={selected.progress} />
                                    {minutesLeft !== null && <p className="mt-2 text-xs text-muted-foreground">About {formatDuration(minutesLeft)} left</p>}
                                  </div>
                                )}
                                <div className="mt-6 flex gap-2">
                                  <button type="button" className="h-9 cursor-pointer rounded-full bg-foreground px-4 text-sm font-medium text-background outline-none transition-transform active:scale-[0.97] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                                    {selected.status === "reading" ? "Continue reading" : selected.status === "finished" ? "Open" : "Start reading"}
                                  </button>
                                  <button type="button" className="h-9 cursor-pointer rounded-full px-4 text-sm text-muted-foreground outline-none hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                                    Highlights
                                  </button>
                                </div>
                              </div>

                              <div className="min-w-0 md:border-l md:pl-8">
                                <p className="text-[11px] text-muted-foreground">
                                  {highlights.length > 0 ? "Recent highlights" : "Highlights"}
                                </p>
                                {highlights.length === 0 ? (
                                  <p className="mt-3 text-sm text-muted-foreground">Passages you highlight will appear here.</p>
                                ) : (
                                  <ul className="mt-3 space-y-4">
                                    {highlights.map((highlight, highlightIndex) => (
                                      <motion.li
                                        key={highlight.id}
                                        initial={{ opacity: 0, y: 4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        transition={{ duration: 0.3, ease: QUIET_EASE, delay: 0.06 + highlightIndex * 0.05 }}
                                        className="border-l-2 pl-3"
                                        style={{ borderColor: inkColor(highlight.color) }}
                                      >
                                        <p className="xp-serif line-clamp-3 text-[15px] leading-snug">{highlight.text}</p>
                                        <p className="mt-1 text-[11px] text-muted-foreground">
                                          {highlight.chapter} · {relativeDay(highlight.createdAt)}
                                        </p>
                                      </motion.li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </motion.div>
                          </AnimatePresence>
                        </div>
                      </motion.div>
                      )}
                    </AnimatePresence>
                  )}
                </Fragment>
              );
            })}
          </div>
          {books.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">Nothing here yet.</p>}
        </div>
      </div>
    </StageSurface>
  );
}
