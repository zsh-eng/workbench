import { open, stat } from "node:fs/promises";
import type { SessionPlace } from "../shared/agent-inbox";
import {
  describeCron,
  expiresAt,
  scheduleCall,
  scheduleState,
  type ScheduleEntry,
  type Schedules,
} from "../shared/schedules";
import { findTranscript } from "./agent-transcripts";
import { userHome } from "./service/discover";

// The Scheduled list (docs/SCHEDULES.md): the jobs that the tabs' Claude Code
// sessions made with CronCreate and ScheduleWakeup and that will fire. Med
// reads them; it never runs, edits, or deletes one. The thread's cards keep
// the jobs that ended or cannot fire.
//
// A session's jobs live in its process only, so the list reads them from the
// transcript: each CronCreate call and its result (the job's ID), each
// CronDelete, each ScheduleWakeup, and each prompt that a schedule enqueued
// (a user record with `turnOrigin: "scheduled"`, whose text is the job's
// prompt). A transcript is read once, then from where the last read ended.

/** Bytes in one read of a transcript. */
const CHUNK = 4 * 1024 * 1024;
const NEEDLES = ["CronCreate", "CronDelete", "ScheduleWakeup", '"turnOrigin":"scheduled"'].map(
  (needle) => Buffer.from(needle),
);

type Json = Record<string, unknown>;
const record = (value: unknown): Json | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : undefined;
const list = (value: unknown) => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);

interface Job {
  kind: "cron" | "wakeup";
  toolId: string;
  id?: string;
  cron?: string;
  recurring: boolean;
  prompt: string;
  createdAt: number;
  delaySeconds?: number;
  durable?: boolean;
  failed?: boolean;
}

/** What one transcript says of its schedules, so far. */
interface Scan {
  size: number;
  /** Where the next read starts: the start of a line. */
  offset: number;
  jobs: Job[];
  cancelled: Set<string>;
  /** Fires by prompt text. */
  fires: Map<string, { count: number; last: number }>;
  /** Calls whose results have not come yet, by tool use ID. */
  pending: Map<string, Job | { cancel: string }>;
}

const time = (entry: Json) => {
  const at = Date.parse(text(entry.timestamp) ?? "");
  return Number.isFinite(at) ? at : 0;
};

function readEntry(scan: Scan, entry: Json) {
  const message = record(entry.message);
  if (!message) return;
  if (entry.type === "assistant") {
    for (const part of list(message.content)) {
      const block = record(part);
      const id = text(block?.id);
      const name = text(block?.name);
      if (block?.type !== "tool_use" || !id || !name) continue;
      const call = scheduleCall(name, record(block.input) ?? {});
      if (!call) continue;
      if (call.kind === "cancel") {
        scan.pending.set(id, { cancel: call.id });
        continue;
      }
      if (call.kind === "wakeup" && call.stop) continue;
      const job: Job =
        call.kind === "cron"
          ? {
              kind: "cron",
              toolId: id,
              cron: call.cron,
              recurring: call.recurring,
              prompt: call.prompt,
              createdAt: time(entry),
            }
          : {
              kind: "wakeup",
              toolId: id,
              recurring: false,
              prompt: call.prompt ?? "",
              createdAt: time(entry),
              ...(call.delaySeconds !== undefined ? { delaySeconds: call.delaySeconds } : {}),
            };
      scan.jobs.push(job);
      scan.pending.set(id, job);
    }
    return;
  }
  if (entry.type !== "user") return;
  if (entry.turnOrigin === "scheduled") {
    const body =
      typeof message.content === "string"
        ? message.content
        : list(message.content)
            .map((part) => text(record(part)?.text) ?? "")
            .join("");
    const prompt = body.trim();
    const before = scan.fires.get(prompt);
    scan.fires.set(prompt, { count: (before?.count ?? 0) + 1, last: time(entry) });
    return;
  }
  for (const part of list(message.content)) {
    const block = record(part);
    const id = text(block?.tool_use_id);
    if (block?.type !== "tool_result" || !id) continue;
    const waiting = scan.pending.get(id);
    if (!waiting) continue;
    scan.pending.delete(id);
    const failed = block.is_error === true;
    if ("cancel" in waiting) {
      if (!failed) scan.cancelled.add(waiting.cancel);
      continue;
    }
    if (failed) waiting.failed = true;
    const result = record(entry.toolUseResult);
    const jobId = text(result?.id);
    if (jobId) waiting.id = jobId;
    if (typeof result?.durable === "boolean") waiting.durable = result.durable;
  }
}

/** The lines of `chunk` that hold one of `needles`, by where each starts. */
function candidateLines(chunk: Buffer, needles: readonly Buffer[]) {
  const starts = new Set<number>();
  for (const needle of needles) {
    let at = chunk.indexOf(needle);
    while (at >= 0) {
      starts.add(chunk.lastIndexOf(10, at) + 1);
      const end = chunk.indexOf(10, at);
      if (end < 0) break;
      at = chunk.indexOf(needle, end);
    }
  }
  return [...starts]
    .sort((a, b) => a - b)
    .map((start) => {
      const end = chunk.indexOf(10, start);
      return { start, line: chunk.subarray(start, end < 0 ? chunk.length : end) };
    });
}

/** Reads the whole lines of `chunk` that name a schedule, or a call that
 * waits for its result; a call's result can be in the same chunk. */
function readChunk(scan: Scan, chunk: Buffer) {
  const read = new Set<number>();
  let needles = [...NEEDLES, ...[...scan.pending.keys()].map((id) => Buffer.from(id))];
  while (needles.length) {
    const before = new Set(scan.pending.keys());
    for (const { start, line } of candidateLines(chunk, needles)) {
      if (read.has(start)) continue;
      read.add(start);
      try {
        const entry = record(JSON.parse(line.toString("utf8")));
        if (entry) readEntry(scan, entry);
      } catch {
        /* A line that is not JSON says nothing. */
      }
    }
    needles = [...scan.pending.keys()].filter((id) => !before.has(id)).map((id) => Buffer.from(id));
  }
}

async function scanTranscript(path: string, previous: Scan | undefined): Promise<Scan> {
  const info = await stat(path);
  // A shorter file is a new one: read it from the start.
  const scan: Scan =
    previous && info.size >= previous.offset
      ? previous
      : {
          size: 0,
          offset: 0,
          jobs: [],
          cancelled: new Set(),
          fires: new Map(),
          pending: new Map(),
        };
  if (info.size === scan.size && scan.offset === info.size) return scan;
  const handle = await open(path, "r");
  try {
    let offset = scan.offset;
    while (offset < info.size) {
      const length = Math.min(CHUNK, info.size - offset);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      const chunk = buffer.subarray(0, bytesRead);
      // Only whole lines: the rest waits for the next read.
      const last = chunk.lastIndexOf(10);
      if (last < 0) {
        if (offset + bytesRead >= info.size) break;
        // A line longer than a chunk: skip it whole.
        const rest = await skipLine(handle, offset + bytesRead, info.size);
        offset = rest;
        continue;
      }
      readChunk(scan, chunk.subarray(0, last + 1));
      offset += last + 1;
    }
    scan.offset = offset;
    scan.size = info.size;
  } finally {
    await handle.close();
  }
  return scan;
}

async function skipLine(handle: Awaited<ReturnType<typeof open>>, from: number, size: number) {
  const buffer = Buffer.alloc(64 * 1024);
  let at = from;
  while (at < size) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, at);
    const end = buffer.subarray(0, bytesRead).indexOf(10);
    if (end >= 0) return at + end + 1;
    at += bytesRead;
    if (!bytesRead) break;
  }
  return size;
}

export interface ScheduleThread {
  id: string;
  title: string;
  sessions?: readonly { agent: string; id: string }[];
}

export interface SchedulesOptions {
  home?: () => string;
  /** Where a session's process runs now, or undefined when none does. */
  running(sessionIds: readonly string[]): Promise<Map<string, "med" | SessionPlace>>;
  now?: () => number;
}

export function createSchedules(options: SchedulesOptions) {
  const home = options.home ?? userHome;
  const now = options.now ?? Date.now;
  const scans = new Map<string, Scan>();
  /** Each session's transcript, found once: the list reads every 30 seconds. */
  const paths = new Map<string, string>();
  /** One read at a time for each transcript. */
  const reading = new Map<string, Promise<Scan>>();

  const scanOf = (path: string) => {
    const busy = reading.get(path);
    if (busy) return busy;
    const work = scanTranscript(path, scans.get(path))
      .then((scan) => {
        scans.set(path, scan);
        return scan;
      })
      .finally(() => reading.delete(path));
    reading.set(path, work);
    return work;
  };

  return {
    /** The tabs' jobs that will fire, newest first. */
    async list(threads: readonly ScheduleThread[]): Promise<Schedules> {
      const sessions = threads.flatMap((thread) =>
        (thread.sessions ?? [])
          .filter((session) => session.agent === "claude")
          .map((session) => ({ thread, session })),
      );
      const found = await Promise.all(
        sessions.map(async ({ thread, session }) => {
          const path =
            paths.get(session.id) ??
            (await findTranscript({ agent: "claude", id: session.id }, home()));
          if (!path) return undefined;
          const scan = await scanOf(path).catch(() => undefined);
          // A transcript that moved is found again on the next read.
          if (scan) paths.set(session.id, path);
          else paths.delete(session.id);
          return scan?.jobs.length ? { thread, session, scan } : undefined;
        }),
      );
      const withJobs = found.filter((entry) => !!entry);
      const places = withJobs.length
        ? await options.running(withJobs.map((entry) => entry.session.id))
        : new Map<string, "med" | SessionPlace>();
      const at = now();
      const entries: ScheduleEntry[] = withJobs.flatMap(({ thread, session, scan }) => {
        // A session's jobs fire only while its process runs.
        const runs = places.get(session.id);
        if (!runs) return [];
        // A wakeup is only the loop's next one: the latest stands for the loop.
        const wakeup = scan.jobs.findLast((job) => job.kind === "wakeup" && !job.failed);
        return scan.jobs.flatMap((job): ScheduleEntry[] => {
          if (job.failed || (job.kind === "wakeup" && job !== wakeup)) return [];
          const fired = scan.fires.get(job.prompt.trim());
          const common = {
            threadId: thread.id,
            threadTitle: thread.title,
            sessionId: session.id,
            prompt: job.prompt,
            createdAt: job.createdAt,
            fires: fired?.count ?? 0,
            ...(fired ? { lastFiredAt: fired.last } : {}),
            runs,
          };
          if (job.kind === "wakeup") {
            const due = job.createdAt + (job.delaySeconds ?? 0) * 1000;
            if (due < at) return [];
            return [
              {
                kind: "wakeup",
                ...common,
                schedule: `In ${Math.max(1, Math.round((due - at) / 60_000))} minutes`,
                recurring: false,
                endsAt: due,
              },
            ];
          }
          const state = scheduleState(
            {
              recurring: job.recurring,
              cron: job.cron!,
              createdAt: job.createdAt,
              cancelled: !!job.id && scan.cancelled.has(job.id),
              fires: fired?.count ?? 0,
            },
            at,
            true,
          );
          if (state !== "live") return [];
          return [
            {
              kind: "cron",
              ...common,
              ...(job.id ? { id: job.id } : {}),
              schedule: describeCron(job.cron!),
              cron: job.cron!,
              recurring: job.recurring,
              ...(job.recurring ? { endsAt: expiresAt(job.createdAt) } : {}),
            },
          ];
        });
      });
      entries.sort((a, b) => b.createdAt - a.createdAt);
      return { sessions: entries };
    },
  };
}
export type ScheduleService = ReturnType<typeof createSchedules>;
