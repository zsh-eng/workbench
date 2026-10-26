import { useEffect, useState } from "react";

// How long work took or runs. A time shows only the digits that change as
// often as it updates: whole seconds, then whole minutes from 10 minutes on,
// so no digit changes faster than the screen shows it (docs/USAGE.md,
// "Agent sessions").

const SECOND = 1000;
const MINUTE = 60 * SECOND;
/** From here a live time counts minutes. */
const MINUTES_FROM = 10 * MINUTE;
/** After the step, so that a timer that fires on time sees it passed. */
const SLACK = 20;

type Step = "second" | "minute";
const two = (value: number) => String(value).padStart(2, "0");

/**
 * A duration in whole units, as a clock counts them: "42s", "1m 05s",
 * "12 min" from 10 minutes, "1h 05m" from an hour. Undefined under one
 * step: Med shows no time under a second, or under a minute for `minute`,
 * which leaves out the seconds below 10 minutes too ("3 min").
 */
export function formatDuration(milliseconds: number, step: Step = "second") {
  const seconds = Math.floor(milliseconds / SECOND);
  const minutes = Math.floor(seconds / 60);
  if (seconds < 1 || (step === "minute" && minutes < 1)) return undefined;
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${two(minutes % 60)}m`;
  if (minutes >= 10 || step === "minute") return `${minutes} min`;
  if (minutes >= 1) return `${minutes}m ${two(seconds % 60)}s`;
  return `${seconds}s`;
}

/**
 * The time since `from`. Without `now` it follows the clock: it renders again
 * when its text changes, at each whole second or minute counted from `from`,
 * so each value shows for one whole step. `now` fixes the clock, for a
 * finished time, a still, or a replay.
 */
export function useElapsed(from: number, now?: number, step: Step = "second") {
  const [clock, setClock] = useState(() => Date.now());
  const live = now === undefined;
  const elapsed = Math.max(0, (now ?? clock) - from);
  useEffect(() => {
    if (!live) return;
    const size = step === "minute" || elapsed >= MINUTES_FROM ? MINUTE : SECOND;
    const timer = setTimeout(() => setClock(Date.now()), size - (elapsed % size) + SLACK);
    return () => clearTimeout(timer);
  }, [live, elapsed, step]);
  return elapsed;
}

/** A live time since `from` (useElapsed), or `empty` under its first step. */
export function Elapsed({
  from,
  now,
  step,
  prefix = "",
  empty = null,
}: {
  from: number;
  now?: number;
  step?: Step;
  /** Before the time, such as " · ", when there is one. */
  prefix?: string;
  empty?: string | null;
}) {
  const text = formatDuration(useElapsed(from, now, step), step);
  return <>{text ? prefix + text : empty}</>;
}
