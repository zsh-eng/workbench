import { useSyncExternalStore } from "react";

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;

// Now, for ages such as "5 min ago": read when a live clock starts, and
// again each minute while it runs.
let now = Date.now();
const everyMinute = (listener: () => void) => {
  now = Date.now();
  const timer = setInterval(() => {
    now = Date.now();
    listener();
  }, minute);
  return () => clearInterval(timer);
};
const still = () => () => {};
const readNow = () => now;
export const useMinuteClock = (live: boolean) =>
  useSyncExternalStore(live ? everyMinute : still, readNow);

/** Compact elapsed time; future author dates remain explicit for clock skew. */
export function relativeTime(timestamp: number, now: number): string {
  const elapsed = now - timestamp;
  const distance = Math.abs(elapsed);
  if (distance < minute) return "just now";
  const [size, label]: [number, string] =
    distance < hour
      ? [minute, "min"]
      : distance < day
        ? [hour, "hr"]
        : distance < 30 * day
          ? [day, "day"]
          : distance < 365 * day
            ? [30 * day, "mo"]
            : [365 * day, "yr"];
  const count = Math.floor(distance / size);
  const unit = label === "day" && count !== 1 ? "days" : label;
  return elapsed < 0 ? `in ${count} ${unit}` : `${count} ${unit} ago`;
}
