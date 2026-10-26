import * as stylex from "@stylexjs/stylex";
import { createContext, useContext, useMemo } from "react";
import {
  describeCron,
  expiryText,
  scheduleState,
  scheduleStateLabels,
  type ScheduleCall,
  type ScheduleState,
} from "../../../shared/schedules";
import type { SessionItem, ToolCallState } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";

type ToolItem = Extract<SessionItem, { kind: "tool" }>;
type CronCall = Extract<ScheduleCall, { kind: "cron" }>;

/** What the rest of a session says of its jobs: which a CronDelete
 * cancelled, and how often each prompt fired. Med reads it; it never runs,
 * edits, or deletes a schedule (docs/SCHEDULES.md). */
export interface ScheduleFacts {
  cancelled: ReadonlySet<string>;
  /** Fires by prompt: a scheduled prompt's text is its job's. */
  fires: ReadonlyMap<string, { count: number; last: number }>;
  /** Each job's schedule by ID, for a cancel's card. */
  jobs: ReadonlyMap<string, CronCall>;
  now: number;
}

const NO_FACTS: ScheduleFacts = {
  cancelled: new Set(),
  fires: new Map(),
  jobs: new Map(),
  now: 0,
};
export const ScheduleFactsContext = createContext<ScheduleFacts>(NO_FACTS);

/** The facts of a thread's items, and of its subagents' threads. */
export function useScheduleFacts(items: readonly SessionItem[], now: number): ScheduleFacts {
  const facts = useMemo(() => {
    const cancelled = new Set<string>();
    const fires = new Map<string, { count: number; last: number }>();
    const jobs = new Map<string, CronCall>();
    const walk = (list: readonly SessionItem[]) => {
      for (const item of list) {
        if (item.kind === "notice" && item.scheduled && item.description) {
          const before = fires.get(item.description);
          fires.set(item.description, { count: (before?.count ?? 0) + 1, last: item.at });
        }
        if (item.kind !== "tool") continue;
        const schedule = item.call.schedule;
        if (schedule?.kind === "cancel" && item.call.status === "completed")
          cancelled.add(schedule.id);
        if (schedule?.kind === "cron" && schedule.id) jobs.set(schedule.id, schedule);
        if (item.items.length) walk(item.items);
      }
    };
    walk(items);
    return { cancelled, fires, jobs };
  }, [items]);
  // The clock moves expiry only; a minute is fine enough.
  const minute = Math.floor(now / 60_000);
  return useMemo(() => ({ ...facts, now: minute * 60_000 }), [facts, minute]);
}

const one = (text: string) => text.replace(/\s+/g, " ").trim();

function cronLine(schedule: CronCall, call: ToolCallState, at: number, facts: ScheduleFacts) {
  const fired = facts.fires.get(schedule.prompt);
  const failed = call.status === "failed";
  const state: ScheduleState | undefined = failed
    ? undefined
    : scheduleState(
        {
          recurring: schedule.recurring,
          cron: schedule.cron,
          createdAt: at,
          cancelled: !!schedule.id && facts.cancelled.has(schedule.id),
          fires: fired?.count ?? 0,
        },
        facts.now || Date.now(),
        undefined,
      );
  const parts = [schedule.recurring ? "Recurring" : "One-shot"];
  if (schedule.recurring && state !== "cancelled" && state !== "expired")
    parts.push(expiryText(at, facts.now || Date.now()));
  if (fired) parts.push(`ran ${fired.count === 1 ? "once" : `${fired.count} times`}`);
  return { state, parts, failed };
}

/**
 * A schedule tool's call as a card: what it schedules, its prompt, and what
 * became of it. A session-only job ends with its session, which it says.
 */
export function ScheduleCard({ item }: { item: ToolItem }) {
  const facts = useContext(ScheduleFactsContext);
  const { call } = item;
  const schedule = call.schedule;
  if (!schedule) return null;
  const running = call.status === "pending" || call.status === "in_progress";
  let title: string;
  let prompt: string | undefined;
  let meta: string[] = [];
  let badge: { label: string; tone: "live" | "off" | "warn" } | undefined;
  let struck = false;
  let note: string | undefined;
  if (schedule.kind === "cron") {
    const line = cronLine(schedule, call, item.at, facts);
    title = describeCron(schedule.cron);
    prompt = schedule.prompt;
    meta = line.parts;
    if (line.failed) badge = { label: "Not scheduled", tone: "warn" };
    else if (line.state === "cancelled" || line.state === "expired" || line.state === "missed") {
      badge = { label: scheduleStateLabels[line.state], tone: "off" };
      struck = line.state !== "missed";
    } else if (line.state === "fired") badge = { label: "Fired", tone: "off" };
    // A job that Claude Code did not write to disk dies with its process.
    if (!line.failed && schedule.durable !== true && line.state !== "cancelled")
      note = line.state === "expired" ? undefined : "Ends with its session";
  } else if (schedule.kind === "cancel") {
    const job = facts.jobs.get(schedule.id);
    title = job ? `Cancelled: ${describeCron(job.cron)}` : "Cancelled a scheduled job";
    prompt = job?.prompt;
    meta = [`job ${schedule.id}`];
    if (call.status === "failed") badge = { label: "Not cancelled", tone: "warn" };
  } else {
    if (schedule.stop) {
      title = "Stopped the loop";
    } else {
      const minutes = schedule.delaySeconds ? Math.round(schedule.delaySeconds / 60) : undefined;
      title =
        minutes === undefined
          ? "Wakes up later"
          : `Wakes up in ${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
      prompt = schedule.prompt;
      meta = ["One-shot", ...(schedule.reason ? [one(schedule.reason)] : [])];
      note = "Ends with its session";
    }
    if (call.status === "failed") badge = { label: "Not scheduled", tone: "warn" };
  }
  return (
    <div
      data-schedule-card={schedule.kind}
      data-tool-call-id={call.toolCallId}
      aria-label={[title, prompt && one(prompt), ...meta, badge?.label, note]
        .filter(Boolean)
        .join(" · ")}
      role="group"
      {...stylex.props(styles.card)}
    >
      <span {...stylex.props(styles.icon)} aria-hidden="true">
        <Icon name="clock" size={14} />
      </span>
      <span {...stylex.props(styles.body)}>
        <span {...stylex.props(styles.head)}>
          <span {...stylex.props(styles.title, struck && styles.titleOff)}>{title}</span>
          {badge && <span {...stylex.props(styles.badge, badges[badge.tone])}>{badge.label}</span>}
          {running && <span {...stylex.props(styles.meta)}>Scheduling…</span>}
        </span>
        {prompt && (
          <span title={prompt} {...stylex.props(styles.prompt)}>
            {one(prompt)}
          </span>
        )}
        {(meta.length > 0 || note) && (
          <span {...stylex.props(styles.meta)}>
            {meta.join(" · ")}
            {note && (
              <span
                {...stylex.props(styles.note)}
                title="Claude Code keeps this job in its session only: it fires while the session's process runs, and stops when the process ends."
              >
                {meta.length > 0 ? " · " : ""}
                {note}
              </span>
            )}
          </span>
        )}
      </span>
    </div>
  );
}

const badges = stylex.create({
  live: { color: tokens.green, borderColor: tokens.green },
  off: { color: tokens.faint, borderColor: tokens.line },
  warn: { color: tokens.warning, borderColor: tokens.warning },
});

const styles = stylex.create({
  card: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    marginBlock: 6,
    paddingBlock: 9,
    paddingInline: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: `calc(9px * ${tokens.round})`,
    backgroundColor: tokens.panel,
    fontFamily: tokens.ui,
    maxWidth: 640,
  },
  icon: { display: "flex", paddingTop: 2, color: tokens.accent, flexShrink: 0 },
  body: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0, flex: "1" },
  head: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 },
  title: { color: tokens.text, fontSize: 13, fontWeight: 550 },
  titleOff: { color: tokens.muted, textDecorationLine: "line-through" },
  badge: {
    flexShrink: 0,
    paddingInline: 6,
    borderWidth: 1,
    borderStyle: "solid",
    borderRadius: 999,
    fontSize: 10.5,
    fontWeight: 500,
    lineHeight: "16px",
  },
  prompt: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.45,
  },
  meta: { color: tokens.faint, fontSize: 11.5 },
  note: { color: tokens.warning },
});
