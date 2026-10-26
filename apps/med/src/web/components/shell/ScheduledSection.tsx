import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { ScheduleEntry } from "../../../shared/schedules";
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

/**
 * The Scheduled section of the sidebar: the tabs' Claude Code jobs that will
 * fire, with their thread, schedule, and prompt. With none, there is no
 * section; a thread's cards keep the jobs that ended or cannot fire. Read
 * only: Med never runs, edits, or deletes a schedule (docs/SCHEDULES.md).
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
  const { data, at: now } = useSchedules(fetcher);
  const jobs = data?.sessions ?? [];
  if (!jobs.length) return null;
  const row = (entry: ScheduleEntry) => (
    <li key={`${entry.sessionId}:${entry.id ?? entry.createdAt}`}>
      <button
        type="button"
        data-sidebar-row=""
        onClick={() => onOpenThread(entry.threadId)}
        title={entry.prompt}
        {...stylex.props(styles.entry)}
      >
        <span {...stylex.props(styles.schedule)}>{entry.schedule}</span>
        <span {...stylex.props(styles.prompt)}>{entry.prompt || "(no prompt)"}</span>
        <span {...stylex.props(styles.meta)}>
          <span {...stylex.props(styles.thread)}>{entry.threadTitle}</span>
          {" · "}
          {entry.recurring ? "recurring" : "one-shot"}
          {entry.fires > 0 && entry.lastFiredAt
            ? ` · ran ${relativeTime(entry.lastFiredAt, now)}`
            : ""}
        </span>
        <span {...stylex.props(styles.note)}>
          Runs {places[entry.runs]} · ends with its session
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
        <span {...stylex.props(styles.count)}>{jobs.length}</span>
      </button>
      {open && <ul {...stylex.props(styles.list, styles.body)}>{jobs.map(row)}</ul>}
    </section>
  );
}

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
  list: {
    listStyle: "none",
    marginBlock: 0,
    marginInline: 0,
    paddingTop: 0,
    paddingInline: 0,
    display: "flex",
    flexDirection: "column",
  },
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
  schedule: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12.5,
    fontWeight: 500,
  },
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
});
