import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import {
  scheduleStateLabels,
  type ScheduleEntry,
  type ScheduleState,
} from "../../../shared/schedules";
import { relativeTime } from "../../data/relative-time";
import { useSchedules } from "../../data/schedules";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";

const OPEN_KEY = "med:sidebar-scheduled";

const readOpen = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === "true";
  } catch {
    return false;
  }
};

const places = {
  med: "in Med",
  terminal: "in a terminal",
  "claude-app": "in the Claude app",
  "other-app": "in another app",
} as const;

/** What a job's state means for whether it fires, in a few words. */
function stateNote(entry: ScheduleEntry): string {
  switch (entry.state) {
    case "live":
      return `Runs ${places[entry.runs ?? "other-app"]} · ends with its session`;
    case "stopped":
      return "Won't fire: its session ended · comes back if the session resumes";
    case "cancelled":
      return "Cancelled with CronDelete";
    case "expired":
      return "Ended after 7 days";
    case "fired":
      return "Fired once";
    case "missed":
      return "Won't fire: its time passed while its session was not running";
  }
}

const OFF: ReadonlySet<ScheduleState> = new Set(["cancelled", "expired", "fired", "missed"]);

/**
 * The Scheduled section of the sidebar: each tab's Claude Code jobs with their
 * thread, schedule, prompt, and whether they can fire, and the Claude app's
 * scheduled tasks. Read only: Med never runs, edits, or deletes a schedule.
 */
export function ScheduledSection({
  fetcher,
  onOpenThread,
}: {
  fetcher: typeof fetch;
  onOpenThread(id: string): void;
}) {
  const [open, setOpen] = useState(readOpen);
  const toggle = () =>
    setOpen((value) => {
      try {
        localStorage.setItem(OPEN_KEY, String(!value));
      } catch {
        /* The choice lasts for this page. */
      }
      return !value;
    });
  const { data, error, at: now } = useSchedules(fetcher, open);
  const live = data?.sessions.filter((entry) => !OFF.has(entry.state)) ?? [];
  const ended = data?.sessions.filter((entry) => OFF.has(entry.state)) ?? [];
  const count = data ? live.length + data.desktop.tasks.length : undefined;
  const row = (entry: ScheduleEntry) => (
    <li key={`${entry.sessionId}:${entry.id ?? entry.createdAt}`}>
      <button
        type="button"
        data-sidebar-row=""
        data-schedule={entry.state}
        onClick={() => onOpenThread(entry.threadId)}
        title={entry.prompt}
        {...stylex.props(styles.entry)}
      >
        <span {...stylex.props(styles.line)}>
          <span
            {...stylex.props(
              styles.schedule,
              (entry.state === "cancelled" || entry.state === "expired") && styles.off,
            )}
          >
            {entry.schedule}
          </span>
          <span {...stylex.props(styles.badge, badgeStyles[entry.state])}>
            {scheduleStateLabels[entry.state]}
          </span>
        </span>
        <span {...stylex.props(styles.prompt)}>{entry.prompt || "(no prompt)"}</span>
        <span {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.thread)}>{entry.threadTitle}</span>
          {" · "}
          {entry.recurring ? "recurring" : "one-shot"}
          {entry.fires > 0 && entry.lastFiredAt
            ? ` · ran ${relativeTime(entry.lastFiredAt, now)}`
            : ""}
        </span>
        <span
          {...stylex.props(
            styles.note,
            (entry.state === "stopped" || entry.state === "missed") && styles.warn,
          )}
        >
          {stateNote(entry)}
        </span>
      </button>
    </li>
  );
  return (
    <section aria-label="Scheduled" data-scheduled="" {...stylex.props(styles.section)}>
      <button type="button" aria-expanded={open} onClick={toggle} {...stylex.props(styles.toggle)}>
        <span {...stylex.props(styles.chevron, open && styles.chevronOpen)}>
          <Icon name="chevron" size={12} />
        </span>
        <span {...stylex.props(ui.label)}>Scheduled</span>
        {count !== undefined && <span {...stylex.props(styles.count)}>{count}</span>}
      </button>
      {open && (
        <div {...stylex.props(styles.body)}>
          {error && !data && <p {...stylex.props(styles.empty)}>{error}</p>}
          {data && !data.sessions.length && (
            <p {...stylex.props(styles.empty)}>
              No agent in a tab has scheduled a prompt. Claude Code's /loop and its cron jobs show
              here, with whether they can fire.
            </p>
          )}
          {live.length > 0 && <ul {...stylex.props(styles.list)}>{live.map(row)}</ul>}
          {ended.length > 0 && (
            <>
              <h3 {...stylex.props(ui.label, styles.group)}>Ended</h3>
              <ul {...stylex.props(styles.list)}>{ended.map(row)}</ul>
            </>
          )}
          {data && (
            <>
              <h3 {...stylex.props(ui.label, styles.group)}>Claude app</h3>
              {data.desktop.tasks.length ? (
                <ul {...stylex.props(styles.list)}>
                  {data.desktop.tasks.map((task) => (
                    <li
                      key={task.path}
                      data-desktop-task={task.name}
                      title={task.prompt}
                      {...stylex.props(styles.entry, styles.task)}
                    >
                      <span {...stylex.props(styles.schedule)}>{task.name}</span>
                      {task.description && (
                        <span {...stylex.props(styles.prompt)}>{task.description}</span>
                      )}
                      <span {...stylex.props(styles.note)}>
                        The Claude app runs it; its schedule is set there
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p {...stylex.props(styles.empty)}>
                  {data.desktop.missing
                    ? "No scheduled tasks: the Claude app has made none on this computer."
                    : "No scheduled tasks."}
                </p>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}

const badgeStyles = stylex.create({
  live: { color: tokens.green },
  stopped: { color: tokens.warning },
  cancelled: { color: tokens.faint },
  expired: { color: tokens.faint },
  fired: { color: tokens.faint },
  missed: { color: tokens.warning },
});

const styles = stylex.create({
  section: {
    flexShrink: 0,
    paddingInline: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    maxHeight: "45%",
    overflowY: "auto",
    scrollbarWidth: "thin",
  },
  toggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    width: "100%",
    height: 28,
    paddingInline: 6,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.faint,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  chevron: {
    display: "inline-flex",
    transform: "rotate(-90deg)",
    transitionProperty: "transform",
    transitionDuration: "150ms",
  },
  chevronOpen: { transform: "rotate(0deg)" },
  count: { color: tokens.faint, fontSize: 11, fontVariantNumeric: "tabular-nums" },
  body: { paddingBottom: 8 },
  group: { marginTop: 10, marginBottom: 2, marginInline: 0, paddingInline: 8 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  entry: {
    display: "flex",
    flexDirection: "column",
    gap: 2,
    width: "100%",
    paddingBlock: 6,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  task: { cursor: "default", backgroundColor: "transparent" },
  line: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 },
  schedule: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12.5,
    fontWeight: 500,
  },
  off: { color: tokens.muted, textDecorationLine: "line-through" },
  badge: { flexShrink: 0, fontSize: 10.5, fontWeight: 500 },
  prompt: {
    display: "-webkit-box",
    WebkitBoxOrient: "vertical",
    WebkitLineClamp: 2,
    overflow: "hidden",
    color: tokens.muted,
    fontSize: 11.5,
    lineHeight: 1.4,
  },
  meta: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 11,
  },
  thread: { color: tokens.muted },
  note: { color: tokens.faint, fontSize: 11 },
  warn: { color: tokens.warning },
  empty: {
    margin: 0,
    paddingBlock: 4,
    paddingInline: 8,
    color: tokens.faint,
    fontSize: 11.5,
    lineHeight: 1.5,
  },
});
