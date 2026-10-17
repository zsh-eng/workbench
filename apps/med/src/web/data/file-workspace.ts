import { useSyncExternalStore } from "react";
import type { BrowseSource } from "../../shared/browse";
import type { FileRead } from "../../shared/local-file";
import type { BrowseApi } from "./browse";

/** A registered vault, whose files a tab names by their paths in the vault. */
export type VaultSource = { kind: "vault"; id: string };
export type TabSource = BrowseSource | VaultSource;

export interface OpenFileTab {
  id: string;
  path: string;
  source: TabSource;
  sourceLabel: string;
  line?: number;
  column?: number;
}
interface Workspace {
  tabs: OpenFileTab[];
  active: string;
  /** The row's tabs, the most recently shown first: a tab that closes gives
   * the screen back to the tab that showed before it. */
  recent: string[];
  recentPaths: string[];
}
interface FileWorkspaceSnapshot extends Workspace {
  key: string;
  source: BrowseSource | null;
  sourceLabel: string;
  file: FileRead | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
}
/** Tabs that are not files: the diff stream, a saved review's guide and brief, and Commit. */
export const isFileTab = (id: string) =>
  id !== "changes" && id !== "brief" && id !== "guide" && id !== "commit";

export function sourceKey(source: TabSource) {
  return JSON.stringify(
    source.kind === "vault"
      ? [source.kind, source.id]
      : source.kind === "commit"
        ? [source.kind, source.repo, source.oid]
        : [source.kind, source.repo],
  );
}
/** The tab source that a read file came from. */
function readSourceKey(file: FileRead) {
  if ("vault" in file && file.vault) return sourceKey({ kind: "vault", id: file.vault.id });
  return file.source.kind === "worktree" || file.source.kind === "commit"
    ? sourceKey(file.source)
    : "";
}
/** A file's path as its tab names it: in its vault, or in its repository. */
const readPath = (file: FileRead) => ("vault" in file && file.vault ? file.vault.path : file.path);

const STORAGE = "med:files:v1:";
const STORAGE_INDEX = "med:files:v1";
/** Workspaces whose open files outlast the window, most recent last. */
const STORED = 48;

function storedSource(value: unknown) {
  const source = value as Partial<{ kind: string; repo: string; oid: string; id: string }> | null;
  if (source?.kind === "vault") return typeof source.id === "string";
  return (
    typeof source?.repo === "string" &&
    (source.kind === "worktree" || (source.kind === "commit" && typeof source.oid === "string"))
  );
}

function readStored(key: string): Workspace | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE + key) ?? "null") as Workspace | null;
    if (!value || !Array.isArray(value.tabs) || typeof value.active !== "string") return undefined;
    const tabs = value.tabs.filter(
      (tab) =>
        tab &&
        typeof tab.id === "string" &&
        typeof tab.path === "string" &&
        typeof tab.sourceLabel === "string" &&
        storedSource(tab.source),
    );
    const active =
      !isFileTab(value.active) || tabs.some((tab) => tab.id === value.active)
        ? value.active
        : "changes";
    return {
      // Tabs from before every tab stayed open carry a `pinned` flag.
      tabs: tabs.map(({ pinned: _pinned, ...tab }: OpenFileTab & { pinned?: unknown }) => tab),
      active,
      recent: Array.isArray(value.recent)
        ? value.recent.filter((id) => typeof id === "string").slice(0, RECENT)
        : [],
      recentPaths: Array.isArray(value.recentPaths)
        ? value.recentPaths.filter((path) => typeof path === "string").slice(0, 50)
        : [],
    };
  } catch {
    return undefined;
  }
}

function writeStored(key: string, workspace: Workspace) {
  try {
    localStorage.setItem(STORAGE + key, JSON.stringify(workspace));
    const index = (JSON.parse(localStorage.getItem(STORAGE_INDEX) ?? "[]") as unknown[]).filter(
      (entry): entry is string => typeof entry === "string" && entry !== key,
    );
    index.push(key);
    while (index.length > STORED) localStorage.removeItem(STORAGE + index.shift()!);
    localStorage.setItem(STORAGE_INDEX, JSON.stringify(index));
  } catch {
    /* The open files last for this window. */
  }
}

/** Open files in one workspace's row. Each open file keeps its own tab. */
export const TAB_LIMIT = 24;
/** Tabs in the recent order: every file tab and every other tab, with room to spare. */
const RECENT = 40;

/** Retain navigation per workspace, but retain bytes only for the active file.
 * With `persist`, each workspace's open files and tab outlast the window, so a
 * restart opens them again. A `held` tab, such as one with an unsaved draft,
 * keeps its place when a full row opens another file. */
export function createFileWorkspace(
  api: BrowseApi,
  {
    persist = false,
    held = () => false,
  }: { persist?: boolean; held?: (tab: OpenFileTab) => boolean } = {},
) {
  // Whether a tab that is not a file's, such as Notes or Commit, is in the
  // row now; a closed file gives the screen only to a tab that is.
  let available = (_id: string) => true;
  const workspaces = new Map<string, Workspace>();
  // Each workspace's open files reach storage shortly after they change,
  // and at once when the window goes away.
  const pending = new Map<string, Workspace>();
  const written = new Map<string, string>();
  let storeTimer: ReturnType<typeof setTimeout> | undefined;
  const flush = () => {
    clearTimeout(storeTimer);
    for (const [key, navigation] of pending) {
      written.set(key, JSON.stringify(navigation));
      writeStored(key, navigation);
    }
    pending.clear();
  };
  if (persist) globalThis.addEventListener?.("pagehide", flush);
  const listeners = new Set<() => void>();
  let snapshot: FileWorkspaceSnapshot = {
    key: "",
    source: null,
    sourceLabel: "",
    tabs: [],
    active: "changes",
    recent: ["changes"],
    recentPaths: [],
    file: null,
    loading: false,
    stale: false,
    error: null,
  };
  let abort: AbortController | undefined;
  let generation = 0;
  let staleCheck: AbortController | undefined;
  let disposed = false;
  const publish = (change: Partial<FileWorkspaceSnapshot>) => {
    if (disposed) return;
    const before = snapshot;
    snapshot = { ...snapshot, ...change };
    // The tab on screen leads the recent order, and closed files leave it.
    if (
      snapshot.active !== before.active ||
      snapshot.tabs !== before.tabs ||
      snapshot.recent !== before.recent
    )
      snapshot.recent = [
        snapshot.active,
        ...snapshot.recent.filter(
          (id) =>
            id !== snapshot.active &&
            (!isFileTab(id) || snapshot.tabs.some((tab) => tab.id === id)),
        ),
      ].slice(0, RECENT);
    if (snapshot.key) {
      workspaces.delete(snapshot.key);
      workspaces.set(snapshot.key, {
        tabs: snapshot.tabs,
        active: snapshot.active,
        recent: snapshot.recent,
        recentPaths: snapshot.recentPaths,
      });
      // Match the branch-tab limit. These entries contain navigation, never file bytes.
      while (workspaces.size > 32) workspaces.delete(workspaces.keys().next().value!);
      if (persist) {
        const key = snapshot.key;
        const navigation = {
          tabs: snapshot.tabs.map(({ line: _line, column: _column, ...tab }) => tab),
          active: snapshot.active,
          recent: snapshot.recent,
          recentPaths: snapshot.recentPaths,
        };
        if (written.get(key) !== JSON.stringify(navigation)) {
          pending.set(key, navigation);
          clearTimeout(storeTimer);
          storeTimer = setTimeout(flush, 250);
        }
      }
    }
    for (const listener of listeners) listener();
  };
  const cancel = () => {
    ++generation;
    abort?.abort();
    staleCheck?.abort();
  };
  async function load() {
    cancel();
    const tab = snapshot.tabs.find((item) => item.id === snapshot.active);
    if (!tab) {
      publish({ file: null, loading: false, stale: false, error: null });
      return;
    }
    const current = generation;
    abort = new AbortController();
    publish({ file: null, loading: true, stale: false, error: null });
    try {
      const file: FileRead =
        tab.source.kind === "vault"
          ? await (api.readVault?.(tab.source.id, tab.path, abort.signal) ??
              Promise.reject(new Error("Vault files are not available here.")))
          : await api.read(tab.source, tab.path, abort.signal);
      if (disposed || current !== generation) return;
      if (readPath(file) !== tab.path || readSourceKey(file) !== sourceKey(tab.source))
        throw new Error("The file response does not match the selected source.");
      publish({ file, loading: false });
    } catch (error) {
      if (disposed || current !== generation) return;
      publish({
        loading: false,
        error: error instanceof Error ? error.message : "Could not read this file.",
      });
    }
  }
  /** The tab that showed most recently, of those still in the row and not in `leaving`. */
  function previous(leaving: ReadonlySet<string> = new Set([snapshot.active])) {
    return (
      snapshot.recent.find(
        (id) =>
          !leaving.has(id) &&
          (isFileTab(id) ? snapshot.tabs.some((tab) => tab.id === id) : available(id)),
      ) ?? "changes"
    );
  }
  /** Closes file tabs. When the tab on screen closes, the tab that showed
   * before it shows again, as in VS Code and Zed. */
  function close(ids: string | readonly string[]) {
    const closing = new Set(typeof ids === "string" ? [ids] : ids);
    const tabs = snapshot.tabs.filter((tab) => !closing.has(tab.id));
    if (tabs.length === snapshot.tabs.length) return;
    const shows = closing.has(snapshot.active);
    publish({ tabs, ...(shows ? { active: previous(closing) } : {}) });
    if (shows) void load();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Show a workspace's files. `keep` is a tab that is not a file's, such as
     * the Notes of a saved review, that stays in front when the workspace
     * changes under it. */
    configure(
      key: string,
      source: BrowseSource | null,
      sourceLabel: string,
      keep: readonly string[] = [],
    ) {
      if (
        snapshot.key === key &&
        JSON.stringify(snapshot.source) === JSON.stringify(source) &&
        snapshot.sourceLabel === sourceLabel
      )
        return;
      const sameWorkspace = snapshot.key === key;
      const saved = sameWorkspace
        ? snapshot
        : (workspaces.get(key) ?? (persist && key ? readStored(key) : undefined));
      cancel();
      publish({
        key,
        source,
        sourceLabel,
        tabs: saved?.tabs ?? [],
        active: keep.includes(snapshot.active) ? snapshot.active : (saved?.active ?? "changes"),
        recent: saved?.recent ?? [],
        recentPaths: saved?.recentPaths ?? [],
        file: null,
        loading: false,
        stale: false,
        error: null,
      });
      if (source && isFileTab(snapshot.active)) void load();
    },
    /** Opens a file in a tab of its own, or shows its tab when it is open, at
     * `line` when given. A `background` open adds the tab and keeps the tab
     * on screen. */
    open(
      path: string,
      line?: number,
      source: TabSource | null = snapshot.source,
      label = snapshot.sourceLabel,
      column?: number,
      { background = false }: { background?: boolean } = {},
    ) {
      if (!source || disposed) return;
      const id = `${sourceKey(source)}:${path}`;
      const existing = snapshot.tabs.some((tab) => tab.id === id);
      // A file that shows already keeps its cursor and scroll.
      if (existing && !line && (background || (snapshot.active === id && snapshot.file))) return;
      let tabs = snapshot.tabs;
      if (existing && line)
        tabs = tabs.map((tab) => (tab.id === id ? { ...tab, line, column } : tab));
      else if (!existing) {
        tabs = [...tabs];
        // A full row gives up the tab that showed least recently and has no unsaved draft.
        if (tabs.length >= TAB_LIMIT) {
          const age = (id: string) => {
            const place = snapshot.recent.indexOf(id);
            return place < 0 ? Infinity : place;
          };
          let index = -1;
          tabs.forEach((tab, place) => {
            if (tab.id === snapshot.active || held(tab)) return;
            if (index < 0 || age(tab.id) > age(tabs[index]!.id)) index = place;
          });
          if (index < 0) {
            publish({
              error: `Save or discard a draft before opening another file (${TAB_LIMIT}-tab limit).`,
            });
            return;
          }
          tabs.splice(index, 1);
        }
        tabs.push({ id, path, source, sourceLabel: label, ...(line ? { line, column } : {}) });
      }
      publish({
        tabs,
        ...(!background ? { active: id } : {}),
        ...(snapshot.source && sourceKey(source) === sourceKey(snapshot.source)
          ? {
              recentPaths: [path, ...snapshot.recentPaths.filter((item) => item !== path)].slice(
                0,
                50,
              ),
            }
          : {}),
      });
      if (!background) void load();
    },
    select(id: string) {
      if (isFileTab(id) && !snapshot.tabs.some((tab) => tab.id === id)) return;
      publish({ active: id });
      void load();
    },
    previous,
    close,
    setAvailable(inRow: (id: string) => boolean) {
      available = inRow;
    },
    /** Closes every file tab; the screen goes back to the tab that showed before them. */
    closeAll: () => close(snapshot.tabs.map((tab) => tab.id)),
    /** Closes every file tab but `keep`. When the tab on screen closes, `keep` shows. */
    closeOthers(keep: string = snapshot.active) {
      if (!snapshot.tabs.some((tab) => tab.id === keep) || snapshot.tabs.length < 2) return;
      const shows = isFileTab(snapshot.active) && snapshot.active !== keep;
      publish({
        tabs: snapshot.tabs.filter((tab) => tab.id === keep),
        ...(shows ? { active: keep } : {}),
      });
      if (shows) void load();
    },
    forgetRepository(repositoryId: string) {
      const belongsToRepository = (key: string) => {
        try {
          const identity: unknown = JSON.parse(key);
          return Array.isArray(identity) && identity[0] === repositoryId;
        } catch {
          return false;
        }
      };
      for (const key of workspaces.keys()) if (belongsToRepository(key)) workspaces.delete(key);
      if (belongsToRepository(snapshot.key)) {
        cancel();
        publish({
          key: "",
          source: null,
          sourceLabel: "",
          tabs: [],
          recent: [],
          recentPaths: [],
          active: "changes",
          file: null,
          loading: false,
          stale: false,
          error: null,
        });
      }
    },
    acceptWrite(file: FileRead) {
      const current = snapshot.file;
      if (
        current &&
        readPath(current) === readPath(file) &&
        readSourceKey(current) === readSourceKey(file)
      ) {
        staleCheck?.abort();
        publish({ file, stale: false });
      }
    },
    invalidate(readCurrent: BrowseApi["read"] = api.read) {
      const tab = snapshot.tabs.find((item) => item.id === snapshot.active);
      const file = snapshot.file;
      if (tab?.source.kind !== "worktree" || !file) return;
      staleCheck?.abort();
      const check = new AbortController();
      staleCheck = check;
      const current = generation;
      // Watch events also follow our own saves and edits to unrelated files.
      // Compare identities without replacing the editor's document or selection.
      void readCurrent(tab.source, tab.path, check.signal).then(
        (disk) => {
          if (!check.signal.aborted && current === generation && snapshot.file === file)
            publish({ stale: disk.identity !== file.identity });
        },
        () => {
          if (!check.signal.aborted && current === generation && snapshot.file === file)
            publish({ stale: true });
        },
      );
    },
    refresh: load,
    dispose() {
      flush();
      globalThis.removeEventListener?.("pagehide", flush);
      disposed = true;
      cancel();
      listeners.clear();
      workspaces.clear();
    },
  };
}
export type FileWorkspace = ReturnType<typeof createFileWorkspace>;
export function useFileWorkspace(workspace: FileWorkspace) {
  return useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
}
