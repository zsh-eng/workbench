import * as stylex from "@stylexjs/stylex";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { tokens, ui } from "../../theme.stylex";
import { themeController, useTheme, type Theme } from "../../themes";
import { Icon } from "../Icon";
import {
  createSetupApi,
  type Discovery,
  type FoundSource,
  type SetupApi,
  type SetupStatus,
  type SourceKind,
} from "../../data/setup";
import { createField, type Field, type FieldColors } from "./field";

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Short relative time, such as 3d for three days ago. */
function since(time: number, now: number) {
  if (!time) return "";
  const minutes = Math.max(1, Math.round((now - time) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 63) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365)}y`;
}

/** A path as people know it: ~/code/med, or iCloud › Obsidian › Notes. */
export function displayPath(path: string, home?: string) {
  if (!home) return path;
  const cloud = `${home}/Library/Mobile Documents/`;
  if (path.startsWith(cloud)) {
    const [container = "", ...rest] = path.slice(cloud.length).split("/");
    const inside = rest[0] === "Documents" ? rest.slice(1) : rest;
    if (container === "com~apple~CloudDocs") return ["iCloud Drive", ...rest].join(" › ");
    if (container === "iCloud~md~obsidian") return ["iCloud", "Obsidian", ...inside].join(" › ");
    return ["iCloud", ...inside].join(" › ");
  }
  return path === home || path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

const DAY = 86_400_000;
/** Recent sources start selected; a long tail of old checkouts does not. */
const RECENT = { repo: { days: 21, count: 10 }, vault: { days: 60, count: 6 } };
/** Rows shown before "Show more", not counting selected ones. */
const SHOWN = 6;

interface Row extends FoundSource {
  kind: SourceKind;
  state: "idle" | "added" | "adding" | "failed";
}

/** Setup data: registered sources, discovered candidates, the selection, and
 * the login item. Sources added elsewhere show when the window gets focus. */
function useSetup(api: SetupApi) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [scanning, setScanning] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [pending, setPending] = useState<Record<string, "adding" | "failed">>({});
  const started = useRef(false);

  const refresh = useCallback(async () => {
    const next = await api.status();
    setStatus(next);
    return next;
  }, [api]);
  useEffect(() => {
    const load = () => void refresh().catch((reason) => setError(message(reason)));
    load();
    addEventListener("focus", load);
    return () => removeEventListener("focus", load);
  }, [refresh]);

  const scan = useCallback(
    async (deep: boolean) => {
      setScanning(true);
      try {
        const found = await api.discover(deep);
        const now = Date.now();
        const recent = (list: FoundSource[], kind: SourceKind) =>
          list
            .filter((entry) => entry.activity > now - RECENT[kind].days * DAY)
            .slice(0, RECENT[kind].count)
            .map((entry) => entry.path);
        setDiscovery(found);
        setSelected(
          (current) =>
            new Set([
              ...current,
              ...recent(found.repositories, "repo"),
              ...recent(found.vaults, "vault"),
            ]),
        );
      } catch (reason) {
        setError(message(reason));
      } finally {
        setScanning(false);
      }
    },
    [api],
  );
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void scan(false);
  }, [scan]);

  const rows = useMemo(() => {
    const registered = new Set(status?.sources.map((source) => source.path));
    const build = (kind: SourceKind, found: FoundSource[]): Row[] => {
      const listed = new Set(found.map((entry) => entry.path));
      // Registered sources outside the search, such as ones added by path, join the list.
      const extra = (status?.sources ?? [])
        .filter((source) => source.kind === kind && !listed.has(source.path))
        .map((source) => ({ path: source.path, name: source.name, activity: 0 }));
      return [...extra, ...found].map((entry) => ({
        ...entry,
        kind,
        state: registered.has(entry.path) ? "added" : (pending[entry.path] ?? "idle"),
      }));
    };
    return {
      repo: build("repo", discovery?.repositories ?? []),
      vault: build("vault", discovery?.vaults ?? []),
    };
  }, [discovery, status, pending]);

  const choose = useCallback((paths: string[], on: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      for (const path of paths) {
        if (on) next.add(path);
        else next.delete(path);
      }
      return next;
    });
  }, []);

  /** Adds each selected source in turn and reports each one that succeeds.
   * Returns false if one failed. */
  const apply = useCallback(
    async (added: () => void) => {
      const todo = [...rows.repo, ...rows.vault].filter(
        (row) => selected.has(row.path) && row.state === "idle",
      );
      let ok = true;
      setError("");
      for (const row of todo) {
        setPending((current) => ({ ...current, [row.path]: "adding" }));
        try {
          await api.add(row.path, row.kind);
          await refresh();
          setPending((current) => {
            const next = { ...current };
            delete next[row.path];
            return next;
          });
          added();
        } catch (reason) {
          ok = false;
          setPending((current) => ({ ...current, [row.path]: "failed" }));
          setError(`${row.name}: ${message(reason)}`);
        }
      }
      return ok;
    },
    [api, refresh, rows, selected],
  );

  const addPath = useCallback(
    async (path: string) => {
      setError("");
      const home = discovery?.home;
      const absolute = home && path.startsWith("~/") ? `${home}${path.slice(1)}` : path;
      await api.add(absolute);
      await refresh();
    },
    [api, discovery?.home, refresh],
  );

  const setLogin = useCallback(
    async (enabled: boolean) => {
      try {
        const login = await api.login(enabled);
        setStatus((current) => (current ? { ...current, login } : current));
      } catch (reason) {
        setError(message(reason));
      }
    },
    [api],
  );

  return {
    status,
    discovery,
    scanning,
    error,
    rows,
    selected,
    choose,
    scan,
    apply,
    addPath,
    setLogin,
  };
}
type Setup = ReturnType<typeof useSetup>;

const fieldColors = (theme: Theme): FieldColors => ({
  canvas: theme.palette.canvas,
  text: theme.palette.text,
  accent: theme.palette.accent,
  green: theme.palette.green,
  dark: theme.appearance === "dark",
});

function summary(sources: SetupStatus["sources"]) {
  const repos = sources.filter((source) => source.kind === "repo").length;
  const vaults = sources.length - repos;
  const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    repos && count(repos, "repository", "repositories"),
    vaults && count(vaults, "vault", "vaults"),
  ];
  return `${parts.filter(Boolean).join(" and ")} ${sources.length === 1 ? "is" : "are"} ready to review.`;
}

/**
 * Med's first-run page: choose the repositories and Obsidian vaults that Med
 * opens, and whether Med opens at login. A shader draws the page of code lines
 * behind it; each added source sends a wave across the lines.
 */
export default function Welcome({
  api: provided,
  onFinish,
}: {
  api?: SetupApi;
  /** Leaves the welcome for an address in Med. */
  onFinish(url: string): void;
}) {
  const [api] = useState(() => provided ?? createSetupApi());
  const setup = useSetup(api);
  const theme = useTheme().active;
  const canvas = useRef<HTMLCanvasElement>(null);
  const field = useRef<Field | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [progress, setProgress] = useState({ added: 0, total: 0 });

  useEffect(() => {
    if (!canvas.current) return;
    try {
      field.current = createField(
        canvas.current,
        fieldColors(themeController.getSnapshot().active),
        {
          still: matchMedia("(prefers-reduced-motion: reduce)").matches,
        },
      );
    } catch {
      // Without WebGL 2, the page keeps its CSS background.
    }
    return () => {
      field.current?.dispose();
      field.current = null;
    };
  }, []);
  useEffect(() => field.current?.setColors(fieldColors(theme)), [theme]);

  const sources = useMemo(() => setup.status?.sources ?? [], [setup.status]);
  const toAdd = [...setup.rows.repo, ...setup.rows.vault].filter(
    (row) => row.state === "idle" && setup.selected.has(row.path),
  ).length;

  const finish = useCallback(() => {
    const repo = sources.find((source) => source.kind === "repo");
    const vault = sources.find((source) => source.kind === "vault");
    onFinish(repo ? "/" : vault ? `/vault/${vault.id}` : "/sources");
  }, [onFinish, sources]);

  const primary = useCallback(async () => {
    if (busy) return;
    if (done || !toAdd) return finish();
    setBusy(true);
    setProgress({ added: 0, total: toAdd });
    try {
      const ok = await setup.apply(() => {
        setProgress((current) => ({ ...current, added: current.added + 1 }));
        field.current?.pulse(0.75);
      });
      if (ok) {
        setDone(true);
        field.current?.pulse(1.6);
        heading.current?.focus({ preventScroll: true });
      }
    } finally {
      setBusy(false);
    }
  }, [busy, done, finish, setup, toAdd]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== "Enter" || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      if (target?.closest("input, textarea, select, button, a, [contenteditable='true']")) return;
      event.preventDefault();
      void primary();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [primary]);

  const label = busy
    ? `Adding ${Math.min(progress.added + 1, progress.total)} of ${progress.total}…`
    : done || (!toAdd && sources.length)
      ? "Open Med"
      : toAdd
        ? `Add ${toAdd} ${toAdd === 1 ? "source" : "sources"}`
        : "Skip for now";
  const { status, discovery, scanning } = setup;

  return (
    <div {...stylex.props(styles.root)} data-welcome={done ? "done" : "setup"}>
      <canvas ref={canvas} aria-hidden="true" {...stylex.props(styles.canvas)} />
      <main {...stylex.props(styles.main)}>
        <header {...stylex.props(styles.hero, styles.rise)}>
          <img src="/icons/icon.svg" alt="" width={48} height={48} {...stylex.props(styles.mark)} />
          <h1 ref={heading} tabIndex={-1} {...stylex.props(styles.title)}>
            {done ? "You're all set" : "Welcome to Med"}
          </h1>
          <p aria-live="polite" {...stylex.props(styles.lede)}>
            {done
              ? summary(sources)
              : "Choose the repositories and Obsidian vaults to review. You can change them any time in Sources."}
          </p>
        </header>

        <section aria-label="Sources" {...stylex.props(styles.card, styles.rise, styles.riseLate)}>
          <div {...stylex.props(styles.list)}>
            <SourceGroup
              title="Repositories"
              kind="repo"
              rows={setup.rows.repo}
              setup={setup}
              disabled={busy}
              empty="No Git repositories found in your home folder."
              footer={
                discovery?.skipped.length ? (
                  <p {...stylex.props(styles.note)}>
                    Not searched:{" "}
                    {new Intl.ListFormat("en", { type: "conjunction" }).format(discovery.skipped)}.{" "}
                    <button
                      type="button"
                      disabled={scanning}
                      onClick={() => void setup.scan(true)}
                      {...stylex.props(styles.link)}
                    >
                      {scanning ? "Searching…" : "Search them too"}
                    </button>
                  </p>
                ) : null
              }
            />
            <SourceGroup
              title="Obsidian vaults"
              kind="vault"
              rows={setup.rows.vault}
              setup={setup}
              disabled={busy}
              empty="No Obsidian vaults found."
            />
            <AddFolder onAdd={setup.addPath} home={discovery?.home} />
          </div>
          {setup.error && (
            <p role="alert" {...stylex.props(styles.error)}>
              {setup.error}
            </p>
          )}
          <footer {...stylex.props(styles.footer)}>
            {status?.login.available ? (
              <div {...stylex.props(styles.login)}>
                <button
                  type="button"
                  role="switch"
                  aria-checked={status.login.enabled}
                  aria-labelledby="welcome-login"
                  aria-describedby="welcome-login-detail"
                  onClick={() => void setup.setLogin(!status.login.enabled)}
                  {...stylex.props(styles.switch, status.login.enabled && styles.switchOn)}
                >
                  <span {...stylex.props(styles.knob, status.login.enabled && styles.knobOn)} />
                </button>
                <span {...stylex.props(styles.loginText)}>
                  <span id="welcome-login" {...stylex.props(styles.loginTitle)}>
                    Open at login
                  </span>
                  <span id="welcome-login-detail" {...stylex.props(styles.loginDetail)}>
                    Review links keep working after a restart.
                  </span>
                </span>
              </div>
            ) : (
              <span {...stylex.props(ui.grow)} />
            )}
            <button
              type="button"
              disabled={busy || (scanning && !discovery)}
              onClick={() => void primary()}
              {...stylex.props(
                ui.button,
                ui.primary,
                ui.pressable,
                styles.primary,
                !toAdd && !done && !sources.length && styles.secondary,
              )}
            >
              {label}
              {!busy && (done || (!toAdd && sources.length > 0)) && (
                <Icon name="arrowDown" size={13} style={{ transform: "rotate(-90deg)" }} />
              )}
            </button>
          </footer>
        </section>
      </main>
    </div>
  );
}

function SourceGroup({
  title,
  kind,
  rows,
  setup,
  disabled,
  empty,
  footer,
}: {
  title: string;
  kind: SourceKind;
  rows: Row[];
  setup: Setup;
  disabled: boolean;
  empty: string;
  footer?: ReactNode;
}) {
  const [all, setAll] = useState(false);
  const [now] = useState(Date.now);
  const home = setup.discovery?.home;
  const searching = setup.scanning && !setup.discovery;
  const open = rows.filter((row) => row.state === "idle");
  const picked = open.filter((row) => setup.selected.has(row.path));
  const added = rows.length - open.length;
  // Selected and added rows always show; the rest wait behind "Show more".
  const shown = all
    ? rows
    : rows.filter(
        (row, index) => index < SHOWN || row.state !== "idle" || setup.selected.has(row.path),
      );
  const hidden = rows.length - shown.length;

  return (
    <div {...stylex.props(styles.group)} data-sources={kind}>
      <div {...stylex.props(styles.groupHead)}>
        <h2 {...stylex.props(styles.groupTitle)}>{title}</h2>
        <span {...stylex.props(styles.count)}>
          {searching
            ? "Searching…"
            : [
                rows.length ? `${rows.length} found` : "",
                added ? `${added} added` : "",
                picked.length ? `${picked.length} selected` : "",
              ]
                .filter(Boolean)
                .join(" · ")}
        </span>
        <span {...stylex.props(ui.grow)} />
        {open.length > 1 && (
          <button
            type="button"
            disabled={disabled}
            onClick={() =>
              setup.choose(
                open.map((row) => row.path),
                picked.length < open.length,
              )
            }
            {...stylex.props(styles.link, styles.quietLink)}
          >
            {picked.length < open.length ? "Select all" : "Clear"}
          </button>
        )}
      </div>
      {searching ? (
        <div aria-busy="true" {...stylex.props(styles.rows)}>
          {[0.42, 0.3, 0.5].map((width) => (
            <div key={width} {...stylex.props(styles.skeleton)}>
              <span {...stylex.props(styles.skeletonBox)} />
              <span {...stylex.props(styles.skeletonText)}>
                <span {...stylex.props(styles.skeletonLine, styles.skeletonWidth(width))} />
                <span {...stylex.props(styles.skeletonLine, styles.skeletonWidth(width * 1.6))} />
              </span>
            </div>
          ))}
        </div>
      ) : rows.length ? (
        <ul {...stylex.props(styles.rows)}>
          {shown.map((row) => {
            const checked = row.state === "added" || setup.selected.has(row.path);
            const locked = row.state !== "idle" || disabled;
            return (
              <li key={row.path}>
                <label
                  title={row.path}
                  data-state={row.state}
                  {...stylex.props(styles.row, locked && styles.rowLocked)}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={locked}
                    onChange={() => setup.choose([row.path], !setup.selected.has(row.path))}
                    {...stylex.props(styles.checkInput)}
                  />
                  <span
                    aria-hidden="true"
                    {...stylex.props(
                      styles.check,
                      checked && styles.checkOn,
                      row.state === "added" && styles.checkAdded,
                    )}
                  >
                    <Icon name="check" size={11} />
                  </span>
                  <span {...stylex.props(styles.rowText)}>
                    <span data-row="name" {...stylex.props(styles.rowName)}>
                      {row.name}
                    </span>
                    <span {...stylex.props(styles.rowDetail)}>
                      <span data-row="path" {...stylex.props(styles.rowPath)}>
                        {displayPath(row.path, home)}
                      </span>
                      {row.branch && (
                        <span data-row="branch" {...stylex.props(styles.branch)}>
                          <Icon name="gitBranch" size={11} />
                          {row.branch}
                        </span>
                      )}
                    </span>
                  </span>
                  <span {...stylex.props(styles.rowMeta)}>
                    {row.state === "added" ? (
                      <span {...stylex.props(styles.added)}>Added</span>
                    ) : row.state === "adding" ? (
                      <span role="img" aria-label="Adding" {...stylex.props(styles.spinner)} />
                    ) : row.state === "failed" ? (
                      <span {...stylex.props(styles.failed)}>Failed</span>
                    ) : (
                      since(row.activity, now)
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <p {...stylex.props(styles.note, styles.empty)}>{empty}</p>
      )}
      {(hidden > 0 || all) && rows.length > SHOWN && (
        <button
          type="button"
          onClick={() => setAll(!all)}
          {...stylex.props(styles.link, styles.more)}
        >
          {all ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
      {footer}
    </div>
  );
}

function AddFolder({ onAdd, home }: { onAdd(path: string): Promise<void>; home?: string }) {
  const [path, setPath] = useState("");
  const [state, setState] = useState({ busy: false, error: "" });
  return (
    <form
      {...stylex.props(styles.addFolder)}
      onSubmit={(event) => {
        event.preventDefault();
        const value = path.trim();
        if (!value) return;
        setState({ busy: true, error: "" });
        onAdd(value).then(
          () => {
            setPath("");
            setState({ busy: false, error: "" });
          },
          (reason) => setState({ busy: false, error: message(reason) }),
        );
      }}
    >
      <div {...stylex.props(styles.addRow)}>
        <Icon name="folder" size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
        <input
          aria-label="Add a folder by path"
          value={path}
          placeholder={`Add a folder by path, such as ${home ? "~/" : "/"}code/project`}
          spellCheck={false}
          autoComplete="off"
          onChange={(event) => setPath(event.target.value)}
          {...stylex.props(styles.addInput)}
        />
        {path.trim() && (
          <button
            type="submit"
            disabled={state.busy}
            {...stylex.props(ui.button, ui.outlined, styles.addButton)}
          >
            {state.busy ? "Adding…" : "Add"}
          </button>
        )}
      </div>
      {state.error && (
        <p role="alert" {...stylex.props(styles.error, styles.addError)}>
          {state.error}
        </p>
      )}
    </form>
  );
}

const rise = stylex.keyframes({
  from: { opacity: 0, transform: "translateY(14px)", filter: "blur(4px)" },
  to: { opacity: 1, transform: "none", filter: "none" },
});
const appear = stylex.keyframes({ from: { opacity: 0 }, to: { opacity: 1 } });
const shimmer = stylex.keyframes({
  "0%": { opacity: 0.5 },
  "50%": { opacity: 1 },
  "100%": { opacity: 0.5 },
});
const spin = stylex.keyframes({ to: { transform: "rotate(360deg)" } });
const reduced = "@media (prefers-reduced-motion: reduce)";
const narrow = "@media (max-width: 640px)";
const short = "@media (max-height: 720px)";

const styles = stylex.create({
  root: {
    position: "fixed",
    inset: 0,
    zIndex: 30,
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    // Shown until the shader draws, and in its place without WebGL 2.
    backgroundImage: `radial-gradient(90% 60% at 50% 55%, color-mix(in srgb, ${tokens.accent} 7%, transparent), transparent 70%)`,
    color: tokens.text,
    fontFamily: tokens.ui,
  },
  canvas: {
    position: "absolute",
    inset: 0,
    display: "block",
    width: "100%",
    height: "100%",
    animationName: { default: appear, [reduced]: "none" },
    animationDuration: "1200ms",
    animationTimingFunction: tokens.easeOut,
  },
  main: {
    position: "relative",
    zIndex: 1,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: { default: 32, [short]: 20 },
    height: "100%",
    paddingTop: { default: "clamp(28px, 9vh, 104px)", [short]: 24 },
    paddingBottom: { default: "clamp(16px, 6vh, 64px)", [short]: 16 },
    paddingInline: 16,
  },
  rise: {
    animationName: { default: rise, [reduced]: "none" },
    animationDuration: "900ms",
    animationTimingFunction: tokens.easeOut,
    animationFillMode: "both",
    animationDelay: "250ms",
  },
  riseLate: { animationDelay: "480ms" },
  hero: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    flexShrink: 0,
    maxWidth: 600,
    textAlign: "center",
  },
  mark: {
    display: { default: "block", [short]: "none" },
    width: 48,
    height: 48,
    marginBottom: 22,
    borderRadius: `calc(12px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 12px 36px -8px color-mix(in srgb, ${tokens.accent} 45%, transparent)`,
  },
  title: {
    marginBlock: 0,
    fontSize: { default: "clamp(34px, 4.2vw, 50px)", [narrow]: 32 },
    fontWeight: 600,
    letterSpacing: "-0.035em",
    lineHeight: 1.04,
    outline: "none",
    textWrap: "balance",
  },
  lede: {
    maxWidth: 440,
    marginTop: 14,
    marginBottom: 0,
    color: tokens.muted,
    fontSize: { default: 15, [narrow]: 14 },
    lineHeight: 1.6,
    textWrap: "balance",
  },
  card: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    flexGrow: 0,
    flexShrink: 1,
    minHeight: 0,
    width: "min(600px, 100%)",
    overflow: "hidden",
    borderRadius: {
      default: `calc(18px * ${tokens.round})`,
      [narrow]: `calc(14px * ${tokens.round})`,
    },
    backgroundColor: `color-mix(in srgb, ${tokens.raised} 76%, transparent)`,
    backdropFilter: "blur(28px) saturate(1.4)",
    boxShadow: `inset 0 1px 0 ${tokens.fill}, 0 0 0 1px ${tokens.line}, 0 30px 90px -30px color-mix(in srgb, ${tokens.panel} 90%, transparent)`,
  },
  list: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    minHeight: 0,
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingBlock: 8,
    paddingInline: 8,
    scrollbarWidth: "thin",
  },
  group: { display: "flex", flexDirection: "column", paddingBottom: 6 },
  groupHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    paddingTop: 10,
    paddingBottom: 6,
    paddingInline: 10,
  },
  groupTitle: {
    marginBlock: 0,
    color: tokens.text,
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: "-0.005em",
  },
  count: { color: tokens.faint, fontSize: 12, fontVariantNumeric: "tabular-nums" },
  rows: {
    display: "flex",
    flexDirection: "column",
    gap: 1,
    marginBlock: 0,
    paddingInlineStart: 0,
    listStyle: "none",
  },
  row: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 48,
    paddingBlock: 6,
    paddingInline: 10,
    borderRadius: `calc(10px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    cursor: "pointer",
    outline: { default: "none", ":has(:focus-visible)": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    transitionProperty: "background-color",
    transitionDuration: "120ms",
  },
  rowLocked: {
    cursor: "default",
    backgroundColor: { default: "transparent", ":hover": "transparent" },
  },
  checkInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
    pointerEvents: "none",
  },
  check: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
    width: 18,
    height: 18,
    borderRadius: `calc(6px * ${tokens.round})`,
    boxShadow: `inset 0 0 0 1.5px ${tokens.lineStrong}`,
    color: "transparent",
    transform: { default: "scale(1)", ":active": "scale(0.92)" },
    transitionProperty: "background-color, box-shadow, color, transform",
    transitionDuration: "160ms",
    transitionTimingFunction: tokens.easeOut,
  },
  checkOn: {
    backgroundColor: tokens.accent,
    boxShadow: `0 0 12px -2px color-mix(in srgb, ${tokens.accent} 70%, transparent)`,
    color: tokens.canvas,
  },
  checkAdded: { backgroundColor: tokens.green, boxShadow: "none" },
  rowText: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flexGrow: 1 },
  rowName: {
    overflow: "hidden",
    fontSize: 13.5,
    fontWeight: 500,
    letterSpacing: "-0.005em",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  rowDetail: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minWidth: 0,
    color: tokens.faint,
    fontSize: 12,
  },
  rowPath: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  branch: {
    display: { default: "inline-flex", [narrow]: "none" },
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11,
  },
  rowMeta: {
    flexShrink: 0,
    minWidth: 30,
    color: tokens.faint,
    fontSize: 12,
    fontVariantNumeric: "tabular-nums",
    textAlign: "right",
  },
  added: { color: tokens.green, fontWeight: 500 },
  failed: { color: tokens.red, fontWeight: 500 },
  spinner: {
    display: "inline-block",
    width: 12,
    height: 12,
    borderRadius: "50%",
    borderWidth: 1.5,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    borderTopColor: tokens.accent,
    animationName: spin,
    animationDuration: "700ms",
    animationTimingFunction: "linear",
    animationIterationCount: "infinite",
  },
  skeleton: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    height: 48,
    paddingInline: 10,
    animationName: { default: shimmer, [reduced]: "none" },
    animationDuration: "1.4s",
    animationIterationCount: "infinite",
  },
  skeletonBox: {
    width: 18,
    height: 18,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: tokens.fillStrong,
  },
  skeletonText: { display: "flex", flexDirection: "column", gap: 7, flexGrow: 1 },
  skeletonLine: {
    height: 8,
    borderRadius: `calc(4px * ${tokens.round})`,
    backgroundColor: tokens.fillStrong,
  },
  skeletonWidth: (width: number) => ({ width: `${Math.round(width * 100)}%` }),
  note: {
    marginBlock: 0,
    paddingTop: 6,
    paddingInline: 10,
    color: tokens.faint,
    fontSize: 12,
    lineHeight: 1.5,
  },
  empty: { paddingBlock: 8 },
  link: {
    paddingBlock: 0,
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: { default: tokens.accent, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: 2,
    borderRadius: `calc(3px * ${tokens.round})`,
  },
  quietLink: { color: { default: tokens.muted, ":hover": tokens.text } },
  more: { alignSelf: "flex-start", marginTop: 4, marginInline: 10 },
  addFolder: { display: "flex", flexDirection: "column", paddingBottom: 4 },
  addRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    minHeight: 44,
    paddingInlineStart: 12,
    paddingInlineEnd: 8,
    borderRadius: `calc(10px * ${tokens.round})`,
    color: tokens.faint,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.line}`,
      ":focus-within": `inset 0 0 0 1px ${tokens.accentLine}`,
    },
    marginInline: 2,
  },
  addInput: {
    flexGrow: 1,
    minWidth: 0,
    height: 32,
    paddingInline: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 13,
    outline: "none",
    "::placeholder": { color: tokens.faint },
  },
  addButton: { minHeight: 26 },
  addError: { paddingInline: 10, paddingTop: 6 },
  error: {
    marginBlock: 0,
    paddingBottom: 10,
    paddingInline: 18,
    color: tokens.red,
    fontSize: 12.5,
    lineHeight: 1.5,
  },
  footer: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
    flexShrink: 0,
    paddingBlock: 14,
    paddingInline: 16,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
    backgroundColor: `color-mix(in srgb, ${tokens.canvas} 35%, transparent)`,
  },
  login: { display: "flex", alignItems: "center", gap: 12, minWidth: 0 },
  loginText: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 },
  loginTitle: { fontSize: 13, fontWeight: 500 },
  loginDetail: { color: tokens.faint, fontSize: 12 },
  switch: {
    position: "relative",
    flexShrink: 0,
    width: 36,
    height: 22,
    paddingBlock: 0,
    paddingInline: 0,
    borderWidth: 0,
    borderRadius: 999,
    backgroundColor: tokens.fillStrong,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: 2,
    transitionProperty: "background-color, box-shadow",
    transitionDuration: "200ms",
  },
  switchOn: {
    backgroundColor: tokens.accent,
    boxShadow: `0 0 14px -2px color-mix(in srgb, ${tokens.accent} 70%, transparent)`,
  },
  knob: {
    position: "absolute",
    top: 3,
    left: 3,
    width: 16,
    height: 16,
    borderRadius: "50%",
    backgroundColor: "#fff",
    boxShadow: "0 1px 3px #0005",
    transitionProperty: "transform",
    transitionDuration: { default: "240ms", [reduced]: "0ms" },
    transitionTimingFunction: tokens.easeOut,
  },
  knobOn: { transform: "translateX(14px)" },
  primary: {
    flexGrow: { default: 0, [narrow]: 1 },
    gap: 8,
    minHeight: 36,
    paddingInline: 16,
    borderRadius: `calc(10px * ${tokens.round})`,
    fontSize: 13,
  },
  secondary: {
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
    backgroundColor: { default: tokens.fill, ":hover:not(:disabled)": tokens.fillStrong },
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
});
