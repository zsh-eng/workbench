import * as stylex from "@stylexjs/stylex";
import {
  Activity,
  createContext,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  createReviewController,
  type ReviewController,
  type ReviewControllerOptions,
} from "../data/controller";
import {
  createWorkspaceStore,
  orderedWorkspaces,
  overlayAddress,
  workspaceUrl,
  type Workspace,
  type WorkspaceInput,
  type WorkspacePatch,
  type WorkspaceSnapshot,
} from "../data/workspaces";
import { tokens } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { ShortcutKeys } from "./ShortcutKeys";
import { ActionTooltip } from "./ToolButton";
import { visibleElement } from "../data/palette-focus";

/** Workspaces kept mounted, most recently shown first. Older ones reload. */
const MOUNTED = 4;

type ControllerOptions = Omit<ReviewControllerOptions, "savedReviewId" | "start">;

interface WorkspaceActions {
  /** Shows a workspace and moves the address to it. */
  activate(id: string): void;
  close(id: string): void;
  /** Shows the workspace for this task, opening it first if needed. */
  open(input: WorkspaceInput): void;
  match(input: WorkspaceInput): string | undefined;
  closeRepository(repositoryId: string, keep: string): void;
  update(id: string, patch: WorkspacePatch): void;
  /** Opens the switcher without a held key, as the palette does. */
  openSwitcher(): void;
}

const Actions = createContext<WorkspaceActions | null>(null);
const Snapshot = createContext<WorkspaceSnapshot | null>(null);
const Current = createContext<string | null>(null);

/** The workspace that renders this App, with the host's actions. Outside a
 * host, such as in a test of App alone, it is null. */
export function useWorkspace() {
  const actions = use(Actions);
  const id = use(Current);
  return useMemo(() => (actions && id ? { id, ...actions } : null), [actions, id]);
}

const historyWorkspace = () => (history.state as { workspace?: unknown } | null)?.workspace;

/** True when the address already shows the workspace. Branches share "/",
 * so their history entries carry the workspace id. */
function showing(workspace: Workspace) {
  if (workspace.kind === "repository") {
    const named = historyWorkspace();
    return location.pathname === "/" && (named === undefined || named === workspace.id);
  }
  return location.pathname === workspaceUrl(workspace);
}

async function readVaults(fetcher: typeof fetch) {
  try {
    const response = await fetcher("/api/service/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    // A plain review host has no sources, so it has no vaults.
    if (response.status === 404) return [];
    if (!response.ok) return null;
    const data = (await response.json()) as {
      sources?: { id: string; name: string; kind: string }[];
    };
    return (data.sources ?? [])
      .filter((source) => source.kind === "vault")
      .map((source) => ({ sourceId: source.id, title: source.name }));
  } catch {
    return null;
  }
}

/**
 * Owns the workspaces of this window: the persisted list, the address, the
 * shortcuts, and the switcher. Place it above the vault and file surfaces so
 * they can show the list too; {@link WorkspaceViews} renders the reviews.
 */
export function WorkspaceHost({
  fetch: providedFetch,
  children,
}: {
  fetch?: typeof fetch;
  children: ReactNode;
}) {
  const [fetcher] = useState(() => providedFetch ?? globalThis.fetch.bind(globalThis));
  const [store] = useState(() => createWorkspaceStore(location.pathname, history.state));
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [switcher, setSwitcher] = useState<{ held: boolean; reverse: boolean } | null>(null);
  // A vault keeps its own address, such as the open file, between visits.
  const vaultAddresses = useRef(new Map<string, string>());
  // Each workspace gets back the focus it had, as a window does.
  const focused = useRef(new Map<string, HTMLElement>());
  const rememberFocus = useCallback(() => {
    const element = document.activeElement;
    if (element instanceof HTMLElement && !element.closest("[data-workspace-switcher]"))
      focused.current.set(store.getSnapshot().active, element);
  }, [store]);

  const show = useCallback(
    (id: string, replace = false) => {
      const workspace = store.getSnapshot().workspaces.find((entry) => entry.id === id);
      if (!workspace) return;
      if (store.getSnapshot().active !== id) rememberFocus();
      store.activate(id);
      requestAnimationFrame(() => {
        const target = focused.current.get(id);
        if (target?.isConnected && target.checkVisibility()) target.focus({ preventScroll: true });
      });
      if (showing(workspace)) return;
      const address =
        (workspace.kind === "vault" && vaultAddresses.current.get(id)) || workspaceUrl(workspace);
      history[replace ? "replaceState" : "pushState"]({ workspace: id }, "", address);
      // The vault and file surfaces follow the address through popstate.
      window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
    },
    [rememberFocus, store],
  );
  const actions = useMemo<WorkspaceActions>(
    () => ({
      activate: (id) => show(id),
      close(id) {
        const before = store.getSnapshot().active;
        store.close(id);
        const after = store.getSnapshot().active;
        if (after !== before) show(after, true);
      },
      open: (input) => show(store.open(input, false)),
      match: store.match,
      closeRepository: store.closeRepository,
      update: store.update,
      openSwitcher() {
        rememberFocus();
        setSwitcher({ held: false, reverse: false });
      },
    }),
    [rememberFocus, show, store],
  );

  // The address names the workspace: links, reloads, Back, and Forward.
  useEffect(() => {
    const active = store
      .getSnapshot()
      .workspaces.find((entry) => entry.id === store.getSnapshot().active);
    if (active?.kind === "repository" && location.pathname === "/" && !historyWorkspace())
      history.replaceState({ ...(history.state as object), workspace: active.id }, "");
    const follow = () => {
      store.follow(location.pathname, history.state);
      if (location.pathname.startsWith("/vault/"))
        vaultAddresses.current.set(store.getSnapshot().active, location.pathname + location.search);
    };
    follow();
    window.addEventListener("popstate", follow);
    window.addEventListener("med:location", follow);
    return () => {
      window.removeEventListener("popstate", follow);
      window.removeEventListener("med:location", follow);
    };
  }, [store]);

  // Registered vaults are pinned first. A vault that is removed closes.
  useEffect(() => {
    let cancelled = false;
    const sync = async () => {
      const vaults = await readVaults(fetcher);
      if (cancelled || !vaults) return;
      const before = store.getSnapshot().active;
      store.syncVaults(vaults);
      const after = store.getSnapshot().active;
      if (after !== before) show(after, true);
    };
    void sync();
    const visible = () => {
      if (document.visibilityState === "visible") void sync();
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", visible);
    };
  }, [fetcher, show, store]);

  // A quick ⌃Tab can release Control before the switcher listens, so the host
  // tracks the key itself.
  const control = useRef(false);
  const controlHeld = useCallback(() => control.current, []);
  useEffect(() => {
    const track = (event: KeyboardEvent) => {
      // Releasing Control reports ctrlKey false; releasing Tab keeps it true.
      control.current = event.ctrlKey;
    };
    const release = () => {
      control.current = false;
    };
    window.addEventListener("keydown", track, true);
    window.addEventListener("keyup", track, true);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", track, true);
      window.removeEventListener("keyup", track, true);
      window.removeEventListener("blur", release);
    };
  }, []);

  // ⌘1–9 shows a workspace by its place in the list; ⌃Tab opens the switcher.
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.altKey) return;
      if (overlayAddress(location.pathname) || visibleElement('[role="dialog"]')) return;
      const rows = orderedWorkspaces(store.getSnapshot());
      if (rows.length < 2) return;
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      if (digit && (event.metaKey || event.ctrlKey) && !event.shiftKey) {
        const target = rows[Number(digit) - 1];
        if (!target) return;
        event.preventDefault();
        event.stopPropagation();
        show(target.id);
      } else if (event.key === "Tab" && event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        rememberFocus();
        setSwitcher({ held: true, reverse: event.shiftKey });
      }
    };
    window.addEventListener("keydown", keydown, true);
    return () => window.removeEventListener("keydown", keydown, true);
  }, [rememberFocus, show, store]);

  return (
    <Actions value={actions}>
      <Snapshot value={snapshot}>
        {children}
        {switcher && (
          <WorkspaceSwitcher
            snapshot={snapshot}
            held={switcher.held}
            controlHeld={controlHeld}
            reverse={switcher.reverse}
            onChoose={(id) => {
              setSwitcher(null);
              show(id);
            }}
            onCancel={() => setSwitcher(null)}
          />
        )}
      </Snapshot>
    </Actions>
  );
}

/** One controller per mounted workspace. Only the one on screen listens for
 * changes; the rest catch up when they are shown again. */
function createControllerPool(options: ControllerOptions) {
  const controllers = new Map<string, ReviewController>();
  return {
    get(workspace: Workspace) {
      let controller = controllers.get(workspace.id);
      if (!controller) {
        controller = createReviewController(
          workspace.kind === "review"
            ? { ...options, savedReviewId: workspace.reviewId }
            : workspace.kind === "repository"
              ? {
                  ...options,
                  start: {
                    path: workspace.path,
                    repositoryId: workspace.repositoryId,
                    branch: workspace.branch,
                  },
                }
              : options,
        );
        controllers.set(workspace.id, controller);
        void controller.initialize();
      }
      return controller;
    },
    retain(ids: readonly string[]) {
      for (const [id, controller] of controllers)
        if (!ids.includes(id)) {
          controller.dispose();
          controllers.delete(id);
        }
    },
    focus(id: string | null) {
      for (const [key, controller] of controllers) {
        if (key === id) controller.resume();
        else controller.suspend();
      }
    },
    dispose() {
      for (const controller of controllers.values()) controller.dispose();
      controllers.clear();
    },
  };
}

/**
 * Renders the review of each mounted workspace. Hidden ones keep their state,
 * scroll, and open files; their effects stop until they are shown again.
 */
export function WorkspaceViews({
  options,
  children: render,
}: {
  options: ControllerOptions;
  children(controller: ReviewController): ReactNode;
}) {
  const snapshot = use(Snapshot);
  if (!snapshot) throw new Error("WorkspaceViews needs a WorkspaceHost.");
  const [pool] = useState(() => createControllerPool(options));
  const [mounted, setMounted] = useState<string[]>([]);
  const active = snapshot.workspaces.find((entry) => entry.id === snapshot.active);
  const onScreen = active && active.kind !== "vault" ? active.id : null;
  let next = mounted.filter((id) => snapshot.workspaces.some((entry) => entry.id === id));
  if (onScreen && next[0] !== onScreen)
    next = [onScreen, ...next.filter((id) => id !== onScreen)].slice(0, MOUNTED);
  if (next.length !== mounted.length || next.some((id, index) => id !== mounted[index]))
    setMounted(next);

  useEffect(() => pool.retain(mounted), [pool, mounted]);
  useEffect(() => pool.focus(onScreen), [pool, onScreen, mounted]);
  useEffect(() => {
    const leave = () => pool.dispose();
    window.addEventListener("pagehide", leave, { once: true });
    return () => {
      window.removeEventListener("pagehide", leave);
      pool.dispose();
    };
  }, [pool]);

  return mounted.flatMap((id) => {
    const workspace = snapshot.workspaces.find((entry) => entry.id === id);
    if (!workspace || workspace.kind === "vault") return [];
    return (
      <Activity key={id} mode={id === onScreen ? "visible" : "hidden"}>
        <Current value={id}>
          <KeepScroll>{render(pool.get(workspace))}</KeepScroll>
        </Current>
      </Activity>
    );
  });
}

/** Hidden workspaces have no layout, so the browser forgets their scroll
 * offsets. This records them as they change and restores them when the
 * workspace is shown, before its own effects read them. Virtualized diffs
 * measure themselves again after the first frame and re-anchor, so the saved
 * offsets apply once more after that measurement. */
function KeepScroll({ children }: { children: ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  const offsets = useRef(new Map<Element, [number, number]>());
  useLayoutEffect(() => {
    const node = root.current;
    if (!node) return;
    const saved = [...offsets.current].filter(([element]) => element.isConnected);
    offsets.current = new Map(saved);
    const restore = () => {
      for (const [element, [top, left]] of saved)
        element.scrollTo({ top, left, behavior: "instant" });
    };
    restore();
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(restore);
    });
    const record = (event: Event) => {
      const target = event.target;
      if (target instanceof Element && target.getClientRects().length)
        offsets.current.set(target, [target.scrollTop, target.scrollLeft]);
    };
    node.addEventListener("scroll", record, { capture: true, passive: true });
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", record, { capture: true });
    };
  }, []);
  return (
    <div ref={root} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

function iconFor(workspace: Workspace): IconName {
  return workspace.kind === "vault"
    ? "vault"
    : workspace.kind === "review"
      ? "pullRequest"
      : workspace.branch
        ? "branch"
        : "commit";
}
function labelFor(workspace: Workspace) {
  if (workspace.title) return workspace.title;
  if (workspace.kind === "vault") return "Vault";
  if (workspace.kind === "review") return "Saved review";
  return workspace.branch ?? "Working changes";
}
/** Repository names help only when the list spans more than one repository. */
function qualifiers(rows: Workspace[]) {
  const names = new Set(
    rows.flatMap((entry) =>
      entry.kind === "repository" && entry.repository ? [entry.repository] : [],
    ),
  );
  return (workspace: Workspace) =>
    names.size > 1 && workspace.kind === "repository" ? workspace.repository : undefined;
}

/**
 * The open workspaces, at the top of a sidebar. It appears with the second
 * workspace; one workspace needs no list.
 */
export function WorkspaceList({ onNew }: { onNew?(): void }) {
  const snapshot = use(Snapshot);
  const actions = use(Actions);
  if (!snapshot || !actions) return null;
  const rows = orderedWorkspaces(snapshot);
  if (rows.length < 2) return null;
  const qualifier = qualifiers(rows);
  return (
    <nav aria-label="Workspaces" {...stylex.props(styles.list)}>
      <div {...stylex.props(styles.heading)}>
        <span>Workspaces</span>
        {onNew && (
          <ActionTooltip label="New workspace" shortcut="Mod+Enter">
            <button
              type="button"
              aria-label="New workspace"
              onClick={onNew}
              {...stylex.props(styles.add)}
            >
              <Icon name="plus" size={12} />
            </button>
          </ActionTooltip>
        )}
      </div>
      <ul {...stylex.props(styles.rows)}>
        {rows.map((workspace, index) => {
          const current = workspace.id === snapshot.active;
          const label = labelFor(workspace);
          const repository = qualifier(workspace);
          const closable = workspace.kind !== "vault";
          return (
            <li key={workspace.id} {...stylex.props(styles.item, stylex.defaultMarker())}>
              <button
                type="button"
                aria-current={current ? "page" : undefined}
                aria-keyshortcuts={index < 9 ? `Meta+${index + 1} Control+${index + 1}` : undefined}
                title={
                  workspace.kind === "repository" && workspace.path
                    ? `${label}\n${workspace.path}`
                    : undefined
                }
                onClick={() => actions.activate(workspace.id)}
                onKeyDown={(event) => {
                  if (closable && (event.key === "Delete" || event.key === "Backspace")) {
                    event.preventDefault();
                    actions.close(workspace.id);
                  }
                }}
                {...stylex.props(styles.row, current && styles.current)}
              >
                <Icon name={iconFor(workspace)} size={14} />
                <span {...stylex.props(styles.name)}>
                  {repository && <span {...stylex.props(styles.repository)}>{repository} / </span>}
                  {label}
                </span>
                {workspace.detail && (
                  <span {...stylex.props(styles.detail, closable && styles.detailHides)}>
                    {workspace.detail}
                    <span {...stylex.props(styles.hidden)}> changed files</span>
                  </span>
                )}
              </button>
              {closable && (
                <button
                  type="button"
                  tabIndex={-1}
                  aria-label={`Close ${label}`}
                  title={`Close ${label}`}
                  onClick={() => actions.close(workspace.id)}
                  {...stylex.props(styles.close)}
                >
                  <Icon name="close" size={12} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * Recent workspaces, most recent first. Held ⌃Tab steps through them and
 * releasing Control shows the selection, as an app switcher does. From the
 * palette it stays open until Return, a click, or Escape.
 */
function WorkspaceSwitcher({
  snapshot,
  held,
  controlHeld,
  reverse,
  onChoose,
  onCancel,
}: {
  snapshot: WorkspaceSnapshot;
  held: boolean;
  controlHeld(): boolean;
  reverse: boolean;
  onChoose(id: string): void;
  onCancel(): void;
}) {
  const ordered = orderedWorkspaces(snapshot);
  const rows = snapshot.recent.flatMap((id) => ordered.find((entry) => entry.id === id) ?? []);
  const [index, setIndex] = useState(() =>
    // The current workspace is first; start on the one before it.
    rows.length < 2 ? 0 : reverse ? rows.length - 1 : 1,
  );
  const list = useRef<HTMLDivElement>(null);
  const qualifier = qualifiers(ordered);
  const selected = rows[Math.min(index, rows.length - 1)];

  useEffect(() => {
    const previous = document.activeElement;
    list.current?.focus({ preventScroll: true });
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  useLayoutEffect(() => {
    // Control was released before this listened: a quick tap toggles back.
    if (held && !controlHeld() && selected) return onChoose(selected.id);
    const step = (by: number) => setIndex((value) => (value + by + rows.length) % rows.length);
    const keydown = (event: KeyboardEvent) => {
      const keys: Record<string, () => void> = {
        Tab: () => step(event.shiftKey ? -1 : 1),
        ArrowDown: () => step(1),
        ArrowUp: () => step(-1),
        Enter: () => selected && onChoose(selected.id),
        Escape: onCancel,
      };
      const action = keys[event.key];
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      action();
    };
    const keyup = (event: KeyboardEvent) => {
      if (held && event.key === "Control" && selected) onChoose(selected.id);
    };
    window.addEventListener("keydown", keydown, true);
    window.addEventListener("keyup", keyup, true);
    window.addEventListener("blur", onCancel);
    return () => {
      window.removeEventListener("keydown", keydown, true);
      window.removeEventListener("keyup", keyup, true);
      window.removeEventListener("blur", onCancel);
    };
  }, [controlHeld, held, onCancel, onChoose, rows.length, selected]);

  if (!rows.length) return null;
  return (
    <div {...stylex.props(styles.scrim)} onPointerDown={onCancel}>
      <div
        role="dialog"
        aria-label="Switch workspace"
        data-workspace-switcher
        onPointerDown={(event) => event.stopPropagation()}
        {...stylex.props(styles.switcher)}
      >
        <div
          ref={list}
          role="listbox"
          tabIndex={-1}
          aria-label="Recent workspaces"
          aria-activedescendant={selected ? `workspace-switch-${selected.id}` : undefined}
          {...stylex.props(styles.switchList)}
        >
          {rows.map((workspace, position) => {
            const place = ordered.indexOf(workspace);
            const repository = qualifier(workspace);
            return (
              <div
                key={workspace.id}
                id={`workspace-switch-${workspace.id}`}
                role="option"
                tabIndex={-1}
                aria-selected={workspace === selected}
                onPointerMove={() => setIndex(position)}
                onClick={() => onChoose(workspace.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") onChoose(workspace.id);
                }}
                {...stylex.props(styles.option, workspace === selected && styles.optionSelected)}
              >
                <Icon name={iconFor(workspace)} size={14} />
                <span {...stylex.props(styles.name)}>
                  {repository && <span {...stylex.props(styles.repository)}>{repository} / </span>}
                  {labelFor(workspace)}
                </span>
                {workspace.id === snapshot.active && (
                  <span {...stylex.props(styles.here)}>Current</span>
                )}
                {place < 9 && <ShortcutKeys value={`Mod+${place + 1}`} />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const appear = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-4px) scale(0.985)" },
  to: { opacity: 1, transform: "none" },
});
const settle = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(-3px)" },
  to: { opacity: 1, transform: "none" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  // The list sits under the sidebar's identity row and above History. It
  // appears with the second workspace, so it settles in rather than sliding.
  list: {
    display: "flex",
    flexDirection: "column",
    flexShrink: 0,
    paddingBottom: 6,
    animationName: { default: settle, [reduced]: "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
  },
  heading: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    height: 30,
    paddingInlineStart: 14,
    paddingInlineEnd: 8,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
  },
  add: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 22,
    height: 22,
    padding: 0,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    margin: 0,
    padding: 0,
    paddingInline: 6,
    listStyle: "none",
    maxHeight: 236,
    overflowY: "auto",
    scrollbarWidth: "thin",
  },
  item: { position: "relative", display: "flex" },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flex: "1",
    minWidth: 0,
    height: 28,
    paddingInlineStart: 8,
    paddingInlineEnd: 8,
    borderWidth: 0,
    borderRadius: 7,
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
  current: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
    fontWeight: 500,
  },
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  repository: { color: tokens.faint, fontWeight: 450 },
  detail: {
    flexShrink: 0,
    color: tokens.faint,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  // The close control takes the status's place while the row is hovered.
  detailHides: {
    opacity: {
      default: 1,
      [stylex.when.ancestor(":hover")]: 0,
      [stylex.when.ancestor(":focus-within")]: 0,
    },
  },
  close: {
    position: "absolute",
    insetInlineEnd: 11,
    top: 5,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: 5,
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    cursor: "pointer",
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  scrim: { position: "fixed", inset: 0, zIndex: 120 },
  switcher: {
    position: "fixed",
    top: "18vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(440px, calc(100vw - 32px))",
    boxSizing: "border-box",
    padding: 6,
    borderRadius: 12,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, ${tokens.shadow}`,
    color: tokens.text,
    fontFamily: tokens.ui,
    animationName: { default: appear, [reduced]: "none" },
    animationDuration: "140ms",
    animationTimingFunction: tokens.easeOut,
  },
  switchList: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    maxHeight: "56vh",
    overflowY: "auto",
    outline: "none",
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 34,
    paddingInline: 10,
    borderRadius: 8,
    color: tokens.muted,
    fontSize: 13,
    cursor: "pointer",
  },
  optionSelected: { backgroundColor: tokens.fillStrong, color: tokens.text },
  here: { color: tokens.faint, fontSize: 11 },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
