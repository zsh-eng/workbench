import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { memo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Thread } from "../../../shared/threads";
import { resumeCommand } from "../../data/workspaces";
import type { ReadState } from "../../data/tabs";
import { needsYou, tabOrder, type SessionRow } from "../../data/threads";
import { tokens, ui } from "../../theme.stylex";
import { Icon, type IconName } from "../Icon";
import { RenameField } from "./RenameField";

/**
 * The sessions: New at the top, then the pinned sessions in the reader's
 * order, then every other one, newest activity first. A row is the agent's
 * mark, the session's name, and at most one dot: accent when something is new
 * since the reader looked, amber when the work stopped. A session at work
 * dims its name under a passing light. Settings is the one way out, at the foot.
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
  onArchive(thread: Thread): void;
  onDelete(thread: Thread): void;
  /** Reads a session ahead of a click, while the pointer rests on its row. */
  onPrefetch(thread: Thread): void;
  onRenaming(thread: Thread | null): void;
  /** Names the session; an empty name gives it its agent's title again. */
  onRename(thread: Thread, name: string): void;
  onPin(thread: Thread, pinned: boolean): void;
}) {
  const ordered = tabOrder(threads, current);
  const pinned = ordered.filter((thread) => thread.pinned);
  const recent = ordered.filter((thread) => !thread.pinned);
  const row = (thread: SessionRow) => (
    <SessionRow
      key={thread.id}
      thread={thread}
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
      }}
    />
  );
  return (
    <nav aria-label="Sessions" {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.top)}>
        <button
          type="button"
          aria-label="New thread"
          aria-pressed={newThread}
          onClick={onNewThread}
          {...stylex.props(styles.new)}
        >
          <Icon name="plus" size={13} />
          New
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
      <div {...stylex.props(styles.scroll)}>
        {pinned.length > 0 && (
          <section aria-label="Pinned">
            <h2 {...stylex.props(styles.label)}>Pinned</h2>
            {pinned.map(row)}
          </section>
        )}
        <section aria-label="Recent">
          {(pinned.length > 0 || recent.length > 0) && (
            <h2 {...stylex.props(styles.label)}>Recent</h2>
          )}
          {recent.map(row)}
          {loaded && threads.length === 0 && (
            <p {...stylex.props(styles.empty)}>Sessions you start or hand off show here.</p>
          )}
        </section>
      </div>
      {notice}
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
}

const SessionRow = memo(function SessionRow({
  thread,
  current,
  unread,
  editing,
  actions,
}: {
  thread: Thread;
  current: boolean;
  unread: boolean;
  editing: boolean;
  actions: RowActions;
}) {
  const [menu, setMenu] = useState<{ x: number; y: number } | "button" | null>(null);
  const more = useRef<HTMLButtonElement>(null);
  const rest = useRef<ReturnType<typeof setTimeout>>(undefined);
  const halted = !!thread.halt;
  const working = thread.state === "working" && !halted;
  // A question waits for the reader like news does.
  const dot = halted ? "halted" : (unread || needsYou(thread)) && !current ? "new" : null;
  const menuOpen = menu !== null;
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
          onClick={actions.open}
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
              aria-label={dot === "new" ? "New since you looked" : "Stopped"}
              {...stylex.props(styles.dot, dot === "halted" ? styles.halted : styles.fresh)}
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
            align="start"
            sideOffset={4}
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
  const items: { key: string; label: string; run(): void; danger?: boolean }[] = [
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
    { key: "A", label: "Archive", run: actions.archive },
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
        <div key={entry.key}>
          {entry.danger && index > 0 && <div role="separator" {...stylex.props(styles.sep)} />}
          <Menu.Item onClick={entry.run} className={item}>
            <span>{entry.label}</span>
            <kbd {...stylex.props(styles.key)}>{entry.key}</kbd>
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
    padding: 8,
    gap: 2,
  },
  top: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 36,
    flex: "none",
  },
  new: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingInlineStart: 11,
    paddingInlineEnd: 14,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.line,
    borderRadius: 999,
    backgroundColor: { default: tokens.raised, ":hover": tokens.hover },
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    fontWeight: 500,
    cursor: "default",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  hide: { width: 30, height: 30, paddingInline: 0, color: tokens.muted },
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
  current: { backgroundColor: { default: tokens.hover, ":hover": tokens.hover } },
  held: { backgroundColor: tokens.fill },
  editing: { backgroundColor: tokens.raised, boxShadow: `inset 0 0 0 1px ${tokens.lineStrong}` },
  field: { flex: "1", minWidth: 0, fontSize: 13 },
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
