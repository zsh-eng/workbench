import { useMemo, useSyncExternalStore } from "react";
import type { ParsedReviewFile } from "../../shared/review";

// Which files of a review the reader marked viewed: by review, each file's
// path with the change it had then. A file whose change differs since, as in
// the review's next version, is not viewed any more. Every window of this
// address shares the marks; the browser keeps the newest reviews only.

const KEY = "med:viewed:v1";
/** The reviews whose marks the browser keeps. */
const MOST = 200;

type Marks = Record<string, Record<string, string>>;

function load(): Marks {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const marks: Marks = {};
    for (const [review, files] of Object.entries(raw)) {
      if (!files || typeof files !== "object" || Array.isArray(files)) continue;
      marks[review] = Object.fromEntries(
        Object.entries(files).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      );
    }
    return marks;
  } catch {
    return {};
  }
}

let marks: Marks | undefined;
const listeners = new Set<() => void>();
const current = () => (marks ??= load());

/** Another window marked a file. */
function follow(event: StorageEvent) {
  if (event.key !== KEY) return;
  marks = load();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) addEventListener("storage", follow);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) removeEventListener("storage", follow);
  };
}

/**
 * What tells one change to a file from another: the blobs that its patch
 * names, and the change's size for a file whose patch names none.
 */
export function changeMark(file: Pick<ParsedReviewFile, "info" | "metadata">) {
  const { info, metadata } = file;
  const size = `${info.status}+${info.additions}-${info.deletions}`;
  const blobs =
    metadata?.prevObjectId || metadata?.newObjectId
      ? `${metadata.prevObjectId ?? ""}..${metadata.newObjectId ?? ""}`
      : "";
  return `${size}|${blobs}`;
}

/** Whether the mark is of this change: by its blobs where both name them. */
function sameChange(kept: string | undefined, now: string) {
  if (!kept) return false;
  const [keptSize, keptBlobs] = kept.split("|");
  const [size, blobs] = now.split("|");
  return keptBlobs && blobs ? keptBlobs === blobs : keptSize === size;
}

/** The IDs of the review's files that the reader marked viewed. */
export function useViewedFiles(
  review: string | undefined,
  files: readonly ParsedReviewFile[],
): ReadonlySet<string> {
  const all = useSyncExternalStore(subscribe, current, current);
  const kept = review ? all[review] : undefined;
  return useMemo(() => {
    const viewed = new Set<string>();
    if (kept)
      for (const file of files)
        if (sameChange(kept[file.path], changeMark(file))) viewed.add(file.id);
    return viewed;
  }, [kept, files]);
}

/** Marks a file of the review viewed, or not viewed. */
export function setFileViewed(review: string, file: ParsedReviewFile, viewed: boolean) {
  const { [review]: before = {}, ...others } = current();
  const { [file.path]: _gone, ...files } = before;
  if (viewed) files[file.path] = changeMark(file);
  // The review marked last goes last, so the oldest go first when full.
  const entries = Object.entries(others);
  if (Object.keys(files).length) entries.push([review, files]);
  marks = Object.fromEntries(entries.slice(-MOST));
  try {
    localStorage.setItem(KEY, JSON.stringify(marks));
  } catch {
    // The marks last for this page.
  }
  for (const listener of listeners) listener();
}

/** How many of the files are viewed, in words: "2 of 4 files viewed". */
export const viewedLabel = (viewed: number, total: number) =>
  viewed < total
    ? `${viewed} of ${total} files viewed`
    : total === 1
      ? "1 file viewed"
      : `All ${total} files viewed`;
