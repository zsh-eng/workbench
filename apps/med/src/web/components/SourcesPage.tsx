import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { picked, tokens, ui } from "../theme.stylex";
import { openWelcome } from "../data/setup";
import { visibleElement } from "../data/palette-focus";
import { useTitleBarOverlay } from "../data/title-bar";
import { CardTab, tabbedCard } from "./CardTab";
import { Icon } from "./Icon";
import { ToolButton } from "./ToolButton";
import { displayPath } from "./welcome/Welcome";
import { byName, useWorkspaceActions } from "./Workspaces";

export interface Source {
  id: string;
  name: string;
  path: string;
  kind: "repo" | "vault";
  index?: {
    state: string;
    revision: number;
    error?: string;
    result?: { notes?: number; files?: number };
  };
}

/** The registered repositories and vaults: open one, index a vault again, or
 * remove a registration. Removing never touches the folder. */
export function SourcesPage({
  sources,
  home,
  loaded,
  notice,
  onOpenVault,
  onRequest,
  onCommands,
}: {
  sources: Source[];
  home?: string;
  loaded: boolean;
  notice?: ReactNode;
  onOpenVault(id: string): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
  onCommands(): void;
}) {
  const actions = useWorkspaceActions();
  const tab = useTitleBarOverlay();
  const back = () => {
    const active = actions?.getSnapshot().active;
    if (actions && active) actions.activate(active);
    else location.assign("/");
  };
  // Escape returns to the workspace, as it closes the other overlays.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (visibleElement('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      back();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const openRepository = (source: Source) => {
    if (!actions) return location.assign("/");
    const open = actions
      .getSnapshot()
      .workspaces.find((entry) => entry.kind === "repository" && entry.path === source.path);
    if (open) actions.activate(open.id);
    else
      actions.open({
        kind: "repository",
        path: source.path,
        title: source.name,
        repository: source.name,
      });
  };
  return (
    <SourcesView
      sources={sources}
      home={home}
      loaded={loaded}
      tab={tab}
      notice={notice}
      onBack={back}
      onOpen={(source) =>
        source.kind === "vault" ? onOpenVault(source.id) : openRepository(source)
      }
      onAdd={openWelcome}
      onRequest={onRequest}
      onCommands={onCommands}
    />
  );
}

/**
 * The Sources page without the app's wiring. It takes the review's frame: one
 * card on the window's panel, headed by a row that is the card's tab when the
 * title bar is hidden.
 */
export function SourcesView({
  sources,
  home,
  loaded,
  tab = false,
  notice,
  onBack,
  onOpen,
  onAdd,
  onRequest,
  onCommands,
}: {
  sources: Source[];
  home?: string;
  loaded: boolean;
  /** The installed app hides its title bar: the card rises between the window controls. */
  tab?: boolean;
  notice?: ReactNode;
  onBack(): void;
  onOpen(source: Source): void;
  onAdd(): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
  onCommands(): void;
}) {
  const empty = loaded && !sources.length;
  const group = (title: string, rows: Source[]) =>
    rows.length > 0 && (
      <section aria-label={title} {...stylex.props(styles.group)}>
        <h2 {...stylex.props(styles.groupTitle)}>
          <span {...stylex.props(ui.label)}>{title}</span>
          <span {...stylex.props(styles.count)}>{rows.length}</span>
        </h2>
        <ul {...stylex.props(styles.rows)}>
          {rows.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              home={home}
              onOpen={() => onOpen(source)}
              onRequest={onRequest}
            />
          ))}
        </ul>
      </section>
    );
  return (
    <div {...stylex.props(styles.page, tab && styles.pageTab)}>
      <main aria-label="Sources" {...stylex.props(styles.card, tab && tabbedCard.card)}>
        {tab && <CardTab />}
        <header {...stylex.props(styles.header)}>
          <ToolButton label="Back" shortcut="Esc" icon="arrowLeft" onClick={onBack} />
          <h1 {...stylex.props(styles.title)}>Sources</h1>
          <span {...stylex.props(ui.grow)} />
          {!empty && (
            <button
              type="button"
              onClick={onAdd}
              {...stylex.props(ui.button, ui.pressable, styles.add)}
            >
              <Icon name="plus" size={13} />
              Add sources…
            </button>
          )}
          <ToolButton label="Commands" shortcut="⌘ K" icon="search" onClick={onCommands} />
        </header>
        <div {...stylex.props(styles.scroller)}>
          <div {...stylex.props(styles.column, empty && styles.emptyColumn)}>
            {notice}
            {empty ? (
              <div {...stylex.props(styles.empty)}>
                <h2 {...stylex.props(styles.emptyTitle)}>No sources yet</h2>
                <p {...stylex.props(styles.emptyText)}>
                  Add the Git repositories and Obsidian vaults you work in. Med finds them for you.
                </p>
                <button
                  type="button"
                  onClick={onAdd}
                  {...stylex.props(ui.button, ui.pressable, ui.primary, styles.emptyAdd)}
                >
                  Add sources…
                </button>
                <p {...stylex.props(styles.note)}>
                  From a terminal: <code {...stylex.props(styles.code)}>med add ~/code/my-app</code>
                </p>
              </div>
            ) : (
              <>
                {/* A vault is one more repository: one list, by name. */}
                {group("Repositories", [...sources].sort(byName))}
                {loaded && (
                  <p {...stylex.props(styles.note, styles.footnote)}>
                    Med keeps a workspace ready for each folder here. To add one from a terminal,
                    run <code {...stylex.props(styles.code)}>med add &lt;folder&gt;</code>. Removing
                    a source never changes its folder.
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Where the folder is. The row shows its name, so the folder's parent is
 * enough when the name is the folder's own, unless the parent is home. */
function folderPlace(source: Source, home?: string) {
  const shown = displayPath(source.path, home);
  const separator = shown.includes(" › ") ? " › " : "/";
  const cut = shown.lastIndexOf(separator);
  return cut > 0 &&
    shown.slice(0, cut) !== "~" &&
    shown.slice(cut + separator.length) === source.name
    ? shown.slice(0, cut)
    : shown;
}

function status(source: Source) {
  const index = source.index;
  if (source.kind !== "vault" || !index) return null;
  if (index.state === "error")
    return (
      <span title={index.error} {...stylex.props(styles.status, styles.failed)}>
        Index failed
      </span>
    );
  if (index.state !== "ready")
    return (
      <span {...stylex.props(styles.status)}>
        <span aria-hidden="true" {...stylex.props(styles.spinner)} />
        Indexing…
      </span>
    );
  const notes = index.result?.notes;
  return notes === undefined ? null : (
    <span {...stylex.props(styles.status)}>
      {notes.toLocaleString()} {notes === 1 ? "note" : "notes"}
    </span>
  );
}

function SourceRow({
  source,
  home,
  onOpen,
  onRequest,
}: {
  source: Source;
  home?: string;
  onOpen(): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
}) {
  const [menu, setMenu] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (action: "index" | "remove") => {
    setBusy(true);
    setError("");
    try {
      await onRequest(action, { source: source.id });
      setConfirming(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const vault = source.kind === "vault";
  if (confirming)
    return (
      <li {...stylex.props(styles.row, styles.confirm)} role="alert">
        <span {...stylex.props(styles.confirmText)}>
          Remove <strong {...stylex.props(styles.strong)}>{source.name}</strong> from Med? The
          folder stays as it is.
          {error && <span {...stylex.props(styles.failed)}> {error}</span>}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => setConfirming(false)}
          {...stylex.props(ui.button, ui.pressable)}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void run("remove")}
          {...stylex.props(ui.button, ui.pressable, styles.remove)}
        >
          Remove
        </button>
      </li>
    );
  return (
    <li {...stylex.props(styles.row, stylex.defaultMarker())}>
      <a
        href={vault ? `/vault/${source.id}` : "/"}
        title={source.path}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onOpen();
        }}
        {...stylex.props(styles.open)}
      >
        <span aria-hidden="true" {...stylex.props(styles.icon)}>
          <Icon name={vault ? "vault" : "gitBranch"} size={14} />
        </span>
        <span data-row="name" {...stylex.props(styles.name)}>
          {source.name}
        </span>
        <span data-row="path" {...stylex.props(styles.where)}>
          {folderPlace(source, home)}
        </span>
        {error ? (
          <span {...stylex.props(styles.status, styles.failed)}>{error}</span>
        ) : (
          status(source)
        )}
      </a>
      <Menu.Root open={menu} onOpenChange={setMenu}>
        <Menu.Trigger
          aria-label={`Actions for ${source.name}`}
          {...stylex.props(ui.button, ui.iconButton, styles.more, menu && styles.moreOpen)}
        >
          <Icon name="more" size={15} />
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="end" sideOffset={4} {...stylex.props(styles.positioner)}>
            <Menu.Popup {...stylex.props(ui.popup, styles.menu)}>
              {[
                { label: "Open", run: onOpen },
                ...(vault ? [{ label: "Index again", run: () => void run("index") }] : []),
                {
                  label: "Copy path",
                  run: () => void navigator.clipboard.writeText(source.path).catch(() => {}),
                },
              ].map((item) => (
                <Menu.Item
                  key={item.label}
                  onClick={item.run}
                  className={(state) =>
                    stylex.props(ui.menuItem, state.highlighted && [ui.menuHighlighted, picked])
                      .className
                  }
                >
                  {item.label}
                </Menu.Item>
              ))}
              <Menu.Separator {...stylex.props(styles.separator)} />
              <Menu.Item
                onClick={() => setConfirming(true)}
                className={(state) =>
                  stylex.props(
                    ui.menuItem,
                    styles.danger,
                    state.highlighted && [ui.menuHighlighted, picked],
                  ).className
                }
              >
                Remove from Med…
              </Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </li>
  );
}

const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const narrow = "@media (max-width: 640px)";

const styles = stylex.create({
  // The review's frame: a 6px gutter on the panel, and one card.
  page: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    padding: 6,
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    WebkitFontSmoothing: "antialiased",
  },
  // The view starts below the title bar; the card rises into it.
  pageTab: { marginTop: "calc(-1 * var(--med-titlebar-height))" },
  card: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: tokens.frame,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  // As the review card's first row.
  header: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 38,
    paddingInline: 6,
    boxSizing: "border-box",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  title: {
    margin: 0,
    marginInlineStart: 2,
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.005em",
    whiteSpace: "nowrap",
  },
  add: { color: tokens.text },
  scroller: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
  },
  column: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 880,
    marginInline: "auto",
    paddingTop: { default: 28, [narrow]: 16 },
    paddingBottom: 40,
    paddingInline: { default: 24, [narrow]: 8 },
  },
  emptyColumn: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  group: { marginBottom: 28 },
  // Level with the rows' icons.
  groupTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBlock: 0,
    marginBottom: 6,
    paddingInline: 10,
    fontSize: "inherit",
    fontWeight: "inherit",
  },
  count: { color: tokens.faint, fontSize: 11.5, fontVariantNumeric: "tabular-nums" },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  // As the sidebar's workspace rows: a rounded highlight, no rules.
  row: {
    display: "flex",
    alignItems: "center",
    minHeight: 34,
    paddingInlineEnd: 4,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
  },
  // The name column has one width, so every row's location starts at one edge.
  open: {
    display: "grid",
    gridTemplateColumns: {
      default: "14px minmax(0, clamp(128px, 30%, 240px)) minmax(0, 1fr) auto",
      [narrow]: "14px minmax(0, 1fr) auto",
    },
    alignItems: "center",
    columnGap: 10,
    rowGap: 1,
    flex: "1",
    minWidth: 0,
    alignSelf: "stretch",
    paddingBlock: { default: 0, [narrow]: 7 },
    paddingInlineStart: 10,
    paddingInlineEnd: 6,
    color: "inherit",
    textDecoration: "none",
    outline: "none",
    borderRadius: `calc(7px * ${tokens.round})`,
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 2px ${tokens.accentLine}` },
  },
  icon: { display: "flex", color: tokens.faint },
  name: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
  },
  where: {
    gridColumnStart: { default: "auto", [narrow]: 2 },
    gridColumnEnd: { default: "auto", [narrow]: -1 },
    gridRowStart: { default: "auto", [narrow]: 2 },
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.muted,
    fontSize: 12.5,
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    color: tokens.faint,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
  failed: { color: tokens.red },
  spinner: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.muted,
    animationName: { default: spin, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "800ms",
    animationIterationCount: "infinite",
    animationTimingFunction: "linear",
  },
  more: {
    flexShrink: 0,
    width: 26,
    minWidth: 26,
    minHeight: 26,
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
      "@media (hover: none)": 1,
    },
  },
  moreOpen: { opacity: 1 },
  positioner: { zIndex: 60 },
  menu: { minWidth: 180 },
  separator: { height: 1, marginBlock: 4, marginInline: 4, backgroundColor: tokens.line },
  danger: { color: tokens.red },
  confirm: {
    flexWrap: "wrap",
    gap: 6,
    paddingBlock: 4,
    paddingInlineStart: 34,
    backgroundColor: { default: tokens.fill, ":hover": tokens.fill },
  },
  confirmText: {
    flex: "1",
    minWidth: 200,
    color: tokens.muted,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  strong: { color: tokens.text, fontWeight: 500 },
  remove: {
    color: { default: tokens.red, ":hover:not(:disabled)": tokens.red },
    backgroundColor: {
      default: `color-mix(in srgb, ${tokens.red} 12%, transparent)`,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.red} 18%, transparent)`,
    },
  },
  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    alignSelf: "center",
    maxWidth: 360,
    paddingBottom: 48,
    textAlign: "center",
  },
  emptyTitle: { margin: 0, fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em" },
  emptyText: {
    marginBlock: 6,
    marginBottom: 18,
    color: tokens.muted,
    fontSize: 13,
    lineHeight: 1.5,
    textWrap: "balance",
  },
  emptyAdd: { paddingInline: 14 },
  note: { marginBlock: 0, marginTop: 16, color: tokens.faint, fontSize: 12, lineHeight: 1.6 },
  footnote: { maxWidth: "62ch", marginTop: 4, paddingInline: 10 },
  code: { fontFamily: tokens.code, fontSize: 11.5, color: tokens.muted },
});
