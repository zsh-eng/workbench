/**
 * What an arriving book shows, as a small contract that any import can feed:
 * today's import loop reports each step, and a background job can be read
 * into the same shape with `arrivalFromJob`.
 *
 * The steps are the real ones in `addBookFromFile`. Nothing here pretends to
 * lay out pages: pagination happens when the book first opens.
 */

export type ArrivalStage =
  /** Waiting for its turn in a batch. */
  | "queued"
  /** The file is read and identified. Nothing is stored yet. */
  | "saving"
  /** The EPUB is opened: its title, author, contents and cover. */
  | "reading"
  /** The cover is made, then the file and the book are stored together. */
  | "preparing"
  /** On the shelf. It opens. */
  | "ready"
  /** The same file is already in the library. */
  | "duplicate"
  | "failed";

export interface ArrivalProgress {
  stage: ArrivalStage;
  /** The share of the work that is done, 0 to 1. It never goes back. */
  fraction: number;
}

/**
 * Each working step's share of the whole, measured on the sample books in
 * Chromium at 4× CPU slowdown: saving 30–140 ms, reading 50–75 ms,
 * preparing 40–150 ms. Bigger files spend longer saving and reading.
 */
export const STAGE_SPANS = {
  saving: [0, 0.25],
  reading: [0.25, 0.55],
  preparing: [0.55, 1],
} as const satisfies Record<string, readonly [number, number]>;

type WorkingStage = keyof typeof STAGE_SPANS;

function isWorking(stage: ArrivalStage): stage is WorkingStage {
  return stage in STAGE_SPANS;
}

/** The fraction at the start of a step, for feeders that know only steps. */
export function stageStart(stage: ArrivalStage): number {
  if (isWorking(stage)) return STAGE_SPANS[stage][0];
  return stage === "ready" ? 1 : 0;
}

/**
 * The fraction to draw: what is done, plus a slow creep into the current
 * step so a long step still moves. The creep covers at most 70% of the
 * step's span, so the drawing never reaches the end of a step before the
 * step really ends.
 */
export function shownFraction(
  progress: ArrivalProgress,
  secondsInStep: number,
): number {
  if (progress.stage === "ready") return 1;
  if (!isWorking(progress.stage)) return progress.fraction;
  const end = STAGE_SPANS[progress.stage][1];
  const creep = 0.7 * (1 - Math.exp(-secondsInStep / 0.9));
  return progress.fraction + Math.max(0, end - progress.fraction) * creep;
}

/** Whether the cover and title are known: the EPUB has been read. */
export function coverKnown(stage: ArrivalStage): boolean {
  return stage === "preparing" || stage === "ready";
}

/**
 * The shape of a job from `@workbench/background-activity`, structurally,
 * so this file needs no import from it. An import job reports its step as
 * `progress.phase` ("saving", "reading", "preparing") and may report bytes.
 */
export interface ImportJobLike {
  state:
    | "queued"
    | "waiting"
    | "running"
    | "retrying"
    | "failed"
    | "done"
    | "cancelled";
  progress: {
    phase: string | null;
    bytes: number;
    totalBytes: number | null;
    done: number;
    total: number | null;
  };
}

/**
 * A background job as an arrival. A running job's phase names the step;
 * bytes or items, when known, place it inside the step.
 */
export function arrivalFromJob(job: ImportJobLike): ArrivalProgress {
  if (job.state === "done") return { stage: "ready", fraction: 1 };
  if (job.state === "failed" || job.state === "cancelled")
    return { stage: "failed", fraction: 0 };
  if (job.state !== "running" && job.state !== "retrying")
    return { stage: "queued", fraction: 0 };
  const phase = job.progress.phase;
  const stage: WorkingStage =
    phase === "reading" || phase === "preparing" ? phase : "saving";
  const [start, end] = STAGE_SPANS[stage];
  const { bytes, totalBytes, done, total } = job.progress;
  const within = totalBytes ? bytes / totalBytes : total ? done / total : 0;
  return {
    stage,
    fraction: start + (end - start) * Math.min(1, Math.max(0, within)),
  };
}
