import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import type { RunningSession } from "../../../shared/found-sessions";
import { keepRunningSession, useRunningSessions } from "../../data/running-sessions";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { tooltip } from "../ToolButton";
import { useHostFetch } from "../Workspaces";

const PLACES: Record<RunningSession["place"], string> = {
  med: "Med",
  terminal: "Terminal",
  "claude-app": "Claude app",
  "other-app": "Other app",
};

const placeName = (session: RunningSession) =>
  session.place === "other-app" && session.agent === "codex" ? "Codex" : PLACES[session.place];

/**
 * Running now: the agent sessions that run on this computer, in Med or in a
 * terminal or an app. One that a thread has opens it; any other becomes one
 * with Keep in Med, or for agy, Continue in Med. It shows only while some
 * session runs.
 */
export function RunningNow({
  fetcher,
  onOpen,
}: {
  fetcher?: typeof fetch;
  /** Opens the thread with this ID. */
  onOpen(threadId: string, title: string): void;
}) {
  const hostFetch = useHostFetch();
  fetcher ??= hostFetch;
  const { sessions, refresh } = useRunningSessions(fetcher);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!sessions.length) return null;
  const keep = (session: RunningSession) => {
    setBusy(session.id);
    setError(null);
    keepRunningSession(session, fetcher)
      .then((kept) => {
        onOpen(kept.id, kept.title);
        refresh();
      })
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : "Med did not keep it."),
      )
      .finally(() => setBusy(null));
  };
  return (
    <section aria-label="Running now" {...stylex.props(styles.section)}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        {...stylex.props(styles.toggle)}
      >
        <span {...stylex.props(styles.chevron, open && styles.chevronOpen)}>
          <Icon name="chevron" size={12} />
        </span>
        <span {...stylex.props(ui.label)}>Running now</span>
        <span {...stylex.props(styles.count)}>{sessions.length}</span>
      </button>
      {open && (
        <ul {...stylex.props(styles.list)}>
          {sessions.map((session) => {
            const { thread } = session;
            const action = session.agent === "agy" ? "Continue in Med" : "Keep in Med";
            return (
              <li key={`${session.agent}:${session.id}`} {...stylex.props(styles.row)}>
                <button
                  type="button"
                  data-sidebar-row=""
                  disabled={busy !== null}
                  {...tooltip(
                    thread
                      ? "Open its thread"
                      : `${action}${session.cwd ? `: ${session.cwd}` : ""}`,
                  )}
                  onClick={() => (thread ? onOpen(thread, session.title) : keep(session))}
                  {...stylex.props(styles.open)}
                >
                  <Icon
                    name={
                      session.agent === "claude" || session.agent === "codex"
                        ? session.agent
                        : "agent"
                    }
                    size={13}
                  />
                  <span {...stylex.props(styles.title)}>{session.title}</span>
                  <span {...stylex.props(styles.place)}>
                    {busy === session.id ? "Keeping…" : thread ? placeName(session) : action}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.error)}>
          {error}
        </p>
      )}
    </section>
  );
}

const styles = stylex.create({
  section: {
    flexShrink: 0,
    paddingInline: 8,
    paddingTop: 6,
    paddingBottom: 4,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    maxHeight: "30%",
    overflowY: "auto",
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
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" },
  row: { minWidth: 0 },
  open: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    minWidth: 0,
    height: 30,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  title: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  place: { flexShrink: 0, color: tokens.faint, fontSize: 11 },
  error: {
    margin: 0,
    paddingInline: 8,
    paddingBottom: 4,
    color: tokens.red,
    fontSize: 11.5,
    lineHeight: 1.45,
  },
});
