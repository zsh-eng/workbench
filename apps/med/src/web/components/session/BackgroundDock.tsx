import * as stylex from "@stylexjs/stylex";
import { useContext, useState } from "react";
import type { SessionItem } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ZenContext } from "../ZenExit";
import { motion, rowStyles } from "./session-styles";
import { formatSeconds, isMedWait } from "./ToolCall";

type ToolItem = Extract<SessionItem, { kind: "tool" }>;

/** A local address that a dev server prints, such as http://localhost:5173/. */
const ADDRESS =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(?::\d{2,5})?\/?[^\s"'`)]*/;

const isRunning = (item: ToolItem) =>
  item.call.status === "pending" || item.call.status === "in_progress";

/** Running tasks, and tasks that ended after `since`. Med's own wait is not a task. */
function backgroundTasks(items: SessionItem[], since: number, found: ToolItem[] = []) {
  for (const item of items) {
    if (item.kind !== "tool") continue;
    if (
      item.call.background &&
      !isMedWait(item.call) &&
      (isRunning(item) || (item.endedAt ?? item.at) >= since)
    )
      found.push(item);
    backgroundTasks(item.items, since, found);
  }
  return found;
}

/** Tasks that the reader hid the dock over; a new task shows it again. */
const HIDDEN = "med:background-hidden";
function readHidden(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(HIDDEN) ?? "[]");
    return Array.isArray(value) ? value.filter((id) => typeof id === "string") : [];
  } catch {
    return [];
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage can be unavailable. */
  }
}

function addressOf(item: ToolItem) {
  for (const part of item.call.content)
    if (part.type === "content" && part.content.type === "text") {
      const match = ADDRESS.exec(part.content.text);
      if (match) return match[0].replace(/\/$/, "");
    }
  return undefined;
}

/**
 * Shells and agents that run in the background, as Claude Desktop lists
 * them: running ones first, with the local address a dev server printed,
 * then the ones that ended since the last prompt. A task's name scrolls the
 * thread to the call that started it. The dock stays closed or hidden as the
 * reader left it; a hidden dock comes back for a new task.
 */
export function BackgroundDock({
  items,
  now,
  onShow,
}: {
  items: SessionItem[];
  now?: number;
  /** Scrolls the thread to the call, which a long thread may not have rendered. */
  onShow?(id: string): void;
}) {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem("med:background") !== "closed";
    } catch {
      return true;
    }
  });
  const [hidden, setHidden] = useState(readHidden);
  const zen = useContext(ZenContext);
  let since = 0;
  for (const item of items) if (item.kind === "user") since = item.at;
  const tasks = backgroundTasks(items, since);
  const ids = tasks.map((item) => item.call.background!.id);
  // Zen leaves the waiting to the session's status.
  if (zen || ids.every((id) => hidden.includes(id))) return null;
  const running = tasks.filter(isRunning);
  const ordered = [...running, ...tasks.filter((item) => !isRunning(item)).reverse()];
  const hide = () => {
    const next = [...new Set([...ids, ...hidden])].slice(0, 200);
    setHidden(next);
    store(HIDDEN, JSON.stringify(next));
  };
  return (
    <section aria-label="Background tasks" {...stylex.props(styles.dock)}>
      <div {...stylex.props(styles.top)}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
            store("med:background", open ? "closed" : "open");
          }}
          {...stylex.props(rowStyles.row, styles.head)}
        >
          <span {...stylex.props(rowStyles.icon)}>
            {running.length ? (
              <span {...stylex.props(motion.spinner)} />
            ) : (
              <Icon name="terminal" size={14} />
            )}
          </span>
          <span {...stylex.props(styles.label)}>Background</span>
          <span {...stylex.props(styles.count)}>
            {running.length ? `${running.length} running` : `${tasks.length} done`}
          </span>
          <span {...stylex.props(styles.grow)} />
          <span {...stylex.props(styles.chevron, open ? styles.chevronOpen : styles.chevronUp)}>
            <Icon name="chevron" size={12} />
          </span>
        </button>
        <button
          type="button"
          aria-label="Hide background tasks"
          title="Hide until a new task starts"
          onClick={hide}
          {...stylex.props(styles.hide)}
        >
          <Icon name="close" size={12} />
        </button>
      </div>
      {open && (
        <ul {...stylex.props(styles.list)}>
          {ordered.map((item) => {
            const live = isRunning(item);
            const address = live ? addressOf(item) : undefined;
            const elapsed = (live ? (now ?? item.at) : (item.endedAt ?? item.at)) - item.at;
            return (
              <li key={item.id} {...stylex.props(styles.task)}>
                <span {...stylex.props(styles.kind)}>
                  <Icon
                    name={item.call.background!.kind === "agent" ? "agent" : "terminal"}
                    size={13}
                  />
                </span>
                <button
                  type="button"
                  onClick={() => onShow?.(item.id)}
                  {...stylex.props(styles.name, !live && styles.finished)}
                >
                  {item.call.title}
                </button>
                {address && (
                  <a
                    href={address}
                    target="_blank"
                    rel="noreferrer"
                    {...stylex.props(styles.address)}
                  >
                    {address.replace(/^https?:\/\//, "")}
                  </a>
                )}
                <span
                  {...stylex.props(styles.state, item.call.status === "failed" && styles.failed)}
                >
                  {live
                    ? elapsed >= 1000
                      ? formatSeconds(elapsed)
                      : "Running"
                    : item.call.status === "failed"
                      ? "Failed"
                      : "Done"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

const styles = stylex.create({
  dock: {
    flexShrink: 0,
    marginInline: 12,
    marginBottom: 8,
    paddingInline: 10,
    paddingBlock: 2,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  top: { display: "flex", alignItems: "center", gap: 4 },
  head: { flex: "1", cursor: "pointer", gap: 8 },
  hide: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 20,
    height: 20,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
  },
  label: { color: tokens.text, fontWeight: 500 },
  count: { color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  grow: { flex: "1" },
  chevron: {
    display: "flex",
    color: tokens.faint,
    transitionProperty: "transform",
    transitionDuration: "150ms",
    transitionTimingFunction: tokens.easeOut,
  },
  chevronOpen: { transform: "rotate(0deg)" },
  chevronUp: { transform: "rotate(180deg)" },
  list: {
    listStyle: "none",
    margin: 0,
    paddingTop: 0,
    paddingBottom: 8,
    paddingInline: 0,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  },
  task: { display: "flex", alignItems: "center", gap: 8, minHeight: 24, fontSize: 12.5 },
  kind: {
    display: "flex",
    width: 16,
    justifyContent: "center",
    color: tokens.faint,
    flexShrink: 0,
  },
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.text, ":hover": tokens.accent },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    textAlign: "left",
    cursor: "pointer",
  },
  finished: { color: tokens.muted },
  address: {
    flexShrink: 0,
    paddingInline: 6,
    paddingBlock: 1,
    borderRadius: 999,
    backgroundColor: tokens.accentSoft,
    color: tokens.accent,
    fontFamily: tokens.code,
    fontSize: 11,
    textDecoration: "none",
  },
  state: { flexShrink: 0, color: tokens.faint, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  failed: { color: tokens.red },
});
