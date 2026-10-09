import { useEffect, useState } from "react";
import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { picked, tokens, ui } from "../theme.stylex";
import { openWelcome } from "../data/setup";
import { visibleElement } from "../data/palette-focus";
import { Icon } from "./Icon";
import { ToolButton } from "./ToolButton";
import { displayPath } from "./welcome/Welcome";
import { useWorkspaceActions } from "./Workspaces";

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
  onOpenVault,
  onRequest,
  onCommands,
}: {
  sources: Source[];
  home?: string;
  loaded: boolean;
  onOpenVault(id: string): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
  onCommands(): void;
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
  const repositories = sources.filter((source) => source.kind === "repo");
  const vaults = sources.filter((source) => source.kind === "vault");
  const group = (title: string, rows: Source[]) =>
    rows.length > 0 && (
      <section aria-label={title} {...stylex.props(styles.group)}>
        <h2 {...stylex.props(styles.groupTitle)}>
          <span {...stylex.props(ui.label)}>{title}</span>{" "}
          <span {...stylex.props(styles.count)}>{rows.length}</span>
        </h2>
        <ul {...stylex.props(styles.rows)}>
          {rows.map((source) => (
            <SourceRow
              key={source.id}
              source={source}
              home={home}
              onOpen={() =>
                source.kind === "vault" ? onOpenVault(source.id) : openRepository(source)
              }
              onRequest={onRequest}
            />
          ))}
        </ul>
      </section>
    );

  return (
    <main {...stylex.props(styles.page)} aria-label="Sources">
      <div {...stylex.props(styles.bar)}>
        <ToolButton label="Back" shortcut="Esc" icon="arrowLeft" onClick={back} />
        <span {...stylex.props(ui.grow)} />
        <ToolButton label="Commands" shortcut="⌘ K" icon="search" onClick={onCommands} />
      </div>
      <div {...stylex.props(styles.content)}>
        <header {...stylex.props(styles.header)}>
          <div>
            <h1 {...stylex.props(styles.title)}>Sources</h1>
            <p {...stylex.props(styles.lede)}>
              Med watches these folders and keeps their workspaces ready.
            </p>
          </div>
          <button
            type="button"
            onClick={openWelcome}
            {...stylex.props(ui.button, ui.pressable, styles.find)}
          >
            <Icon name="plus" size={13} />
            Add sources…
          </button>
        </header>
        {group("Repositories", repositories)}
        {group("Vaults", vaults)}
        {loaded && !sources.length && (
          <div {...stylex.props(styles.empty)}>
            <p {...stylex.props(styles.emptyTitle)}>No sources yet</p>
            <p {...stylex.props(styles.lede)}>
              Add the repositories and Obsidian vaults you work in.
            </p>
          </div>
        )}
        <p {...stylex.props(styles.hint)}>
          From a terminal: <code {...stylex.props(styles.code)}>med add /path/to/folder</code>
        </p>
      </div>
    </main>
  );
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
          Remove <strong>{source.name}</strong> from Med? The folder stays as it is.
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
        <span aria-hidden="true" {...stylex.props(styles.tile, vault && styles.vaultTile)}>
          <Icon name={vault ? "vault" : "gitBranch"} size={15} />
        </span>
        <span {...stylex.props(styles.text)}>
          <span data-row="name" {...stylex.props(styles.name)}>
            {source.name}
          </span>
          <span data-row="path" {...stylex.props(styles.path)}>
            {displayPath(source.path, home)}
          </span>
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

const styles = stylex.create({
  page: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  bar: {
    position: "sticky",
    top: 0,
    zIndex: 1,
    display: "flex",
    alignItems: "center",
    height: 44,
    paddingInline: 8,
    backgroundColor: tokens.panel,
  },
  content: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 680,
    marginInline: "auto",
    paddingTop: { default: 40, "@media (max-width: 600px)": 16 },
    paddingBottom: 48,
    paddingInline: 16,
  },
  header: {
    display: "flex",
    alignItems: "flex-end",
    justifyContent: "space-between",
    gap: 16,
    marginBottom: 28,
  },
  title: { margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em" },
  lede: { marginBlock: 6, color: tokens.muted, fontSize: 13, lineHeight: 1.5 },
  find: { flexShrink: 0, color: tokens.text, backgroundColor: tokens.fill },
  group: { marginBottom: 24 },
  groupTitle: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    marginBlock: 0,
    marginBottom: 8,
    paddingInline: 2,
    color: tokens.muted,
    fontSize: 12,
    fontWeight: 500,
  },
  count: { color: tokens.faint, fontWeight: 400, fontVariantNumeric: "tabular-nums" },
  rows: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 2px #0000000d`,
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    minHeight: 56,
    paddingInlineEnd: 8,
    borderTopWidth: { default: 1, ":first-child": 0 },
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
  },
  open: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flex: "1",
    minWidth: 0,
    alignSelf: "stretch",
    paddingInlineStart: 12,
    paddingInlineEnd: 4,
    color: "inherit",
    textDecoration: "none",
    outline: "none",
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: { default: "none", ":focus-visible": `inset 0 0 0 2px ${tokens.accentLine}` },
  },
  tile: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: 30,
    height: 30,
    borderRadius: `calc(8px * ${tokens.round})`,
    color: tokens.muted,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  vaultTile: { color: tokens.accent, backgroundColor: tokens.accentSoft, boxShadow: "none" },
  text: { display: "flex", flexDirection: "column", gap: 2, flex: "1", minWidth: 0 },
  name: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: 13,
    fontWeight: 500,
  },
  path: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 12,
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
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
    opacity: {
      default: 0,
      [stylex.when.ancestor(":hover")]: 1,
      [stylex.when.ancestor(":focus-within")]: 1,
    },
  },
  moreOpen: { opacity: 1 },
  positioner: { zIndex: 60 },
  menu: { minWidth: 180 },
  separator: { height: 1, marginBlock: 4, marginInline: 4, backgroundColor: tokens.line },
  danger: { color: tokens.red },
  confirm: { gap: 6, paddingInlineStart: 16, backgroundColor: tokens.fill },
  confirmText: { flex: "1", minWidth: 0, color: tokens.muted, fontSize: 12.5, lineHeight: 1.5 },
  remove: {
    color: { default: tokens.red, ":hover:not(:disabled)": tokens.red },
    backgroundColor: {
      default: `color-mix(in srgb, ${tokens.red} 12%, transparent)`,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.red} 18%, transparent)`,
    },
  },
  empty: {
    paddingBlock: 32,
    textAlign: "center",
    borderRadius: `calc(10px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  emptyTitle: { margin: 0, fontSize: 14, fontWeight: 500 },
  hint: { marginTop: 20, color: tokens.faint, fontSize: 12 },
  code: { fontFamily: tokens.code, fontSize: 11.5, color: tokens.muted },
});
