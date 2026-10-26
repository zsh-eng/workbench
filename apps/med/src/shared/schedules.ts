import { z } from "zod";

// Claude Code's schedules, which Med shows and never runs (docs/SCHEDULES.md).
// A session's CronCreate and ScheduleWakeup calls schedule prompts in that
// session only: they fire while its process runs and are gone when it ends.

/** The tools whose calls the thread shows as schedule cards. */
export const SCHEDULE_TOOLS = new Set(["CronCreate", "CronDelete", "ScheduleWakeup"]);
/** A recurring job ends this long after it was made (Claude Code's limit). */
export const RECURRING_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PROMPT = 2000;

export const scheduleCallSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("cron"),
    cron: z.string().max(200),
    recurring: z.boolean(),
    prompt: z.string(),
    /** The job's ID, from the call's result. */
    id: z.string().max(64).optional(),
    /** Claude Code wrote the job to disk; a session-only job dies with its process. */
    durable: z.boolean().optional(),
  }),
  z.object({ kind: z.literal("cancel"), id: z.string().max(64) }),
  z.object({
    kind: z.literal("wakeup"),
    delaySeconds: z.number().optional(),
    prompt: z.string().optional(),
    reason: z.string().max(400).optional(),
    stop: z.boolean().optional(),
  }),
]);
export type ScheduleCall = z.infer<typeof scheduleCallSchema>;

const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const cut = (value: string) =>
  value.length > MAX_PROMPT ? `${value.slice(0, MAX_PROMPT)}…` : value;

/** What a schedule tool's call says, from its input and, once it ends, its result. */
export function scheduleCall(
  tool: string,
  input: Record<string, unknown>,
  output?: Record<string, unknown>,
): ScheduleCall | undefined {
  if (tool === "CronCreate") {
    const cron = text(input.cron);
    if (!cron) return undefined;
    const id = text(output?.id);
    return {
      kind: "cron",
      cron: cron.slice(0, 200),
      recurring: input.recurring !== false,
      prompt: cut(text(input.prompt) ?? ""),
      ...(id ? { id } : {}),
      ...(typeof output?.durable === "boolean" ? { durable: output.durable } : {}),
    };
  }
  if (tool === "CronDelete") {
    const id = text(input.id);
    return id ? { kind: "cancel", id } : undefined;
  }
  if (tool === "ScheduleWakeup") {
    const prompt = text(input.prompt);
    const reason = text(input.reason);
    return {
      kind: "wakeup",
      ...(typeof input.delaySeconds === "number" ? { delaySeconds: input.delaySeconds } : {}),
      ...(prompt ? { prompt: cut(prompt) } : {}),
      ...(reason ? { reason: reason.slice(0, 400) } : {}),
      ...(input.stop === true ? { stop: true } : {}),
    };
  }
  return undefined;
}

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const number = (field: string) => (/^\d+$/.test(field) ? Number(field) : undefined);
const two = (value: number) => String(value).padStart(2, "0");

/**
 * A 5-field cron expression in words, in the session's local time, such as
 * "Every hour at :23" or "Weekdays at 09:05". An expression that this does not
 * know stays as it is.
 */
export function describeCron(cron: string): string {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;
  const [minute, hour, day, month, weekday] = fields as [string, string, string, string, string];
  const m = number(minute);
  const h = number(hour);
  const step = (field: string) => /^\*\/(\d+)$/.exec(field)?.[1];
  const anyDay = day === "*" && month === "*";
  if (anyDay && weekday === "*") {
    if (minute === "*" && hour === "*") return "Every minute";
    if (step(minute) && hour === "*") return `Every ${step(minute)} minutes`;
    if (m !== undefined && hour === "*") return `Every hour at :${two(m)}`;
    if (m !== undefined && step(hour)) return `Every ${step(hour)} hours at :${two(m)}`;
    if (m !== undefined && h !== undefined) return `Every day at ${two(h)}:${two(m)}`;
  }
  if (anyDay && m !== undefined && h !== undefined) {
    const at = `${two(h)}:${two(m)}`;
    if (weekday === "1-5") return `Weekdays at ${at}`;
    const named = number(weekday);
    if (named !== undefined && DAYS[named % 7]) return `${DAYS[named % 7]}s at ${at}`;
  }
  const d = number(day);
  const mo = number(month);
  if (m !== undefined && h !== undefined && d !== undefined && mo !== undefined && weekday === "*")
    return `${MONTHS[mo - 1] ?? `Month ${mo}`} ${d} at ${two(h)}:${two(m)}`;
  return cron;
}

/** The next time a one-shot cron of fixed fields fires, after `from`. */
export function cronTime(cron: string, from: number): number | undefined {
  const [minute, hour, day, month] = cron.trim().split(/\s+/).map(number);
  if ([minute, hour, day, month].some((value) => value === undefined)) return undefined;
  const year = new Date(from).getFullYear();
  for (const at of [year, year + 1]) {
    const time = new Date(at, month! - 1, day!, hour!, minute!).getTime();
    if (time >= from - 60_000) return time;
  }
  return undefined;
}

/** A schedule's state, for its card. The Scheduled list has only live jobs. */
export type ScheduleState =
  /** Its session's process runs, so it can fire. */
  | "live"
  /** Its session's process ended; it fires again only if the session resumes. */
  | "stopped"
  | "cancelled"
  /** A recurring job past its 7 days. */
  | "expired"
  /** A one-shot job that fired. */
  | "fired"
  /** A one-shot job whose time passed while its session did not run. */
  | "missed";

export const scheduleStateLabels: Record<ScheduleState, string> = {
  live: "Live",
  stopped: "Stopped",
  cancelled: "Cancelled",
  expired: "Expired",
  fired: "Fired",
  missed: "Missed",
};

/** When a recurring job made at `createdAt` ends. */
export const expiresAt = (createdAt: number) => createdAt + RECURRING_DAYS * DAY_MS;

/** "expires in 6 days", "expires in 5 hours", or "expired". */
export function expiryText(createdAt: number, now: number) {
  const left = expiresAt(createdAt) - now;
  if (left <= 0) return "expired";
  const days = Math.floor(left / DAY_MS);
  if (days >= 1) return `expires in ${days} ${days === 1 ? "day" : "days"}`;
  const hours = Math.max(1, Math.floor(left / (60 * 60 * 1000)));
  return `expires in ${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * A job's state from what its session did: a cancel, its fires, and whether
 * its process runs now (`running`, or undefined when Med cannot tell).
 */
export function scheduleState(
  job: { recurring: boolean; cron: string; createdAt: number; cancelled: boolean; fires: number },
  now: number,
  running: boolean | undefined,
): ScheduleState {
  if (job.cancelled) return "cancelled";
  if (job.recurring) {
    if (now >= expiresAt(job.createdAt)) return "expired";
  } else {
    if (job.fires > 0) return "fired";
    const at = cronTime(job.cron, job.createdAt);
    if (at !== undefined && at < now) return "missed";
  }
  return running ? "live" : "stopped";
}

/** One entry of the Scheduled list (`GET /api/schedules`): a job that will
 * fire, since its session's process runs. */
export const scheduleEntrySchema = z.object({
  /** The session's job: a cron, or the next wakeup of a dynamic /loop. */
  kind: z.enum(["cron", "wakeup"]),
  id: z.string().optional(),
  threadId: z.string(),
  threadTitle: z.string(),
  sessionId: z.string(),
  /** In words, such as "Every hour at :23" or "In 20 minutes". */
  schedule: z.string(),
  cron: z.string().optional(),
  recurring: z.boolean(),
  prompt: z.string(),
  createdAt: z.number(),
  /** When a recurring job ends, or when a wakeup fires. */
  endsAt: z.number().optional(),
  /** How many times it fired, from the session's transcript. */
  fires: z.number().int().nonnegative(),
  lastFiredAt: z.number().optional(),
  /** Where its session's process runs. */
  runs: z.enum(["med", "terminal", "claude-app", "other-app"]),
});
export type ScheduleEntry = z.infer<typeof scheduleEntrySchema>;

export const schedulesSchema = z.object({ sessions: z.array(scheduleEntrySchema) });
export type Schedules = z.infer<typeof schedulesSchema>;
