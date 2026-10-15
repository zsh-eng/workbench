import { ContextMenu } from "@base-ui/react/context-menu";
import * as stylex from "@stylexjs/stylex";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
  type SyntheticEvent,
} from "react";
import type { Thread, ThreadSubagent } from "../../../shared/threads";
import { useAttemptsAddress } from "../../data/attempts";
import { foundSessionThread, threadInput } from "../../data/found-threads";
import { shownSubagents, type ReadState } from "../../data/tabs";
import { groupThreads, needsYou, shortAge } from "../../data/threads";
import {
  lazygitCommand,
  resumeCommand,
  type WorkspaceInput,
  type WorkspaceSnapshot,
} from "../../data/workspaces";
import { picked, tokens, ui } from "../../theme.stylex";
import { withAttempts } from "../attempts/AttemptGroupRow";
import { Icon, type IconName } from "../Icon";
import { ShortcutKeys } from "../ShortcutKeys";
import { ToolButton } from "../ToolButton";

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
    /* The choice lasts for this page. */
  }
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

/** A short message about the tabs, such as a closed tab with Undo. */
export interface TabNotice {
  text: string;
  actions?: { label: string; run(): void }[];
  /** Something failed; it shows longer, as an alert. */
  problem?: boolean;
  /** A question: it stays until the reader answers. */
  stays?: boolean;
}

/** The notice in the sidebar, or over the workspace while the sidebar hides. */
export function NoticeBar({
  notice,
  onDismiss,
  floating = false,
}: {
  notice: TabNotice;
  onDismiss(): void;
  floating?: boolean;
}) {
  return (
    <div
      role={notice.problem ? "alert" : "status"}
      {...stylex.props(
        styles.notice,
        notice.problem && styles.problem,
        floating && styles.floating,
      )}
    >
      <span {...stylex.props(styles.noticeText)}>{notice.text}</span>
      {notice.actions?.map((action) => (
        <button
          key={action.label}
          type="button"
          onClick={action.run}
          {...stylex.props(styles.undo)}
        >
          {action.label}
        </button>
      ))}
      {!notice.actions?.length && floating && (
        <button type="button" onClick={onDismiss} {...stylex.props(styles.undo)}>
          OK
        </button>
      )}
    </div>
  );
}

const noRead: ReadState = {
  isUnread: () => false,
  setUnread: () => {},
  isSubagentUnread: () => false,
  seeSubagent: () => {},
};

/**
 * The window's sidebar: the tabs, grouped by repository in the reader's
 * order, and the repositories and vaults to browse without a thread. A tab
 * keeps its place when its agent's state changes; the reader moves it by
 * drag or ⌥↑ and ⌥↓. Closed threads are history: ⌃Tab and the palette find
 * them. Above the tabs, a line counts those that need the reader and those
 * that work; under a tab, its subagents that work or have news.
 */
export function ThreadSidebar({
  threads,
  sources,
  snapshot,
  loaded,
  current: shownThread,
  read = noRead,
  notice,
  onOpen,
  onOpenThread,
  onOpenSubagent,
  onNewThread,
  newThread = false,
  onHide,
  onSources,
  onClose,
  onDelete,
  onReorder,
  onMove,
  onNext,
  onPrefetch,
}: {
  /** The tabs, in the reader's order. */
  threads: readonly Thread[];
  sources: readonly SidebarSource[];
  snapshot: WorkspaceSnapshot;
  loaded: boolean;
  /** The thread on screen; without it, the active workspace's. */
  current?: string | null;
  read?: ReadState;
  /** The tabs' notice, such as a closed tab with Undo. */
  notice?: ReactNode;
  /** The New thread view shows. */
  newThread?: boolean;
  onOpen(input: WorkspaceInput): void;
  onOpenThread?(thread: Thread): void;
  onOpenSubagent?(thread: Thread, subagent: ThreadSubagent): void;
  onNewThread?(): void;
  onHide(): void;
  onSources(): void;
  /** Sends the tab to history; it can remove the thread's worktree. */
  onClose?(thread: Thread, removeWorktree: boolean): void;
  /** Asks to delete the thread for good. */
  onDelete?(thread: Thread): void;
  /** Puts one repository's tabs in this order. */
  onReorder?(ids: readonly string[]): void;
  onMove?(thread: Thread, by: -1 | 1): void;
  /** Shows the next tab that needs the reader, or the next that works. */
  onNext?(kind: "needs" | "working"): void;
  /** Reads a thread ahead of a click, such as while the pointer rests on it. */
  onPrefetch?(thread: Thread): void;
}) {
  const active = newThread
    ? undefined
    : snapshot.workspaces.find((entry) => entry.id === snapshot.active);
  // The Attempts page covers the workspace, so no thread row is current.
  const attemptsPage = useAttemptsAddress();
  const currentThread =
    shownThread !== undefined
      ? shownThread
      : newThread || attemptsPage
        ? null
        : active?.kind === "review"
          ? active.reviewId
          : active?.kind === "repository" && active.found
            ? foundSessionThread(active.found)
            : null;
  const groups = useMemo(() => groupThreads(threads), [threads]);
  const needs = threads.filter(needsYou).length;
  const working = threads.filter(
    (thread) => thread.state === "working" && !needsYou(thread),
  ).length;
  const openThread = (thread: Thread) =>
    onOpenThread ? onOpenThread(thread) : onOpen(threadInput(thread));
  const [copied, setCopied] = useState<string | null>(null);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(null), 1600);
    return () => clearTimeout(timer);
  }, [copied]);
  const copy = (thread: Thread, text: string) => {
    void navigator.clipboard.writeText(text).then(() => setCopied(thread.id));
  };
  // Ages move while the list shows.
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // A drag moves a tab within its repository; a line shows where it lands.
  const [drag, setDrag] = useState<{ id: string; group: string } | null>(null);
  const [drop, setDrop] = useState<{ id: string; after: boolean } | null>(null);
  const endDrag = () => {
    setDrag(null);
    setDrop(null);
  };
  const dropOn = (group: { key: string; threads: Thread[] }, target: string, after: boolean) => {
    if (!drag || drag.group !== group.key || drag.id === target) return endDrag();
    const ids = group.threads.map((thread) => thread.id).filter((id) => id !== drag.id);
    ids.splice(ids.indexOf(target) + (after ? 1 : 0), 0, drag.id);
    onReorder?.(ids);
    endDrag();
  };
  // ⌥↑ and ⌥↓ move the focused tab; it keeps the focus at its new place.
  const move = (thread: Thread, by: -1 | 1) => {
    onMove?.(thread, by);
    requestAnimationFrame(() =>
      list.current
        ?.querySelector<HTMLElement>(`[data-thread="${CSS.escape(thread.id)}"]`)
        ?.focus({ preventScroll: false }),
    );
  };
  // The rows share one object of actions that reads the newest props, so a
  // row renders again only when its own thread or state changes.
  const handlers = {
    openThread,
    onOpenSubagent,
    onClose,
    onPrefetch,
    move,
    drag,
    drop,
    dropOn,
    groups,
  };
  const latest = useRef(handlers);
  useLayoutEffect(() => {
    latest.current = handlers;
  });
  const [actions] = useState<RowActions>(() => ({
    open: (thread) => latest.current.openThread(thread),
    openSubagent: (thread, subagent) => latest.current.onOpenSubagent?.(thread, subagent),
    close: (thread, removeWorktree) => latest.current.onClose?.(thread, removeWorktree),
    move: (thread, by) => latest.current.move(thread, by),
    prefetch: (thread) => latest.current.onPrefetch?.(thread),
    dragStart: (thread, group) => setDrag({ id: thread.id, group }),
    dragOver: (thread, group, after) => {
      const { drag, drop } = latest.current;
      if (!drag || drag.group !== group || drag.id === thread.id) return false;
      if (drop?.id !== thread.id || drop.after !== after) setDrop({ id: thread.id, after });
      return true;
    },
    drop: (thread, key, after) => {
      const { groups, dropOn } = latest.current;
      const group = groups.find((entry) => entry.key === key);
      if (group) dropOn(group, thread.id, after);
      else endDrag();
    },
    dragEnd: () => endDrag(),
  }));

  // One right-click menu serves all tabs: it opens for the tab under the
  // pointer, or the focused one for the menu key.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const located = useRef<string | null>(null);
  const locate = (event: SyntheticEvent) => {
    const row = (event.target as Element).closest?.("[data-thread-row]");
    located.current = row?.getAttribute("data-thread-row") ?? null;
    if (located.current) setMenuFor(located.current);
  };
  const menuThread = menuFor ? threads.find((thread) => thread.id === menuFor) : undefined;
  if (menuOpen && !menuThread) setMenuOpen(false);

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
    const step = (event: KeyboardEvent) => {
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
    nav.addEventListener("keydown", step);
    return () => nav.removeEventListener("keydown", step);
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
      <ContextMenu.Root
        open={menuOpen}
        onOpenChange={(open) => setMenuOpen(open && !!located.current)}
      >
        <ContextMenu.Trigger
          render={<div />}
          {...stylex.props(styles.scroll)}
          onContextMenuCapture={locate}
          onTouchStartCapture={locate}
        >
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
          {(needs > 0 || working > 0) && (
            <div role="group" aria-label="Tabs at work" {...stylex.props(styles.counts)}>
              {needs > 0 && (
                <button
                  type="button"
                  title="Show the next tab that needs you (⌘0)"
                  onClick={() => onNext?.("needs")}
                  {...stylex.props(styles.count, styles.countNeeds)}
                >
                  {needs} needs you
                </button>
              )}
              {needs > 0 && working > 0 && <span aria-hidden="true">·</span>}
              {working > 0 && (
                <button
                  type="button"
                  title="Show the next tab that works"
                  onClick={() => onNext?.("working")}
                  {...stylex.props(styles.count)}
                >
                  {working} working
                </button>
              )}
            </div>
          )}
          {loaded && !threads.length && (
            <p {...stylex.props(styles.empty)}>
              Tabs show here: each agent task that you have open, with its changes. Start one, or
              ask an agent to hand off its work with{" "}
              <code {...stylex.props(styles.code)}>med review</code>. ⌃Tab finds closed ones.
            </p>
          )}
          {groups.map((group) => {
            const row = (thread: Thread, name?: string) => {
              const subagents = shownSubagents(thread, read);
              return (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  name={name}
                  group={group.key}
                  current={thread.id === currentThread}
                  unread={read.isUnread(thread)}
                  copied={copied === thread.id}
                  now={now}
                  subagents={subagents}
                  fresh={subagents
                    .filter((subagent) => read.isSubagentUnread(subagent))
                    .map((subagent) => subagent.id)
                    .join(" ")}
                  drop={drop?.id === thread.id ? (drop.after ? "after" : "before") : undefined}
                  closable={!!onClose}
                  movable={!!onMove}
                  draggable={!!onReorder}
                  // A found session has no saved review to read ahead.
                  prefetch={!!onPrefetch && !thread.found}
                  actions={actions}
                />
              );
            };
            return (
              <section key={group.key} aria-label={group.name} {...stylex.props(styles.group)}>
                <h2 {...stylex.props(ui.label, styles.groupName)}>{group.name}</h2>
                <ul {...stylex.props(styles.list)}>
                  {withAttempts(group.threads, row, { current: currentThread, now })}
                </ul>
              </section>
            );
          })}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner {...stylex.props(styles.menuPositioner)}>
            {menuThread && (
              <ThreadMenu
                thread={menuThread}
                unread={read.isUnread(menuThread)}
                onOpen={() => openThread(menuThread)}
                onCopy={(text) => copy(menuThread, text)}
                onUnread={(unread) => read.setUnread(menuThread, unread)}
                onClose={onClose && ((removeWorktree) => onClose(menuThread, removeWorktree))}
                onDelete={onDelete && (() => onDelete(menuThread))}
              />
            )}
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {notice}
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
            <span {...stylex.props(styles.sourceCount)}>{sources.length}</span>
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

/** What the rows do: one object for all rows, so that a row renders again
 * only when its own thread or state changes. */
interface RowActions {
  open(thread: Thread): void;
  openSubagent(thread: Thread, subagent: ThreadSubagent): void;
  close(thread: Thread, removeWorktree: boolean): void;
  move(thread: Thread, by: -1 | 1): void;
  prefetch(thread: Thread): void;
  dragStart(thread: Thread, group: string): void;
  /** Whether the dragged tab can land here. */
  dragOver(thread: Thread, group: string, after: boolean): boolean;
  drop(thread: Thread, group: string, after: boolean): void;
  dragEnd(): void;
}

interface RowProps {
  thread: Thread;
  /** In place of the title, such as an attempt's letter and agent. */
  name?: string;
  /** The repository group, in which a drag moves the tab. */
  group: string;
  current: boolean;
  unread: boolean;
  copied: boolean;
  now: number;
  subagents: readonly ThreadSubagent[];
  /** The IDs of subagents with results that the reader has not seen. */
  fresh: string;
  /** A dragged tab lands before or after this one. */
  drop?: "before" | "after";
  closable: boolean;
  movable: boolean;
  draggable: boolean;
  /** A pointer that rests on the row, or a press, reads the thread ahead. */
  prefetch: boolean;
  actions: RowActions;
}

/** Rows are equal when their props are, with the subagents by element. */
const sameRow = (before: RowProps, after: RowProps) => {
  const keys = Object.keys(after) as (keyof RowProps)[];
  return (
    keys.length === Object.keys(before).length &&
    keys.every((key) =>
      key === "subagents"
        ? before.subagents.length === after.subagents.length &&
          before.subagents.every((subagent, index) => subagent === after.subagents[index])
        : Object.is(before[key], after[key]),
    )
  );
};

/** A tab's row, with its subagents under it. Its right-click menu is the
 * sidebar's (ThreadMenu). */
const ThreadRow = memo(function ThreadRow({
  thread,
  name,
  group,
  current,
  unread,
  copied,
  now,
  subagents,
  fresh,
  drop,
  closable,
  movable,
  draggable,
  prefetch,
  actions,
}: RowProps) {
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(rest.current), []);
  const branch = thread.branch ?? thread.checkout?.split("/").at(-1);
  const busy = thread.state === "working";
  const asking = needsYou(thread);
  // A turn that runs shows what it does now in place of its branch, unless
  // that is a subagent's task, which its own row shows.
  const doing = busy && !asking ? thread.turn?.activity : undefined;
  const activity =
    doing && !subagents.some((subagent) => doing.includes(subagent.description))
      ? doing
      : undefined;
  const after = (event: DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    return event.clientY > box.top + box.height / 2;
  };
  const read = () => !current && prefetch && actions.prefetch(thread);
  return (
    <li
      data-thread-row={thread.id}
      {...stylex.props(
        styles.item,
        drop === "before" && styles.dropBefore,
        drop === "after" && styles.dropAfter,
        stylex.defaultMarker(),
      )}
    >
      <button
        type="button"
        data-sidebar-row=""
        data-thread={thread.id}
        data-found={thread.found || undefined}
        aria-current={current ? "page" : undefined}
        aria-keyshortcuts={movable ? "Alt+ArrowUp Alt+ArrowDown" : undefined}
        draggable={draggable}
        onDragStart={(event) => {
          if (!draggable) return;
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", thread.title);
          actions.dragStart(thread, group);
        }}
        onDragOver={(event) => {
          if (draggable && actions.dragOver(thread, group, after(event))) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (draggable) actions.drop(thread, group, after(event));
        }}
        onDragEnd={() => draggable && actions.dragEnd()}
        onClick={() => actions.open(thread)}
        onKeyDown={(event) => {
          if (!movable || !event.altKey || event.metaKey || event.ctrlKey || event.shiftKey) return;
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          actions.move(thread, event.key === "ArrowUp" ? -1 : 1);
        }}
        onPointerEnter={() => {
          if (current || !prefetch) return;
          clearTimeout(rest.current);
          rest.current = setTimeout(read, 60);
        }}
        onPointerLeave={() => clearTimeout(rest.current)}
        onPointerDown={read}
        onFocus={read}
        {...stylex.props(styles.row, styles.thread, current && styles.current)}
      >
        <span {...stylex.props(styles.mark)} aria-hidden="true">
          {asking ? (
            <span {...stylex.props(styles.dot, thread.state === "waiting" && styles.waiting)}>
              {thread.state === "waiting" && <span {...stylex.props(styles.pulse)} />}
            </span>
          ) : (
            <Icon name={agentIcon(thread.agent)} size={13} />
          )}
        </span>
        <span {...stylex.props(styles.lines)}>
          <span {...stylex.props(styles.titleLine)}>
            <span
              {...stylex.props(
                styles.title,
                busy && !asking && styles.busy,
                unread && styles.unread,
                asking && styles.asking,
              )}
            >
              {name ?? thread.title}
            </span>
            {copied ? (
              <span role="status" {...stylex.props(styles.age)}>
                Copied
              </span>
            ) : (
              (asking || !busy) && (
                <span
                  {...stylex.props(
                    styles.age,
                    asking && styles.needsYou,
                    closable && styles.ageHides,
                  )}
                >
                  {asking ? "Needs you" : shortAge(thread.updatedAt, now)}
                </span>
              )
            )}
          </span>
          <span {...stylex.props(styles.detailLine)}>
            {activity ? (
              <span title={activity} {...stylex.props(styles.activity)}>
                {activity}
              </span>
            ) : (
              branch && <span {...stylex.props(styles.branch)}>{branch}</span>
            )}
            {thread.changes && thread.changes.files > 0 && (
              <span {...stylex.props(styles.changes)}>
                <span {...stylex.props(styles.added)}>+{thread.changes.additions}</span>
                <span {...stylex.props(styles.removed)}>−{thread.changes.deletions}</span>
              </span>
            )}
          </span>
        </span>
        <span {...stylex.props(styles.hidden)}>
          {asking ? ", needs you" : busy ? ", working" : unread ? ", new" : ""}
        </span>
      </button>
      {closable && (
        <button
          type="button"
          aria-label={`Close ${thread.title}`}
          title="Close tab (⌘⌥W)"
          onClick={() => actions.close(thread, false)}
          {...stylex.props(styles.close)}
        >
          <Icon name="close" size={12} />
        </button>
      )}
      {subagents.length > 0 && (
        <ul aria-label={`${thread.title} subagents`} {...stylex.props(styles.subagents)}>
          {subagents.map((subagent) => {
            const working = subagent.state === "working";
            const done = !working && fresh.split(" ").includes(subagent.id);
            return (
              <li key={subagent.id}>
                <button
                  type="button"
                  data-sidebar-row=""
                  data-subagent={subagent.id}
                  onClick={() => actions.openSubagent(thread, subagent)}
                  {...stylex.props(styles.row, styles.subagent)}
                >
                  <span {...stylex.props(styles.lines, styles.subagentLines)}>
                    <span
                      {...stylex.props(
                        styles.subagentName,
                        working && styles.busy,
                        done && styles.unread,
                      )}
                    >
                      {subagent.description}
                    </span>
                    {working ? (
                      <span
                        title={subagent.activity}
                        {...stylex.props(styles.subagentActivity, styles.activity)}
                      >
                        {subagent.activity ?? "Working"}
                      </span>
                    ) : (
                      <span aria-hidden="true" {...stylex.props(styles.subagentActivity)}>
                        Done · {shortAge(subagent.updatedAt, now)}
                      </span>
                    )}
                  </span>
                  <span {...stylex.props(styles.hidden)}>
                    {working ? ", working" : done ? ", done" : ""}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}, sameRow);

/** A tab's right-click menu: resume its agent in a terminal, mark it read or
 * unread, close it, with the worktree Med made for it, or delete it. */
function ThreadMenu({
  thread,
  unread,
  onOpen,
  onCopy,
  onUnread,
  onClose,
  onDelete,
}: {
  thread: Thread;
  unread: boolean;
  onOpen(): void;
  onCopy(text: string): void;
  onUnread(unread: boolean): void;
  onClose?(removeWorktree: boolean): void;
  onDelete?(): void;
}) {
  const sessions = (thread.sessions ?? []).flatMap((session) =>
    session.agent === "acp" ? [] : [{ ...session, agent: session.agent }],
  );
  const item = (state: { highlighted: boolean }) =>
    stylex.props(ui.menuItem, state.highlighted && [ui.menuHighlighted, picked]).className;
  return (
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
        <ContextMenu.Item onClick={() => onCopy(lazygitCommand(thread.checkout!))} className={item}>
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
      {onClose && (
        <ContextMenu.Item onClick={() => onClose(false)} className={item}>
          Close tab
          <span {...stylex.props(styles.menuHint)}>⌘⌥W</span>
        </ContextMenu.Item>
      )}
      {onClose && thread.linked && !thread.found && (
        <ContextMenu.Item
          disabled={thread.state === "working"}
          onClick={() => onClose(true)}
          className={item}
        >
          Close and remove worktree
          <span {...stylex.props(styles.menuHint)}>{thread.checkout?.split("/").at(-1)}</span>
        </ContextMenu.Item>
      )}
      {onDelete && (
        <ContextMenu.Item onClick={onDelete} className={item}>
          Delete…
        </ContextMenu.Item>
      )}
    </ContextMenu.Popup>
  );
}

// The 7 px dot's ring grows by 5 px on each side: 17 / 7.
const pulse = stylex.keyframes({
  "0%": { transform: "scale(1)", opacity: 1 },
  "70%": { transform: "scale(2.43)", opacity: 0 },
  "100%": { transform: "scale(1)", opacity: 0 },
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
  // A tab's row holds its close control and its subagents.
  item: { position: "relative" },
  // Where a dragged tab lands: a line above or below the row.
  dropBefore: { boxShadow: `inset 0 2px 0 ${tokens.accent}` },
  dropAfter: { boxShadow: `inset 0 -2px 0 ${tokens.accent}` },
  current: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.pick, ":hover": tokens.pick },
  },
  // While its agent works, a tab's title is dim; a result not seen yet is bold.
  busy: { color: { default: tokens.faint, ":hover": tokens.muted } },
  unread: { color: { default: tokens.text, ":hover": tokens.text }, fontWeight: 600 },
  asking: { color: tokens.text },
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
  // The close control takes the age's place while the row is hovered.
  ageHides: {
    opacity: {
      default: 1,
      [stylex.when.ancestor(":hover")]: 0,
      [stylex.when.ancestor(":focus-within")]: 0,
    },
  },
  close: {
    position: "absolute",
    insetInlineEnd: 6,
    top: 7,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    opacity: {
      default: 0,
      ":focus-visible": 1,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  subagents: {
    listStyle: "none",
    margin: 0,
    padding: 0,
    display: "flex",
    flexDirection: "column",
    gap: 1,
    paddingBottom: 2,
  },
  // Under the tab's title, two lines each, as a tab has: the task, then what
  // it does now, or when it finished. A finished subagent keeps its height.
  subagent: {
    paddingBlock: 4,
    paddingInlineStart: 31,
    fontSize: 12,
  },
  subagentLines: { gap: 1 },
  subagentName: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    lineHeight: "16px",
  },
  subagentActivity: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 11,
    fontWeight: 450,
    lineHeight: "14px",
  },
  // Above the tabs: how many need the reader, and how many work.
  counts: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginTop: 10,
    paddingInline: 8,
    color: tokens.faint,
    fontSize: 11.5,
  },
  count: {
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    cursor: "pointer",
    textDecorationLine: { default: "none", ":hover": "underline" },
    textUnderlineOffset: 3,
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    borderRadius: 3,
  },
  countNeeds: { color: { default: tokens.accent, ":hover": tokens.accent }, fontWeight: 500 },
  detailLine: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    color: tokens.faint,
    fontSize: 11,
    lineHeight: "15px",
  },
  activity: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
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
  waiting: { position: "relative", isolation: "isolate" },
  // A disc behind the dot grows and fades: transform and opacity only, which
  // the compositor runs without a style recalculation in each frame.
  pulse: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    borderRadius: "50%",
    backgroundColor: `color-mix(in srgb, ${tokens.accent} 45%, transparent)`,
    opacity: 0,
    animationName: { default: pulse, [reduced]: "none" },
    animationDuration: "2s",
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
  // While the sidebar hides, the notice shows over the workspace.
  floating: {
    position: "absolute",
    zIndex: 30,
    left: 12,
    bottom: 12,
    maxWidth: "min(380px, calc(100% - 24px))",
    marginInline: 0,
    marginBottom: 0,
    boxShadow: `0 0 0 1px ${tokens.line}, ${tokens.shadow}`,
  },
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
  sourceCount: { color: tokens.faint, fontSize: 11, fontVariantNumeric: "tabular-nums" },
});
