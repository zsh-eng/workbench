/**
 * When the activity island shows, as a pure step: the app's words go in,
 * what the island shows comes out, with the time of its next change. The
 * rules are the summary's (docs/MODEL.md): nothing for the first 0.5 s, at
 * least 0.6 s once shown, and "done" confirms for 1.5 s if it showed. Work
 * that ends before 0.5 s never shows, and neither does its "done".
 */
import { DONE_LINGER_MS, SHOW_AFTER_MS } from "./summary";

/** What the island says. `fraction: null` is an unknown size: a slow sweep. */
export type IslandContent =
  | {
      mark: "progress";
      fraction: number | null;
      label: string;
      detail?: string;
    }
  | { mark: "waiting" | "attention" | "done"; label: string; detail?: string };

export const ISLAND_SHOW_AFTER_MS = SHOW_AFTER_MS;
/** A thing that shows stays at least this long, so nothing flickers. */
export const ISLAND_STAY_MS = 600;
export const ISLAND_CONFIRM_MS = DONE_LINGER_MS;
/** The fold back into the app's mark, on the morph spring. */
export const ISLAND_FOLD_MS = 320;

export interface IslandClock {
  /** When the current work began, while it has not shown. */
  since: number | null;
  /** When the island opened. */
  openedAt: number | null;
  /** When the work ended, after the island opened. */
  endedAt: number | null;
  /** The last words shown, kept while the island confirms and folds. */
  last: IslandContent | null;
}

export const RESTING_ISLAND: IslandClock = {
  since: null,
  openedAt: null,
  endedAt: null,
  last: null,
};

export type IslandPhase = "rest" | "open" | "folding";

export function islandStep(
  clock: IslandClock,
  content: IslandContent | null,
  now: number,
): {
  clock: IslandClock;
  phase: IslandPhase;
  shown: IslandContent | null;
  /** When to step again; null while nothing is due to change. */
  wakeAt: number | null;
} {
  const working = content !== null && content.mark !== "done";
  let { since, openedAt, endedAt, last } = clock;
  if (openedAt === null) {
    if (!working) return { clock: RESTING_ISLAND, ...resting };
    since ??= now;
    if (now < since + ISLAND_SHOW_AFTER_MS)
      return {
        clock: { ...RESTING_ISLAND, since },
        ...resting,
        wakeAt: since + ISLAND_SHOW_AFTER_MS,
      };
    openedAt = now;
  }
  if (working) {
    return {
      clock: { since: null, openedAt, endedAt: null, last: content },
      phase: "open",
      shown: content,
      wakeAt: null,
    };
  }
  endedAt ??= now;
  if (content !== null) last = content;
  const confirm = content?.mark === "done" ? ISLAND_CONFIRM_MS : 0;
  const until = Math.max(endedAt + confirm, openedAt + ISLAND_STAY_MS);
  const next = { since: null, openedAt, endedAt, last };
  if (now < until)
    return { clock: next, phase: "open", shown: last, wakeAt: until };
  if (now < until + ISLAND_FOLD_MS)
    return {
      clock: next,
      phase: "folding",
      shown: last,
      wakeAt: until + ISLAND_FOLD_MS,
    };
  return { clock: RESTING_ISLAND, ...resting };
}

const resting = { phase: "rest" as const, shown: null, wakeAt: null };
