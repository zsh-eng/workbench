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
import type { Thread, ThreadPart, ThreadSubagent } from "../../../shared/threads";
import {
  layerProgress,
  progressLabels,
  useLayerViewed,
  type LayerProgress,
} from "../../data/stack";
import { useAttemptsAddress } from "../../data/attempts";
import { foundSessionThread, threadInput } from "../../data/found-threads";
import { shownSubagents, type ReadState } from "../../data/tabs";
import { groupThreads, needsYou, shortAge, type ThreadGroup } from "../../data/threads";
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
import { RenameField } from "./RenameField";
import { StreamHeader, StreamTabs, type SidebarStream, type StreamActions } from "./StreamHeader";
import { ToolButton } from "../ToolButton";

const SOURCES_KEY = "med:sidebar-sources";
/** The stacks and sets whose rows show their parts. */
const PARTS_KEY = "med:sidebar-parts";

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
  renaming,
  onRenaming,
  onRename,
  onGroup,
  onUngroup,
  onShape,
  onOpenPart,
  scheduled,
  streams,
  streamActions,
  closedStreams,
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
  /** The thread whose row shows its name field. */
  renaming?: string | null;
  /** Shows the name field of a thread's row, or hides it. */
  onRenaming?(thread: Thread | null): void;
  /** Names the thread; an empty name gives it its agent's title again. */
  onRename?(thread: Thread, name: string): void;
  /** Puts `thread` on top of `onto`'s stack (docs/STACKS.md). */
  onGroup?(thread: Thread, onto: Thread): void;
  /** Makes each part of a stack or a set a thread again. */
  onUngroup?(thread: Thread): void;
  onShape?(thread: Thread, shape: "stack" | "set"): void;
  /** Shows one part of a stack or a set. */
  onOpenPart?(thread: Thread, part: string): void;
  /** The Scheduled section, above the repositories (ScheduledSection.tsx). */
  scheduled?: ReactNode;
  /** Streams of work, in the reader's order: they group the tabs in place of
   * the repositories (the durable sessions design). */
  streams?: readonly SidebarStream[];
  streamActions?: StreamActions;
  /** The streams in history, under the tabs. */
  closedStreams?: { count: number; open(): void };
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
  const groups = useMemo<(ThreadGroup & { stream?: SidebarStream })[]>(
    () => (streams ? streamGroups(streams, threads) : groupThreads(threads)),
    [streams, threads],
  );
  const [renamingStream, setRenamingStream] = useState<string | null>(null);
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
  const [drop, setDrop] = useState<{ id: string; at: DropAt } | null>(null);
  // Since when the drag has held on a row's middle, which stacks it there.
  const hold = useRef<{ id: string; since: number } | null>(null);
  const endDrag = () => {
    hold.current = null;
    setDrag(null);
    setDrop(null);
  };
  const dropOn = (group: { key: string; threads: Thread[] }, target: string, at: DropAt) => {
    if (!drag || drag.group !== group.key || drag.id === target) return endDrag();
    // A hold on the middle of a row stacks the dragged thread on it.
    if (at === "onto") {
      const source = group.threads.find((thread) => thread.id === drag.id);
      const onto = group.threads.find((thread) => thread.id === target);
      if (source && onto) onGroup?.(source, onto);
      return endDrag();
    }
    const after = at === "after";
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
  const [partsOpen, setPartsOpen] = useState(() => new Set(readJson<string[]>(PARTS_KEY, [])));
  // The rows share one object of actions that reads the newest props, so a
  // row renders again only when its own thread or state changes.
  const handlers = {
    openThread,
    onOpenSubagent,
    onClose,
    onPrefetch,
    onRenaming,
    onRename,
    move,
    drag,
    drop,
    dropOn,
    groups,
    onGroup,
    onOpenPart,
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
    dragOver: (thread, group, place) => {
      const { drag, drop, onGroup, groups } = latest.current;
      if (!drag || drag.group !== group || drag.id === thread.id) return false;
      const source = groups
        .find((entry) => entry.key === group)
        ?.threads.find((entry) => entry.id === drag.id);
      // A quick drop reorders; one that holds on the row's middle for
      // STACK_HOLD_MS stacks, and the row's outline says so before the drop.
      const middle =
        place.middle && !!onGroup && stackable(thread) && !!source && stackable(source);
      if (!middle) hold.current = null;
      else if (hold.current?.id !== thread.id)
        hold.current = { id: thread.id, since: performance.now() };
      const at: DropAt =
        middle && performance.now() - hold.current!.since >= STACK_HOLD_MS
          ? "onto"
          : place.after
            ? "after"
            : "before";
      if (drop?.id !== thread.id || drop.at !== at) setDrop({ id: thread.id, at });
      return true;
    },
    drop: (thread, key) => {
      const { groups, dropOn, drop } = latest.current;
      const group = groups.find((entry) => entry.key === key);
      if (group && drop?.id === thread.id) dropOn(group, thread.id, drop.at);
      else endDrag();
    },
    dragEnd: () => endDrag(),
    rename: (thread) => latest.current.onRenaming?.(thread),
    toggleParts: (thread) =>
      setPartsOpen((open) => {
        const next = new Set(open);
        if (!next.delete(thread.id)) next.add(thread.id);
        writeJson(PARTS_KEY, [...next]);
        return next;
      }),
    openPart: (thread, part) => latest.current.onOpenPart?.(thread, part),
    renamed: (thread, name) => {
      latest.current.onRenaming?.(null);
      if (name !== null) latest.current.onRename?.(thread, name);
    },
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
                  editing={!!onRename && renaming === thread.id}
                  current={thread.id === currentThread}
                  unread={read.isUnread(thread)}
                  copied={copied === thread.id}
                  now={now}
                  subagents={subagents}
                  fresh={subagents
                    .filter((subagent) => read.isSubagentUnread(subagent))
                    .map((subagent) => subagent.id)
                    .join(" ")}
                  drop={drop?.id === thread.id ? drop.at : undefined}
                  partsOpen={partsOpen.has(thread.id)}
                  closable={!!onClose}
                  movable={!!onMove}
                  draggable={!!onReorder}
                  // A found session has no saved review to read ahead.
                  prefetch={!!onPrefetch && !thread.found}
                  actions={actions}
                />
              );
            };
            const rows = (
              <ul {...stylex.props(styles.list)}>
                {withAttempts(group.threads, row, { current: currentThread, now })}
              </ul>
            );
            const stream = group.stream;
            return stream && streamActions ? (
              <section
                key={group.key}
                aria-label={group.name}
                {...stylex.props(styles.group, styles.streamGroup)}
              >
                <StreamHeader
                  stream={stream}
                  threads={group.threads}
                  actions={streamActions}
                  renaming={renamingStream === stream.id}
                  onRenaming={(on) => setRenamingStream(on ? stream.id : null)}
                />
                <StreamTabs collapsed={!!stream.collapsed}>{rows}</StreamTabs>
              </section>
            ) : (
              <section key={group.key} aria-label={group.name} {...stylex.props(styles.group)}>
                <h2 {...stylex.props(ui.label, styles.groupName)}>{group.name}</h2>
                {rows}
              </section>
            );
          })}
          {closedStreams && closedStreams.count > 0 && (
            <button
              type="button"
              data-sidebar-row=""
              onClick={closedStreams.open}
              {...stylex.props(styles.row, styles.closedStreams)}
            >
              <Icon name="history" size={13} />
              <span {...stylex.props(styles.title)}>Closed streams</span>
              <span {...stylex.props(styles.sourceCount)}>{closedStreams.count}</span>
            </button>
          )}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenu.Positioner {...stylex.props(styles.menuPositioner)}>
            {menuThread && (
              <ThreadMenu
                thread={menuThread}
                unread={read.isUnread(menuThread)}
                onOpen={() => openThread(menuThread)}
                onRename={onRenaming && (() => onRenaming(menuThread))}
                onCopy={(text) => copy(menuThread, text)}
                onUnread={(unread) => read.setUnread(menuThread, unread)}
                onClose={onClose && ((removeWorktree) => onClose(menuThread, removeWorktree))}
                onDelete={onDelete && (() => onDelete(menuThread))}
                stackOn={
                  onGroup && stackable(menuThread)
                    ? (groups
                        .find((group) => group.threads.some((entry) => entry.id === menuThread.id))
                        ?.threads.filter(
                          (entry) => entry.id !== menuThread.id && stackable(entry),
                        ) ?? [])
                    : []
                }
                onStackOn={onGroup && ((onto) => onGroup(menuThread, onto))}
                onUngroup={onUngroup && menuThread.parts && (() => onUngroup(menuThread))}
                onShape={onShape && menuThread.parts && ((shape) => onShape(menuThread, shape))}
              />
            )}
          </ContextMenu.Positioner>
        </ContextMenu.Portal>
      </ContextMenu.Root>
      {notice}
      {scheduled}
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

/** The tabs by stream, in the streams' order; a stream keeps its tabs' order. */
function streamGroups(streams: readonly SidebarStream[], threads: readonly Thread[]) {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  return streams.map((stream) => ({
    key: stream.id,
    name: stream.name,
    stream,
    threads: stream.threads.flatMap((id) => byId.get(id) ?? []),
  }));
}

/** How a row names work that stopped until the reader acts. A cut turn can
 * go on; the others need the agent started again. */
const HALTS = {
  interrupted: { label: "Interrupted", warning: true },
  stopped: { label: "Stopped", warning: false },
  login: { label: "Log in", warning: false },
  crashing: { label: "Stopped", warning: false },
} as const;

/** What the rows do: one object for all rows, so that a row renders again
 * only when its own thread or state changes. */
interface RowActions {
  open(thread: Thread): void;
  openSubagent(thread: Thread, subagent: ThreadSubagent): void;
  close(thread: Thread, removeWorktree: boolean): void;
  move(thread: Thread, by: -1 | 1): void;
  prefetch(thread: Thread): void;
  dragStart(thread: Thread, group: string): void;
  /** Whether the dragged tab can land here: before or after the row, or on
   * its middle after a hold, which stacks the dragged thread on it. */
  dragOver(thread: Thread, group: string, place: { after: boolean; middle: boolean }): boolean;
  drop(thread: Thread, group: string): void;
  dragEnd(): void;
  /** Shows the row's name field. */
  rename(thread: Thread): void;
  /** The field closed, with a new name or null. */
  renamed(thread: Thread, name: string | null): void;
  /** Shows or hides a stack's or a set's parts under its row. */
  toggleParts(thread: Thread): void;
  openPart(thread: Thread, part: string): void;
}

/** Where a dragged tab lands on a row. */
type DropAt = "before" | "after" | "onto";
/** How long a drag holds on a row's middle before a drop there stacks. */
const STACK_HOLD_MS = 500;

/** A thread that can be a part of a stack: a saved review, not a found session
 * or an attempt. */
const stackable = (thread: Thread) => !thread.found && !thread.group;

/** At most this many segments; a longer stack counts the rest. */
const MAX_SEGMENTS = 16;

/** A stack's or a set's progress in its row: a segment for each part, bottom
 * first, unreviewed, in progress, approved, or with changes requested. */
function PartStrip({
  shape,
  parts,
  states,
}: {
  shape: "stack" | "set";
  parts: readonly ThreadPart[];
  states: readonly LayerProgress[];
}) {
  const done = states.filter((state) => state === "approved" || state === "changes").length;
  const noun = shape === "stack" ? "layers" : "parts";
  return (
    <span
      role="img"
      data-part-strip=""
      aria-label={`${done} of ${parts.length} ${noun} reviewed: ${states
        .map((state, index) => `${index + 1} ${progressLabels[state].toLowerCase()}`)
        .join(", ")}`}
      {...stylex.props(styles.strip)}
    >
      {states.slice(0, MAX_SEGMENTS).map((state, index) => (
        <span
          key={parts[index]!.id}
          data-progress={state}
          {...stylex.props(
            styles.segment,
            segments[state],
            (parts[index]!.state === "merged" || parts[index]!.state === "closed") &&
              styles.partGone,
          )}
        />
      ))}
      {parts.length > MAX_SEGMENTS && (
        <span {...stylex.props(styles.stripMore)}>+{parts.length - MAX_SEGMENTS}</span>
      )}
      <span {...stylex.props(styles.stripCount)}>
        {done}/{parts.length}
      </span>
    </span>
  );
}

interface RowProps {
  thread: Thread;
  /** In place of the title, such as an attempt's letter and agent. */
  name?: string;
  /** The row shows its name field. */
  editing: boolean;
  /** The repository group, in which a drag moves the tab. */
  group: string;
  current: boolean;
  unread: boolean;
  copied: boolean;
  now: number;
  subagents: readonly ThreadSubagent[];
  /** The IDs of subagents with results that the reader has not seen. */
  fresh: string;
  /** A dragged tab lands before or after this one, or on it. */
  drop?: DropAt;
  /** A stack's or a set's row shows its parts. */
  partsOpen: boolean;
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
  editing,
  group,
  current,
  unread,
  copied,
  now,
  subagents,
  fresh,
  drop,
  partsOpen,
  closable,
  movable,
  draggable,
  prefetch,
  actions,
}: RowProps) {
  const parts = thread.parts;
  const layerViewed = useLayerViewed(parts ? thread.id : null);
  const partStates = parts?.items.map((part) => {
    const counts = part.targetId ? layerViewed[part.targetId] : undefined;
    return layerProgress(counts?.viewed ?? 0, part.files || counts?.files, part.comments);
  });
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(rest.current), []);
  const branch = thread.branch ?? thread.checkout?.split("/").at(-1);
  // Work that stopped until the reader acts says so in place of its age.
  const halt = thread.halt;
  const busy = thread.state === "working" && !halt;
  const asking = needsYou(thread) && !halt;
  // A turn that runs shows what it does now in place of its branch, unless
  // that is a subagent's task, which its own row shows.
  const doing = busy && !asking ? thread.turn?.activity : undefined;
  const activity =
    doing && !subagents.some((subagent) => doing.includes(subagent.description))
      ? doing
      : undefined;
  const place = (event: DragEvent) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = (event.clientY - box.top) / box.height;
    return { after: at > 0.5, middle: at > 0.3 && at < 0.7 };
  };
  const read = () => !current && prefetch && actions.prefetch(thread);
  const mark = (
    <span {...stylex.props(styles.mark)} aria-hidden="true">
      {halt ? (
        <span
          {...stylex.props(
            styles.dot,
            HALTS[halt.kind].warning ? styles.dotWarning : styles.dotRed,
          )}
        />
      ) : asking ? (
        <span {...stylex.props(styles.dot, thread.state === "waiting" && styles.waiting)}>
          {thread.state === "waiting" && <span {...stylex.props(styles.pulse)} />}
        </span>
      ) : (
        <Icon name={agentIcon(thread.agent)} size={13} />
      )}
    </span>
  );
  const detail = (
    <span {...stylex.props(styles.detailLine)}>
      {halt?.detail ? (
        <span title={halt.detail} {...stylex.props(styles.activity)}>
          {halt.detail}
        </span>
      ) : activity ? (
        <span title={activity} {...stylex.props(styles.activity)}>
          {activity}
        </span>
      ) : parts && partStates ? (
        <PartStrip shape={parts.shape} parts={parts.items} states={partStates} />
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
  );
  return (
    <li
      data-thread-row={thread.id}
      data-drop={drop}
      {...stylex.props(
        styles.item,
        drop === "before" && styles.dropBefore,
        drop === "after" && styles.dropAfter,
        drop === "onto" && styles.dropOnto,
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
          if (draggable && actions.dragOver(thread, group, place(event))) event.preventDefault();
        }}
        onDrop={(event) => {
          event.preventDefault();
          if (draggable) actions.drop(thread, group);
        }}
        onDragEnd={() => draggable && actions.dragEnd()}
        onClick={() => actions.open(thread)}
        onDoubleClick={() => actions.rename(thread)}
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
        {...stylex.props(
          styles.row,
          styles.thread,
          current && styles.current,
          editing && styles.away,
        )}
      >
        {mark}
        <span {...stylex.props(styles.lines)}>
          <span {...stylex.props(styles.titleLine)}>
            <span
              {...stylex.props(
                styles.title,
                busy && !asking && styles.busy,
                unread && styles.unread,
                (asking || halt) && styles.asking,
              )}
            >
              {/* A name that the reader gave wins over an attempt's label. */}
              {(thread.agentTitle === undefined && name) || thread.title}
            </span>
            {copied ? (
              <span role="status" {...stylex.props(styles.age)}>
                Copied
              </span>
            ) : halt ? (
              <span
                {...stylex.props(
                  styles.age,
                  styles.halted,
                  HALTS[halt.kind].warning ? styles.warningText : styles.redText,
                  closable && styles.ageHides,
                )}
              >
                {HALTS[halt.kind].label}
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
          {detail}
        </span>
        <span {...stylex.props(styles.hidden)}>
          {halt
            ? `, ${HALTS[halt.kind].label.toLowerCase()}`
            : asking
              ? ", needs you"
              : busy
                ? ", working"
                : unread
                  ? ", new"
                  : ""}
        </span>
      </button>
      {editing && (
        <div {...stylex.props(styles.row, styles.thread, current && styles.current)}>
          {mark}
          <span {...stylex.props(styles.lines)}>
            <span {...stylex.props(styles.titleLine)}>
              <RenameField thread={thread} onDone={(next) => actions.renamed(thread, next)} />
            </span>
            {detail}
          </span>
        </div>
      )}
      {closable && !editing && (
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
      {parts && partStates && !editing && (
        <button
          type="button"
          aria-expanded={partsOpen}
          aria-label={`${partsOpen ? "Hide" : "Show"} the ${parts.shape === "stack" ? "layers" : "parts"} of ${thread.title}`}
          onClick={() => actions.toggleParts(thread)}
          {...stylex.props(styles.partsToggle)}
        >
          <span {...stylex.props(styles.chevron, partsOpen && styles.chevronOpen)}>
            <Icon name="chevron" size={11} />
          </span>
        </button>
      )}
      {parts && partStates && partsOpen && (
        <ol
          aria-label={`${thread.title} ${parts.shape === "stack" ? "layers" : "parts"}`}
          {...stylex.props(styles.subagents, styles.parts)}
        >
          {parts.items
            .map((part, index) => ({ part, index }))
            .toReversed()
            .map(({ part, index }) => (
              <li key={part.id}>
                <button
                  type="button"
                  data-sidebar-row=""
                  data-part={index + 1}
                  onClick={() => actions.openPart(thread, part.id)}
                  title={part.title}
                  {...stylex.props(
                    styles.row,
                    styles.part,
                    (part.state === "merged" || part.state === "closed") && styles.partGone,
                  )}
                >
                  <span {...stylex.props(styles.partNumber)}>{index + 1}</span>
                  <span {...stylex.props(styles.title, styles.partTitle)}>{part.title}</span>
                  <span {...stylex.props(styles.changes)}>
                    <span {...stylex.props(styles.added)}>+{part.additions}</span>
                    <span {...stylex.props(styles.removed)}>−{part.deletions}</span>
                  </span>
                  <span
                    aria-label={progressLabels[partStates[index]!]}
                    {...stylex.props(styles.segment, styles.partDot, segments[partStates[index]!])}
                  />
                </button>
              </li>
            ))}
        </ol>
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

const previewActions: RowActions = {
  open() {},
  openSubagent() {},
  close() {},
  move() {},
  prefetch() {},
  dragStart() {},
  dragOver: () => false,
  drop() {},
  dragEnd() {},
  rename() {},
  renamed() {},
  toggleParts() {},
  openPart() {},
};

/** Tab rows as the sidebar draws them, without the sidebar: for the
 * Elements page, which shows each state of a tab on its own. */
export function ThreadRowsPreview({
  threads,
  now,
  current,
  unread = [],
}: {
  threads: readonly Thread[];
  now: number;
  current?: string;
  unread?: readonly string[];
}) {
  return (
    <ul {...stylex.props(styles.list)}>
      {threads.map((thread) => (
        <ThreadRow
          key={thread.id}
          thread={thread}
          editing={false}
          group="preview"
          current={thread.id === current}
          unread={unread.includes(thread.id)}
          copied={false}
          now={now}
          subagents={[]}
          fresh=""
          partsOpen={false}
          closable={false}
          movable={false}
          draggable={false}
          prefetch={false}
          actions={previewActions}
        />
      ))}
    </ul>
  );
}

/** A tab's right-click menu: rename it, resume its agent in a terminal, mark it
 * read or unread, close it, with the worktree Med made for it, or delete it. */
function ThreadMenu({
  thread,
  unread,
  onOpen,
  onRename,
  onCopy,
  onUnread,
  onClose,
  onDelete,
  stackOn = [],
  onStackOn,
  onUngroup,
  onShape,
}: {
  thread: Thread;
  unread: boolean;
  onOpen(): void;
  onRename?(): void;
  onCopy(text: string): void;
  onUnread(unread: boolean): void;
  onClose?(removeWorktree: boolean): void;
  onDelete?(): void;
  /** The tabs of its repository that the thread can go on top of. */
  stackOn?: readonly Thread[];
  onStackOn?(onto: Thread): void;
  onUngroup?: (() => void) | false;
  onShape?: ((shape: "stack" | "set") => void) | false;
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
      {onRename && (
        <ContextMenu.Item onClick={onRename} className={item}>
          Rename…
        </ContextMenu.Item>
      )}
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
      {((onStackOn && stackOn.length > 0) || onUngroup || onShape) && (
        <ContextMenu.Separator {...stylex.props(styles.separator)} />
      )}
      {onStackOn && stackOn.length > 0 && (
        <ContextMenu.SubmenuRoot>
          <ContextMenu.SubmenuTrigger className={item}>
            Stack on
            <span {...stylex.props(styles.menuHint, styles.submenuArrow)}>
              <Icon name="chevron" size={12} />
            </span>
          </ContextMenu.SubmenuTrigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner sideOffset={4} {...stylex.props(styles.menuPositioner)}>
              <ContextMenu.Popup
                aria-label={`Stack ${thread.title} on`}
                {...stylex.props(ui.popup, styles.menu)}
              >
                {stackOn.map((onto) => (
                  <ContextMenu.Item key={onto.id} onClick={() => onStackOn(onto)} className={item}>
                    <span {...stylex.props(styles.menuLabel, styles.menuTitle)}>{onto.title}</span>
                    {onto.parts && (
                      <span {...stylex.props(styles.menuHint)}>
                        {onto.parts.items.length}{" "}
                        {onto.parts.shape === "stack" ? "layers" : "parts"}
                      </span>
                    )}
                  </ContextMenu.Item>
                ))}
              </ContextMenu.Popup>
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.SubmenuRoot>
      )}
      {onShape && thread.parts && (
        <ContextMenu.Item
          onClick={() => onShape(thread.parts!.shape === "stack" ? "set" : "stack")}
          className={item}
        >
          {thread.parts.shape === "stack" ? "Treat as a set" : "Treat as a stack"}
        </ContextMenu.Item>
      )}
      {onUngroup && (
        <ContextMenu.Item onClick={onUngroup} className={item}>
          Ungroup
          <span {...stylex.props(styles.menuHint)}>{thread.parts?.items.length} threads</span>
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
  streamGroup: { marginTop: 10 },
  closedStreams: {
    height: 30,
    marginTop: 14,
    color: { default: tokens.faint, ":hover": tokens.text },
  },
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
  // The row while its name field shows in its place.
  away: { display: "none" },
  source: { height: 30 },
  // A tab's row holds its close control and its subagents.
  item: { position: "relative" },
  // Where a dragged tab lands: a line above or below the row.
  dropBefore: { boxShadow: `inset 0 2px 0 ${tokens.accent}` },
  dropAfter: { boxShadow: `inset 0 -2px 0 ${tokens.accent}` },
  // A thread held on the middle of a row goes on top of its stack.
  dropOnto: {
    borderRadius: `calc(7px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 2px ${tokens.accent}`,
  },
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
  halted: { fontWeight: 500 },
  warningText: { color: tokens.warning },
  redText: { color: tokens.red },
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
  dotWarning: { backgroundColor: tokens.warning },
  dotRed: { backgroundColor: tokens.red },
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
  menuTitle: {
    display: "block",
    maxWidth: 260,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  submenuArrow: { display: "inline-flex", transform: "rotate(-90deg)" },
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
  // A stack's row: its strip in place of the branch, a toggle under its mark.
  strip: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flex: "1",
    minWidth: 0,
    maxWidth: 160,
    height: 15,
  },
  segment: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 3,
    maxWidth: 28,
    height: 4,
    boxSizing: "border-box",
    borderRadius: 2,
  },
  stripMore: { flexShrink: 0, fontSize: 10, fontVariantNumeric: "tabular-nums" },
  stripCount: {
    flexShrink: 0,
    marginInlineStart: 4,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  partsToggle: {
    position: "absolute",
    insetInlineStart: 8,
    top: 26,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 14,
    height: 15,
    padding: 0,
    borderWidth: 0,
    borderRadius: 4,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  parts: { paddingTop: 1 },
  part: { gap: 7, height: 26, paddingInlineStart: 31, fontSize: 12 },
  partGone: { opacity: 0.45 },
  partNumber: {
    flexShrink: 0,
    width: 12,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
  },
  partTitle: { fontSize: 12 },
  partDot: { flexGrow: 0, flexShrink: 0, width: 7, height: 7, borderRadius: "50%" },
});

const segments = stylex.create({
  unreviewed: { boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}` },
  progress: {
    backgroundImage: `linear-gradient(90deg, ${tokens.accent} 50%, transparent 50%)`,
    boxShadow: `inset 0 0 0 1px ${tokens.accent}`,
  },
  approved: { backgroundColor: tokens.green },
  changes: { backgroundColor: tokens.warning },
});
