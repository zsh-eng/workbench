import type { BrowseRead } from "../../shared/browse";
import {
  blamePage,
  cachedBlameLine,
  loadBlamePage,
  type BlameEntry,
  type BlameLoader,
} from "./blame";
import { relativeTime } from "./relative-time";

export interface LineBlame {
  line: number;
  entry: BlameEntry;
  /** When the line blame appeared; its relative times count from here. */
  now: number;
}

/** Waits this long after the cursor stops before it reads a page. */
const REST_MS = 250;

export const uncommitted = (entry: BlameEntry) => /^0+$/.test(entry.commit);

/** "Mira, 2 days ago · Add weeks to relative time" */
export function lineBlameLabel(entry: BlameEntry, now = Date.now()) {
  if (uncommitted(entry)) return "Not committed yet";
  const time = Date.parse(entry.date);
  const when = Number.isFinite(time) ? `, ${relativeTime(time, now)}` : "";
  return `${entry.author}${when}${entry.summary ? ` · ${entry.summary}` : ""}`;
}

/**
 * The cursor line's history. It shows when the cursor rests, so holding a
 * motion key neither flickers nor reads. A line outside the cache loads its
 * page then. The gutter shares that cache, so either one fills the other.
 */
export function createLineBlame(file: BrowseRead | null, load: BlameLoader | undefined) {
  let snapshot: LineBlame | null = null;
  let wanted: number | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let request: AbortController | undefined;
  const listeners = new Set<() => void>();
  const lineCount = Math.min(200_000, file?.text?.replace(/\n$/, "").split("\n").length ?? 0);
  const publish = (next: LineBlame | null) => {
    if (next?.line === snapshot?.line && next?.entry === snapshot?.entry) return;
    snapshot = next;
    for (const listener of listeners) listener();
  };
  const show = () => {
    const entry = file && load && wanted ? cachedBlameLine(load, file, wanted) : undefined;
    publish(entry && wanted ? { line: wanted, entry, now: Date.now() } : null);
    return !!entry;
  };
  const read = async (line: number) => {
    if (!file || !load) return;
    request?.abort();
    const current = new AbortController();
    request = current;
    try {
      await loadBlamePage(load, file, blamePage(line), lineCount, current.signal);
      if (!current.signal.aborted && wanted === line) show();
    } catch {
      // The line blame is a hint; the gutter reports read failures.
    } finally {
      if (request === current) request = undefined;
    }
  };
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    /** The cursor line, or null when the line blame should not show. */
    setLine(line: number | null) {
      clearTimeout(timer);
      if (line !== null && (line < 1 || line > lineCount)) line = null;
      if (line === wanted) return;
      wanted = line;
      publish(null);
      if (line === null || !file || !load) return;
      timer = setTimeout(() => {
        if (wanted === line && !show()) void read(line);
      }, REST_MS);
    },
    dispose() {
      clearTimeout(timer);
      request?.abort();
      wanted = null;
      publish(null);
    },
  };
}
export type LineBlameStore = ReturnType<typeof createLineBlame>;
