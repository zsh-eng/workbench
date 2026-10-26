import * as stylex from "@stylexjs/stylex";
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { SessionItem } from "../../data/session-store";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";
import { ZenContext } from "../ZenExit";
import { Elapsed } from "./Elapsed";
import { motion, rowStyles } from "./session-styles";
import { isMedWait } from "./thread-model";

type ToolItem = Extract<SessionItem, { kind: "tool" }>;

/** A local address that a dev server prints, such as http://localhost:5173/. */
const ADDRESS =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|[\w-]+\.localhost)(?::\d{2,5})?\/?[^\s"'`)]*/;

const isRunning = (item: ToolItem) =>
  item.call.status === "pending" || item.call.status === "in_progress";
const failed = (item: ToolItem) => item.call.status === "failed";
const idOf = (item: ToolItem) => item.call.background!.id;

/** How long a task that ends well shows "Done" in its place. */
const DONE_MS = 3000;

/** Background tasks, also in subagents. Med's own wait is not a task. */
function backgroundTasks(items: SessionItem[], found: ToolItem[] = []) {
  for (const item of items) {
    if (item.kind !== "tool") continue;
    if (item.call.background && !isMedWait(item.call)) found.push(item);
    backgroundTasks(item.items, found);
  }
  return found;
}

/** Tasks that the reader hid the dock over; a new task shows it again. */
const HIDDEN = "med:background-hidden";
/** Failed tasks that the reader saw: opened, or hid the dock over. */
const SEEN = "med:background-seen";
function readIds(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
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
 * The tasks that ended well while the dock watched them run, until each has
 * shown "Done" for DONE_MS. A task that ended before the dock saw it run has
 * no place to end in, so it does not show.
 */
function useDone(tasks: readonly ToolItem[]) {
  const [state, setState] = useState(() => ({
    tasks,
    running: new Set(tasks.filter(isRunning).map(idOf)),
    done: new Set<string>(),
  }));
  // Read in the render that sees a task end, so its row changes in place.
  if (state.tasks !== tasks) {
    const ended = tasks
      .filter((task) => !isRunning(task) && !failed(task) && state.running.has(idOf(task)))
      .map(idOf);
    setState({
      tasks,
      running: new Set(tasks.filter(isRunning).map(idOf)),
      done: ended.length ? new Set([...state.done, ...ended]) : state.done,
    });
  }
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  useEffect(() => {
    const map = timers.current;
    for (const id of state.done)
      if (!map.has(id))
        map.set(
          id,
          setTimeout(() => {
            map.delete(id);
            setState((current) => ({
              ...current,
              done: new Set([...current.done].filter((entry) => entry !== id)),
            }));
          }, DONE_MS),
        );
  }, [state.done]);
  useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((timer) => clearTimeout(timer));
      // Effects that run again set them again.
      map.clear();
    };
  }, []);
  return state.done;
}

/**
 * Shells and agents that run in the background, as Claude Desktop lists
 * them: only what runs, with the local address a dev server printed. A task
 * that ends shows how it ended in its place: "Done" leaves after a moment,
 * and "Failed" stays until the reader opens it, hides the dock, or sends the
 * next prompt. With nothing to show, the dock is gone. A task's name scrolls
 * the thread to the call that started it. The dock stays closed or hidden as
 * the reader left it; a hidden dock comes back for a new task.
 */
export function BackgroundDock({
  items,
  now,
  onShow,
}: {
  items: SessionItem[];
  /** A fixed clock, for stills; without it, running times follow the clock. */
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
  const [hidden, setHidden] = useState(() => readIds(HIDDEN));
  const [seen, setSeen] = useState(() => readIds(SEEN));
  const zen = useContext(ZenContext);
  const all = useMemo(() => backgroundTasks(items), [items]);
  const done = useDone(all);
  let since = 0;
  for (const item of items) if (item.kind === "user") since = item.at;
  const tasks = all.filter(
    (item) =>
      isRunning(item) ||
      done.has(idOf(item)) ||
      (failed(item) && (item.endedAt ?? item.at) >= since && !seen.includes(idOf(item))),
  );
  const ids = tasks.map(idOf);
  // Zen leaves the waiting to the session's status. A hidden dock comes back
  // for a new task, or for a failure that the reader has not seen.
  if (zen || tasks.every((item) => hidden.includes(idOf(item)) && !failed(item))) return null;
  const see = (list: string[]) => {
    if (list.every((id) => seen.includes(id))) return;
    const next = [...new Set([...list, ...seen])].slice(0, 200);
    setSeen(next);
    store(SEEN, JSON.stringify(next));
  };
  const running = tasks.filter(isRunning).length;
  const failures = tasks.filter(failed);
  const hide = () => {
    // Hiding the dock is seeing its failures.
    see(failures.map(idOf));
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
            {running ? (
              <span {...stylex.props(motion.spinner)} />
            ) : (
              <Icon name="terminal" size={14} />
            )}
          </span>
          <span {...stylex.props(styles.label)}>Background</span>
          <span {...stylex.props(styles.count)}>
            {[running && `${running} running`, failures.length && `${failures.length} failed`]
              .filter(Boolean)
              .join(" · ") || "Done"}
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
          {/* In the order they started, so a task ends in its place. */}
          {tasks.map((item) => {
            const live = isRunning(item);
            const address = live ? addressOf(item) : undefined;
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
                  onClick={() => {
                    if (failed(item)) see([idOf(item)]);
                    onShow?.(item.id);
                  }}
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
                <span {...stylex.props(styles.state, failed(item) && styles.failedText)}>
                  {live ? (
                    // A dev server runs for hours: its time counts minutes.
                    <Elapsed from={item.at} now={now} step="minute" empty="Running" />
                  ) : failed(item) ? (
                    "Failed"
                  ) : (
                    "Done"
                  )}
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
  // One width for "Running", "12 min", and "Done", so the name and the
  // address keep their place as the time changes.
  state: {
    flexShrink: 0,
    minWidth: 46,
    color: tokens.faint,
    fontSize: 11.5,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
  },
  failedText: { color: tokens.red },
});
