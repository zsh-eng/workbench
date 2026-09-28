import { useSyncExternalStore } from "react";
import type { BrowseRead, BrowseSource } from "../../shared/browse";
import type { BrowseApi } from "./browse";

export interface OpenFileTab {
  id: string;
  path: string;
  pinned: boolean;
  source: BrowseSource;
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
  file: BrowseRead | null;
  loading: boolean;
  stale: boolean;
  error: string | null;
}
export function sourceKey(source: BrowseSource) {
  return JSON.stringify(
    source.kind === "commit" ? [source.kind, source.repo, source.oid] : [source.kind, source.repo],
  );
}

/** Retain navigation per workspace, but retain bytes only for the active file. */
export function createFileWorkspace(api: BrowseApi) {
  const workspaces = new Map<string, Workspace>();
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
      const file = await api.read(tab.source, tab.path, abort.signal);
      if (disposed || current !== generation) return;
      if (file.path !== tab.path || sourceKey(file.source) !== sourceKey(tab.source))
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
    configure(key: string, source: BrowseSource | null, sourceLabel: string) {
      if (
        snapshot.key === key &&
        JSON.stringify(snapshot.source) === JSON.stringify(source) &&
        snapshot.sourceLabel === sourceLabel
      )
        return;
      const sameWorkspace = snapshot.key === key;
      const saved = sameWorkspace ? snapshot : workspaces.get(key);
      cancel();
      publish({
        key,
        source,
        sourceLabel,
        tabs: saved?.tabs ?? [],
        active: saved?.active ?? "changes",
        recentPaths: saved?.recentPaths ?? [],
        file: null,
        loading: false,
        stale: false,
        error: null,
      });
      if (source && snapshot.active !== "changes") void load();
    },
    open(
      path: string,
      options: boolean | { pinned?: boolean; background?: boolean } = false,
      line?: number,
      source = snapshot.source,
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
      if (id !== "changes" && !snapshot.tabs.some((tab) => tab.id === id)) return;
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
      if (snapshot.active === "changes") return;
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
    acceptWrite(file: BrowseRead) {
      const current = snapshot.file;
      if (current?.path === file.path && sourceKey(current.source) === sourceKey(file.source)) {
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
