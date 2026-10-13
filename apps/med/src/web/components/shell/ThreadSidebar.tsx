import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Thread } from "../../../shared/threads";
import { groupThreads, shortAge } from "../../data/threads";
import type { WorkspaceInput, WorkspaceSnapshot } from "../../data/workspaces";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { ShortcutKeys } from "../ShortcutKeys";
import { ToolButton } from "../ToolButton";

const SEEN_KEY = "med:thread-seen";
const SINCE_KEY = "med:thread-seen-since";

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Unread marks last for this page. */
  }
}

/**
 * Which threads changed since the reader last looked at them. The shown
 * thread counts as seen. Threads from before the first visit start as seen,
 * so old work does not show as new.
 */
function useUnread(threads: readonly Thread[], current: string | null) {
  const [since] = useState(() => {
    const value = readJson<number>(SINCE_KEY, 0);
    if (value) return value;
    const now = Date.now();
    writeJson(SINCE_KEY, now);
    return now;
  });
  const [seen, setSeen] = useState<Record<string, number>>(() => readJson(SEEN_KEY, {}));
  const shown = threads.find((thread) => thread.id === current);
  useEffect(() => {
    if (!shown || (seen[shown.id] ?? 0) >= shown.updatedAt) return;
    const next = { ...seen, [shown.id]: shown.updatedAt };
    // Forget threads the host no longer keeps.
    for (const id of Object.keys(next))
      if (!threads.some((thread) => thread.id === id)) delete next[id];
    setSeen(next);
    writeJson(SEEN_KEY, next);
  }, [shown, seen, threads]);
  return (thread: Thread) =>
    thread.id !== current &&
    thread.state !== "working" &&
    thread.updatedAt > (seen[thread.id] ?? since);
}

function agentIcon(agent: Thread["agent"]): IconName {
  return agent === "claude" || agent === "codex" ? agent : "agent";
}

export interface SidebarSource {
  kind: "repository" | "vault";
  id: string;
  name: string;
  path?: string;
}

/**
 * The window's sidebar: every thread, grouped by repository, and the
 * repositories and vaults to browse without a thread.
 */
export function ThreadSidebar({
  threads,
  sources,
  snapshot,
  loaded,
  onOpen,
  onNewThread,
  newThread = false,
  onHide,
  onSources,
}: {
  /** The New thread view shows. */
  newThread?: boolean;
  threads: readonly Thread[];
  sources: readonly SidebarSource[];
  snapshot: WorkspaceSnapshot;
  loaded: boolean;
  onOpen(input: WorkspaceInput): void;
  onNewThread?(): void;
  onHide(): void;
  onSources(): void;
}) {
  const active = newThread
    ? undefined
    : snapshot.workspaces.find((entry) => entry.id === snapshot.active);
  const currentThread = !newThread && active?.kind === "review" ? active.reviewId : null;
  const isUnread = useUnread(threads, currentThread);
  const groups = useMemo(() => groupThreads(threads), [threads]);
  // Ages move while the list shows.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const list = useRef<HTMLElement>(null);
  // ↑ and ↓ move between rows, as in a menu; Home and End go to the ends.
  const move = (event: KeyboardEvent<HTMLElement>) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
    const rows = [...(list.current?.querySelectorAll<HTMLElement>("[data-sidebar-row]") ?? [])];
    const index = rows.indexOf(document.activeElement as HTMLElement);
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? rows.length - 1
          : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
    rows[next]?.focus();
    event.preventDefault();
  };

  const sourceActive = (source: SidebarSource) =>
    source.kind === "vault"
      ? active?.kind === "vault" && active.sourceId === source.id
      : active?.kind === "repository" &&
        (active.repositoryId === source.id || (!!source.path && active.path === source.path));

  return (
    <nav aria-label="Threads" ref={list} onKeyDown={move} {...stylex.props(styles.sidebar)}>
      <div className="med-title-row" {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.grow)} />
        <ToolButton
          label="Hide sidebar"
          shortcut="Mod+B"
          icon="panelLeft"
          aria-label="Hide sidebar"
          onClick={onHide}
        />
      </div>
      <div {...stylex.props(styles.scroll)}>
        {onNewThread && (
          <button
            type="button"
            data-sidebar-row=""
            aria-current={newThread ? "page" : undefined}
            onClick={onNewThread}
            {...stylex.props(styles.row, styles.newRow, newThread && styles.current)}
          >
            <Icon name="plus" size={14} />
            <span {...stylex.props(styles.title)}>New thread</span>
            <ShortcutKeys value="Alt+N" />
          </button>
        )}
        {loaded && !threads.length && (
          <p {...stylex.props(styles.empty)}>
            Threads show here: each agent task, with its changes. Start one, or ask an agent to
            hand off its work with <code {...stylex.props(styles.code)}>med review</code>.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.key} aria-label={group.name} {...stylex.props(styles.group)}>
            <h2 {...stylex.props(ui.label, styles.groupName)}>{group.name}</h2>
            <ul {...stylex.props(styles.list)}>
              {group.threads.map((thread) => {
                const current = thread.id === currentThread;
                const unread = isUnread(thread);
                const branch = thread.branch ?? thread.checkout?.split("/").at(-1);
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      data-sidebar-row=""
                      data-thread={thread.id}
                      aria-current={current ? "page" : undefined}
                      onClick={() =>
                        onOpen({ kind: "review", reviewId: thread.id, title: thread.title })
                      }
                      {...stylex.props(
                        styles.row,
                        styles.thread,
                        current && styles.current,
                        unread && styles.unread,
                      )}
                    >
                      <span {...stylex.props(styles.mark)} aria-hidden="true">
                        {thread.state === "working" ? (
                          <span {...stylex.props(styles.working)} />
                        ) : thread.state === "waiting" ? (
                          <span {...stylex.props(styles.waiting)} />
                        ) : unread ? (
                          <span {...stylex.props(styles.dot)} />
                        ) : (
                          <Icon name={agentIcon(thread.agent)} size={13} />
                        )}
                      </span>
                      <span {...stylex.props(styles.lines)}>
                        <span {...stylex.props(styles.titleLine)}>
                          <span {...stylex.props(styles.title)}>{thread.title}</span>
                          <span
                            {...stylex.props(
                              styles.age,
                              thread.state === "waiting" && styles.needsYou,
                            )}
                          >
                            {thread.state === "working"
                              ? "Working"
                              : thread.state === "waiting"
                                ? "Needs you"
                                : shortAge(thread.updatedAt, now)}
                          </span>
                        </span>
                        <span {...stylex.props(styles.detailLine)}>
                          {branch && <span {...stylex.props(styles.branch)}>{branch}</span>}
                          {thread.changes && thread.changes.files > 0 && (
                            <span {...stylex.props(styles.changes)}>
                              <span {...stylex.props(styles.added)}>
                                +{thread.changes.additions}
                              </span>
                              <span {...stylex.props(styles.removed)}>
                                −{thread.changes.deletions}
                              </span>
                            </span>
                          )}
                        </span>
                      </span>
                      <span {...stylex.props(styles.hidden)}>
                        {thread.state === "working"
                          ? ", working"
                          : thread.state === "waiting"
                            ? ", needs you"
                            : unread
                              ? ", new"
                              : ""}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
      <section aria-label="Repositories" {...stylex.props(styles.sources)}>
        <div {...stylex.props(styles.sourcesHeader)}>
          <h2 {...stylex.props(ui.label, styles.groupName, styles.flush)}>Repositories</h2>
          <ToolButton label="Add or remove repositories" icon="plus" onClick={onSources} />
        </div>
        <ul {...stylex.props(styles.list)}>
          {sources.map((source) => {
            const current = sourceActive(source);
            return (
              <li key={`${source.kind}:${source.id}`}>
                <button
                  type="button"
                  data-sidebar-row=""
                  aria-current={current ? "page" : undefined}
                  onClick={() =>
                    onOpen(
                      source.kind === "vault"
                        ? { kind: "vault", sourceId: source.id, title: source.name }
                        : {
                            kind: "repository",
                            repositoryId: source.id,
                            ...(source.path && { path: source.path }),
                            title: source.name,
                          },
                    )
                  }
                  {...stylex.props(styles.row, styles.source, current && styles.current)}
                >
                  <Icon name={source.kind === "vault" ? "vault" : "gitBranch"} size={14} />
                  <span {...stylex.props(styles.title)}>{source.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </nav>
  );
}

const turn = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const pulse = stylex.keyframes({
  "0%": { boxShadow: `0 0 0 0 color-mix(in srgb, ${tokens.accent} 45%, transparent)` },
  "70%": { boxShadow: `0 0 0 5px color-mix(in srgb, ${tokens.accent} 0%, transparent)` },
  "100%": { boxShadow: `0 0 0 0 color-mix(in srgb, ${tokens.accent} 0%, transparent)` },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  sidebar: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    minHeight: 0,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  // Level with the window controls; the controls sit at its end.
  header: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flexShrink: 0,
    height: "max(var(--med-titlebar-height), 40px)",
    paddingInlineStart: "max(var(--med-titlebar-left), 8px)",
    paddingInlineEnd: 6,
  },
  grow: { flex: "1" },
  scroll: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    paddingInline: 8,
    paddingBottom: 12,
    scrollbarWidth: "thin",
  },
  group: { marginTop: 14 },
  groupName: {
    margin: 0,
    paddingInline: 8,
    paddingBottom: 4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  flush: { paddingBottom: 0 },
  list: { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 1 },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    width: "100%",
    minWidth: 0,
    paddingInline: 8,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 450,
    textAlign: "left",
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    transitionProperty: "background-color, color",
    transitionDuration: "120ms",
  },
  newRow: { height: 32, color: { default: tokens.text, ":hover": tokens.text }, marginTop: 2 },
  thread: { alignItems: "flex-start", paddingBlock: 7 },
  source: { height: 30 },
  current: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
  },
  unread: { color: { default: tokens.text, ":hover": tokens.text } },
  mark: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 14,
    height: 18,
    color: tokens.faint,
  },
  lines: { display: "flex", flexDirection: "column", gap: 2, flex: "1", minWidth: 0 },
  titleLine: { display: "flex", alignItems: "baseline", gap: 8, minWidth: 0, lineHeight: "18px" },
  title: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 12.5,
  },
  age: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
  },
  needsYou: { color: tokens.accent, fontWeight: 500 },
  detailLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    color: tokens.faint,
    fontSize: 11,
    lineHeight: "15px",
  },
  branch: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontFamily: tokens.code,
    fontSize: 10.5,
  },
  changes: {
    display: "inline-flex",
    gap: 4,
    flexShrink: 0,
    marginInlineStart: "auto",
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  added: { color: tokens.green },
  removed: { color: tokens.red },
  dot: { width: 7, height: 7, borderRadius: "50%", backgroundColor: tokens.accent },
  waiting: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "2s",
    animationIterationCount: "infinite",
  },
  working: {
    boxSizing: "border-box",
    width: 11,
    height: 11,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.text,
    animationName: { default: turn, [reduced]: "none" },
    animationDuration: "900ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
  empty: {
    marginBlock: 16,
    marginInline: 8,
    color: tokens.faint,
    fontSize: 12,
    lineHeight: 1.55,
  },
  code: { fontFamily: tokens.code, fontSize: 11 },
  sources: {
    flexShrink: 0,
    paddingInline: 8,
    paddingTop: 8,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    maxHeight: "40%",
    overflowY: "auto",
  },
  sourcesHeader: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInlineStart: 0,
    marginBottom: 2,
  },
});
