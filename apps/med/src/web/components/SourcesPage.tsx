import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { picked, tokens, ui } from "../theme.stylex";
import { openWelcome } from "../data/setup";
import { visibleElement } from "../data/palette-focus";
import { Icon } from "./Icon";
import { page, PageHeading } from "./PageHeading";
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
}: {
  sources: Source[];
  home?: string;
  loaded: boolean;
  notice?: ReactNode;
  onOpenVault(id: string): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
}) {
  const actions = useWorkspaceActions();
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
      notice={notice}
      onOpen={(source) =>
        source.kind === "vault" ? onOpenVault(source.id) : openRepository(source)
      }
      onAdd={openWelcome}
      onRequest={onRequest}
    />
  );
}

/**
 * The Sources page without the app's wiring: a page as Pull requests and
 * Dashboards are, its title and actions on one line (PageHeading.tsx).
 */
export function SourcesView({
  sources,
  home,
  loaded,
  notice,
  onOpen,
  onAdd,
  onRequest,
}: {
  sources: Source[];
  home?: string;
  loaded: boolean;
  notice?: ReactNode;
  onOpen(source: Source): void;
  onAdd(): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
}) {
  const empty = loaded && !sources.length;
  return (
    <div {...stylex.props(styles.page)}>
      <main aria-label="Sources" {...stylex.props(styles.scroller)}>
        <div {...stylex.props(page.column, empty && styles.emptyColumn)}>
          {notice}
          {empty ? (
            <div {...stylex.props(styles.empty)}>
              <h1 {...stylex.props(styles.emptyTitle)}>No sources yet</h1>
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
              <PageHeading
                title="Sources"
                lead={
                  <>
                    Med keeps a workspace ready for each repository and vault here. To add one from
                    a terminal, run{" "}
                    <code {...stylex.props(styles.code)}>med add &lt;folder&gt;</code>. Removing a
                    source never changes its folder.
                  </>
                }
              >
                <button
                  type="button"
                  onClick={onAdd}
                  {...stylex.props(ui.button, ui.pressable, ui.outlined)}
                >
                  <Icon name="plus" size={13} />
                  Add sources…
                </button>
              </PageHeading>
              {/* A vault is one more source: one list, by name. */}
              <ul aria-label="Sources" {...stylex.props(styles.rows, page.flush)}>
                {[...sources].sort(byName).map((source) => (
                  <SourceRow
                    key={source.id}
                    source={source}
                    home={home}
                    onOpen={() => onOpen(source)}
                    onRequest={onRequest}
                  />
                ))}
              </ul>
            </>
          )}
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
              <Menu.Separator {...stylex.props(ui.separator)} />
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
  // Flat, as the review's panes: the page on the canvas.
  page: {
    flex: "1",
    minHeight: 0,
    display: "flex",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    WebkitFontSmoothing: "antialiased",
  },
  scroller: {
    flex: "1",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
  },
  emptyColumn: {
    flex: "1",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    margin: 0,
    marginTop: 28,
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
  // The name column has one width, so every row's location starts at one
  // edge; the status follows its location, as part of one line.
  open: {
    display: "grid",
    gridTemplateColumns: {
      default:
        "14px minmax(0, clamp(128px, 30%, 240px)) minmax(0, max-content) minmax(max-content, 1fr)",
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
    justifySelf: { default: "start", [narrow]: "end" },
    marginInlineStart: { default: 6, [narrow]: 0 },
    gap: 6,
    color: tokens.muted,
    fontSize: 12.5,
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
