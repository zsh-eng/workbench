import { ContextMenu } from "@base-ui/react/context-menu";
import * as stylex from "@stylexjs/stylex";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Thread } from "../../../shared/threads";
import { groupThreads, shortAge } from "../../data/threads";
import {
  lazygitCommand,
  resumeCommand,
  type WorkspaceInput,
  type WorkspaceSnapshot,
} from "../../data/workspaces";
import { picked, tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { ShortcutKeys } from "../ShortcutKeys";
import { ToolButton } from "../ToolButton";

const SEEN_KEY = "med:thread-seen";
const SINCE_KEY = "med:thread-seen-since";
const SOURCES_KEY = "med:sidebar-sources";

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
  // The shown thread is seen as it changes.
  const shown = threads.find((thread) => thread.id === current);
  if (shown && (seen[shown.id] ?? 0) < shown.updatedAt) {
    const next = { ...seen, [shown.id]: shown.updatedAt };
    // Forget threads the host no longer keeps.
    for (const id of Object.keys(next))
      if (!threads.some((thread) => thread.id === id)) delete next[id];
    setSeen(next);
  }
  useEffect(() => writeJson(SEEN_KEY, seen), [seen]);
  const isUnread = (thread: Thread) =>
    thread.id !== current &&
    thread.state !== "working" &&
    thread.updatedAt > (seen[thread.id] ?? since);
  const setUnread = (thread: Thread, unread: boolean) =>
    setSeen((value) => ({
      ...value,
      [thread.id]: unread ? thread.updatedAt - 1 : thread.updatedAt,
    }));
  return { isUnread, setUnread };
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
  onArchive,
  onPrefetch,
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
  /** Archives the thread or brings it back; it can remove the thread's worktree. */
  onArchive?(thread: Thread, archived: boolean, removeWorktree: boolean): Promise<void>;
  /** Reads a thread ahead of a click, such as while the pointer rests on it. */
  onPrefetch?(thread: Thread): void;
}) {
  const active = newThread
    ? undefined
    : snapshot.workspaces.find((entry) => entry.id === snapshot.active);
  const currentThread = !newThread && active?.kind === "review" ? active.reviewId : null;
  const { isUnread, setUnread } = useUnread(threads, currentThread);
  // An archived thread leaves at once; Undo brings it back.
  const [archiving, setArchiving] = useState<ReadonlySet<string>>(new Set());
  const [notice, setNotice] = useState<{
    thread: Thread;
    text: string;
    undo?: boolean;
  } | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.undo ? 6000 : 8000);
    return () => clearTimeout(timer);
  }, [notice]);
  const listed = useMemo(
    () => (archiving.size ? threads.filter((thread) => !archiving.has(thread.id)) : threads),
    [threads, archiving],
  );
  const groups = useMemo(() => groupThreads(listed), [listed]);
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (thread: Thread, text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(thread.id));
  };
  const archive = (thread: Thread, removeWorktree: boolean) => {
    if (!onArchive) return;
    setArchiving((value) => new Set(value).add(thread.id));
    setNotice(null);
    onArchive(thread, true, removeWorktree).then(
      () =>
        setNotice({
          thread,
          text: removeWorktree ? "Archived; removed its worktree" : "Archived",
          undo: true,
        }),
      (error: unknown) => {
        setArchiving((value) => {
          const next = new Set(value);
          next.delete(thread.id);
          return next;
        });
        setNotice({
          thread,
          text: `Kept "${thread.title}". ${error instanceof Error ? error.message : ""}`.trim(),
        });
      },
    );
  };
  const restore = (thread: Thread) => {
    setNotice(null);
    void onArchive?.(thread, false, false).then(() =>
      setArchiving((value) => {
        const next = new Set(value);
        next.delete(thread.id);
        return next;
      }),
    );
  };
  // Forget threads once the host no longer lists them.
  if (archiving.size && [...archiving].some((id) => !threads.some((thread) => thread.id === id)))
    setArchiving(
      new Set([...archiving].filter((id) => threads.some((thread) => thread.id === id))),
    );
  // Ages move while the list shows.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const [sourcesOpen, setSourcesOpen] = useState(() => readJson(SOURCES_KEY, false));
  const toggleSources = () =>
    setSourcesOpen((open) => {
      writeJson(SOURCES_KEY, !open);
      return !open;
    });
  const list = useRef<HTMLElement>(null);
  // ↑ and ↓ move between rows, as in a menu; Home and End go to the ends.
  useEffect(() => {
    const nav = list.current;
    if (!nav) return;
    const move = (event: KeyboardEvent) => {
      const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
      if (!keys.includes(event.key) || event.altKey || event.metaKey || event.ctrlKey) return;
      const rows = [...nav.querySelectorAll<HTMLElement>("[data-sidebar-row]")];
      const index = rows.indexOf(document.activeElement as HTMLElement);
      if (index < 0) return;
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? rows.length - 1
            : Math.max(0, Math.min(rows.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      rows[next]?.focus();
      event.preventDefault();
    };
    nav.addEventListener("keydown", move);
    return () => nav.removeEventListener("keydown", move);
  }, []);

  const sourceActive = (source: SidebarSource) =>
    source.kind === "vault"
      ? active?.kind === "vault" && active.sourceId === source.id
      : active?.kind === "repository" &&
        (active.repositoryId === source.id || (!!source.path && active.path === source.path));

  return (
    <nav aria-label="Threads" ref={list} {...stylex.props(styles.sidebar)}>
      <div className={`med-title-row ${stylex.props(styles.header).className ?? ""}`}>
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
            Threads show here: each agent task, with its changes. Start one, or ask an agent to hand
            off its work with <code {...stylex.props(styles.code)}>med review</code>.
          </p>
        )}
        {groups.map((group) => (
          <section key={group.key} aria-label={group.name} {...stylex.props(styles.group)}>
            <h2 {...stylex.props(ui.label, styles.groupName)}>{group.name}</h2>
            <ul {...stylex.props(styles.list)}>
              {group.threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  current={thread.id === currentThread}
                  unread={isUnread(thread)}
                  copied={copied === thread.id}
                  now={now}
                  onOpen={() =>
                    onOpen({ kind: "review", reviewId: thread.id, title: thread.title })
                  }
                  onCopy={(text) => copy(thread, text)}
                  onUnread={(unread) => setUnread(thread, unread)}
                  onArchive={onArchive && ((removeWorktree) => archive(thread, removeWorktree))}
                  onPrefetch={onPrefetch && (() => onPrefetch(thread))}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>
      {notice && (
        <div
          role={notice.undo ? "status" : "alert"}
          {...stylex.props(styles.notice, !notice.undo && styles.problem)}
        >
          <span {...stylex.props(styles.noticeText)}>{notice.text}</span>
          {notice.undo && (
            <button
              type="button"
              onClick={() => restore(notice.thread)}
              {...stylex.props(styles.undo)}
            >
              Undo
            </button>
          )}
        </div>
      )}
      <section aria-label="Repositories" {...stylex.props(styles.sources)}>
        <div {...stylex.props(styles.sourcesHeader)}>
          <button
            type="button"
            aria-expanded={sourcesOpen}
            onClick={toggleSources}
            {...stylex.props(styles.sourcesToggle)}
          >
            <span {...stylex.props(styles.chevron, sourcesOpen && styles.chevronOpen)}>
              <Icon name="chevron" size={12} />
            </span>
            <span {...stylex.props(ui.label)}>Repositories</span>
            <span {...stylex.props(styles.count)}>{sources.length}</span>
          </button>
          <ToolButton label="Add or remove repositories" icon="plus" onClick={onSources} />
        </div>
        {sourcesOpen && (
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
        )}
      </section>
    </nav>
  );
}

const agentNames = { claude: "Claude Code", codex: "Codex" } as const;

/** A thread's row, with its right-click menu: resume its agent in a terminal,
 * mark it read or unread, or archive it, with the worktree Med made for it. */
function ThreadRow({
  thread,
  current,
  unread,
  copied,
  now,
  onOpen,
  onCopy,
  onUnread,
  onArchive,
  onPrefetch,
}: {
  thread: Thread;
  current: boolean;
  unread: boolean;
  copied: boolean;
  now: number;
  onOpen(): void;
  onCopy(text: string): void;
  onUnread(unread: boolean): void;
  onArchive?(removeWorktree: boolean): void;
  onPrefetch?(): void;
}) {
  // A pointer that rests on the row, or a press, reads the thread ahead.
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(rest.current), []);
  const branch = thread.branch ?? thread.checkout?.split("/").at(-1);
  const sessions = (thread.sessions ?? []).flatMap((session) =>
    session.agent === "acp" ? [] : [{ ...session, agent: session.agent }],
  );
  const item = (state: { highlighted: boolean }) =>
    stylex.props(ui.menuItem, state.highlighted && [ui.menuHighlighted, picked]).className;
  const busy = thread.state === "working";
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={<li />}>
        <button
          type="button"
          data-sidebar-row=""
          data-thread={thread.id}
          aria-current={current ? "page" : undefined}
          onClick={onOpen}
          onPointerEnter={() => {
            if (current || !onPrefetch) return;
            clearTimeout(rest.current);
            rest.current = setTimeout(onPrefetch, 60);
          }}
          onPointerLeave={() => clearTimeout(rest.current)}
          onPointerDown={() => !current && onPrefetch?.()}
          onFocus={() => !current && onPrefetch?.()}
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
            ) : thread.agent ? (
              <Icon name={agentIcon(thread.agent)} size={13} />
            ) : null}
          </span>
          <span {...stylex.props(styles.lines)}>
            <span {...stylex.props(styles.titleLine)}>
              <span {...stylex.props(styles.title)}>{thread.title}</span>
              {copied ? (
                <span role="status" {...stylex.props(styles.age)}>
                  Copied
                </span>
              ) : (
                <span {...stylex.props(styles.age, thread.state === "waiting" && styles.needsYou)}>
                  {thread.state === "working"
                    ? "Working"
                    : thread.state === "waiting"
                      ? "Needs you"
                      : shortAge(thread.updatedAt, now)}
                </span>
              )}
            </span>
            <span {...stylex.props(styles.detailLine)}>
              {branch && <span {...stylex.props(styles.branch)}>{branch}</span>}
              {thread.changes && thread.changes.files > 0 && (
                <span {...stylex.props(styles.changes)}>
                  <span {...stylex.props(styles.added)}>+{thread.changes.additions}</span>
                  <span {...stylex.props(styles.removed)}>−{thread.changes.deletions}</span>
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
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner {...stylex.props(styles.menuPositioner)}>
          <ContextMenu.Popup
            aria-label={`${thread.title} actions`}
            {...stylex.props(ui.popup, styles.menu)}
          >
            <ContextMenu.Item onClick={onOpen} className={item}>
              Open
            </ContextMenu.Item>
            {(sessions.length > 0 || thread.checkout) && (
              <ContextMenu.Separator {...stylex.props(styles.separator)} />
            )}
            {[...sessions].reverse().map((session) => (
              <ContextMenu.Item
                key={`${session.agent}:${session.id}`}
                onClick={() => onCopy(resumeCommand(session))}
                className={item}
              >
                <span {...stylex.props(styles.menuLabel)}>
                  <Icon name={session.agent} size={13} />
                  Copy {agentNames[session.agent]} resume command
                </span>
                <span {...stylex.props(styles.menuHint)}>{session.id.slice(0, 8)}</span>
              </ContextMenu.Item>
            ))}
            {thread.checkout && (
              <ContextMenu.Item
                onClick={() => onCopy(lazygitCommand(thread.checkout!))}
                className={item}
              >
                <span {...stylex.props(styles.menuLabel)}>
                  <Icon name="command" size={13} />
                  Copy lazygit command
                </span>
              </ContextMenu.Item>
            )}
            <ContextMenu.Separator {...stylex.props(styles.separator)} />
            <ContextMenu.Item onClick={() => onUnread(!unread)} className={item}>
              {unread ? "Mark as read" : "Mark as unread"}
            </ContextMenu.Item>
            {onArchive && (
              <ContextMenu.Item onClick={() => onArchive(false)} className={item}>
                Archive
              </ContextMenu.Item>
            )}
            {onArchive && thread.linked && (
              <ContextMenu.Item disabled={busy} onClick={() => onArchive(true)} className={item}>
                Archive and remove worktree
                <span {...stylex.props(styles.menuHint)}>{thread.checkout?.split("/").at(-1)}</span>
              </ContextMenu.Item>
            )}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
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
  list: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 1,
  },
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
  menuPositioner: { zIndex: 60 },
  menu: { minWidth: 240 },
  menuLabel: { display: "inline-flex", alignItems: "center", gap: 8 },
  menuHint: {
    marginInlineStart: "auto",
    paddingInlineStart: 16,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
  },
  separator: { height: 1, marginBlock: 4, marginInline: 4, backgroundColor: tokens.line },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
    marginInline: 8,
    marginBottom: 8,
    paddingBlock: 7,
    paddingInline: 10,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontSize: 12,
    lineHeight: 1.45,
  },
  problem: { color: tokens.text },
  noticeText: { flex: "1", minWidth: 0 },
  undo: {
    flexShrink: 0,
    paddingInline: 6,
    height: 22,
    borderWidth: 0,
    borderRadius: tokens.buttonRound,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 500,
    cursor: "pointer",
  },
  sources: {
    flexShrink: 0,
    paddingInline: 8,
    paddingTop: 6,
    paddingBottom: 8,
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
    gap: 4,
  },
  sourcesToggle: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flex: "1",
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
});
