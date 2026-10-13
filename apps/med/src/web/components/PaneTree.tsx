import * as stylex from "@stylexjs/stylex";
import {
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
  balance as balanceTree,
  balanced,
  fit,
  has,
  insert,
  isSplit,
  layout,
  leaves,
  neighbor,
  parseTree,
  remove,
  resize as resizeTree,
  withSizes,
  type Direction,
  type Gutter,
  type PaneNode,
  type Rect,
  type Side,
} from "../data/pane-tree";
import { tokens } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { ToolButton } from "./ToolButton";

/** The room between panes and around them, in pixels. */
export const PANE_GAP = 6;
const STORAGE = "med:panes:v1:";
const KEYBOARD_STEP = 24;

export interface PaneSpec {
  id: string;
  label: string;
  /** The pane's landmark name. */
  ariaLabel: string;
  icon: IconName;
  /** Close the pane; by default the tree closes it. */
  onClose?(): void;
  /** Mount the pane hidden before it first shows, so it opens at once. */
  preload?: boolean;
  /** Where the pane opens when nothing says otherwise. */
  place?: { near?: string; side?: Side; share?: number };
  /** The pane cannot close, such as the review. */
  fixed?: boolean;
  /** The pane with its header; `controls` go at the header's end. */
  render(controls: ReactNode): ReactNode;
}

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* The layout lasts for this window. */
  }
}

interface Stored {
  root: PaneNode | null;
  zoom: string | null;
}

function load(key: string | undefined, initial: () => PaneNode | null): Stored {
  const saved = key ? read(STORAGE + key) : null;
  if (saved) {
    try {
      const value = JSON.parse(saved) as { root?: unknown; zoom?: unknown };
      const root = parseTree(value.root);
      if (root)
        return {
          root,
          zoom: typeof value.zoom === "string" && has(root, value.zoom) ? value.zoom : null,
        };
    } catch {
      /* A broken layout starts over. */
    }
  }
  return { root: initial(), zoom: null };
}

/**
 * The panes of a workspace: which are open and how they split the room,
 * which one has focus, and which one fills the room (zoom). The layout
 * persists for each workspace `key`, so a workspace opens as it was left.
 */
interface PaneView {
  focused: string | null;
  entering: string | null;
}
function createPaneView() {
  let value: PaneView = { focused: null, entering: null };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(change: Partial<PaneView>) {
      const next = { ...value, ...change };
      if (next.focused === value.focused && next.entering === value.entering) return;
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  };
}

export function usePaneTree({
  key,
  initial,
  persist = true,
}: {
  key?: string;
  initial: () => PaneNode | null;
  persist?: boolean;
}) {
  const storageKey = persist ? key : undefined;
  const [state, setState] = useState(() => ({ key: storageKey, ...load(storageKey, initial) }));
  // Another workspace's layout replaces this one while rendering, so the
  // old layout never shows under the new key.
  let current = state;
  if (state.key !== storageKey) {
    current = { key: storageKey, ...load(storageKey, initial) };
    setState(current);
  }
  const { root, zoom } = current;
  // The pane the reader chose last, and the pane that just opened and settles
  // in. Only the tree reads them, so a click in another pane renders the tree
  // alone, not the workspace.
  const [view] = useState(createPaneView);
  // A pane stays mounted once shown, so it keeps its scroll and its stream.
  const [mounted, setMounted] = useState<ReadonlySet<string>>(() => new Set(leaves(root)));
  const open = useMemo(() => leaves(root), [root]);
  if (open.some((id) => !mounted.has(id))) setMounted(new Set([...mounted, ...open]));

  useEffect(() => {
    if (!storageKey) return;
    const timer = setTimeout(
      () => write(STORAGE + storageKey, root ? JSON.stringify({ root, zoom }) : null),
      150,
    );
    return () => clearTimeout(timer);
  }, [storageKey, root, zoom]);

  // A change that leaves the layout as it was keeps the same state, so no
  // pane renders again for it.
  const update = useCallback(
    (change: (value: { root: PaneNode | null; zoom: string | null }) => Partial<Stored>) =>
      setState((value) => {
        const next = change(value);
        const root = "root" in next ? (next.root ?? null) : value.root;
        const zoom = "zoom" in next ? (next.zoom ?? null) : value.zoom;
        return root === value.root && zoom === value.zoom ? value : { ...value, root, zoom };
      }),
    [],
  );

  const show = useCallback(
    (id: string, place: { near?: string; side?: Side; share?: number; quiet?: boolean } = {}) => {
      update(({ root, zoom }) => {
        if (has(root, id)) return { zoom: zoom && zoom !== id ? null : zoom };
        // A quiet show, such as a pane that follows the main view, takes only free room.
        if (place.quiet && leaves(root).length >= 3) return {};
        return { root: insert(root, id, place), zoom: null };
      });
      if (!open.includes(id) && !(place.quiet && open.length >= 3)) view.set({ entering: id });
      if (!place.quiet) view.set({ focused: id });
    },
    [update, open, view],
  );
  const close = useCallback(
    (id: string) => {
      update(({ root, zoom }) =>
        has(root, id) ? { root: remove(root, id), zoom: zoom === id ? null : zoom } : {},
      );
      if (view.get().focused === id) view.set({ focused: null });
    },
    [update, view],
  );
  const isOpen = useCallback((id: string) => open.includes(id), [open]);
  const toggle = useCallback(
    (id: string, place?: { near?: string; side?: Side; share?: number }) =>
      open.includes(id) ? close(id) : show(id, place),
    [open, close, show],
  );
  const toggleZoom = useCallback(
    (id?: string | null) =>
      update(({ root, zoom }) => {
        const target = id ?? zoom;
        if (!target || !has(root, target) || leaves(root).length < 2) return { zoom: null };
        return { zoom: zoom === target ? null : target };
      }),
    [update],
  );
  const resize = useCallback(
    (path: number[], index: number, delta: number, length: number) =>
      update(({ root }) => ({
        root: root && resizeTree(root, path, index, delta, length, PANE_GAP),
      })),
    [update],
  );
  const setSizes = useCallback(
    (path: number[], sizes: number[]) =>
      update(({ root }) => ({ root: root && withSizes(root, path, sizes) })),
    [update],
  );
  const balance = useCallback(
    () => update(({ root }) => ({ root: root && balanceTree(root), zoom: null })),
    [update],
  );
  const reset = useCallback(
    () => update(() => ({ root: initial(), zoom: null })),
    [update, initial],
  );

  return useMemo(
    () => ({
      root,
      zoom: zoom && open.includes(zoom) ? zoom : null,
      open,
      view,
      /** The focused pane now: the chosen one, else the first. */
      focused: () => {
        const chosen = view.get().focused;
        return chosen && open.includes(chosen) ? chosen : (open[0] ?? null);
      },
      mounted,
      isOpen,
      show,
      close,
      toggle,
      toggleZoom,
      focus: (id: string | null) => view.set({ focused: id }),
      resize,
      setSizes,
      balance,
      balanced: balanced(root),
      reset,
    }),
    [
      root,
      zoom,
      open,
      view,
      mounted,
      isOpen,
      show,
      close,
      toggle,
      toggleZoom,
      resize,
      setSizes,
      balance,
      reset,
    ],
  );
}
export type PaneTreeState = ReturnType<typeof usePaneTree>;

/** A plain pane header: an icon, a title, a detail, and the pane controls. */
export function PaneHeader({
  icon,
  title,
  detail,
  controls,
}: {
  icon: IconName;
  title: string;
  detail?: ReactNode;
  controls: ReactNode;
}) {
  return (
    <header {...stylex.props(styles.header)}>
      <Icon name={icon} size={14} />
      <span {...stylex.props(styles.title)}>{title}</span>
      {detail !== undefined && <span {...stylex.props(styles.detail)}>{detail}</span>}
      <span {...stylex.props(styles.grow)} />
      {controls}
    </header>
  );
}

/** Zoom and Close at the end of a pane's header. */
export function PaneControls({
  label,
  zoomable,
  zoomed,
  onZoom,
  onClose,
}: {
  label: string;
  zoomable: boolean;
  zoomed: boolean;
  onZoom(): void;
  onClose?(): void;
}) {
  const name = label.toLowerCase();
  return (
    <>
      {zoomable && (
        <ToolButton
          label={zoomed ? `Restore ${name}` : `Zoom ${name}`}
          shortcut="Mod+E"
          icon={zoomed ? "restore" : "maximize"}
          aria-pressed={zoomed}
          onClick={onZoom}
        />
      )}
      {onClose && <ToolButton label={`Close ${name}`} icon="close" onClick={onClose} />}
    </>
  );
}

function useBox(element: HTMLElement | null) {
  const [box, setBox] = useState<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!element) return;
    const measure = () => {
      const width = element.clientWidth;
      const height = element.clientHeight;
      setBox((value) =>
        value.width === width && value.height === height ? value : { x: 0, y: 0, width, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);
  return box;
}

/** Moves focus into a pane: its last focused element, or the pane itself. */
function focusPane(element: Element | null | undefined) {
  if (!(element instanceof HTMLElement)) return;
  const inside = element.querySelector<HTMLElement>(
    "[data-pane-autofocus], textarea:not([disabled]), [role=tabpanel][tabindex], [tabindex='0']",
  );
  (inside ?? element).focus({ preventScroll: true });
}

/**
 * A workspace's panes, tiled as their tree says, as cards with gutters that
 * resize them. Each pane keeps one element for its life: splitting, zooming,
 * or closing another pane only moves it, so its scroll and its state stay.
 */
export function PaneTree({
  state,
  panes,
  label = "Panes",
}: {
  state: PaneTreeState;
  panes: PaneSpec[];
  label?: string;
}) {
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const box = useBox(element);
  const view = useSyncExternalStore(state.view.subscribe, state.view.get);
  const chosen = view.focused && state.open.includes(view.focused) ? view.focused : null;
  const focusedId = chosen ?? state.open[0] ?? null;
  // In a small window, panes that do not fit leave from the left; the chosen
  // pane and the fixed one stay. When those do not fit either, one shows.
  const fixed = panes.find((pane) => pane.fixed)?.id ?? null;
  const shownTree = useMemo(
    () =>
      fit(
        state.root,
        box,
        PANE_GAP,
        [chosen, fixed].filter((id): id is string => !!id),
        chosen ?? fixed,
      ),
    [state.root, chosen, fixed, box],
  );
  const { panes: rects, gutters } = useMemo(
    () => layout(shownTree, box, PANE_GAP),
    [shownTree, box],
  );
  const zoomed = state.zoom;
  const several = rects.size > 1;
  const rectsRef = useRef(rects);
  useLayoutEffect(() => {
    rectsRef.current = rects;
  }, [rects]);

  // Keys that act on the focused pane, from anywhere in the workspace.
  useEffect(() => {
    if (!element) return;
    const scope = element.closest("[data-pane-scope]") ?? element;
    const keydown = (event: Event) => {
      const key = event as KeyboardEvent;
      if (key.defaultPrevented || key.isComposing) return;
      if (!element.offsetParent) return;
      const mod = key.metaKey || key.ctrlKey;
      // Vim keeps Control in the editor on macOS (Control+E scrolls).
      const inEditor = (key.target as HTMLElement).closest?.(".cm-editor");
      if (inEditor && key.ctrlKey && !key.metaKey && /Mac/.test(navigator.platform)) return;
      if (mod && !key.altKey && !key.shiftKey && key.key.toLowerCase() === "e") {
        if (state.open.length < 2) return;
        key.preventDefault();
        state.toggleZoom(state.zoom ?? state.focused());
        return;
      }
      const arrows: Record<string, Direction> = {
        ArrowLeft: "left",
        ArrowRight: "right",
        ArrowUp: "above",
        ArrowDown: "below",
      };
      const direction = arrows[key.key];
      const from = state.focused();
      if (mod && key.altKey && !key.shiftKey && direction && from && !state.zoom) {
        const next = neighbor(rectsRef.current, from, direction);
        if (!next) return;
        key.preventDefault();
        state.focus(next);
        focusPane(element.querySelector(`[data-pane="${CSS.escape(next)}"]`));
      }
    };
    scope.addEventListener("keydown", keydown);
    return () => scope.removeEventListener("keydown", keydown);
  }, [element, state]);

  const byId = new Map(panes.map((pane) => [pane.id, pane]));
  const full: Rect = { x: 0, y: 0, width: box.width, height: box.height };
  return (
    <div
      ref={setElement}
      role="group"
      aria-label={label}
      data-pane-tree=""
      data-zoomed={zoomed ?? undefined}
      {...stylex.props(styles.tree)}
    >
      {panes.map((pane) => {
        const open = state.open.includes(pane.id);
        if (!open && !pane.preload && !state.mounted.has(pane.id)) return null;
        const rect = zoomed ? (zoomed === pane.id ? full : rects.get(pane.id)) : rects.get(pane.id);
        const behind = !!zoomed && zoomed !== pane.id && open;
        const shown = open && !!rect && box.width > 0;
        const focused = several && focusedId === pane.id && !zoomed;
        return (
          <section
            key={pane.id}
            aria-label={pane.ariaLabel}
            data-pane={pane.id}
            data-focused={focused || undefined}
            onAnimationEnd={(event) =>
              event.target === event.currentTarget && state.view.set({ entering: null })
            }
            hidden={!shown}
            inert={behind || undefined}
            tabIndex={-1}
            onPointerDownCapture={() => chosen !== pane.id && state.focus(pane.id)}
            onFocusCapture={() => chosen !== pane.id && state.focus(pane.id)}
            {...stylex.props(
              styles.pane,
              rect && styles.rect(rect.x, rect.y, rect.width, rect.height),
              !shown && styles.hidden,
              view.entering === pane.id && styles.entering,
              behind && styles.behind,
              zoomed === pane.id && styles.zoomed,
            )}
          >
            {pane.render(
              <PaneControls
                label={pane.label}
                zoomable={several}
                zoomed={zoomed === pane.id}
                onZoom={() => state.toggleZoom(pane.id)}
                onClose={
                  pane.fixed
                    ? undefined
                    : () => (pane.onClose ? pane.onClose() : state.close(pane.id))
                }
              />,
            )}
          </section>
        );
      })}
      {!zoomed &&
        gutters.map((gutter) => (
          <PaneGutter
            key={`${gutter.path.join(".")}:${gutter.index}`}
            gutter={gutter}
            state={state}
            byId={byId}
          />
        ))}
    </div>
  );
}

/** The panes on each side of a gutter, for its name. */
function sideLabels(state: PaneTreeState, gutter: Gutter, byId: Map<string, PaneSpec>) {
  let node: PaneNode | null = state.root;
  for (const index of gutter.path) node = node && isSplit(node) ? node.children[index]! : null;
  if (!node || !isSplit(node)) return "panes";
  const name = (child: PaneNode | undefined) =>
    leaves(child ?? null)
      .map((id) => byId.get(id)?.label ?? id)
      .join(" and ");
  return `${name(node.children[gutter.index])} and ${name(node.children[gutter.index + 1])}`;
}

function PaneGutter({
  gutter,
  state,
  byId,
}: {
  gutter: Gutter;
  state: PaneTreeState;
  byId: Map<string, PaneSpec>;
}) {
  const drag = useRef<{ start: number; root: PaneNode; frame: number } | null>(null);
  const row = gutter.axis === "row";
  const { rect } = gutter;
  const size = (node: PaneNode | null) => {
    let split: PaneNode | null = node;
    for (const index of gutter.path)
      split = split && isSplit(split) ? split.children[index]! : null;
    return split && isSplit(split) ? split.sizes : [];
  };
  const sizes = size(state.root);
  const share = Math.round((sizes[gutter.index] ?? 0) * 100);
  return (
    <div
      role="separator"
      aria-label={`Resize ${sideLabels(state, gutter, byId)}`}
      aria-orientation={row ? "vertical" : "horizontal"}
      aria-valuenow={share}
      aria-valuemin={0}
      aria-valuemax={100}
      tabIndex={0}
      data-pane-gutter=""
      {...stylex.props(
        styles.gutter,
        styles.rect(rect.x, rect.y, rect.width, rect.height),
        row ? styles.gutterRow : styles.gutterColumn,
        stylex.defaultMarker(),
      )}
      onPointerDown={(event) => {
        if (event.button !== 0 || !state.root) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { start: row ? event.clientX : event.clientY, root: state.root, frame: 0 };
        document.documentElement.dataset.paneResizing = row ? "row" : "column";
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        const delta = (row ? event.clientX : event.clientY) - active.start;
        cancelAnimationFrame(active.frame);
        // One layout per frame; each step starts from the tree at the press.
        active.frame = requestAnimationFrame(() =>
          state.setSizes(
            gutter.path,
            size(
              resizeTree(active.root, gutter.path, gutter.index, delta, gutter.length, PANE_GAP),
            ),
          ),
        );
      }}
      onPointerUp={() => {
        drag.current = null;
        delete document.documentElement.dataset.paneResizing;
      }}
      onLostPointerCapture={() => {
        drag.current = null;
        delete document.documentElement.dataset.paneResizing;
      }}
      onDoubleClick={() =>
        state.setSizes(
          gutter.path,
          sizes.map(() => 1),
        )
      }
      onKeyDown={(event) => {
        const back = row ? "ArrowLeft" : "ArrowUp";
        const forward = row ? "ArrowRight" : "ArrowDown";
        if (event.key === back || event.key === forward) {
          event.preventDefault();
          const step = (event.shiftKey ? 4 : 1) * KEYBOARD_STEP;
          state.resize(gutter.path, gutter.index, event.key === back ? -step : step, gutter.length);
        } else if (event.key === "Enter") {
          event.preventDefault();
          state.setSizes(
            gutter.path,
            sizes.map(() => 1),
          );
        }
      }}
    >
      <span {...stylex.props(styles.gutterLine, row ? styles.lineRow : styles.lineColumn)} />
    </div>
  );
}

const enter = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.985)" },
  to: { opacity: 1, transform: "scale(1)" },
});
const reduced = "@media (prefers-reduced-motion: reduce)";

const styles = stylex.create({
  tree: {
    position: "relative",
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    minHeight: 0,
    // A drag never selects text or lets a pane take the pointer.
    userSelect: { default: null, ":is(html[data-pane-resizing] *)": "none" },
  },
  pane: {
    position: "absolute",
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: tokens.frame,
    backgroundColor: tokens.canvas,
    boxShadow: {
      default: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
      ":is([data-focused])": `0 0 0 1px ${tokens.lineStrong}, 0 1px 3px #0000000f`,
    },
    transitionProperty: "box-shadow",
    transitionDuration: "120ms",
    outline: "none",
    contain: "strict",
    pointerEvents: { default: null, ":is(html[data-pane-resizing] *)": "none" },
  },
  rect: (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
  }),
  hidden: { display: "none" },
  entering: {
    animationName: { default: enter, [reduced]: "none" },
    animationDuration: "180ms",
    animationTimingFunction: tokens.easeOut,
  },
  // Zoom keeps the other panes laid out, so they keep their scroll.
  behind: { visibility: "hidden" },
  zoomed: { zIndex: 1 },
  gutter: {
    position: "absolute",
    zIndex: 2,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    outline: "none",
    touchAction: "none",
    // The hit area reaches past the gap into the panes' edges.
    "::before": { content: "''", position: "absolute", inset: -3 },
  },
  gutterRow: { cursor: "col-resize" },
  gutterColumn: { cursor: "row-resize" },
  // The line shows after a short hover, at once while dragged or focused.
  gutterLine: {
    borderRadius: 2,
    backgroundColor: tokens.accentLine,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-visible")]: 1,
      [stylex.when.ancestor(":active")]: 1,
    },
    transitionProperty: "opacity",
    transitionDuration: "120ms",
    transitionDelay: {
      default: "0ms",
      [stylex.when.ancestor(":hover")]: "250ms",
      [stylex.when.ancestor(":active")]: "0ms",
    },
  },
  lineRow: { width: 2, height: "min(48px, 40%)" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 40,
    flexShrink: 0,
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
    fontFamily: tokens.ui,
  },
  title: { flexShrink: 0, color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  detail: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 12,
  },
  grow: { flex: "1" },
  lineColumn: { height: 2, width: "min(48px, 40%)" },
});
