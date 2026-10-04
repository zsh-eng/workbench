/**
 * Shelf: books stand in the order you started them; spine width is time.
 *
 * Pointing at a spine lifts it and its neighbours lean away. Choosing one
 * pulls it from the shelf (a shared layout transition into the detail view)
 * and draws each sitting as a stroke across the length of the book.
 */
import { cn } from "@/lib/utils";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from "motion/react";
import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { StudioLibrary } from "../data/sample-library";
import {
  EASE_OUT,
  SNAPPY_SPRING,
  SOFT_SPRING,
  StageSurface,
  TypographicCover,
  formatMinutes,
  getStableNumber,
  toneSurface,
  toneText,
  useElementSize,
} from "../primitives";
import { DAY_MS, timeByBook, type BookTime } from "./session-stats";

const SHORT_DATE = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const MAX_STRIP_ROWS = 44;

function Spine({
  entry,
  width,
  height,
  lean,
  lifted,
  hidden,
  onHover,
  onSelect,
}: {
  entry: BookTime;
  width: number;
  height: number;
  lean: -1 | 0 | 1;
  lifted: boolean;
  hidden: boolean;
  onHover: (hovered: boolean) => void;
  onSelect: () => void;
}) {
  const hours = entry.minutes / 60;
  return (
    <motion.button
      type="button"
      onPointerEnter={() => onHover(true)}
      onPointerLeave={() => onHover(false)}
      onFocus={() => onHover(true)}
      onBlur={() => onHover(false)}
      onClick={onSelect}
      aria-label={`${entry.book.title}, ${formatMinutes(entry.minutes * 60000)}`}
      className="relative shrink-0 cursor-pointer outline-none focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      style={{ width, height, originX: lean === -1 ? 0 : lean === 1 ? 1 : 0.5, originY: 1 }}
      animate={{
        y: lifted ? -14 : 0,
        rotate: lean * 2.6,
        opacity: hidden ? 0 : 1,
      }}
      transition={SNAPPY_SPRING}
    >
      <motion.span
        layoutId={`spine-${entry.book.id}`}
        transition={SOFT_SPRING}
        className="absolute inset-0 overflow-hidden rounded-t-[3px] rounded-b-[1px]"
        style={{ background: toneSurface(entry.book.tone), color: toneText() }}
      >
        <span
          aria-hidden="true"
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to right, rgba(255,255,255,0.16), rgba(255,255,255,0.02) 22%, transparent 70%, rgba(0,0,0,0.22))",
          }}
        />
        <span aria-hidden="true" className="absolute inset-x-1.5 top-3 border-y border-current opacity-35" style={{ height: 4 }} />
        <span aria-hidden="true" className="absolute inset-x-1.5 bottom-9 border-y border-current opacity-35" style={{ height: 4 }} />
        <span
          className="xp-vertical xp-serif absolute inset-x-0 top-6 bottom-12 flex items-center justify-center overflow-hidden px-0.5 leading-none whitespace-nowrap"
          style={{ fontSize: Math.min(17, Math.max(10, width * 0.42)) }}
        >
          <span className="truncate">{entry.book.title}</span>
        </span>
        <span className="absolute inset-x-0 bottom-2 text-center font-mono text-[9px] opacity-80">
          {hours >= 1 ? `${Math.round(hours)}h` : `${Math.round(entry.minutes)}m`}
        </span>
      </motion.span>
    </motion.button>
  );
}

function SessionStrip({ entry }: { entry: BookTime }) {
  const rows = entry.sessions.slice(-MAX_STRIP_ROWS);
  return (
    <div>
      <div className="mb-2 flex justify-between font-mono text-[10px] text-muted-foreground uppercase">
        <span>First page</span>
        <span>The end</span>
      </div>
      <div className="relative rounded-md border border-foreground/10 bg-foreground/[0.03] px-2 py-2">
        {[0.25, 0.5, 0.75].map((mark) => (
          <span
            key={mark}
            aria-hidden="true"
            className="absolute inset-y-0 w-px bg-foreground/10"
            style={{ left: `calc(0.5rem + (100% - 1rem) * ${mark})` }}
          />
        ))}
        <div className="flex flex-col gap-[2px]">
          {rows.map((session, index) => {
            const from = Math.min(session.startFraction, session.endFraction);
            const to = Math.max(session.endFraction, from + 0.006);
            return (
              <div key={session.id} className="relative h-[3px]">
                <motion.span
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: `${from * 100}%`,
                    width: `${(to - from) * 100}%`,
                    background: toneSurface(entry.book.tone),
                    originX: 0,
                  }}
                  initial={{ scaleX: 0, opacity: 0 }}
                  animate={{ scaleX: 1, opacity: 1 }}
                  transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.35 + index * 0.018 }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-5 text-muted-foreground">
        Each line is one sitting, oldest at the top. Its position shows where you were in the book.
        {entry.sessions.length > MAX_STRIP_ROWS && ` Showing the last ${MAX_STRIP_ROWS} of ${entry.sessions.length}.`}
      </p>
    </div>
  );
}

function WeeklyBars({ entry }: { entry: BookTime }) {
  const weeks = Math.max(1, Math.ceil((entry.last - entry.first) / (7 * DAY_MS)) + 1);
  const totals = new Array<number>(Math.min(weeks, 26)).fill(0);
  const start = entry.last - (totals.length - 1) * 7 * DAY_MS - 6 * DAY_MS;
  for (const session of entry.sessions) {
    const index = Math.floor((session.startedAt - start) / (7 * DAY_MS));
    if (index >= 0 && index < totals.length) totals[index] += session.activeMs / 60000;
  }
  const max = Math.max(1, ...totals);
  return (
    <div className="flex h-10 items-end gap-[3px]" aria-hidden="true">
      {totals.map((minutes, index) => (
        <motion.span
          key={index}
          className="block w-full min-w-[3px] rounded-t-[2px] bg-foreground/70"
          style={{ originY: 1 }}
          initial={{ scaleY: 0 }}
          animate={{ scaleY: 1 }}
          transition={{ duration: 0.5, ease: EASE_OUT, delay: 0.5 + index * 0.02 }}
        >
          <span className="block" style={{ height: `${Math.max(4, (minutes / max) * 40)}px` }} />
        </motion.span>
      ))}
    </div>
  );
}

export function Shelf({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const all = useMemo(
    () => timeByBook(library.sessions, library.books).sort((a, b) => a.first - b.first),
    [library.sessions, library.books],
  );
  const years = useMemo(
    () => [...new Set(all.flatMap((entry) => entry.sessions.map((session) => new Date(session.startedAt).getFullYear())))].sort(),
    [all],
  );
  const [year, setYear] = useState<number | "all">("all");
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();

  const books = useMemo(() => {
    if (year === "all") return all;
    return timeByBook(
      library.sessions.filter((session) => new Date(session.startedAt).getFullYear() === year),
      library.books,
    ).sort((a, b) => a.first - b.first);
  }, [all, library.books, library.sessions, year]);

  useEffect(() => {
    if (!selected) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  // Spine width grows with the square root of time, then fits the shelf.
  const available = Math.max(200, size.width - 72);
  const rawWidths = books.map((entry) => Math.min(104, 24 + Math.sqrt(entry.minutes) * 3.4));
  const totalRaw = rawWidths.reduce((sum, width) => sum + width + 3, 0);
  const fit = Math.min(1, available / Math.max(1, totalRaw));
  const baseHeight = Math.min(340, Math.max(180, size.height * 0.52));
  const hoveredIndex = books.findIndex((entry) => entry.book.id === hovered);
  const selectedEntry = books.find((entry) => entry.book.id === selected) ?? null;
  const totalMinutes = books.reduce((sum, entry) => sum + entry.minutes, 0);

  return (
    <StageSurface tone="inherit" className="relative size-full overflow-hidden">
      <LayoutGroup id="shelf">
        <div ref={sizeRef} className="absolute inset-0">
          <div className="absolute inset-x-0 top-0 flex flex-wrap items-start justify-between gap-4 p-5 md:p-7">
            <div>
              <p className="xp-smcp text-xs tracking-[0.22em] text-muted-foreground">The shelf</p>
              <p className="xp-serif mt-1 text-[clamp(1.8rem,3.5vw,2.6rem)] leading-none tracking-[-0.02em]">
                {books.length} books, <span className="italic">{Math.round(totalMinutes / 60)} hours</span>
              </p>
            </div>
            <div className="flex rounded-full border bg-background p-0.5 text-[11px] font-medium" role="radiogroup" aria-label="Year">
              {(["all", ...years] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={year === option}
                  onClick={() => setYear(option)}
                  className={cn(
                    "relative isolate cursor-pointer rounded-full px-3 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    year === option ? "text-background" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {year === option && (
                    <motion.span layoutId="shelf-year" transition={SNAPPY_SPRING} className="absolute inset-0 -z-10 rounded-full bg-foreground" />
                  )}
                  {option === "all" ? "All years" : option}
                </button>
              ))}
            </div>
          </div>

          {/* Shelf */}
          <motion.div
            className="absolute inset-x-0 bottom-[16%] flex flex-col items-center"
            animate={{ opacity: selectedEntry ? 0.18 : 1, filter: selectedEntry ? "blur(2px)" : "blur(0px)" }}
            transition={{ duration: 0.4 }}
          >
            <div className="flex items-end gap-[3px] px-9" onPointerLeave={() => setHovered(null)}>
              <AnimatePresence initial={false} mode="popLayout">
                {books.map((entry, index) => {
                  const height = baseHeight * (0.8 + (getStableNumber(entry.book.id) % 5) * 0.05);
                  const lean: -1 | 0 | 1 =
                    hoveredIndex < 0 ? 0 : index === hoveredIndex - 1 ? -1 : index === hoveredIndex + 1 ? 1 : 0;
                  return (
                    <motion.div
                      key={entry.book.id}
                      layout="position"
                      initial={{ opacity: 0, y: 30 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 30, transition: { duration: 0.2 } }}
                      transition={{ ...SOFT_SPRING, delay: reducedMotion ? 0 : index * 0.03 }}
                    >
                      <Spine
                        entry={entry}
                        width={rawWidths[index] * fit}
                        height={height}
                        lean={lean}
                        lifted={hovered === entry.book.id}
                        hidden={selected === entry.book.id}
                        onHover={(isHovered) => setHovered(isHovered ? entry.book.id : null)}
                        onSelect={() => setSelected(entry.book.id)}
                      />
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
            {/* Plank */}
            <div className="relative h-3 w-[min(100%-2rem,calc(var(--w)+5rem))] rounded-[2px] bg-foreground/85 shadow-[0_14px_24px_-10px_rgba(0,0,0,0.45)]" style={{ ["--w" as string]: `${totalRaw * fit}px` }} />
            <p className="xp-serif mt-4 text-sm text-muted-foreground italic">
              {books.length > 0 ? `${SHORT_DATE.format(books[0].first)} → ${SHORT_DATE.format(books[books.length - 1].last)}` : "Nothing read in this year."}
            </p>
          </motion.div>
        </div>

        {/* Pulled-out book */}
        <AnimatePresence>
          {selectedEntry && (
            <motion.div
              key="detail"
              className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto p-5 md:p-10"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.25, delay: 0.05 } }}
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelected(null);
              }}
            >
              <div className="grid w-full max-w-4xl items-center gap-8 md:grid-cols-[auto_minmax(0,1fr)] md:gap-12">
                <div className="mx-auto" style={{ perspective: 1200 }}>
                  <motion.div
                    layoutId={`spine-${selectedEntry.book.id}`}
                    transition={SOFT_SPRING}
                    className="relative h-[270px] w-[180px] overflow-hidden rounded-r-lg rounded-l-[4px] shadow-[0_30px_60px_-24px_rgba(0,0,0,0.55)]"
                    style={{ background: toneSurface(selectedEntry.book.tone), rotateY: -10 }}
                  >
                    <motion.div
                      className="size-full"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.2, duration: 0.3 }}
                    >
                      <TypographicCover book={selectedEntry.book} className="size-full" />
                    </motion.div>
                  </motion.div>
                </div>

                <motion.div
                  initial={{ opacity: 0, x: 24 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 12, transition: { duration: 0.15 } }}
                  transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.12 }}
                  className="min-w-0 rounded-3xl border bg-background/95 p-6 shadow-xl backdrop-blur md:p-8"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <h4 className="xp-serif text-[clamp(2rem,4vw,3rem)] leading-[0.95] tracking-[-0.02em] text-balance">{selectedEntry.book.title}</h4>
                      <p className="xp-smcp mt-2 text-sm tracking-[0.18em] text-muted-foreground">{selectedEntry.book.author}</p>
                    </div>
                    <button
                      type="button"
                      aria-label="Put the book back"
                      onClick={() => setSelected(null)}
                      className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full bg-foreground text-background outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X className="size-4" />
                    </button>
                  </div>

                  <dl className="mt-6 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
                    {[
                      { label: "Time", value: formatMinutes(selectedEntry.minutes * 60000) },
                      { label: "Sittings", value: selectedEntry.sessions.length.toLocaleString() },
                      { label: "Typical", value: formatMinutes((selectedEntry.minutes / selectedEntry.sessions.length) * 60000) },
                      { label: "Reached", value: `${Math.round(Math.max(...selectedEntry.sessions.map((session) => session.endFraction)) * 100)}%` },
                    ].map((item) => (
                      <div key={item.label}>
                        <dt className="xp-smcp text-[11px] tracking-[0.16em] text-muted-foreground">{item.label}</dt>
                        <dd className="xp-serif xp-onum mt-0.5 text-xl">{item.value}</dd>
                      </div>
                    ))}
                  </dl>

                  <div className="mt-6">
                    <SessionStrip entry={selectedEntry} />
                  </div>

                  <div className="mt-5 flex items-end justify-between gap-6">
                    <div className="min-w-0 flex-1">
                      <WeeklyBars entry={selectedEntry} />
                    </div>
                    <p className="xp-serif xp-onum shrink-0 text-right text-sm text-muted-foreground italic">
                      {SHORT_DATE.format(selectedEntry.first)}
                      <br />→ {SHORT_DATE.format(selectedEntry.last)}
                    </p>
                  </div>
                </motion.div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </LayoutGroup>
    </StageSurface>
  );
}
