import { useCallback, useSyncExternalStore } from "react";
import type { ParsedReviewFile } from "../../shared/review";

/**
 * Files the reader marked as viewed in a saved review, as on GitHub. A mark
 * belongs to the file's content: the path and its new blob ID. A later
 * iteration that changes the file shows it unviewed again; an unchanged file
 * stays viewed. Marks live in this browser only (`med:viewed:v1:<review>`),
 * and windows share them through `storage` events.
 */
const PREFIX = "med:viewed:v1:";
/** Marks kept for one review; the oldest go first. */
const MAX_MARKS = 4000;

/** The identity of a file's shown content, for its viewed mark. */
export function viewKey(file: ParsedReviewFile, scope = ""): string {
  const metadata = file.metadata;
  const blob =
    metadata?.type === "deleted"
      ? `deleted:${metadata.prevObjectId ?? ""}`
      : (metadata?.newObjectId ??
        `${file.info.status}:${file.info.additions}:${file.info.deletions}`);
  return `${scope}${file.path}\0${blob}`;
}

type Listener = () => void;
const cache = new Map<string, ReadonlySet<string>>();
const listeners = new Map<string, Set<Listener>>();
let listening = false;

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(review: string): ReadonlySet<string> {
  const cached = cache.get(review);
  if (cached) return cached;
  let marks: ReadonlySet<string> = new Set();
  try {
    const raw = storage()?.getItem(PREFIX + review);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed))
      marks = new Set(parsed.filter((entry): entry is string => typeof entry === "string"));
  } catch {
    /* Unreadable marks start empty. */
  }
  cache.set(review, marks);
  return marks;
}

function publish(review: string) {
  for (const listener of listeners.get(review) ?? []) listener();
}

function write(review: string, next: Set<string>) {
  const list = [...next].slice(-MAX_MARKS);
  const marks = new Set(list);
  cache.set(review, marks);
  try {
    if (list.length) storage()?.setItem(PREFIX + review, JSON.stringify(list));
    else storage()?.removeItem(PREFIX + review);
  } catch {
    /* The marks still apply to this window. */
  }
  publish(review);
}

/** Mark files viewed or not viewed. */
export function setViewed(review: string, keys: readonly string[], viewed: boolean) {
  const next = new Set(read(review));
  for (const key of keys) {
    // Delete first, so a new mark moves to the end and is kept longest.
    next.delete(key);
    if (viewed) next.add(key);
  }
  write(review, next);
}

function subscribe(review: string, listener: Listener) {
  if (!listening && typeof window !== "undefined") {
    listening = true;
    window.addEventListener("storage", (event) => {
      if (!event.key?.startsWith(PREFIX)) return;
      const review = event.key.slice(PREFIX.length);
      cache.delete(review);
      publish(review);
    });
  }
  let set = listeners.get(review);
  if (!set) listeners.set(review, (set = new Set()));
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

const EMPTY: ReadonlySet<string> = new Set();

/** The viewed marks of a review, and a setter. */
export function useViewed(review: string | null) {
  const marks = useSyncExternalStore(
    useCallback(
      (listener: Listener) => (review ? subscribe(review, listener) : () => {}),
      [review],
    ),
    () => (review ? read(review) : EMPTY),
    () => EMPTY,
  );
  const set = useCallback(
    (keys: readonly string[], viewed: boolean) => {
      if (review) setViewed(review, keys, viewed);
    },
    [review],
  );
  return { marks, set };
}
