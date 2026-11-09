import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import type { Thread } from "../../../shared/threads";
import { resumeCommand } from "../../data/workspaces";
import type { ReadState } from "../../data/tabs";
import { needsYou, tabOrder, type SessionRow } from "../../data/threads";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { RenameField } from "./RenameField";
import { newThreadKeys } from "../../data/title-bar";
import { tooltip } from "../ToolButton";
import { motion } from "../session/session-styles";

/** Where a dragged row would land: a place among the pins, or Recent. */
type DropTarget = { pinned: true; at: number } | { pinned: false };

interface Drag {
  id: string;
  /** The pointer, and where on the row it holds it. */
  y: number;
  grab: number;
  left: number;
  width: number;
  target: DropTarget;
}

/** How far the pointer moves before a press on a row becomes a drag. */
const DRAG_START = 4;

/**
 * The sessions: New at the top, then the pinned sessions in the reader's
 * order, then every other one, newest activity first. A row is the agent's
 * mark, the session's name, and at most one dot, by what it asks of the
 * reader, as ⌘0 ranks it: an accent dot in a ring when it needs them, a plain
 * accent dot when its work finished since they looked, amber when the work
 * stopped. A session at work dims its name under a passing light. Archived,
 * Pull requests, and Settings are at the foot.
 *
 * A row drags into Pinned, to a place among the pins, and out of it again.
 * While it drags, the list shows where it would land: the other rows make
 * room for it there, and it follows the pointer above them.
 */
export function SessionSidebar({
  threads,
  current,
  read,
  loaded,
  notice,
  newThread,
  renaming,
  onOpen,
  onNewThread,
  onHide,
  onSettings,
  onHistory,
  onPullRequests,
  onSuperagent,
  onArchive,
  onDelete,
  onPrefetch,
  onRenaming,
  onRename,
  onPin,
}: {
  /** The open sessions; their order here does not matter. */
  threads: readonly Thread[];
  /** The session on screen. */
  current: string | null;
  read: ReadState;
  loaded: boolean;
  /** A notice to act on, such as an error. */
  notice?: ReactNode;
  /** The New view shows. */
  newThread: boolean;
  /** The session whose row shows its name field. */
  renaming: string | null;
  onOpen(thread: Thread): void;
  onNewThread(): void;
  onHide(): void;
  onSettings(): void;
  /** Shows the Archived page: the threads that are not tabs. */
  onHistory?(): void;
  /** Shows the open pull requests that wait on you, and yours. */
  onPullRequests?(): void;
  /** Opens the Superagent's thread, and makes it the first time. */
  onSuperagent?(): void;
  onArchive(thread: Thread): void;
  onDelete(thread: Thread): void;
  /** Reads a session ahead of a click, while the pointer rests on its row. */
  onPrefetch(thread: Thread): void;
  onRenaming(thread: Thread | null): void;
  /** Names the session; an empty name gives it its agent's title again. */
  onRename(thread: SessionRow, name: string): void;
  /** Pins the session at `at` among the pins (under the others without it),
   * moves a pinned one there, or unpins it. */
  onPin(thread: SessionRow, pinned: boolean, at?: number): void;
}) {
  // A drop shows at once: the pins as dropped, until the host's list agrees.
  const [placed, setPlaced] = useState<readonly string[] | null>(null);
  // The Superagent has its own row on top, apart from the sessions.
  const superagent = threads.find((thread) => thread.superagent);
  const ordered = tabOrder(
    threads.filter((thread) => !thread.superagent),
    current,
  );
  const pinnedIds = ordered.filter((thread) => thread.pinned).map((thread) => thread.id);
  const settled =
    placed !== null &&
    placed.length === pinnedIds.length &&
    placed.every((id, index) => id === pinnedIds[index]);
  if (placed && settled) setPlaced(null);
  useEffect(() => {
    if (!placed) return;
    // A pin the host refused stops showing after a while.
    const timer = setTimeout(() => setPlaced(null), 4000);
    return () => clearTimeout(timer);
  }, [placed]);
  const byId = new Map(ordered.map((thread) => [thread.id, thread]));
  const pins = placed && !settled ? placed : pinnedIds;
  const pinned = pins.flatMap((id) => byId.get(id) ?? []);
  const recent = ordered.filter((thread) => !pins.includes(thread.id));

  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as the last move left it, for the release.
  const dragRef = useRef<Drag | null>(null);
  const pinnedBox = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  // A drag ends without the click that would open its row.
  const dragged = useRef(false);
  const dragging = drag ? byId.get(drag.id) : undefined;

  /** The landing place under the pointer: the pins' area, up to its foot,
   * is a place among them, by the rows' middles; below it is Recent. */
  const targetAt = (y: number, id: string): DropTarget => {
    const box = pinnedBox.current?.getBoundingClientRect();
    if (!box || y > box.bottom) return { pinned: false };
    const rows = [
      ...(pinnedBox.current?.querySelectorAll<HTMLElement>("[data-session-row]") ?? []),
    ].filter((row) => row.dataset.sessionRow !== id);
    const at = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      // Where the row is, not where its glide shows it (useFlip).
      const glide = new DOMMatrixReadOnly(getComputedStyle(row).transform).m42;
      return rect.top - glide + rect.height / 2 < y;
    }).length;
    return { pinned: true, at };
  };

  const press = (thread: SessionRow, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const row = event.currentTarget.closest<HTMLElement>("[data-session-row]");
    if (!row) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = row.getBoundingClientRect();
    let started = false;
    const move = (moved: PointerEvent) => {
      if (!started) {
        if (Math.hypot(moved.clientX - startX, moved.clientY - startY) < DRAG_START) return;
        started = true;
        dragged.current = true;
        document.documentElement.dataset.sessionDrag = "";
      }
      moved.preventDefault();
      // Near the list's ends, the list scrolls under the row.
      const list = scroller.current?.getBoundingClientRect();
      if (list && scroller.current) {
        if (moved.clientY < list.top + 24) scroller.current.scrollTop -= 8;
        else if (moved.clientY > list.bottom - 24) scroller.current.scrollTop += 8;
      }
      dragRef.current = {
        id: thread.id,
        y: moved.clientY,
        grab: startY - rect.top,
        left: rect.left,
        width: rect.width,
        target: targetAt(moved.clientY, thread.id),
      };
      setDrag(dragRef.current);
    };
    const stop = (drop: boolean) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      delete document.documentElement.dataset.sessionDrag;
      const last = dragRef.current;
      dragRef.current = null;
      setDrag(null);
      // The click that follows the release opens nothing.
      setTimeout(() => (dragged.current = false));
      if (!drop || !started || !last) return;
      const from = pins.indexOf(thread.id);
      if (last.target.pinned) {
        if (from === last.target.at) return;
        const next = pins.filter((id) => id !== thread.id);
        setPlaced(next.toSpliced(last.target.at, 0, thread.id));
        onPin(thread, true, last.target.at);
      } else if (from >= 0) {
        setPlaced(pins.filter((id) => id !== thread.id));
        onPin(thread, false);
      }
    };
    const up = () => stop(true);
    const cancel = () => stop(false);
    const escape = (key: globalThis.KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      stop(false);
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    document.addEventListener("keydown", escape, true);
  };

  /** Moves a pinned session one place up or down, as a drag would. */
  const move = (thread: SessionRow, by: -1 | 1) => {
    const from = pins.indexOf(thread.id);
    const to = from + by;
    if (from < 0 || to < 0 || to >= pins.length) return;
    setPlaced(pins.filter((id) => id !== thread.id).toSpliced(to, 0, thread.id));
    onPin(thread, true, to);
  };

  // The list as it would be after the drop: the dragged row's place shows
  // where it would land, and the others make room for it.
  const pinnedShown = (() => {
    if (!drag || !dragging) return pinned;
    const others = pinned.filter((thread) => thread.id !== drag.id);
    return drag.target.pinned ? others.toSpliced(drag.target.at, 0, dragging) : others;
  })();
  const recentShown = (() => {
    if (!drag || !dragging) return recent;
    const others = recent.filter((thread) => thread.id !== drag.id);
    if (drag.target.pinned) return others;
    // Out of Pinned, it goes back to its place by activity.
    const at = others.findIndex((thread) => thread.updatedAt < dragging.updatedAt);
    return others.toSpliced(at < 0 ? others.length : at, 0, dragging);
  })();
  useFlip(scroller, drag ? JSON.stringify(drag.target) : null);

  const row = (thread: SessionRow, index: number, list: readonly SessionRow[]) => (
    <SessionRow
      key={thread.id}
      thread={thread}
      placeholder={drag?.id === thread.id}
      menuBoundary={nav}
      current={
        !newThread && (thread.id === current || (!!current && !!thread.members?.includes(current)))
      }
      unread={read.isUnread(thread)}
      editing={renaming === thread.id}
      actions={{
        open: () => onOpen(thread),
        prefetch: () => onPrefetch(thread),
        rename: () => onRenaming(thread),
        renamed: (name) => {
          onRenaming(null);
          if (name !== null) onRename(thread, name);
        },
        pin: () => onPin(thread, !thread.pinned),
        unread: (unread) => read.setUnread(thread, unread),
        // Archiving the session archives each review it handed off.
        archive: () => {
          for (const member of thread.members ?? [thread.id]) {
            const each = threads.find((entry) => entry.id === member);
            if (each) onArchive(each);
          }
        },
        delete: () => onDelete(thread),
        press: (event) => press(thread, event),
        dragged: () => dragged.current,
        ...(thread.pinned && list === pinnedShown
          ? {
              ...(index > 0 && { up: () => move(thread, -1) }),
              ...(index < list.length - 1 && { down: () => move(thread, 1) }),
            }
          : {}),
      }}
    />
  );
  const top = stylex.props(styles.top);
  return (
    <nav ref={nav} aria-label="Sessions" {...stylex.props(styles.list)}>
      {/* The window's top row: in the installed app, the title bar's strip,
          after the window's controls. */}
      <div className={`med-title-row ${top.className ?? ""}`} style={top.style}>
        <button
          type="button"
          aria-label="New thread"
          aria-pressed={newThread}
          onClick={onNewThread}
          {...tooltip("New thread", newThreadKeys())}
          {...stylex.props(styles.row, styles.new, newThread && styles.current)}
        >
          <span {...stylex.props(styles.mark, styles.plus)}>
            <Icon name="plus" size={14} />
          </span>
          <span {...stylex.props(styles.name)}>New thread</span>
        </button>
        <button
          type="button"
          aria-label="Hide sidebar"
          title="Hide sidebar (⌘B)"
          onClick={onHide}
          {...stylex.props(ui.button, styles.hide)}
        >
          <Icon name="panelLeft" size={15} />
        </button>
      </div>
      <div ref={scroller} {...stylex.props(styles.scroll)}>
        {onSuperagent && (
          <button
            type="button"
            aria-current={superagent && superagent.id === current ? "page" : undefined}
            {...tooltip("Superagent: one thread that sees the others")}
            onClick={() => (superagent ? onOpen(superagent) : onSuperagent())}
            {...stylex.props(
              styles.row,
              styles.superagent,
              !newThread && !!superagent && superagent.id === current && styles.current,
            )}
          >
            <span {...stylex.props(styles.mark, styles.spark)}>
              <Icon name="superagent" size={14} />
            </span>
            <span {...stylex.props(styles.name, superagent?.state === "working" && motion.shimmer)}>
              Superagent
            </span>
            {superagent && read.isUnread(superagent) && (
              <span aria-label="New" {...stylex.props(styles.newDot)} />
            )}
          </button>
        )}
        {/* While a row drags, Pinned shows even with no pins, to drop into. */}
        {(pinnedShown.length > 0 || drag) && (
          <section ref={pinnedBox} aria-label="Pinned">
            <h2 {...stylex.props(styles.label)}>Pinned</h2>
            {pinnedShown.map(row)}
            {drag && pinnedShown.length === 0 && (
              <div aria-hidden="true" {...stylex.props(styles.dropHint)}>
                Drop here to pin
              </div>
            )}
          </section>
        )}
        <section aria-label="Recent">
          {(pinnedShown.length > 0 || recentShown.length > 0 || drag) && (
            <h2 {...stylex.props(styles.label)}>Recent</h2>
          )}
          {recentShown.map(row)}
          {loaded && threads.length === 0 && (
            <p {...stylex.props(styles.empty)}>Sessions you start or hand off show here.</p>
          )}
        </section>
      </div>
      {drag && dragging && (
        // The row in the hand, over the list.
        <div
          aria-hidden="true"
          {...stylex.props(styles.lifted, styles.at(drag.y - drag.grab, drag.left, drag.width))}
        >
          <span {...stylex.props(styles.mark)}>
            <Icon name={agentIcon(dragging.agent)} size={14} />
          </span>
          <span {...stylex.props(styles.name)}>{dragging.title}</span>
        </div>
      )}
      {notice}
      {onHistory && (
        <button type="button" onClick={onHistory} {...stylex.props(styles.row, styles.settings)}>
          <Icon name="history" size={15} />
          <span {...stylex.props(styles.name)}>Archived</span>
        </button>
      )}
      {onPullRequests && (
        <button
          type="button"
          onClick={onPullRequests}
          {...stylex.props(styles.row, styles.settings)}
        >
          <Icon name="pullRequest" size={15} />
          <span {...stylex.props(styles.name)}>Pull requests</span>
        </button>
      )}
      <button type="button" onClick={onSettings} {...stylex.props(styles.row, styles.settings)}>
        <Icon name="settings" size={15} />
        <span {...stylex.props(styles.name)}>Settings</span>
      </button>
    </nav>
  );
}

function agentIcon(agent: Thread["agent"]): IconName {
  return agent === "claude" || agent === "codex" ? agent : "agent";
}

interface RowActions {
  open(): void;
  prefetch(): void;
  rename(): void;
  renamed(name: string | null): void;
  pin(): void;
  unread(unread: boolean): void;
  archive(): void;
  delete(): void;
  /** A press that may become a drag. */
  press(event: ReactPointerEvent<HTMLElement>): void;
  /** The press was a drag, so its click opens nothing. */
  dragged(): boolean;
  /** A pinned session's place, one up or down; absent at the ends. */
  up?(): void;
  down?(): void;
}

const SessionRow = memo(function SessionRow({
  thread,
  current,
  unread,
  editing,
  placeholder = false,
  menuBoundary,
  actions,
}: {
  thread: Thread;
  current: boolean;
  unread: boolean;
  editing: boolean;
  /** The row drags: its place in the list is where it would land. */
  placeholder?: boolean;
  /** The menu stays inside this, the sidebar. */
  menuBoundary?: { current: HTMLElement | null };
  actions: RowActions;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | "button" | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  const halted = !!thread.halt;
  const working = thread.state === "working" && !halted;
  const dot = halted
    ? "halted"
    : current
      ? null
      : needsYou(thread)
        ? "needs"
        : unread
          ? "new"
          : null;
  const menuOpen = menu !== null;
  // Where the dragged row would land: an empty place, as tall as the row.
  if (placeholder)
    return (
      <div data-session-row={thread.id} aria-hidden="true" {...stylex.props(styles.slotRow)} />
    );
  return (
    <div
      data-session-row={thread.id}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onPointerEnter={() => {
        rest.current = setTimeout(actions.prefetch, 120);
      }}
      onPointerLeave={() => clearTimeout(rest.current)}
      {...stylex.props(styles.rowBox, stylex.defaultMarker())}
    >
      {editing ? (
        <div {...stylex.props(styles.row, styles.editing)}>
          <Icon name={agentIcon(thread.agent)} size={14} />
          <RenameField thread={thread} onDone={actions.renamed} xstyle={styles.field} />
        </div>
      ) : (
        <button
          type="button"
          data-thread={thread.id}
          aria-current={current ? "page" : undefined}
          aria-busy={working || undefined}
          title={thread.title}
          onPointerDown={actions.press}
          onClick={() => {
            if (!actions.dragged()) actions.open();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            actions.rename();
          }}
          {...stylex.props(styles.row, current && styles.current, menuOpen && styles.held)}
        >
          <span {...stylex.props(styles.mark)}>
            <Icon name={agentIcon(thread.agent)} size={14} />
          </span>
          <span {...stylex.props(styles.name, working && styles.working)}>{thread.title}</span>
          {dot && (
            <span
              role="img"
              aria-label={
                dot === "needs" ? "Needs you" : dot === "new" ? "New since you looked" : "Stopped"
              }
              {...stylex.props(
                styles.dot,
                dot === "halted" ? styles.halted : styles.fresh,
                dot === "needs" && styles.needs,
              )}
            />
          )}
        </button>
      )}
      {!editing && (
        <button
          ref={more}
          type="button"
          aria-label={`Actions for ${thread.title}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenu("button")}
          {...stylex.props(ui.button, styles.more, menuOpen && styles.moreShown)}
        >
          <Icon name="more" size={14} />
        </button>
      )}
      <Menu.Root open={menuOpen} onOpenChange={(open) => !open && setMenu(null)}>
        <Menu.Portal>
          <Menu.Positioner
            anchor={
              menu === "button" || menu === null
                ? more
                : {
                    getBoundingClientRect: () => DOMRect.fromRect({ x: menu.x, y: menu.y }),
                  }
            }
            side="bottom"
            // From its button, the menu opens inward, under the row, so it
            // stays in the sidebar as Claude's does.
            align={menu === "button" || menu === null ? "end" : "start"}
            sideOffset={4}
            collisionBoundary={menuBoundary?.current ?? undefined}
            collisionPadding={6}
            {...stylex.props(styles.positioner)}
          >
            <SessionMenu thread={thread} unread={unread} actions={actions} />
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </div>
  );
});

/** The row's menu, as in Claude's: narrow, and each item has a key while it is open. */
function SessionMenu({
  thread,
  unread,
  actions,
}: {
  thread: Thread;
  unread: boolean;
  actions: RowActions;
}) {
  const session = thread.sessions?.findLast((entry) => entry.agent !== "acp");
  const resume =
    session && session.agent !== "acp" && session.cwd
      ? resumeCommand({ agent: session.agent, id: session.id, cwd: session.cwd })
      : undefined;
  const items: { key?: string; label: string; run(): void; danger?: boolean; rule?: boolean }[] = [
    ...(thread.pullRequestUrl
      ? [{ key: "G", label: "Open PR", run: () => open(thread.pullRequestUrl!, "_blank") }]
      : []),
    ...(resume
      ? [
          {
            key: "C",
            label: "Copy resume command",
            run: () => navigator.clipboard.writeText(resume),
          },
        ]
      : []),
    { key: "P", label: thread.pinned ? "Unpin" : "Pin", run: actions.pin },
    {
      key: "U",
      label: unread ? "Mark as read" : "Mark as unread",
      run: () => actions.unread(!unread),
    },
    { key: "R", label: "Rename", run: actions.rename },
    // A pin's place, as dragging it does.
    ...(actions.up ? [{ label: "Move up", run: actions.up, rule: true }] : []),
    ...(actions.down ? [{ label: "Move down", run: actions.down, rule: !actions.up }] : []),
    { key: "A", label: "Archive", run: actions.archive, rule: !!(actions.up || actions.down) },
    { key: "D", label: "Delete", run: actions.delete, danger: true },
  ];
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const item = items.find((entry) => entry.key === event.key.toUpperCase());
    if (!item) return;
    event.preventDefault();
    item.run();
    // The menu closes after the item, as after a click.
    (event.currentTarget as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  };
  const item = (state: { highlighted: boolean }) =>
    stylex.props(ui.menuItem, styles.item, state.highlighted && ui.menuHighlighted).className;
  return (
    <Menu.Popup
      aria-label={`${thread.title} actions`}
      onKeyDown={onKeyDown}
      {...stylex.props(ui.popup, styles.menu)}
    >
      {items.map((entry, index) => (
        <div key={entry.label}>
          {(entry.danger || entry.rule) && index > 0 && (
            <div role="separator" {...stylex.props(styles.sep)} />
          )}
          <Menu.Item onClick={entry.run} className={item}>
            <span>{entry.label}</span>
            {entry.key && <kbd {...stylex.props(styles.key)}>{entry.key}</kbd>}
          </Menu.Item>
        </div>
      ))}
    </Menu.Popup>
  );
}

const shimmer = stylex.keyframes({
  from: { backgroundPosition: "120% 0" },
  to: { backgroundPosition: "-120% 0" },
});

const styles = stylex.create({
  list: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    width: "100%",
    minWidth: 0,
    height: "100%",
    boxSizing: "border-box",
    paddingTop: 0,
    paddingInline: 8,
    paddingBottom: 8,
    gap: 2,
  },
  // As tall as the title band beside it, so New and the band share a line.
  top: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: "var(--med-top-row)",
    paddingInlineStart: "max(calc(var(--med-titlebar-left) - 8px), 0px)",
    flex: "none",
  },
  // A row like the sessions under it, its mark in their marks' column; the
  // open New thread is its current row.
  new: { flex: "1", width: "auto", minWidth: 0 },
  plus: { color: tokens.muted },
  hide: { width: 28, height: 28, paddingInline: 0, color: tokens.muted },
  scroll: { flex: "1", minHeight: 0, overflowY: "auto", marginInline: -8, paddingInline: 8 },
  label: {
    marginTop: 18,
    marginBottom: 4,
    marginInline: 10,
    color: tokens.muted,
    fontSize: 12.5,
    fontWeight: 500,
  },
  empty: { marginInline: 10, color: tokens.faint, fontSize: 12.5, lineHeight: 1.5 },
  rowBox: { position: "relative" },
  // Where a dragged row would land.
  slotRow: {
    height: 32,
    borderRadius: 8,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  dropHint: {
    display: "flex",
    alignItems: "center",
    height: 32,
    paddingInline: 10,
    borderRadius: 8,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    color: tokens.faint,
    fontSize: 12.5,
  },
  // The row in the hand: the row's look, lifted over the list.
  lifted: {
    position: "fixed",
    zIndex: 70,
    display: "flex",
    alignItems: "center",
    gap: 10,
    height: 32,
    boxSizing: "border-box",
    paddingInline: 10,
    borderRadius: 8,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 8px 20px -6px #00000059`,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    pointerEvents: "none",
  },
  at: (top: number, left: number, width: number) => ({ top, left, width }),
  row: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    height: 32,
    boxSizing: "border-box",
    paddingInline: 10,
    borderWidth: 0,
    borderRadius: 8,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    textAlign: "start",
    cursor: "default",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  // As the file on screen in the tabs: a firmer fill than the pointer's.
  current: { backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong } },
  held: { backgroundColor: tokens.fill },
  editing: { backgroundColor: tokens.raised, boxShadow: `inset 0 0 0 1px ${tokens.line}` },
  // The row is the field's box, so the field draws none of its own.
  field: {
    flex: "1",
    minWidth: 0,
    fontSize: 13,
    borderColor: "transparent",
    backgroundColor: "transparent",
  },
  mark: { display: "flex", flex: "none", color: tokens.faint },
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  working: {
    color: "transparent",
    backgroundImage: `linear-gradient(90deg, ${tokens.faint} 0%, ${tokens.faint} 38%, ${tokens.text} 50%, ${tokens.faint} 62%, ${tokens.faint} 100%)`,
    backgroundSize: "240% 100%",
    backgroundClip: "text",
    animationName: { default: shimmer, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "2.6s",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  dot: { flex: "none", width: 7, height: 7, marginInlineEnd: 3, borderRadius: "50%" },
  fresh: { backgroundColor: tokens.accent },
  // Louder than news: the work waits on the reader.
  needs: { boxShadow: `0 0 0 2.5px ${tokens.accentSoft}` },
  halted: { backgroundColor: tokens.warning },
  // The menu's button takes the dot's place while the pointer is on the row.
  more: {
    position: "absolute",
    insetInlineEnd: 4,
    top: 4,
    width: 24,
    height: 24,
    paddingInline: 0,
    opacity: {
      default: 0,
      ":focus-visible": 1,
      [stylex.when.ancestor(":hover")]: 1,
    },
    backgroundColor: tokens.hover,
    color: tokens.muted,
  },
  moreShown: { opacity: 1 },
  settings: { flex: "none", color: tokens.muted },
  superagent: { flex: "none", marginBottom: 8, color: tokens.text },
  spark: { color: tokens.accent },
  newDot: {
    flexShrink: 0,
    width: 6,
    height: 6,
    marginInlineStart: "auto",
    borderRadius: 3,
    backgroundColor: tokens.accent,
  },
  positioner: { zIndex: 60 },
  menu: { minWidth: 180, width: "max-content", borderRadius: 12 },
  item: { borderRadius: 8, whiteSpace: "nowrap" },
  key: { color: tokens.faint, fontFamily: tokens.ui, fontSize: 12 },
  sep: { height: 1, marginBlock: 4, marginInline: 6, backgroundColor: tokens.line },
});

const noActions: RowActions = {
  open() {},
  prefetch() {},
  rename() {},
  renamed() {},
  pin() {},
  unread() {},
  archive() {},
  delete() {},
  press() {},
  dragged: () => false,
};

/** Rows without their list, for the elements page. */
export function SessionRowsPreview({
  threads,
  unread = [],
}: {
  threads: readonly Thread[];
  unread?: readonly string[];
}) {
  return (
    <div>
      {threads.map((thread) => (
        <SessionRow
          key={thread.id}
          thread={thread}
          current={false}
          unread={unread.includes(thread.id)}
          editing={false}
          actions={noActions}
        />
      ))}
    </div>
  );
}

/**
 * Rows glide to their new places when `key` changes, as the list makes room
 * for a dragged row: each starts where it was and moves to where it is.
 */
function useFlip(box: { current: HTMLElement | null }, key: string | null) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const rows = [...(box.current?.querySelectorAll<HTMLElement>("[data-session-row]") ?? [])];
    const now = new Map(
      rows.map((row) => [row.dataset.sessionRow!, row.getBoundingClientRect().top]),
    );
    const before = last.current;
    last.current = key === null ? new Map() : now;
    if (key === null || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    for (const row of rows) {
      const from = before.get(row.dataset.sessionRow!);
      const to = now.get(row.dataset.sessionRow!);
      if (from === undefined || to === undefined || from === to) continue;
      row.animate([{ transform: `translateY(${from - to}px)` }, { transform: "none" }], {
        duration: 140,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
      });
    }
  }, [box, key]);
}
