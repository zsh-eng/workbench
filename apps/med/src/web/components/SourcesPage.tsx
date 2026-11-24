import { useCallback, useEffect, useId, useRef, useState, type ReactNode, type Ref } from "react";
import { Menu } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { picked, tokens, ui } from "../theme.stylex";
import { createSetupApi, displayPath, since, takeFindSources, type SetupApi } from "../data/setup";
import { visibleElement } from "../data/palette-focus";
import { EmptyState } from "./EmptyState";
import { useFoundSources, type FoundRow, type FoundSources } from "./found-sources";
import { Icon } from "./Icon";
import { page, PageHeading } from "./PageHeading";
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

/** Rows of what Med found, before Show more. */
const SHOWN = 6;

/** The registered repositories and vaults: open one, index a vault again, or
 * remove a registration. Removing never touches the folder. Add sources…
 * shows what Med found on this computer, and adds one at a click. */
export function SourcesPage({
  sources,
  home,
  loaded,
  notice,
  setup,
  onOpenVault,
  onRequest,
  onRefresh,
}: {
  sources: Source[];
  home?: string;
  loaded: boolean;
  notice?: ReactNode;
  /** The server's setup actions; a test gives its own. */
  setup?: SetupApi;
  onOpenVault(id: string): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
  /** Reads the registered sources again, as after an add. */
  onRefresh(): Promise<void>;
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
  // A source added elsewhere, as with `med add`, shows when the window gets focus.
  useEffect(() => {
    const read = () => void onRefresh().catch(() => {});
    window.addEventListener("focus", read);
    return () => window.removeEventListener("focus", read);
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

  const [api] = useState(() => setup ?? createSetupApi());
  const found = useFoundSources({ api, registered: sources, home, refresh: onRefresh });
  // The reader's choice. With nothing registered, the page opens on what Med
  // found: those rows are its call to action.
  const [choice, setChoice] = useState<boolean | null>(null);
  if (choice === null && loaded && !sources.length) setChoice(true);
  const finding = choice ?? false;
  const section = useRef<HTMLElement>(null);
  const focusFound = useRef(false);
  const find = useCallback((open: boolean) => {
    // Focus goes to the section when the reader opens it, not on first run.
    if (open && section.current) section.current.focus();
    else focusFound.current = open;
    setChoice(open);
  }, []);
  const { start } = found;
  useEffect(() => {
    if (!finding) return;
    start();
    if (focusFound.current) section.current?.focus();
    focusFound.current = false;
  }, [finding, start]);
  // ⌘K's Add sources… and New thread's Add a folder… ask for the section.
  useEffect(() => {
    const take = () => {
      if (takeFindSources()) find(true);
    };
    take();
    window.addEventListener("popstate", take);
    return () => window.removeEventListener("popstate", take);
  }, [find]);

  return (
    <SourcesView
      sources={sources}
      home={home}
      loaded={loaded}
      notice={notice}
      onOpen={(source) =>
        source.kind === "vault" ? onOpenVault(source.id) : openRepository(source)
      }
      found={finding ? found : null}
      onFinding={find}
      foundRef={section}
      onRequest={onRequest}
    />
  );
}

/**
 * The Sources page without the app's wiring: a page as Pull requests and
 * Dashboards are, its title and actions on one line (PageHeading.tsx). Under
 * the registered sources, Add sources… shows what Med found on this computer.
 */
export function SourcesView({
  sources,
  home,
  loaded,
  notice,
  found,
  foundRef,
  onOpen,
  onFinding,
  onRequest,
}: {
  sources: Source[];
  home?: string;
  loaded: boolean;
  notice?: ReactNode;
  /** What Med found on this computer, while that section shows. */
  found: FoundSources | null;
  foundRef?: Ref<HTMLElement>;
  onOpen(source: Source): void;
  onFinding(open: boolean): void;
  onRequest(action: "index" | "remove", body: object): Promise<void>;
}) {
  const foundId = useId();
  return (
    <div {...stylex.props(styles.page)}>
      <main aria-label="Sources" {...stylex.props(styles.scroller)}>
        <div {...stylex.props(page.column)}>
          {notice}
          <PageHeading
            title="Sources"
            count={
              sources.length > 0 ? (
                <span {...stylex.props(page.badge)}>{sources.length}</span>
              ) : undefined
            }
            lead={
              <>
                Med keeps a workspace ready for each repository and vault here. To add one from a
                terminal, run <code {...stylex.props(styles.code)}>med add &lt;folder&gt;</code>.
                Removing a source never changes its folder.
              </>
            }
          >
            <button
              type="button"
              aria-expanded={found !== null}
              aria-controls={found ? foundId : undefined}
              onClick={() => onFinding(!found)}
              {...stylex.props(ui.button, ui.pressable, ui.outlined)}
            >
              <Icon name="plus" size={13} />
              Add sources…
            </button>
          </PageHeading>
          {sources.length > 0 && (
            // A vault is one more source: one list, by name, inside the shared framed card.
            <ul aria-label="Sources" {...stylex.props(styles.rows, styles.registered, page.card)}>
              {[...sources].sort(byName).map((source, index) => (
                <SourceRow
                  key={source.id}
                  source={source}
                  first={index === 0}
                  home={home}
                  onOpen={() => onOpen(source)}
                  onRequest={onRequest}
                />
              ))}
            </ul>
          )}
          {found && (
            <FoundSection
              id={foundId}
              found={found}
              home={found.home ?? home}
              first={loaded && !sources.length}
              sectionRef={foundRef}
            />
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * Found on this computer: the repositories and vaults under the home folder
 * that Med does not have, most recently active first. A row is a registered
 * row with Add at its end; an added row leaves for the list above.
 */
function FoundSection({
  id,
  found,
  home,
  first,
  sectionRef,
}: {
  id: string;
  found: FoundSources;
  home?: string;
  /** Nothing is registered yet. */
  first: boolean;
  sectionRef?: Ref<HTMLElement>;
}) {
  const [all, setAll] = useState(false);
  const [now] = useState(Date.now);
  const { rows } = found;
  // A row that is being added, or failed, stays in view.
  const shown = all ? rows : rows.filter((row, at) => at < SHOWN || row.state !== "idle");
  const hidden = rows.length - shown.length;
  const recent = rows.filter((row) => row.recent).length;
  // The row that the reader adds leaves with the focus. The section takes
  // it, so the keyboard stays in the list.
  const added = useRef(false);
  useEffect(() => {
    if (!added.current) return;
    if (document.activeElement === document.body)
      document.getElementById(id)?.focus({ preventScroll: true });
    added.current = rows.some((row) => row.state === "adding");
  }, [rows, id]);
  // Until the first search answers, the section is one line.
  const looking = !found.searched && !found.error;
  const nothing = found.searched && !rows.length;
  return (
    <section
      id={id}
      ref={sectionRef}
      tabIndex={-1}
      aria-labelledby={`${id}-title`}
      {...stylex.props(page.section, styles.found)}
    >
      <div {...stylex.props(styles.foundHead, nothing && first && styles.foundHeadAlone)}>
        <h2 id={`${id}-title`} {...stylex.props(page.sectionTitle, styles.foundTitle)}>
          Found on this computer
        </h2>
        {recent > 1 && (
          <button
            type="button"
            disabled={found.addingRecent}
            onClick={found.addRecent}
            {...stylex.props(ui.button, ui.pressable, styles.headButton)}
          >
            Add the {recent} recent
          </button>
        )}
      </div>
      {found.unavailable ? (
        <p {...stylex.props(styles.line)}>
          This server cannot add sources. From a terminal:{" "}
          <code {...stylex.props(styles.code)}>med add &lt;folder&gt;</code>
        </p>
      ) : looking ? (
        <p role="status" {...stylex.props(styles.line, styles.lineParts)}>
          <span aria-hidden="true" {...stylex.props(styles.spinner)} />
          Looking in your home folder…
        </p>
      ) : (
        <>
          {rows.length > 0 ? (
            <ul aria-label="Found on this computer" {...stylex.props(styles.rows, page.flush)}>
              {shown.map((row) => (
                <FoundSourceRow
                  key={row.path}
                  row={row}
                  home={home}
                  now={now}
                  onAdd={() => {
                    added.current = true;
                    found.add(row);
                  }}
                />
              ))}
            </ul>
          ) : !found.searched ? null : first ? (
            <EmptyState
              page
              title="No repositories or vaults found in your home folder"
              note={
                <>
                  From a terminal: <code {...stylex.props(styles.code)}>med add ~/code/my-app</code>
                </>
              }
            />
          ) : (
            <p {...stylex.props(styles.line)}>
              No other repositories or vaults found in your home folder.
            </p>
          )}
          {rows.length > SHOWN && (hidden > 0 || all) && (
            <button
              type="button"
              onClick={() => setAll(!all)}
              {...stylex.props(ui.button, ui.pressable, styles.showMore)}
            >
              {all ? "Show fewer" : `Show ${hidden} more`}
            </button>
          )}
          {found.error && (
            <p role="alert" {...stylex.props(styles.line, styles.failed, styles.under)}>
              {found.error}
            </p>
          )}
          {found.skipped.length > 0 && (
            <p {...stylex.props(styles.line, styles.lineParts, styles.under)}>
              <span>
                Not searched:{" "}
                {new Intl.ListFormat("en", { type: "conjunction" }).format(found.skipped)}.
              </span>
              <button
                type="button"
                disabled={found.searching}
                onClick={found.searchAll}
                {...stylex.props(ui.button, ui.outlined, ui.pressable)}
              >
                {found.searching ? "Searching…" : "Search them too"}
              </button>
            </p>
          )}
          <AddFolder onAdd={found.addPath} home={home} />
        </>
      )}
    </section>
  );
}

function FoundSourceRow({
  row,
  home,
  now,
  onAdd,
}: {
  row: FoundRow;
  home?: string;
  now: number;
  onAdd(): void;
}) {
  const adding = row.state === "adding";
  const label = adding ? "Adding…" : row.state === "failed" ? "Retry" : "Add";
  const age = since(row.activity, now);
  return (
    <li data-state={row.state} {...stylex.props(styles.row, styles.foundRow)}>
      <div title={row.path} {...stylex.props(styles.open, styles.foundText)}>
        <span aria-hidden="true" {...stylex.props(styles.icon)}>
          <Icon name={row.kind === "vault" ? "vault" : "gitBranch"} size={14} />
        </span>
        <span data-row="name" {...stylex.props(styles.name)}>
          {row.name}
        </span>
        <span data-row="path" {...stylex.props(styles.where)}>
          {folderPlace(row, home)}
        </span>
        <span {...stylex.props(styles.facts)}>
          {row.branch && (
            <span data-row="branch" {...stylex.props(styles.branch)}>
              {row.branch}
            </span>
          )}
          {age && (
            <span data-row="age" {...stylex.props(styles.age)}>
              {age}
            </span>
          )}
        </span>
      </div>
      <span {...stylex.props(styles.end)}>
        <button
          type="button"
          disabled={adding}
          aria-label={`${label} ${row.name}`}
          onClick={onAdd}
          {...stylex.props(
            ui.button,
            ui.outlined,
            ui.pressable,
            styles.add,
            adding && styles.addBusy,
          )}
        >
          {adding && <span aria-hidden="true" {...stylex.props(styles.spinner)} />}
          {label}
        </button>
      </span>
    </li>
  );
}

/** A folder that the search missed, by its path. Enter adds it. */
function AddFolder({ onAdd, home }: { onAdd(path: string): Promise<void>; home?: string }) {
  const [path, setPath] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  return (
    <form
      {...stylex.props(styles.addFolder)}
      onSubmit={(event) => {
        event.preventDefault();
        const value = path.trim();
        if (!value || state.busy) return;
        setState({ busy: true, error: "" });
        onAdd(value).then(
          () => {
            setPath("");
            setState({ busy: false, error: "" });
          },
          (reason) =>
            setState({
              busy: false,
              error: reason instanceof Error ? reason.message : String(reason),
            }),
        );
      }}
    >
      <div {...stylex.props(styles.row, styles.folderRow)}>
        <span aria-hidden="true" {...stylex.props(styles.icon)}>
          <Icon name="folder" size={14} />
        </span>
        <input
          aria-label="Add a folder by path"
          value={path}
          placeholder={`Add a folder by path, such as ${home ? "~/" : "/"}code/project`}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          onChange={(event) => {
            setPath(event.target.value);
            if (state.error) setState({ busy: false, error: "" });
          }}
          {...stylex.props(styles.folderInput)}
        />
        {path.trim() && (
          <button
            type="submit"
            disabled={state.busy}
            {...stylex.props(ui.button, ui.outlined, ui.pressable, styles.add)}
          >
            {state.busy ? "Adding…" : "Add"}
          </button>
        )}
      </div>
      {state.error && (
        <p role="alert" {...stylex.props(styles.line, styles.failed, styles.folderError)}>
          {state.error}
        </p>
      )}
    </form>
  );
}

/** Where the folder is. The row shows its name, so the folder's parent is
 * enough when the name is the folder's own, unless the parent is home. */
function folderPlace(source: { name: string; path: string }, home?: string) {
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
  first = false,
  home,
  onOpen,
  onRequest,
}: {
  source: Source;
  first?: boolean;
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
    <li
      {...stylex.props(
        styles.row,
        styles.registeredRow,
        first && styles.firstRow,
        stylex.defaultMarker(),
      )}
    >
      <a
        href={vault ? `/vault/${source.id}` : "/"}
        title={source.path}
        onClick={(event) => {
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          onOpen();
        }}
        {...stylex.props(styles.open, styles.registeredOpen)}
      >
        <span aria-hidden="true" {...stylex.props(page.iconTile, vault && styles.vaultIcon)}>
          <Icon name={vault ? "vault" : "gitBranch"} size={14} />
        </span>
        <span data-row="name" {...stylex.props(styles.name)}>
          {source.name}
        </span>
        <span data-row="path" {...stylex.props(styles.where)}>
          {folderPlace(source, home)}
        </span>
        <span {...stylex.props(styles.metaEnd)}>
          {error ? (
            <span {...stylex.props(styles.status, styles.failed)}>{error}</span>
          ) : (
            status(source)
          )}
          <span {...stylex.props(page.pill)}>{vault ? "Vault" : "Repository"}</span>
        </span>
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
  scroller: { flex: "1", minWidth: 0, overflowY: "auto" },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  registered: { marginTop: 24, gap: 0 },
  // As the sidebar's workspace rows: a rounded highlight, no rules.
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    minHeight: 34,
    paddingInlineEnd: 4,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
  },
  registeredRow: {
    minHeight: 52,
    paddingInlineEnd: 10,
    borderRadius: 0,
    "::before": {
      content: '""',
      position: "absolute",
      top: 0,
      left: 16,
      right: 16,
      height: 1,
      backgroundColor: tokens.line,
    },
  },
  firstRow: { "::before": { content: "none" } },
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
  registeredOpen: {
    gridTemplateColumns: {
      default: "28px minmax(0, clamp(120px, 26%, 200px)) minmax(0, 1fr) auto",
      [narrow]: "28px minmax(0, 1fr) auto",
    },
    columnGap: 12,
    paddingInlineStart: 16,
    paddingInlineEnd: 8,
    borderRadius: 0,
  },
  vaultIcon: { color: tokens.accent },
  metaEnd: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    flexShrink: 0,
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
  // The section takes focus when the reader opens it; it shows no ring.
  found: { outline: "none" },
  foundHead: { display: "flex", alignItems: "baseline", gap: 8, marginBottom: 14 },
  // The empty state brings its own space above.
  foundHeadAlone: { marginBottom: 0 },
  foundTitle: { flex: "1", minWidth: 0, marginBottom: 0 },
  // At the heading's end without moving its line; its label ends at the column's edge.
  headButton: { flexShrink: 0, marginBlock: -6, marginInlineEnd: -8 },
  // One line of the section: a state, a note, or an error.
  line: { margin: 0, color: tokens.muted, fontSize: 12.5, lineHeight: 1.5 },
  // A line with a spinner before it, or a button after it.
  lineParts: { display: "flex", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 6 },
  under: { marginTop: 14 },
  // A found row is not a link, so it has no highlight.
  foundRow: {
    paddingInlineEnd: { default: 4, [narrow]: 0 },
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  // A registered row's columns. The branch and the age give way first.
  foundText: {
    gridTemplateColumns: {
      default: "14px minmax(0, clamp(128px, 30%, 240px)) minmax(0, max-content) minmax(0, 1fr)",
      [narrow]: "14px minmax(0, 1fr)",
    },
  },
  // The reserve at its end keeps the facts clear of the widest button.
  facts: {
    display: { default: "flex", [narrow]: "none" },
    alignItems: "baseline",
    gap: 10,
    minWidth: 0,
    marginInlineStart: 6,
    marginInlineEnd: 72,
    overflow: "hidden",
    color: tokens.muted,
    whiteSpace: "nowrap",
  },
  branch: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
  age: { flexShrink: 0, color: tokens.faint, fontSize: 12.5, fontVariantNumeric: "tabular-nums" },
  // As wide as a registered row's actions, so both lists' columns start at
  // the same edges: the button reaches over the row's free end, and ends at
  // the column's edge. A narrow row has no columns to keep, so it gives the
  // button its width.
  end: {
    display: "flex",
    justifyContent: "flex-end",
    flexShrink: 0,
    width: { default: 20, [narrow]: "auto" },
    marginInlineEnd: { default: 6, [narrow]: 10 },
  },
  add: {
    position: "relative",
    flexShrink: 0,
    minHeight: { default: 28, [narrow]: 32 },
    paddingInline: { default: 10, [narrow]: 12 },
    // A finger's target, 44 pixels tall, around the button that shows.
    "::after": {
      content: { default: "none", [narrow]: '""' },
      position: "absolute",
      insetBlock: -6,
      insetInline: -6,
    },
  },
  // Adding…: disabled, but as legible as the row.
  addBusy: { color: tokens.muted, opacity: 1, cursor: "default" },
  // Its label starts at the column's edge.
  showMore: { marginTop: 4, marginInlineStart: -8 },
  addFolder: { marginTop: 14 },
  // A row's height and corners, with an edge: its box ends at the column's
  // edges, as the buttons do.
  folderRow: {
    gap: 10,
    minHeight: { default: 34, [narrow]: 44 },
    paddingInlineStart: 10,
    paddingInlineEnd: { default: 3, [narrow]: 6 },
    backgroundColor: { default: "transparent", ":hover": "transparent" },
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.line}`,
      ":focus-within": `inset 0 0 0 1px ${tokens.accentLine}`,
    },
  },
  folderInput: {
    flex: "1",
    minWidth: 0,
    alignSelf: "stretch",
    padding: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    textOverflow: "ellipsis",
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  folderError: { marginTop: 8 },
  code: { fontFamily: tokens.code, fontSize: 11.5, color: tokens.muted },
});
