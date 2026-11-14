import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import {
  memo,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import type { Thread } from "../../../shared/threads";
import { resumeCommand } from "../../data/workspaces";
import type { ReadState } from "../../data/tabs";
import { needsYou, tabOrder } from "../../data/threads";
import { tokens, ui } from "../../theme.stylex";
import { Icon } from "../Icon";
import { RenameField } from "./RenameField";
import { newThreadKeys } from "../../data/title-bar";
import { ToolButton, tooltip } from "../ToolButton";
import { HistoryArrows } from "./HistoryArrows";

/** Where a dragged row would land: a place among the pins, or Recent. */
type DropTarget = { pinned: true; at: number } | { pinned: false };

/** A drag's row and where it would land. The pointer itself moves the row in
 * the hand without a render, so it is not here. */
interface Drag {
  id: string;
  /** The row's column, for the row in the hand. */
  left: number;
  width: number;
  target: DropTarget;
}

const sameTarget = (a: DropTarget, b: DropTarget) =>
  a.pinned && b.pinned ? a.at === b.at : a.pinned === b.pinned;

/** How far the pointer moves before a press on a row becomes a drag. */
const DRAG_START = 4;
/** A row's glide to its new place, and the dropped row's into its own. */
const GLIDE = { duration: 140, easing: "cubic-bezier(0.2, 0, 0, 1)" };
const SETTLE = { duration: 160, easing: "cubic-bezier(0.2, 0, 0, 1)" };
const still = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/**
 * The sessions: New and the Superagent at the top, then the pinned sessions
 * in the reader's order, then every other one, newest activity first. A row
 * is the session's name and at most one dot, by what it asks of the
 * reader, as ⌘0 ranks it: an accent dot in a ring when it needs them, a plain
 * accent dot when its work finished since they looked, amber when the work
 * stopped. A session at work dims its name under a passing light. Archived,
 * Pull requests, and Settings are at the foot.
 *
 * A row drags into Pinned, to a place among the pins, and out of it again.
 * While it drags, the list shows where it would land: the other rows slide
 * aside to make room for it there, and it follows the pointer above them.
 * On release it settles into that place.
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
  onRename(thread: Thread, name: string): void;
  /** Pins the session at `at` among the pins (under the others without it),
   * moves a pinned one there, or unpins it. */
  onPin(thread: Thread, pinned: boolean, at?: number): void;
}) {
  // A drop shows at once: the pins as dropped, until the host's list agrees.
  const [placed, setPlaced] = useState<readonly string[] | null>(null);
  // The Superagent's thread has its own row at the top, not one among these.
  const superagent = threads.find((thread) => thread.superagent);
  const ordered = tabOrder(threads).filter((thread) => !thread.superagent);
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
  // Newest first, also a row just dropped out of Pinned that the host still
  // has pinned, so it does not show first until the host agrees.
  const recent = ordered
    .filter((thread) => !pins.includes(thread.id))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);

  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as the last move left it, for the release.
  const dragRef = useRef<Drag | null>(null);
  const pinnedBox = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  // The row in the hand. The pointer moves it, not a render.
  const lifted = useRef<HTMLDivElement>(null);
  // Ends a dropped row's glide into its place at once, for a press that
  // comes first.
  const settling = useRef<(() => void) | null>(null);
  // A drag ends without the click that would open its row.
  const dragged = useRef(false);
  const dragging = drag ? byId.get(drag.id) : undefined;

  /** Shows the drag as `next` has it, and the rows glide to their places. */
  const show = (next: Drag | null) => {
    dragRef.current = next;
    glide(scroller.current, () => flushSync(() => setDrag(next)));
  };

  /** The landing place under the pointer: the pins' area, up to its foot,
   * is a place among them, by the rows' middles; below it is Recent. The
   * rows are where the list lays them out, the dragged row's place among
   * them, so a row that made room is passed again only at its new middle:
   * a pointer that wavers at a middle does not move it back. */
  const targetAt = (y: number, id: string): DropTarget => {
    const box = pinnedBox.current?.getBoundingClientRect();
    if (!box || y > box.bottom) return { pinned: false };
    const rows = [
      ...(pinnedBox.current?.querySelectorAll<HTMLElement>("[data-session-row]") ?? []),
    ].filter((row) => row.dataset.sessionRow !== id);
    const at = rows.filter((row) => {
      const rect = row.getBoundingClientRect();
      // Where the row is, not where its glide shows it.
      const shift = new DOMMatrixReadOnly(getComputedStyle(row).transform).m42;
      return rect.top - shift + rect.height / 2 < y;
    }).length;
    return { pinned: true, at };
  };

  const press = (thread: Thread, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const row = event.currentTarget.closest<HTMLElement>("[data-session-row]");
    if (!row) return;
    settling.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = row.getBoundingClientRect();
    const from = pins.indexOf(thread.id);
    // Where the row is now, and where Esc puts it back.
    const home: DropTarget = from >= 0 ? { pinned: true, at: from } : { pinned: false };
    let started = false;
    let y = startY;
    // The row in the hand is where the pointer holds it, in the same frame.
    const follow = () => {
      if (lifted.current) lifted.current.style.transform = `translateY(${y - startY + rect.top}px)`;
    };
    const move = (moved: PointerEvent) => {
      y = moved.clientY;
      if (!started) {
        if (Math.hypot(moved.clientX - startX, y - startY) < DRAG_START) return;
        started = true;
        dragged.current = true;
        document.documentElement.dataset.sessionDrag = "";
        // The row's place empties, and Pinned shows even with no pins.
        show({ id: thread.id, left: rect.left, width: rect.width, target: home });
      }
      moved.preventDefault();
      follow();
      // Near the list's ends, the list scrolls under the row.
      const list = scroller.current?.getBoundingClientRect();
      if (list && scroller.current) {
        if (y < list.top + 24) scroller.current.scrollTop -= 8;
        else if (y > list.bottom - 24) scroller.current.scrollTop += 8;
      }
      // Only a new landing place renders, and moves the other rows.
      const last = dragRef.current!;
      const target = targetAt(y, thread.id);
      if (!sameTarget(last.target, target)) show({ ...last, target });
    };
    const stop = (drop: boolean) => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      document.removeEventListener("keydown", escape, true);
      delete document.documentElement.dataset.sessionDrag;
      // The click that follows the release opens nothing.
      setTimeout(() => (dragged.current = false));
      const last = dragRef.current;
      if (!started || !last) return;
      if (!drop) show({ ...last, target: home });
      else if (last.target.pinned) {
        if (from !== last.target.at) {
          const next = pins.filter((id) => id !== thread.id);
          setPlaced(next.toSpliced(last.target.at, 0, thread.id));
          onPin(thread, true, last.target.at);
        }
      } else if (from >= 0) {
        setPlaced(pins.filter((id) => id !== thread.id));
        onPin(thread, false);
      }
      settle(thread.id);
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

  /** The row in the hand glides into its place, and the drag ends there, so
   * the row shows where the hand left it: no jump. */
  const settle = (id: string) => {
    const end = () => {
      settling.current = null;
      show(null);
    };
    const hand = lifted.current;
    const list = scroller.current?.getBoundingClientRect();
    const place = scroller.current?.querySelector<HTMLElement>(
      `[data-session-row="${CSS.escape(id)}"]`,
    );
    if (!hand || !list || !place || still()) return end();
    // Where the place is laid out, not where its own glide shows it now.
    const box = place.getBoundingClientRect();
    const to = box.top - new DOMMatrixReadOnly(getComputedStyle(place).transform).m42;
    // A place scrolled out of the list's view: the row does not cross the
    // sidebar's foot to reach it.
    if (to < list.top || to + box.height > list.bottom) return end();
    const into = hand.animate(
      [{ transform: hand.style.transform }, { transform: `translateY(${to}px)` }],
      { ...SETTLE, fill: "forwards" },
    );
    into.onfinish = end;
    settling.current = () => {
      into.onfinish = null;
      end();
    };
  };

  /** Moves a pinned session one place up or down, as a drag would. */
  const move = (thread: Thread, by: -1 | 1) => {
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
  const row = (thread: Thread, index: number, list: readonly Thread[]) => (
    <SessionRow
      key={thread.id}
      thread={thread}
      placeholder={drag?.id === thread.id}
      menuBoundary={nav}
      current={!newThread && thread.id === current}
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
        archive: () => onArchive(thread),
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
      {/* The window's top row: in the installed app, the title bar's strip.
          After the window's controls, the sidebar's toggle and Back and
          Forward, as in Claude's desktop app; the title band has them at the
          same place while the sidebar hides. */}
      <div className={`med-title-row ${top.className ?? ""}`} style={top.style}>
        <ToolButton label="Hide sidebar" shortcut="Mod+B" icon="panelLeft" onClick={onHide} />
        <HistoryArrows />
      </div>
      {/* A row like the sessions under it; the open New thread is its current row. */}
      <button
        type="button"
        aria-label="New thread"
        aria-pressed={newThread}
        onClick={onNewThread}
        {...tooltip("New thread", newThreadKeys())}
        {...stylex.props(styles.row, newThread && styles.current)}
      >
        <span {...stylex.props(styles.mark, styles.plus)}>
          <Icon name="plus" size={14} />
        </span>
        <span {...stylex.props(styles.name)}>New</span>
      </button>
      <div ref={scroller} {...stylex.props(styles.scroll, drag && styles.dragging)}>
        {onSuperagent && (
          // The Superagent is a pinned session; this opens it, and makes it
          // the first time.
          <SuperagentRow
            thread={superagent}
            current={!newThread && !!superagent && superagent.id === current}
            unread={!!superagent && read.isUnread(superagent)}
            onOpen={onSuperagent}
          />
        )}
        {/* While a row drags, Pinned shows even with no pins, to drop into. */}
        {(pinnedShown.length > 0 || drag) && (
          <section ref={pinnedBox} aria-label="Pinned">
            <h2 data-glide="" {...stylex.props(styles.label)}>
              Pinned
            </h2>
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
            <h2 data-glide="" {...stylex.props(styles.label)}>
              Recent
            </h2>
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
          ref={lifted}
          aria-hidden="true"
          {...stylex.props(styles.lifted, styles.at(drag.left, drag.width))}
        >
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

/** At most one dot, by what the session asks of the reader; none on the
 * session on screen, except that its work stopped. */
function dotOf(thread: Thread, current: boolean, unread: boolean) {
  if (thread.halt) return "halted";
  if (current) return null;
  return needsYou(thread) ? "needs" : unread ? "new" : null;
}

function RowDot({ dot }: { dot: ReturnType<typeof dotOf> }) {
  if (!dot) return null;
  return (
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
  );
}

/** The Superagent's row: its mark, its name, and its session's dot. It opens
 * the thread, and makes it the first time. */
function SuperagentRow({
  thread,
  current,
  unread,
  onOpen,
}: {
  thread?: Thread;
  current: boolean;
  unread: boolean;
  onOpen(): void;
}) {
  const working = thread?.state === "working" && !thread.halt;
  return (
    <button
      type="button"
      data-thread={thread?.id}
      aria-current={current ? "page" : undefined}
      aria-busy={working || undefined}
      {...tooltip("Superagent: one thread that sees the others")}
      onClick={onOpen}
      {...stylex.props(styles.row, styles.superagent, current && styles.current)}
    >
      <span {...stylex.props(styles.mark, styles.spark)}>
        <Icon name="superagent" size={14} />
      </span>
      <span {...stylex.props(styles.name, working && styles.working)}>Superagent</span>
      {thread && <RowDot dot={dotOf(thread, current, unread)} />}
    </button>
  );
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
  const working = thread.state === "working" && !thread.halt;
  const dot = dotOf(thread, current, unread);
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
          <span {...stylex.props(styles.name, working && styles.working)}>{thread.title}</span>
          <RowDot dot={dot} />
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
  const session = thread.session;
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
  // As tall as the title band beside it, so the two share a line. Its toggle
  // starts where the band's Show sidebar does (WorkspaceBar's afterControls),
  // so neither it nor the arrows move as the sidebar hides.
  top: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    height: "var(--med-top-row)",
    paddingInlineStart: "max(calc(var(--med-titlebar-left) - 4px), 0px)",
    flex: "none",
    color: tokens.muted,
  },
  plus: { color: tokens.muted },
  scroll: { flex: "1", minHeight: 0, overflowY: "auto", marginInline: -8, paddingInline: 8 },
  // The rows move only as the drag moves them: the browser keeps no row in
  // place by scrolling while Pinned grows or shrinks above it.
  dragging: { overflowAnchor: "none" },
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
  // The row in the hand: the row's look, lifted over the list. The pointer
  // moves it by its transform.
  lifted: {
    position: "fixed",
    top: 0,
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
    willChange: "transform",
  },
  at: (left: number, width: number) => ({ left, width }),
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
  // The menu's button takes the dot's place while the pointer is on the row:
  // in the row's middle, as far from its end as from its top and foot.
  more: {
    position: "absolute",
    insetInlineEnd: 4,
    top: 0,
    bottom: 0,
    marginBlock: "auto",
    width: 24,
    height: 24,
    // ui.button's least height would make it taller than wide, and low in the row.
    minHeight: 0,
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

// Each element's glide in the list, to cancel when it moves again.
const glides = new WeakMap<Element, Animation>();

/**
 * Makes `change` to the list, and the rows and labels that it moves glide
 * there from where they show. A glide starts where the row is drawn now,
 * partway through an earlier glide or not, so changes that come faster than
 * glides end never make a row jump back. Both places are read in this frame,
 * so a scroll since the last change does not matter, and a row that `change`
 * does not move keeps its glide. A row new to the list shows in its place.
 */
function glide(list: HTMLElement | null, change: () => void) {
  const elements = () => [
    ...(list?.querySelectorAll<HTMLElement>("[data-session-row], [data-glide]") ?? []),
  ];
  const shown = new Map(
    elements().map((element) => [element, element.getBoundingClientRect().top]),
  );
  change();
  if (still()) return;
  // The reads come in batches between the writes, so the list lays out once
  // for each batch, not once for each row.
  const moved = elements().flatMap((element) => {
    const from = shown.get(element);
    return from !== undefined && Math.abs(element.getBoundingClientRect().top - from) >= 0.5
      ? [{ element, from }]
      : [];
  });
  for (const { element } of moved) glides.get(element)?.cancel();
  const places = moved.map(({ element }) => element.getBoundingClientRect().top);
  moved.forEach(({ element, from }, index) => {
    glides.set(
      element,
      element.animate(
        [{ transform: `translateY(${from - places[index]!}px)` }, { transform: "none" }],
        GLIDE,
      ),
    );
  });
}
