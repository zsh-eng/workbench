import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { tokens } from "../theme.stylex";
import { Icon, type IconName } from "./Icon";
import { ToolButton } from "./ToolButton";

export type PaneId = "session" | "files" | "preview";
/** Two panes one above the other, or one pane at a time behind tabs. */
export type PaneLayout = "stack" | "tabs";

const WIDTH_KEY = "med:pane-width";
const LAYOUT_KEY = "med:pane-layout";
const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const DEFAULT_WIDTH = 400;
/** The stack shows this many panes; opening another closes the oldest. */
const STACKED = 2;

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* The choice lasts for this window. */
  }
}
const clamp = (width: number) => Math.round(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, width)));

/**
 * The right column's panes: which are open, in the order they opened, which
 * fills the column, and the column's width and layout. The width and layout
 * persist; open panes do not. A demo can start with panes open and keep its
 * choices to itself.
 */
export function usePaneColumn({
  persist = true,
  layout: initialLayout,
  initial = [],
}: { persist?: boolean; layout?: PaneLayout; initial?: PaneId[] } = {}) {
  const [open, setOpen] = useState<PaneId[]>(initial);
  const [active, setActive] = useState<PaneId | null>(initial.at(-1) ?? null);
  const [maximized, setMaximized] = useState<PaneId | null>(null);
  const [layout, setLayoutState] = useState<PaneLayout>(
    () => initialLayout ?? (persist && read(LAYOUT_KEY) === "tabs" ? "tabs" : "stack"),
  );
  const [width, setWidthState] = useState(() =>
    clamp((persist && Number(read(WIDTH_KEY))) || DEFAULT_WIDTH),
  );
  // A pane stays mounted once shown, so it keeps its scroll and its thread.
  const [mounted, setMounted] = useState<ReadonlySet<PaneId>>(() => new Set(initial));

  /**
   * Opens a pane. A full stack closes its oldest pane. A quiet show, such as
   * a pane that follows the main view, takes only free room and leaves the
   * shown tab.
   */
  const show = useCallback(
    (id: PaneId, { quiet = false }: { quiet?: boolean } = {}) => {
      if (!open.includes(id)) {
        if (quiet && layout === "stack" && open.length >= STACKED) return;
        const next = [...open, id];
        setOpen(layout === "stack" ? next.slice(-STACKED) : next);
      }
      setActive((current) => (quiet && current && open.includes(current) ? current : id));
      setMounted((set) => (set.has(id) ? set : new Set([...set, id])));
    },
    [layout, open],
  );
  const close = useCallback(
    (id: PaneId) => {
      if (!open.includes(id)) return;
      const next = open.filter((entry) => entry !== id);
      setOpen(next);
      setActive((current) => (current === id ? (next.at(-1) ?? null) : current));
      setMaximized((current) => (current === id ? null : current));
    },
    [open],
  );
  const isOpen = useCallback((id: PaneId) => open.includes(id), [open]);
  const toggle = useCallback(
    (id: PaneId) => {
      // In tabs, a pane behind another tab comes forward before it closes.
      if (open.includes(id) && (layout === "stack" || active === id)) close(id);
      else show(id);
    },
    [open, layout, active, close, show],
  );
  const setLayout = useCallback(
    (next: PaneLayout) => {
      setLayoutState(next);
      if (persist) write(LAYOUT_KEY, next);
      if (next === "stack") setOpen((list) => list.slice(-STACKED));
      setMaximized(null);
    },
    [persist],
  );
  const setWidth = useCallback((next: number) => setWidthState(clamp(next)), []);
  useEffect(() => {
    if (!persist) return;
    const timer = setTimeout(() => write(WIDTH_KEY, String(width)), 200);
    return () => clearTimeout(timer);
  }, [width, persist]);

  return useMemo(
    () => ({
      open,
      active: active && open.includes(active) ? active : (open.at(-1) ?? null),
      maximized,
      layout,
      width,
      mounted,
      isOpen,
      show,
      close,
      toggle,
      select: setActive,
      maximize: setMaximized,
      setLayout,
      setWidth,
    }),
    [
      open,
      active,
      maximized,
      layout,
      width,
      mounted,
      isOpen,
      show,
      close,
      toggle,
      setLayout,
      setWidth,
    ],
  );
}
export type PaneColumnState = ReturnType<typeof usePaneColumn>;

export interface PaneSpec {
  id: PaneId;
  label: string;
  /** The pane's landmark name. */
  ariaLabel: string;
  icon: IconName;
  /** Close the pane; by default the column closes it. */
  onClose?(): void;
  /** Mount the pane hidden before it first shows, so it opens at once. */
  preload?: boolean;
  /** The pane with its header; `controls` go at the header's end. */
  render(controls: ReactNode): ReactNode;
}

/** Maximize and Close at the end of a pane's header. */
function PaneControls({
  label,
  canMaximize,
  maximized,
  onMaximize,
  onClose,
}: {
  label: string;
  canMaximize: boolean;
  maximized: boolean;
  onMaximize(): void;
  onClose(): void;
}) {
  return (
    <>
      {canMaximize && (
        <ToolButton
          label={maximized ? `Restore ${label.toLowerCase()}` : `Maximize ${label.toLowerCase()}`}
          icon={maximized ? "restore" : "maximize"}
          aria-pressed={maximized}
          onClick={onMaximize}
        />
      )}
      <ToolButton label={`Close ${label.toLowerCase()}`} icon="close" onClick={onClose} />
    </>
  );
}

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

/**
 * One column on the right for the Session, Files, and Preview panes, with
 * one width. Stacked, it shows the two latest panes one above the other; a
 * maximized pane leaves the other as its header. With tabs, it shows one pane.
 */
export function PaneColumn({ state, panes }: { state: PaneColumnState; panes: PaneSpec[] }) {
  const { open, layout, maximized, width } = state;
  const visible = layout === "stack" ? open : open.filter((id) => id === state.active);
  const shown = open.length > 0;
  const stacked = layout === "stack" && open.length > 1;
  const byId = new Map(panes.map((pane) => [pane.id, pane]));
  return (
    <>
      <div
        role="separator"
        aria-label="Resize side panes"
        aria-orientation="vertical"
        aria-valuenow={width}
        aria-valuemin={MIN_WIDTH}
        aria-valuemax={MAX_WIDTH}
        tabIndex={0}
        hidden={!shown}
        {...stylex.props(styles.divider, stylex.defaultMarker(), !shown && styles.hidden)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            state.setWidth(width + (event.key === "ArrowLeft" ? 16 : -16));
          }
        }}
        onPointerDown={(event) => event.currentTarget.setPointerCapture(event.pointerId)}
        onPointerMove={(event) => {
          if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
          const right =
            event.currentTarget.nextElementSibling?.getBoundingClientRect().right ??
            window.innerWidth;
          state.setWidth(right - event.clientX);
        }}
      >
        <span {...stylex.props(styles.dividerLine)} />
      </div>
      <div
        data-pane-layout={layout}
        hidden={!shown}
        {...stylex.props(styles.column, styles.width(width), !shown && styles.hidden)}
      >
        {layout === "tabs" && open.length > 1 && (
          <div role="tablist" aria-label="Side panes" {...stylex.props(styles.tabs)}>
            {open.map((id) => {
              const pane = byId.get(id);
              if (!pane) return null;
              const selected = id === state.active;
              return (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => state.select(id)}
                  {...stylex.props(styles.tab, selected && styles.tabOn)}
                >
                  <Icon name={pane.icon} size={13} />
                  {pane.label}
                </button>
              );
            })}
          </div>
        )}
        {panes.map((pane) => {
          if (!pane.preload && !state.mounted.has(pane.id)) return null;
          const index = visible.indexOf(pane.id);
          const collapsed = stacked && maximized !== null && maximized !== pane.id;
          return (
            <aside
              key={pane.id}
              aria-label={pane.ariaLabel}
              data-pane={pane.id}
              hidden={index < 0}
              {...stylex.props(
                styles.pane,
                styles.order(index),
                stacked && index > 0 && styles.below,
                collapsed && styles.collapsed,
                index < 0 && styles.hidden,
              )}
            >
              {pane.render(
                <PaneControls
                  label={pane.label}
                  canMaximize={stacked}
                  maximized={maximized === pane.id}
                  onMaximize={() => state.maximize(maximized === pane.id ? null : pane.id)}
                  onClose={() => (pane.onClose ? pane.onClose() : state.close(pane.id))}
                />,
              )}
            </aside>
          );
        })}
      </div>
    </>
  );
}

const styles = stylex.create({
  hidden: { display: "none" },
  divider: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    width: 6,
    minWidth: 6,
    cursor: "col-resize",
    zIndex: 2,
    outline: "none",
    touchAction: "none",
  },
  // As the left sidebar's divider: the line shows after a short hover.
  dividerLine: {
    width: 2,
    height: "100%",
    borderRadius: `calc(1px * ${tokens.round})`,
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
  column: {
    flexShrink: 0,
    minWidth: MIN_WIDTH,
    maxWidth: "50vw",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: tokens.canvas,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  width: (width: number) => ({ width }),
  pane: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  order: (index: number) => ({ order: index }),
  below: { borderTopWidth: 1, borderTopStyle: "solid", borderTopColor: tokens.line },
  // A pane behind a maximized one keeps its header, so it stays in reach.
  collapsed: { flexGrow: 0, flexBasis: 40, height: 40 },
  tabs: {
    display: "flex",
    flexShrink: 0,
    gap: 2,
    paddingInline: 6,
    paddingTop: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  tab: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingInline: 10,
    marginBottom: -1,
    borderWidth: 0,
    borderBottomWidth: 2,
    borderBottomStyle: "solid",
    borderBottomColor: "transparent",
    backgroundColor: "transparent",
    color: { default: tokens.faint, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  tabOn: { color: tokens.text, borderBottomColor: tokens.text },
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
});
