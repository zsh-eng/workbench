import type { Job } from "@workbench/background-activity";

/**
 * The activity sheet's rows. Nothing moves while you look: the sheet groups
 * its rows when it opens, and while it stays open each row keeps its place
 * and finishes there. New work joins the end of its section, and a row you
 * cancel or dismiss leaves; those are the only moves, and the sheet makes
 * each set of them at once. The next opening groups the rows again, as
 * Music and Podcasts do.
 */
export type SheetSection = "now" | "waiting" | "failed" | "done" | "app";

export const SECTION_ORDER: readonly SheetSection[] = [
  "now",
  "waiting",
  "failed",
  "done",
  "app",
];

export const SECTION_TITLES: Record<SheetSection, string> = {
  now: "Now",
  waiting: "Waiting",
  failed: "Couldn't finish",
  done: "Done",
  app: "This app",
};

export interface SheetRow {
  job: Job;
  /** The section it joined, kept while the sheet is open. */
  section: SheetSection;
  /** It had finished when the sheet opened: its check does not draw again. */
  settled: boolean;
  /**
   * It left the queue while the sheet was open: a finished download's
   * linger ran out, or sync caught up. It stays as it ended.
   */
  gone: boolean;
}

/**
 * A sync pass is routine and silent: sync shows only its exceptions, and a
 * restore on a new device, which you wait for.
 */
export function listsInSheet(job: Job): boolean {
  return !(
    job.kind === "sync" &&
    job.state === "running" &&
    job.origin === "app"
  );
}

export function sectionOf(job: Job): SheetSection {
  if (job.tracked) return "app";
  if (job.state === "waiting") return "waiting";
  if (job.state === "failed") return "failed";
  if (job.state === "done" || job.state === "cancelled") return "done";
  return "now";
}

const byStart = (a: Job, b: Job) => a.createdAt - b.createdAt;

/** The rows as the sheet opens: by section, each in the order work began. */
export function arrangeOnOpen(jobs: readonly Job[]): SheetRow[] {
  const listed = jobs
    .filter((job) => listsInSheet(job) && job.state !== "cancelled")
    .sort(byStart);
  return SECTION_ORDER.flatMap((section) =>
    listed
      .filter((job) => sectionOf(job) === section)
      .map((job) => ({
        job,
        section,
        settled: job.state === "done",
        gone: false,
      })),
  );
}

/**
 * The rows while the sheet stays open, from the last rows and the queue
 * now. `removed` holds the rows you cancelled or dismissed here.
 */
export function arrangeWhileOpen(
  rows: readonly SheetRow[],
  jobs: readonly Job[],
  removed: ReadonlySet<string>,
): SheetRow[] {
  const current = new Map(jobs.map((job) => [job.id, job]));
  let changed = false;
  const next: SheetRow[] = [];
  for (const row of rows) {
    if (removed.has(row.job.id)) {
      changed = true;
      continue;
    }
    const job = current.get(row.job.id);
    if (job && listsInSheet(job) && job.state !== "cancelled") {
      if (job === row.job && !row.gone) next.push(row);
      else {
        changed = true;
        next.push({ ...row, job, gone: false });
      }
    } else if (job?.state === "cancelled" && !row.job.tracked) {
      // Cancelled elsewhere: the row says so where it is.
      changed ||= job !== row.job;
      next.push({ ...row, job, gone: false });
    } else {
      changed ||= !row.gone;
      next.push(row.gone ? row : { ...row, gone: true });
    }
  }
  const present = new Set(next.map((row) => row.job.id));
  const arriving = jobs
    .filter(
      (job) =>
        listsInSheet(job) &&
        job.state !== "cancelled" &&
        !present.has(job.id) &&
        !removed.has(job.id),
    )
    .sort(byStart);
  for (const job of arriving) {
    changed = true;
    const section = sectionOf(job);
    const rank = SECTION_ORDER.indexOf(section);
    // After the last row of its section, or where its section belongs.
    let at = next.findIndex((row) => SECTION_ORDER.indexOf(row.section) > rank);
    if (at === -1) at = next.length;
    next.splice(at, 0, { job, section, settled: false, gone: false });
  }
  return changed ? next : (rows as SheetRow[]);
}

/** The rows in their sections, in order, for rendering. */
export function sectionsOf(
  rows: readonly SheetRow[],
): { section: SheetSection; rows: SheetRow[] }[] {
  return SECTION_ORDER.map((section) => ({
    section,
    rows: rows.filter((row) => row.section === section),
  })).filter((group) => group.rows.length > 0);
}
