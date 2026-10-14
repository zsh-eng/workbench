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
  pinned: boolean;
  source: TabSource;
  sourceLabel: string;
  line?: number;
  column?: number;
}
interface Workspace {
  tabs: OpenFileTab[];
  active: string;
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
      tabs: tabs.map((tab) => ({ ...tab, pinned: tab.pinned === true })),
      active,
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

/** Retain navigation per workspace, but retain bytes only for the active file.
 * With `persist`, each workspace's open files and tab outlast the window, so a
 * restart opens them again. */
export function createFileWorkspace(api: BrowseApi, { persist = false } = {}) {
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
    snapshot = { ...snapshot, ...change };
    if (snapshot.key) {
      workspaces.delete(snapshot.key);
      workspaces.set(snapshot.key, {
        tabs: snapshot.tabs,
        active: snapshot.active,
        recentPaths: snapshot.recentPaths,
      });
      // Match the branch-tab limit. These entries contain navigation, never file bytes.
      while (workspaces.size > 32) workspaces.delete(workspaces.keys().next().value!);
      if (persist) {
        const key = snapshot.key;
        const navigation = {
          tabs: snapshot.tabs.map(({ line: _line, column: _column, ...tab }) => tab),
          active: snapshot.active,
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
        recentPaths: saved?.recentPaths ?? [],
        file: null,
        loading: false,
        stale: false,
        error: null,
      });
      if (source && isFileTab(snapshot.active)) void load();
    },
    open(
      path: string,
      options: boolean | { pinned?: boolean; background?: boolean } = false,
      line?: number,
      source: TabSource | null = snapshot.source,
      label = snapshot.sourceLabel,
      column?: number,
    ) {
      if (!source || disposed) return;
      const background = typeof options === "object" && options.background === true;
      const pinned = background || (typeof options === "boolean" ? options : !!options.pinned);
      const id = `${sourceKey(source)}:${path}`;
      const existing = snapshot.tabs.find((tab) => tab.id === id);
      let tabs: OpenFileTab[];
      if (existing)
        tabs = snapshot.tabs.map((tab) =>
          tab.id === id
            ? { ...tab, pinned: tab.pinned || pinned, ...(line ? { line, column } : {}) }
            : tab,
        );
      else {
        tabs = snapshot.tabs.filter((tab) => background || tab.pinned);
        if (tabs.length >= 12) {
          publish({ error: "Close a file tab before opening another (12-tab limit)." });
          return;
        }
        tabs.push({
          id,
          path,
          pinned,
          source,
          sourceLabel: label,
          ...(line ? { line, column } : {}),
        });
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
    pin(id: string) {
      publish({
        tabs: snapshot.tabs.map((tab) => (tab.id === id ? { ...tab, pinned: true } : tab)),
      });
    },
    close(id: string) {
      const index = snapshot.tabs.findIndex((tab) => tab.id === id);
      if (index < 0) return;
      const wasActive = snapshot.active === id;
      const tabs = snapshot.tabs.filter((tab) => tab.id !== id);
      publish({
        tabs,
        ...(wasActive ? { active: (tabs[index] ?? tabs[index - 1])?.id ?? "changes" } : {}),
      });
      if (wasActive) void load();
    },
    closeAll() {
      cancel();
      publish({
        tabs: [],
        active: "changes",
        file: null,
        loading: false,
        error: null,
        stale: false,
      });
    },
    closeOthers() {
      if (!isFileTab(snapshot.active)) return;
      publish({ tabs: snapshot.tabs.filter((tab) => tab.id === snapshot.active) });
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
