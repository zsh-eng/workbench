/**
 * Almanac: a year of reading set as a broadsheet.
 *
 * The lead figure rolls like an odometer. Pointing at a day in the calendar
 * swaps the figure and deck to that day; leaving restores the year.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useInView, useReducedMotion } from "motion/react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StudioLibrary } from "../data/sample-library";
import { EASE_OUT, SOFT_SPRING, StageSurface, formatMinutes, inkColor } from "../primitives";
import {
  dayKey,
  formatClock,
  highlightColorsByDay,
  minuteOfDay,
  streaks,
  timeByBook,
  totalsByDay,
} from "./session-stats";

const MONTHS = 12;
const WEEKDAYS = ["Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays"];
const MONTH_NAME = new Intl.DateTimeFormat(undefined, { month: "long" });
const LONG_DATE = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long" });
const MASTHEAD_DATE = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });

function Digit({ digit, delay }: { digit: number; delay: number }) {
  return (
    <span className="relative inline-block h-[1em] overflow-hidden align-top">
      <motion.span
        className="flex flex-col"
        initial={{ y: "0em" }}
        animate={{ y: `${-digit}em` }}
        transition={{ type: "spring", stiffness: 120, damping: 20, mass: 1, delay }}
      >
        {Array.from({ length: 10 }, (_, value) => (
          <span key={value} className="block h-[1em] leading-[1em]">
            {value}
          </span>
        ))}
      </motion.span>
    </span>
  );
}

/** Each digit is a strip of 0–9 that rolls to its value. */
function Odometer({ value }: { value: number }) {
  const digits = String(Math.max(0, Math.round(value))).split("");
  return (
    <span className="xp-lnum inline-flex" aria-label={String(value)}>
      <AnimatePresence initial={false} mode="popLayout">
        {digits.map((digit, index) => {
          const place = digits.length - index;
          return (
            <motion.span
              key={place}
              layout="position"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={SOFT_SPRING}
              className="inline-block overflow-hidden"
            >
              <Digit digit={Number(digit)} delay={index * 0.05} />
            </motion.span>
          );
        })}
      </AnimatePresence>
    </span>
  );
}

function Record({ label, value, detail }: { label: string; value: ReactNode; detail?: string }) {
  return (
    <div className="py-2">
      <div className="flex items-baseline">
        <span className="xp-smcp text-[13px] tracking-[0.12em] text-foreground/80">{label}</span>
        <span className="xp-leader" aria-hidden="true" />
        <span className="xp-serif xp-onum text-lg whitespace-nowrap">{value}</span>
      </div>
      {detail && <p className="xp-serif -mt-0.5 text-right text-sm text-muted-foreground italic">{detail}</p>}
    </div>
  );
}

export function Almanac({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const [today] = useState(() => new Date());
  const [hoveredDay, setHoveredDay] = useState<string | null>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const calendarInView = useInView(calendarRef, { once: true, amount: 0.15 }) || reducedMotion;
  const [entered, setEntered] = useState(reducedMotion);

  useEffect(() => {
    if (!calendarInView || entered) return;
    const timeout = window.setTimeout(() => setEntered(true), 1300);
    return () => window.clearTimeout(timeout);
  }, [calendarInView, entered]);
  const booksById = useMemo(() => new Map(library.books.map((book) => [book.id, book])), [library.books]);

  const months = useMemo(() => {
    return Array.from({ length: MONTHS }, (_, index) => {
      const date = new Date(today.getFullYear(), today.getMonth() - (MONTHS - 1 - index), 1);
      const dayCount = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
      return { date, dayCount, offset: (date.getDay() + 6) % 7 };
    });
  }, [today]);

  const rangeStart = months[0].date.getTime();
  const sessions = useMemo(
    () => library.sessions.filter((session) => session.startedAt >= rangeStart && session.startedAt <= today.getTime()),
    [library.sessions, rangeStart, today],
  );
  const days = useMemo(() => totalsByDay(sessions), [sessions]);
  const inkDays = useMemo(() => highlightColorsByDay(library.highlights), [library.highlights]);
  const maxMinutes = Math.max(1, ...[...days.values()].map((day) => day.minutes));
  const totalMinutes = sessions.reduce((sum, session) => sum + session.activeMs / 60000, 0);
  const books = useMemo(() => timeByBook(sessions, library.books).sort((a, b) => b.minutes - a.minutes), [sessions, library.books]);
  const streak = useMemo(() => streaks(days, today), [days, today]);

  const records = useMemo(() => {
    const longest = sessions.reduce<(typeof sessions)[number] | null>(
      (best, session) => (!best || session.activeMs > best.activeMs ? session : best),
      null,
    );
    const hourWeights = new Array<number>(24).fill(0);
    const weekdayWeights = new Array<number>(7).fill(0);
    const monthWeights = new Map<number, number>();
    for (const session of sessions) {
      const date = new Date(session.startedAt);
      hourWeights[date.getHours()] += session.activeMs;
      weekdayWeights[(date.getDay() + 6) % 7] += session.activeMs;
      const monthIndex = date.getFullYear() * 12 + date.getMonth();
      monthWeights.set(monthIndex, (monthWeights.get(monthIndex) ?? 0) + session.activeMs);
    }
    const favouriteHour = hourWeights.indexOf(Math.max(...hourWeights));
    const favouriteWeekday = weekdayWeights.indexOf(Math.max(...weekdayWeights));
    const busiest = [...monthWeights.entries()].sort((a, b) => b[1] - a[1])[0];
    const earliest = sessions.reduce<(typeof sessions)[number] | null>(
      (best, session) => (!best || minuteOfDay(session.startedAt) < minuteOfDay(best.startedAt) ? session : best),
      null,
    );
    return {
      longest,
      earliest,
      favouriteHour,
      favouriteWeekday,
      busiestMonth: busiest ? new Date(Math.floor(busiest[0] / 12), busiest[0] % 12, 1) : null,
      busiestMinutes: busiest ? busiest[1] / 60000 : 0,
    };
  }, [sessions]);

  const hovered = hoveredDay ? days.get(hoveredDay) : undefined;
  const hoveredDate = hoveredDay
    ? (() => {
        const [year, month, day] = hoveredDay.split("-").map(Number);
        return new Date(year, month, day);
      })()
    : null;
  const figureMinutes = hoveredDay ? (hovered?.minutes ?? 0) : totalMinutes;
  const hours = Math.floor(figureMinutes / 60);
  const minutes = Math.round(figureMinutes % 60);
  const todayKey = dayKey(today);

  return (
    <StageSurface tone="paper" className="relative min-h-[inherit] px-5 py-7 md:px-10 md:py-9">
      {/* Masthead */}
      <header className="text-center">
        <div className="xp-smcp flex items-baseline justify-between gap-4 text-[11px] tracking-[0.16em] text-muted-foreground">
          <span>Vol. {today.getFullYear() - 2024} · No. {Math.ceil((today.getTime() - new Date(today.getFullYear(), 0, 1).getTime()) / 86_400_000)}</span>
          <span className="max-sm:hidden">{MASTHEAD_DATE.format(today)}</span>
          <span>Price: one evening</span>
        </div>
        <h4 className="xp-serif mt-3 text-[clamp(2.6rem,7vw,5.4rem)] leading-[0.95] font-medium tracking-[-0.03em]">
          The Reading Almanac
        </h4>
        <div className="mt-4 border-y-[3px] border-double border-foreground/70 py-1.5">
          <p className="xp-serif text-sm italic text-foreground/80">
            Being a true account of {MONTHS} months spent with {books.length} books, compiled from {sessions.length.toLocaleString()} sessions.
          </p>
        </div>
      </header>

      <div className="mt-8 grid gap-x-10 gap-y-10 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="min-w-0">
          {/* Lead figure */}
          <div className="border-b pb-6" aria-live="polite">
            <p className="xp-serif flex flex-wrap items-baseline gap-x-3 text-[clamp(4rem,11vw,8.5rem)] leading-[0.9] tracking-[-0.04em]">
              <AnimatePresence initial={false} mode="popLayout">
                {(hours > 0 || !hoveredDay) && (
                  <motion.span
                    key="hours"
                    layout="position"
                    initial={{ opacity: 0, filter: "blur(8px)" }}
                    animate={{ opacity: 1, filter: "blur(0px)" }}
                    exit={{ opacity: 0, filter: "blur(8px)" }}
                    className="inline-flex items-baseline gap-3"
                  >
                    <Odometer value={hours} />
                    <span className="text-[0.3em] tracking-normal italic">{hours === 1 ? "hour" : "hours"},</span>
                  </motion.span>
                )}
              </AnimatePresence>
              <motion.span layout="position" className="inline-flex items-baseline gap-3">
                <Odometer value={minutes} />
                <span className="text-[0.3em] tracking-normal italic">{minutes === 1 ? "minute" : "minutes"}</span>
              </motion.span>
            </p>
            <div className="relative mt-3 h-14 overflow-hidden">
              <AnimatePresence initial={false} mode="popLayout">
                <motion.p
                  key={hoveredDay ?? "year"}
                  initial={{ y: 14, opacity: 0 }}
                  animate={{ y: 0, opacity: 1 }}
                  exit={{ y: -14, opacity: 0 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}
                  className="xp-serif absolute inset-x-0 max-w-2xl text-xl leading-snug text-foreground/80"
                >
                  {hoveredDate ? (
                    <>
                      on <span className="italic">{LONG_DATE.format(hoveredDate)}</span>
                      {hovered ? (
                        <>
                          {" "}— {[...hovered.bookIds].map((id) => booksById.get(id)?.title).filter(Boolean).join(" and ")}, in {hovered.sessions}{" "}
                          {hovered.sessions === 1 ? "sitting" : "sittings"}.
                        </>
                      ) : (
                        <> — a day without reading.</>
                      )}
                    </>
                  ) : (
                    <>
                      of reading in the past year — {days.size} days with a book open, the longest run being{" "}
                      <span className="italic">{streak.longest} days</span>.
                    </>
                  )}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Calendar */}
          <div
            ref={calendarRef}
            className="mt-6 grid grid-cols-2 gap-x-6 gap-y-6 sm:grid-cols-3 xl:grid-cols-4"
            onPointerLeave={() => setHoveredDay(null)}
          >
            {months.map((month, monthIndex) => {
              const monthMinutes = Array.from({ length: month.dayCount }, (_, day) =>
                days.get(dayKey(new Date(month.date.getFullYear(), month.date.getMonth(), day + 1)))?.minutes ?? 0,
              ).reduce((sum, value) => sum + value, 0);
              return (
                <div key={month.date.getTime()}>
                  <div className="mb-2 flex items-baseline justify-between border-b border-foreground/15 pb-1">
                    <span className="xp-smcp text-[13px] tracking-[0.14em]">{MONTH_NAME.format(month.date)}</span>
                    <span className="xp-serif xp-onum text-sm text-muted-foreground italic">{Math.round(monthMinutes / 60)} h</span>
                  </div>
                  <div className="grid grid-cols-7 gap-[3px]">
                    {Array.from({ length: month.offset }, (_, index) => (
                      <span key={`pad-${index}`} aria-hidden="true" />
                    ))}
                    {Array.from({ length: month.dayCount }, (_, dayIndex) => {
                      const date = new Date(month.date.getFullYear(), month.date.getMonth(), dayIndex + 1);
                      const key = dayKey(date);
                      const total = days.get(key)?.minutes ?? 0;
                      const future = date > today;
                      const size = total > 0 ? 3 + Math.sqrt(total / maxMinutes) * 11 : 2.5;
                      const inks = inkDays.get(key);
                      const isHovered = hoveredDay === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          disabled={future}
                          onPointerEnter={() => setHoveredDay(key)}
                          onFocus={() => setHoveredDay(key)}
                          aria-label={`${LONG_DATE.format(date)}: ${total > 0 ? formatMinutes(total * 60000) : "no reading"}`}
                          className={cn(
                            "relative grid aspect-square place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            future ? "cursor-default" : "cursor-crosshair",
                          )}
                        >
                          <motion.span
                            className="block rounded-full bg-foreground"
                            initial={reducedMotion ? false : { scale: 0 }}
                            animate={{ scale: !calendarInView ? 0 : isHovered ? 1.45 : 1 }}
                            transition={{
                              type: "spring",
                              stiffness: 420,
                              damping: 24,
                              // A diagonal wave on first view; hover responds at once.
                              delay: entered ? 0 : monthIndex * 0.035 + dayIndex * 0.006,
                            }}
                            style={{
                              width: size,
                              height: size,
                              opacity: future ? 0.06 : total > 0 ? 0.25 + 0.75 * Math.sqrt(total / maxMinutes) : 0.14,
                            }}
                          />
                          {inks && !future && (
                            <span className="absolute -bottom-[2px] left-1/2 flex -translate-x-1/2 gap-px" aria-hidden="true">
                              {inks.slice(0, 3).map((ink) => (
                                <span key={ink} className="h-[2px] w-[3px] rounded-full" style={{ background: inkColor(ink) }} />
                              ))}
                            </span>
                          )}
                          {key === todayKey && (
                            <span aria-hidden="true" className="absolute inset-[-1px] rounded-full ring-1 ring-foreground/50" />
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-6 flex items-center gap-4 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-[3px] rounded-full bg-foreground/40" />
              <span className="size-[7px] rounded-full bg-foreground/60" />
              <span className="size-[12px] rounded-full bg-foreground" />
              more time
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-[2px] w-[6px] rounded-full" style={{ background: inkColor("yellow") }} />
              highlighted that day
            </span>
          </p>
        </div>

        {/* Records */}
        <aside className="lg:border-l lg:pl-8">
          <p className="xp-smcp border-b-2 border-foreground/70 pb-1 text-sm tracking-[0.2em]">Records &amp; Figures</p>
          <div className="divide-y divide-dotted divide-foreground/15">
            {records.longest && (
              <Record
                label="Longest sitting"
                value={formatMinutes(records.longest.activeMs)}
                detail={`${booksById.get(records.longest.bookId)?.title ?? ""}, ${LONG_DATE.format(records.longest.startedAt)}`}
              />
            )}
            <Record label="Longest run" value={`${streak.longest} days`} detail={streak.current > 1 ? `current run: ${streak.current} days` : undefined} />
            {records.busiestMonth && (
              <Record label="Busiest month" value={MONTH_NAME.format(records.busiestMonth)} detail={`${Math.round(records.busiestMinutes / 60)} hours`} />
            )}
            <Record label="Favourite hour" value={formatClock(records.favouriteHour * 60)} />
            <Record label="Best day" value={WEEKDAYS[records.favouriteWeekday]} />
            <Record label="Typical sitting" value={formatMinutes(sessions.length ? (totalMinutes / sessions.length) * 60000 : 0)} />
          </div>

          <p className="xp-smcp mt-8 border-b-2 border-foreground/70 pb-1 text-sm tracking-[0.2em]">Books of the Year</p>
          <ol className="mt-1">
            {books.slice(0, 6).map((entry, index) => (
              <Fragment key={entry.book.id}>
                <li className="flex items-baseline py-1.5">
                  <span className="xp-serif xp-onum w-6 text-muted-foreground italic">{index + 1}.</span>
                  <span className="xp-serif min-w-0 truncate text-[17px]">{entry.book.title}</span>
                  <span className="xp-leader" aria-hidden="true" />
                  <span className="xp-serif xp-onum text-[17px] whitespace-nowrap">{Math.round(entry.minutes / 60)} h</span>
                </li>
              </Fragment>
            ))}
          </ol>
          <p className="xp-serif mt-6 text-sm leading-snug text-muted-foreground italic">
            Figures count active reading only; idle minutes are not included.
            {records.earliest && (
              <>
                {" "}The earliest sitting began at {formatClock(minuteOfDay(records.earliest.startedAt))} on{" "}
                {LONG_DATE.format(records.earliest.startedAt)}.
              </>
            )}
          </p>
        </aside>
      </div>
    </StageSurface>
  );
}
