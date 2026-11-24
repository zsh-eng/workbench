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
import { flushSync } from "react-dom";
import type { Thread } from "../../../shared/threads";
import { resumeCommand } from "../../data/workspaces";
import type { ReadState } from "../../data/tabs";
import { needsYou, tabOrder } from "../../data/threads";
import { draftKeyOf, useDraftedBoxes } from "../../data/outbox";
import { tokens, ui } from "../../theme.stylex";
import { useViewSetting, viewSettings } from "../../data/view-settings";
import { Icon } from "../Icon";
import { Shimmer } from "../Shimmer";
import { RenameField } from "./RenameField";
import { newThreadKeys } from "../../data/title-bar";
import { clippedTooltip, tooltip } from "../ToolButton";
import { HistoryArrows } from "./HistoryArrows";
import { SidebarToggleButton } from "./SidebarToggleButton";
import { ThreadPeek } from "./ThreadPeek";

/** The lists that keep the reader's order: Pinned, and Later. */
type Shelf = "pinned" | "later";
/** Where a dragged row would land: a place among the pins or in Later, or Recent. */
type DropTarget = { shelf: Shelf; at: number } | { shelf: null };

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
  a.shelf === b.shelf && (a.shelf === null || a.at === (b as { at: number }).at);
const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

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
 * stopped. A session at work dims its name under a passing light. A session
 * whose comments wait to be sent says how many before its dot, and one whose
 * message the reader started says "Draft". Archived, Pull requests,
 * Dashboards, and Settings are at the foot.
 *
 * Later, under Recent, holds the sessions that the reader put off; it folds
 * to one row. Recent's Archive all archives its sessions but those at work
 * and those that need the reader.
 *
 * A row drags into Pinned or Later, to a place in it, and out of it again.
 * While it drags, the list shows where it would land: the other rows slide
 * aside to make room for it there, and it follows the pointer above them.
 * On release it settles into that place.
 *
 * Space, held, peeks at a session without opening it: a card beside its row
 * says what it does and said last (ThreadPeek). The row is the one under the
 * pointer, else the one with focus. While Space is down, the arrow keys move
 * to the other rows and Enter opens the one shown; letting go closes it.
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
  onDashboards,
  onUsage,
  onSuperagent,
  onArchive,
  onDelete,
  onPrefetch,
  onRenaming,
  onRename,
  onPin,
  onLater,
  onArchiveAll,
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
  /** Shows the dashboards: YAML files whose panels chart sources feed. */
  onDashboards?(): void;
  /** Shows what the agents spent (UsagePage). */
  onUsage?(): void;
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
  /** Puts the session in Later at `at` (under the others without it), moves
   * it there, or takes it out. */
  onLater(thread: Thread, later: boolean, at?: number): void;
  /** Archives these sessions of Recent. */
  onArchiveAll?(threads: readonly Thread[]): void;
}) {
  // A move shows at once: Pinned and Later as the reader left them, until the
  // host's list agrees.
  const [placed, setPlaced] = useState<{
    pinned: readonly string[];
    later: readonly string[];
  } | null>(null);
  // The Superagent's thread has its own row at the top, not one among these.
  const superagent = threads.find((thread) => thread.superagent);
  const ordered = tabOrder(threads).filter((thread) => !thread.superagent);
  const pinnedIds = ordered.filter((thread) => thread.pinned).map((thread) => thread.id);
  const laterIds = ordered.filter((thread) => thread.later).map((thread) => thread.id);
  const settled =
    placed !== null && sameIds(placed.pinned, pinnedIds) && sameIds(placed.later, laterIds);
  if (placed && settled) setPlaced(null);
  useEffect(() => {
    if (!placed) return;
    // A move the host refused stops showing after a while.
    const timer = setTimeout(() => setPlaced(null), 4000);
    return () => clearTimeout(timer);
  }, [placed]);
  const byId = new Map(ordered.map((thread) => [thread.id, thread]));
  const pins = placed && !settled ? placed.pinned : pinnedIds;
  const laters = placed && !settled ? placed.later : laterIds;
  const place = (next: { pinned?: readonly string[]; later?: readonly string[] }) =>
    setPlaced({ pinned: next.pinned ?? pins, later: next.later ?? laters });
  const pinned = pins.flatMap((id) => byId.get(id) ?? []);
  const later = laters.flatMap((id) => byId.get(id) ?? []);
  // Newest first, also a row just moved out of Pinned or Later that the
  // host still has there, so it does not show first until the host agrees.
  const recent = ordered
    .filter((thread) => !pins.includes(thread.id) && !laters.includes(thread.id))
    .toSorted((a, b) => b.updatedAt - a.updatedAt);
  const folded = useViewSetting(viewSettings.laterSection) === "folded";
  // The message boxes with a draft, in any window.
  const drafted = useDraftedBoxes();

  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag as the last move left it, for the release.
  const dragRef = useRef<Drag | null>(null);
  const pinnedBox = useRef<HTMLElement>(null);
  const laterBox = useRef<HTMLElement>(null);
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
   * is a place among them, by the rows' middles; Later's, from its name down,
   * a place in Later; between them is Recent. The rows are where the list
   * lays them out, the dragged row's place among them, so a row that made
   * room is passed again only at its new middle: a pointer that wavers at a
   * middle does not move it back. */
  const targetAt = (y: number, id: string): DropTarget => {
    const among = (box: HTMLElement, shelf: Shelf): DropTarget => {
      const rows = [...box.querySelectorAll<HTMLElement>("[data-session-row]")].filter(
        (row) => row.dataset.sessionRow !== id,
      );
      const at = rows.filter((row) => {
        const rect = row.getBoundingClientRect();
        // Where the row is, not where its glide shows it.
        const shift = new DOMMatrixReadOnly(getComputedStyle(row).transform).m42;
        return rect.top - shift + rect.height / 2 < y;
      }).length;
      return { shelf, at };
    };
    const pinnedArea = pinnedBox.current?.getBoundingClientRect();
    if (pinnedArea && y <= pinnedArea.bottom) return among(pinnedBox.current!, "pinned");
    // Later starts at its name, not at the space above it.
    const laterHead = laterBox.current?.querySelector("[aria-expanded]")?.getBoundingClientRect();
    if (laterHead && y >= laterHead.top) return among(laterBox.current!, "later");
    return { shelf: null };
  };
  /** Where a session is now: its place in Pinned or Later, or Recent. */
  const homeOf = (id: string): DropTarget => {
    const pin = pins.indexOf(id);
    if (pin >= 0) return { shelf: "pinned", at: pin };
    const put = laters.indexOf(id);
    return put >= 0 ? { shelf: "later", at: put } : { shelf: null };
  };
  /** Moves a session to `target`, as a drop or the row's menu does. */
  const moveTo = (thread: Thread, target: DropTarget) => {
    const from = homeOf(thread.id);
    if (sameTarget(from, target)) return;
    const others = (list: readonly string[]) => list.filter((id) => id !== thread.id);
    if (target.shelf === "pinned") {
      place({ pinned: others(pins).toSpliced(target.at, 0, thread.id), later: others(laters) });
      onPin(thread, true, target.at);
    } else if (target.shelf === "later") {
      place({ pinned: others(pins), later: others(laters).toSpliced(target.at, 0, thread.id) });
      onLater(thread, true, target.at);
    } else if (from.shelf === "pinned") {
      place({ pinned: others(pins) });
      onPin(thread, false);
    } else if (from.shelf === "later") {
      place({ later: others(laters) });
      onLater(thread, false);
    }
  };

  const press = (thread: Thread, event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
    const row = event.currentTarget.closest<HTMLElement>("[data-session-row]");
    if (!row) return;
    settling.current?.();
    const startX = event.clientX;
    const startY = event.clientY;
    const rect = row.getBoundingClientRect();
    // Where the row is now, and where Esc puts it back.
    const home = homeOf(thread.id);
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
        // The row's place empties, and Pinned and Later show even empty.
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
      else moveTo(thread, last.target);
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

  /** Moves a session in Pinned or Later one place up or down, as a drag would. */
  const move = (thread: Thread, by: -1 | 1) => {
    const from = homeOf(thread.id);
    if (from.shelf === null) return;
    const to = from.at + by;
    if (to < 0 || to >= (from.shelf === "pinned" ? pins : laters).length) return;
    moveTo(thread, { shelf: from.shelf, at: to });
  };

  // The lists as they would be after the drop: the dragged row's place shows
  // where it would land, and the others make room for it.
  const onShelf = (list: readonly Thread[], shelf: Shelf) => {
    if (!drag || !dragging) return list;
    const others = list.filter((thread) => thread.id !== drag.id);
    return drag.target.shelf === shelf ? others.toSpliced(drag.target.at, 0, dragging) : others;
  };
  const pinnedShown = onShelf(pinned, "pinned");
  const laterShown = onShelf(later, "later");
  const recentShown = (() => {
    if (!drag || !dragging) return recent;
    const others = recent.filter((thread) => thread.id !== drag.id);
    if (drag.target.shelf !== null) return others;
    // Out of Pinned or Later, it goes back to its place by activity.
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
      draft={!!thread.session && drafted.has(draftKeyOf(thread.id, thread.session.id))}
      peeked={peek?.id === thread.id}
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
        later: () =>
          moveTo(
            thread,
            laters.includes(thread.id) ? { shelf: null } : { shelf: "later", at: laters.length },
          ),
        unread: (unread) => read.setUnread(thread, unread),
        archive: () => onArchive(thread),
        delete: () => onDelete(thread),
        press: (event) => press(thread, event),
        dragged: () => dragged.current,
        point: (over) => {
          if (over) pointed.current = thread.id;
          else if (pointed.current === thread.id) pointed.current = null;
        },
        ...(list === pinnedShown || list === laterShown
          ? {
              ...(index > 0 && { up: () => move(thread, -1) }),
              ...(index < list.length - 1 && { down: () => move(thread, 1) }),
            }
          : {}),
      }}
    />
  );
  // The peek: the session whose card shows while Space is down, and where
  // its row is.
  const [peek, setPeek] = useState<{ id: string; top: number; right: number } | null>(null);
  // The row under the pointer, which Space peeks at first.
  const pointed = useRef<string | null>(null);
  const peekNow = useRef({ byId, onOpen, onPrefetch, peek });
  useLayoutEffect(() => {
    peekNow.current = { byId, onOpen, onPrefetch, peek };
  });
  useEffect(() => {
    // Space is down for a peek; and until it is up, it presses nothing.
    let held = false;
    let started = false;
    const rows = () => [
      ...(nav.current?.querySelectorAll<HTMLElement>("[data-session-row]:not([aria-hidden])") ??
        []),
    ];
    const show = (id: string) => {
      const row = rows().find((entry) => entry.dataset.sessionRow === id);
      const thread = peekNow.current.byId.get(id);
      if (!row || !thread) return false;
      const box = row.getBoundingClientRect();
      setPeek({ id, top: box.top, right: box.right });
      // Enter opens it without a wait.
      peekNow.current.onPrefetch(thread);
      return true;
    };
    const hide = () => {
      held = false;
      setPeek(null);
    };
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (event.code === "Space") {
        if (held || started) return event.preventDefault();
        if (event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey)
          return;
        if (dragRef.current) return;
        const id = peekTarget(nav.current, pointed.current);
        if (!id || !show(id)) return;
        event.preventDefault();
        event.stopPropagation();
        held = true;
        started = true;
        return;
      }
      if (!held) return;
      const shown = peekNow.current.peek;
      const down = event.key === "ArrowDown" || event.key === "j";
      if (down || event.key === "ArrowUp" || event.key === "k") {
        const list = rows();
        const at = list.findIndex((entry) => entry.dataset.sessionRow === shown?.id);
        const next = list[Math.max(0, Math.min(list.length - 1, at + (down ? 1 : -1)))];
        if (next) {
          next.scrollIntoView({ block: "nearest" });
          show(next.dataset.sessionRow!);
        }
      } else if (event.key === "Enter") {
        const thread = shown && peekNow.current.byId.get(shown.id);
        hide();
        if (thread) peekNow.current.onOpen(thread);
      } else if (event.key === "Escape") hide();
      else return;
      event.preventDefault();
      event.stopPropagation();
    };
    const keyup = (event: globalThis.KeyboardEvent) => {
      if (event.code !== "Space" || !started) return;
      // The key that peeked does not also press the row it was on.
      event.preventDefault();
      event.stopPropagation();
      started = false;
      hide();
    };
    const blur = () => {
      started = false;
      hide();
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("keyup", keyup, true);
    addEventListener("blur", blur);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("keyup", keyup, true);
      removeEventListener("blur", blur);
    };
  }, []);
  const peeked = peek ? byId.get(peek.id) : undefined;
  // What Archive all takes: Recent, but the sessions at work and those that
  // need the reader.
  const archivable = recent.filter((thread) => thread.state !== "working" && !needsYou(thread));
  const top = stylex.props(styles.top);
  return (
    <nav ref={nav} aria-label="Sessions" {...stylex.props(styles.list)}>
      {/* The window's top row: in the installed app, the title bar's strip.
          After the window's controls, the sidebar's toggle and Back and
          Forward, as in Claude's desktop app; the title band has them at the
          same place while the sidebar hides. */}
      <div className={`med-title-row ${top.className ?? ""}`} style={top.style}>
        <SidebarToggleButton open label="Hide sidebar" shortcut="Mod+B" onClick={onHide} />
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
          {(pinnedShown.length > 0 || recentShown.length > 0 || laterShown.length > 0 || drag) && (
            <div data-glide="" {...stylex.props(styles.head)}>
              <h2 {...stylex.props(styles.label, styles.headLabel)}>Recent</h2>
              {onArchiveAll && archivable.length > 0 && !drag && (
                <button
                  type="button"
                  onClick={() => onArchiveAll(archivable)}
                  {...tooltip(
                    `Archive ${archivable.length === 1 ? "1 session" : `${archivable.length} sessions`}`,
                    undefined,
                    undefined,
                    "Sessions at work, and\nthose that need you, stay.",
                  )}
                  {...stylex.props(styles.headAction)}
                >
                  Archive all
                </button>
              )}
            </div>
          )}
          {recentShown.map(row)}
          {loaded && threads.length === 0 && (
            <p {...stylex.props(styles.empty)}>Sessions you start or hand off show here.</p>
          )}
        </section>
        {/* While a row drags, Later shows even empty, to drop into. */}
        {(laterShown.length > 0 || drag) && (
          <section ref={laterBox} aria-label="Later">
            <div data-glide="" {...stylex.props(styles.head)}>
              <button
                type="button"
                aria-expanded={!folded}
                aria-label={
                  folded
                    ? `Later, ${laterShown.length} ${laterShown.length === 1 ? "session" : "sessions"}`
                    : "Later"
                }
                onClick={() => viewSettings.laterSection.set(folded ? "open" : "folded")}
                {...stylex.props(styles.label, styles.headLabel, styles.fold)}
              >
                <span {...stylex.props(styles.chevron, folded && styles.chevronFolded)}>
                  <Icon name="chevron" size={12} />
                </span>
                Later
                {folded && <span {...stylex.props(styles.count)}>{laterShown.length}</span>}
              </button>
            </div>
            {!folded && laterShown.map(row)}
            {drag && (folded || laterShown.length === 0) && (
              <div aria-hidden="true" {...stylex.props(styles.dropHint)}>
                Drop here for later
              </div>
            )}
          </section>
        )}
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
      {peek && peeked && <ThreadPeek thread={peeked} unread={read.isUnread(peeked)} at={peek} />}
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
      {onDashboards && (
        <button type="button" onClick={onDashboards} {...stylex.props(styles.row, styles.settings)}>
          <Icon name="display" size={15} />
          <span {...stylex.props(styles.name)}>Dashboards</span>
        </button>
      )}
      {onUsage && (
        <button type="button" onClick={onUsage} {...stylex.props(styles.row, styles.settings)}>
          <Icon name="usage" size={15} />
          <span {...stylex.props(styles.name)}>Usage</span>
        </button>
      )}
      <button type="button" onClick={onSettings} {...stylex.props(styles.row, styles.settings)}>
        <Icon name="settings" size={15} />
        <span {...stylex.props(styles.name)}>Settings</span>
      </button>
    </nav>
  );
}

const isTextField = (node: Element) =>
  (node as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName);

/**
 * The session that Space peeks at now, or null where Space has another use.
 * With focus in the sidebar, it is the row under the pointer, else the row
 * with focus; a control that is not a row keeps its Space. With focus
 * elsewhere, it is the row under the pointer, and only where Space would do
 * nothing: with nothing in focus, or in a session's empty message box, where
 * a first space is no text. A message that the reader has started keeps its
 * spaces, and a thread in focus keeps Space to scroll.
 */
function peekTarget(nav: HTMLElement | null, pointed: string | null) {
  const active = document.activeElement;
  if (active && nav?.contains(active)) {
    if (isTextField(active)) return null;
    const row = active.closest<HTMLElement>("[data-session-row]")?.dataset.sessionRow;
    return row ? (pointed ?? row) : null;
  }
  if (!pointed) return null;
  if (!active || active === document.body) return pointed;
  if (active instanceof HTMLTextAreaElement && active.closest("[data-session-panel]"))
    return active.value === "" ? pointed : null;
  return null;
}

/** At most one dot, by what the session asks of the reader; none on the
 * session on screen, except that its work stopped. */
function dotOf(thread: Thread, current: boolean, unread: boolean) {
  if (thread.halt) return "halted";
  if (current) return null;
  return needsYou(thread) ? "needs" : unread ? "new" : null;
}

/**
 * What waits in the session's message box, in words: its comments that are
 * not sent, else a message that the reader started. None on the session on
 * screen, whose message box says it.
 */
export function unsentOf(thread: Thread, current: boolean, draft: boolean) {
  if (current) return null;
  if (thread.unsent) return `${thread.unsent} ${thread.unsent === 1 ? "comment" : "comments"}`;
  return draft ? "Draft" : null;
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
      <Shimmer on={working} quiet style={styles.name}>
        Superagent
      </Shimmer>
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
  /** Into Later, or out of it to Recent. */
  later(): void;
  unread(unread: boolean): void;
  archive(): void;
  delete(): void;
  /** A press that may become a drag. */
  press(event: ReactPointerEvent<HTMLElement>): void;
  /** The press was a drag, so its click opens nothing. */
  dragged(): boolean;
  /** The pointer came onto the row, or left it: Space peeks at the row
   * under the pointer. */
  point(over: boolean): void;
  /** A pinned session's place, one up or down; absent at the ends. */
  up?(): void;
  down?(): void;
}

const SessionRow = memo(function SessionRow({
  thread,
  current,
  unread,
  draft = false,
  peeked = false,
  editing,
  placeholder = false,
  menuBoundary,
  actions,
}: {
  thread: Thread;
  current: boolean;
  unread: boolean;
  /** The reader started a message to the session and did not send it. */
  draft?: boolean;
  /** Its peek shows: the row looks held, as under its menu. */
  peeked?: boolean;
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
  const unsent = unsentOf(thread, current, draft);
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
      onPointerEnter={(event) => {
        rest.current = setTimeout(actions.prefetch, 120);
        if (event.pointerType === "mouse") actions.point(true);
      }}
      onPointerLeave={() => {
        clearTimeout(rest.current);
        actions.point(false);
      }}
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
          {...clippedTooltip(thread.title)}
          onPointerDown={actions.press}
          onClick={() => {
            if (!actions.dragged()) actions.open();
          }}
          onDoubleClick={(event) => {
            event.preventDefault();
            actions.rename();
          }}
          {...stylex.props(
            styles.row,
            current && styles.current,
            (menuOpen || peeked) && !current && styles.held,
          )}
        >
          <Shimmer on={working} quiet clip style={styles.name}>
            {thread.title}
          </Shimmer>
          {unsent && (
            <span data-unsent="" {...stylex.props(styles.unsent, menuOpen && styles.unsentHidden)}>
              {unsent}
            </span>
          )}
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
    { key: "L", label: thread.later ? "Move to Recent" : "Move to Later", run: actions.later },
    {
      key: "U",
      label: unread ? "Mark as read" : "Mark as unread",
      run: () => actions.unread(!unread),
    },
    { key: "R", label: "Rename", run: actions.rename },
    // A place in Pinned or Later, as dragging it does.
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
  empty: { marginInline: 10, color: tokens.muted, fontSize: 12.5, lineHeight: 1.5 },
  rowBox: { position: "relative" },
  // Where a dragged row would land.
  slotRow: {
    height: 32,
    borderRadius: 8,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  // A section's head: its name, and its action at the end.
  head: { display: "flex", alignItems: "center", gap: 6, marginInline: 10 },
  headLabel: { marginInline: 0, flex: "1", minWidth: 0 },
  headAction: {
    marginTop: 14,
    paddingBlock: 2,
    paddingInline: 6,
    marginInlineEnd: -6,
    borderWidth: 0,
    borderRadius: 6,
    color: { default: tokens.muted, ":hover": tokens.text },
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "default",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  fold: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    paddingBlock: 0,
    paddingInline: 0,
    // Its chevron sits in the rows' margin, so its name lines up with theirs.
    marginInlineStart: -16,
    borderWidth: 0,
    backgroundColor: "transparent",
    fontFamily: tokens.ui,
    textAlign: "start",
    cursor: "default",
    color: { default: tokens.muted, ":hover": tokens.text },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  chevron: { display: "inline-flex", transition: "transform 120ms ease" },
  chevronFolded: { transform: "rotate(-90deg)" },
  count: { marginInlineStart: 2, color: tokens.faint, fontVariantNumeric: "tabular-nums" },
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
  // What waits in the session's message box, in words, before the dot. The
  // menu's button takes its place while the pointer is on the row.
  unsent: {
    flex: "none",
    color: tokens.muted,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
    opacity: { default: 1, [stylex.when.ancestor(":hover")]: 0 },
  },
  unsentHidden: { opacity: 0 },
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
  later() {},
  unread() {},
  archive() {},
  delete() {},
  press() {},
  dragged: () => false,
  point() {},
};

/** Rows without their list, for the elements page. */
export function SessionRowsPreview({
  threads,
  unread = [],
  drafts = [],
}: {
  threads: readonly Thread[];
  unread?: readonly string[];
  /** The sessions with a message that the reader started. */
  drafts?: readonly string[];
}) {
  return (
    <div>
      {threads.map((thread) => (
        <SessionRow
          key={thread.id}
          thread={thread}
          current={false}
          unread={unread.includes(thread.id)}
          draft={drafts.includes(thread.id)}
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
