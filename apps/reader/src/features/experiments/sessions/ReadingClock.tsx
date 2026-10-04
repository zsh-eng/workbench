/**
 * Rhythm: reading sessions on a twenty-four-hour dial.
 *
 * Rings are days (today outermost) and arcs are sessions at their time of
 * day. The outer petals total every hour of reading in the library. Arcs keep
 * the same path structure across window changes, so motion can morph them
 * between ring radii.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMemo, useState } from "react";
import type { StudioInk, StudioLibrary, StudioSession } from "../data/sample-library";
import { EASE_OUT, SNAPPY_SPRING, StageSurface, formatMinutes, useElementSize } from "../primitives";
import { DAY_MS, formatClock, minuteOfDay, startOfDay } from "./session-stats";

type Palette = StudioInk | "cyan" | "purple";

const PALETTE: Palette[] = ["yellow", "cyan", "magenta", "green", "blue", "purple"];
const WINDOWS = [
  { days: 28, label: "4 weeks" },
  { days: 91, label: "3 months" },
];
const SHORT_DATE = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

function stroke(color: Palette): string {
  return `var(--${color}-primary)`;
}

function polar(cx: number, cy: number, r: number, degrees: number) {
  const radians = (degrees * Math.PI) / 180;
  return { x: cx + r * Math.sin(radians), y: cy - r * Math.cos(radians) };
}

function arcPath(cx: number, cy: number, r: number, from: number, to: number): string {
  const start = polar(cx, cy, r, from);
  const end = polar(cx, cy, r, to);
  const large = to - from > 180 ? 1 : 0;
  return `M ${start.x.toFixed(2)} ${start.y.toFixed(2)} A ${r.toFixed(2)} ${r.toFixed(2)} 0 ${large} 1 ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function sectorPath(cx: number, cy: number, r1: number, r2: number, from: number, to: number): string {
  const a = polar(cx, cy, r2, from);
  const b = polar(cx, cy, r2, to);
  const c = polar(cx, cy, r1, to);
  const d = polar(cx, cy, r1, from);
  return `M ${a.x} ${a.y} A ${r2} ${r2} 0 0 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${r1} ${r1} 0 0 0 ${d.x} ${d.y} Z`;
}

function describeRhythm(sessions: StudioSession[]): { title: string; line: string } {
  const total = sessions.reduce((sum, session) => sum + session.activeMs, 0) || 1;
  const share = (predicate: (minute: number) => boolean) =>
    sessions.filter((session) => predicate(minuteOfDay(session.startedAt))).reduce((sum, session) => sum + session.activeMs, 0) / total;
  const late = share((minute) => minute >= 21 * 60 || minute < 3 * 60);
  const early = share((minute) => minute >= 5 * 60 && minute < 9 * 60);
  const midday = share((minute) => minute >= 11 * 60 && minute < 14 * 60);
  if (late >= 0.45) return { title: "Night owl", line: `${Math.round(late * 100)}% of your reading happens after 9 pm.` };
  if (early >= 0.35) return { title: "Early riser", line: `${Math.round(early * 100)}% of your reading happens before 9 am.` };
  if (midday >= 0.3) return { title: "Lunch-hour reader", line: `${Math.round(midday * 100)}% of your reading happens around noon.` };
  return { title: "Around the clock", line: "You read at all hours, with no single habit." };
}

export function ReadingClock({ library }: { library: StudioLibrary }) {
  const reducedMotion = useReducedMotion() ?? false;
  const [today] = useState(() => startOfDay(new Date()));
  const [windowIndex, setWindowIndex] = useState(0);
  const [hoveredSession, setHoveredSession] = useState<string | null>(null);
  const [hoveredBook, setHoveredBook] = useState<string | null>(null);
  const [sizeRef, size] = useElementSize<HTMLDivElement>();
  const days = WINDOWS[windowIndex].days;
  const booksById = useMemo(() => new Map(library.books.map((book) => [book.id, book])), [library.books]);

  const windowStart = today.getTime() - (days - 1) * DAY_MS;
  const recent = useMemo(
    () => library.sessions.filter((session) => session.startedAt >= windowStart),
    [library.sessions, windowStart],
  );

  // Colour books by their share of reading in the visible window.
  const bookColors = useMemo(() => {
    const totals = new Map<string, number>();
    for (const session of recent) totals.set(session.bookId, (totals.get(session.bookId) ?? 0) + session.activeMs);
    const ranked = [...totals.entries()].sort((a, b) => b[1] - a[1]);
    return {
      ranked,
      colors: new Map(ranked.map(([bookId], index) => [bookId, PALETTE[index % PALETTE.length]])),
    };
  }, [recent]);

  const hourTotals = useMemo(() => {
    const totals = new Array<number>(24).fill(0);
    for (const session of library.sessions) totals[new Date(session.startedAt).getHours()] += session.activeMs;
    return totals;
  }, [library.sessions]);
  const maxHour = Math.max(1, ...hourTotals);
  const rhythm = useMemo(() => describeRhythm(library.sessions), [library.sessions]);

  const wide = size.width >= 900;
  const dial = Math.max(260, Math.min(size.height - 40, wide ? size.width * 0.58 : size.width - 32, 640));
  const pad = 26;
  const R = dial / 2 - pad;
  const cx = dial / 2;
  const cy = dial / 2;
  const innerR = R * 0.25;
  const ringOuter = R * 0.82;
  const spacing = (ringOuter - innerR) / days;
  const petalInner = R * 0.88;

  const hovered = recent.find((session) => session.id === hoveredSession);
  const nowAngle = (minuteOfDay(Date.now()) / 1440) * 360;

  return (
    <StageSurface tone="night" className="relative size-full overflow-hidden">
      <div ref={sizeRef} className={cn("absolute inset-0 flex items-center", wide ? "flex-row justify-center gap-10 px-10" : "flex-col justify-start gap-4 overflow-y-auto px-4 py-6")}>
        <div className="relative shrink-0" style={{ width: dial, height: dial }}>
          {size.width > 0 && (
            <svg width={dial} height={dial} viewBox={`0 0 ${dial} ${dial}`} role="img" aria-label="Reading sessions by time of day">
              {/* Night: 9 pm to 6 am */}
              <path d={sectorPath(cx, cy, innerR, ringOuter + spacing, 315, 450)} fill="currentColor" className="text-foreground" opacity={0.035} />

              {/* Day rings */}
              {Array.from({ length: days }, (_, index) => (
                <circle
                  key={index}
                  cx={cx}
                  cy={cy}
                  r={innerR + spacing * (index + 0.5)}
                  fill="none"
                  stroke="currentColor"
                  className="text-foreground"
                  strokeWidth={0.5}
                  opacity={index === days - 1 ? 0.18 : 0.05}
                />
              ))}

              {/* Hour ticks and labels */}
              {Array.from({ length: 24 }, (_, hour) => {
                const angle = hour * 15;
                const a = polar(cx, cy, ringOuter + spacing * 0.9, angle);
                const b = polar(cx, cy, ringOuter + spacing * 0.9 + (hour % 6 === 0 ? 7 : 3), angle);
                return <line key={hour} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="currentColor" className="text-foreground" opacity={0.35} />;
              })}
              {[0, 6, 12, 18].map((hour) => {
                const point = polar(cx, cy, R + 12, hour * 15);
                return (
                  <text key={hour} x={point.x} y={point.y} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground font-mono text-[10px]">
                    {hour === 0 ? "midnight" : hour === 12 ? "noon" : formatClock(hour * 60)}
                  </text>
                );
              })}

              {/* Petals: all-time minutes per hour, as radial bars */}
              {hourTotals.map((total, hour) => {
                const length = (R - petalInner - 4) * Math.sqrt(total / maxHour);
                if (length < 0.5) return null;
                const angle = hour * 15 + 7.5;
                const a = polar(cx, cy, petalInner, angle);
                const b = polar(cx, cy, petalInner + length, angle);
                return (
                  <motion.line
                    key={hour}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="currentColor"
                    strokeWidth={5}
                    strokeLinecap="round"
                    className="text-foreground"
                    initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 0.16 + 0.5 * (total / maxHour) }}
                    transition={{ duration: 0.6, ease: EASE_OUT, delay: 0.4 + hour * 0.02 }}
                  />
                );
              })}

              {/* Sessions */}
              <g strokeLinecap="round" fill="none">
                {recent.map((session) => {
                  const dayIndex = Math.floor((startOfDay(session.startedAt).getTime() - windowStart) / DAY_MS + 0.5);
                  const r = innerR + spacing * (dayIndex + 0.5);
                  const from = (minuteOfDay(session.startedAt) / 1440) * 360;
                  const sweep = Math.max(2.5, (session.activeMs / 60000 / 1440) * 360);
                  const color = bookColors.colors.get(session.bookId) ?? "yellow";
                  const dimmed =
                    (hoveredBook !== null && hoveredBook !== session.bookId) ||
                    (hoveredSession !== null && hoveredSession !== session.id);
                  const d = arcPath(cx, cy, r, from, Math.min(from + sweep, from + 359));
                  return (
                    <motion.path
                      key={session.id}
                      d={d}
                      initial={reducedMotion ? false : { pathLength: 0, opacity: 0 }}
                      animate={{
                        d,
                        pathLength: 1,
                        opacity: dimmed ? 0.14 : 1,
                        strokeWidth: Math.max(1.4, spacing * (hoveredSession === session.id ? 0.95 : 0.62)),
                      }}
                      transition={{
                        d: { duration: 0.8, ease: [0.65, 0, 0.35, 1] },
                        pathLength: { duration: 0.7, ease: EASE_OUT, delay: 0.15 + dayIndex * (0.9 / days) },
                        opacity: { duration: 0.25 },
                        strokeWidth: { duration: 0.2 },
                      }}
                      stroke={stroke(color)}
                      className="cursor-pointer"
                      onPointerEnter={() => setHoveredSession(session.id)}
                      onPointerLeave={() => setHoveredSession(null)}
                    />
                  );
                })}
              </g>

              {/* Hand: sweeps from midnight to now on first view */}
              <motion.g
                style={{ transformOrigin: `${cx}px ${cy}px` }}
                initial={reducedMotion ? false : { rotate: 0 }}
                animate={{ rotate: nowAngle }}
                transition={{ duration: 1.8, ease: [0.65, 0, 0.35, 1], delay: 0.2 }}
              >
                <line x1={cx} y1={cy - innerR + 6} x2={cx} y2={cy - R} stroke="currentColor" className="text-foreground" strokeWidth={1} opacity={0.6} />
                <circle cx={cx} cy={cy - R} r={2.5} fill="currentColor" className="text-foreground" />
              </motion.g>
            </svg>
          )}

          {/* Centre readout */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="text-center" style={{ width: innerR * 1.7 }}>
              <AnimatePresence mode="popLayout" initial={false}>
                {hovered ? (
                  <motion.div
                    key={hovered.id}
                    initial={{ opacity: 0, y: 6, filter: "blur(4px)" }}
                    animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                    exit={{ opacity: 0, y: -6, filter: "blur(4px)" }}
                    transition={{ duration: 0.2 }}
                  >
                    <p className="xp-serif text-[clamp(1rem,2vw,1.35rem)] leading-tight italic">{booksById.get(hovered.bookId)?.title}</p>
                    <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                      {SHORT_DATE.format(hovered.startedAt)} · {formatClock(minuteOfDay(hovered.startedAt))}
                    </p>
                    <p className="xp-serif mt-0.5 text-lg" style={{ color: stroke(bookColors.colors.get(hovered.bookId) ?? "yellow") }}>
                      {formatMinutes(hovered.activeMs)}
                    </p>
                  </motion.div>
                ) : (
                  <motion.div
                    key="idle"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <p className="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">now</p>
                    <p className="xp-serif xp-lnum text-[clamp(1.4rem,3vw,2.2rem)] leading-none">{formatClock(minuteOfDay(Date.now()))}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Narrative */}
        <div className={cn("min-w-0", wide ? "w-72" : "w-full max-w-md")}>
          <p className="xp-smcp text-xs tracking-[0.24em] text-muted-foreground">Your rhythm</p>
          <h4 className="xp-serif mt-2 text-[clamp(2.6rem,5vw,4rem)] leading-[0.95] tracking-[-0.03em] italic">{rhythm.title}</h4>
          <p className="xp-serif mt-3 text-lg leading-snug text-foreground/80">{rhythm.line}</p>

          <div className="mt-6 flex rounded-full border border-foreground/10 bg-foreground/[0.04] p-0.5 text-[11px] font-medium" role="radiogroup" aria-label="Window">
            {WINDOWS.map((option, index) => (
              <button
                key={option.days}
                type="button"
                role="radio"
                aria-checked={windowIndex === index}
                onClick={() => setWindowIndex(index)}
                className={cn(
                  "relative isolate flex-1 cursor-pointer rounded-full px-3 py-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  windowIndex === index ? "text-background" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {windowIndex === index && (
                  <motion.span layoutId="clock-window" transition={SNAPPY_SPRING} className="absolute inset-0 -z-10 rounded-full bg-foreground" />
                )}
                Last {option.label}
              </button>
            ))}
          </div>

          <ul className="mt-5 space-y-0.5" onPointerLeave={() => setHoveredBook(null)}>
            {bookColors.ranked.slice(0, 6).map(([bookId, ms]) => {
              const color = bookColors.colors.get(bookId) ?? "yellow";
              const dimmed = hoveredBook !== null && hoveredBook !== bookId;
              return (
                <li key={bookId}>
                  <button
                    type="button"
                    onPointerEnter={() => setHoveredBook(bookId)}
                    onFocus={() => setHoveredBook(bookId)}
                    onBlur={() => setHoveredBook(null)}
                    className={cn(
                      "flex w-full cursor-default items-center gap-3 rounded-lg px-2 py-1.5 text-left outline-none transition-opacity duration-200 focus-visible:ring-2 focus-visible:ring-ring",
                      dimmed && "opacity-35",
                    )}
                  >
                    <span className="h-[3px] w-5 shrink-0 rounded-full" style={{ background: stroke(color) }} />
                    <span className="xp-serif min-w-0 flex-1 truncate text-[17px]">{booksById.get(bookId)?.title}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">{formatMinutes(ms)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <p className="mt-5 text-[11px] leading-5 text-muted-foreground">
            Rings are days, today outermost. Petals add up every hour you have ever read. The shaded wedge is night.
          </p>
        </div>
      </div>
    </StageSurface>
  );
}
