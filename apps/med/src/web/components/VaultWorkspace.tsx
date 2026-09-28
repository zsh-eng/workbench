import { ActionTooltip, ToolButton } from "./ToolButton";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import { createApi } from "../data/api";
import { z } from "zod";
import { localReadSchema, type LocalRead } from "../../shared/local-file";
import type { BrowseEntry } from "../../shared/browse";
import { FullFileView } from "./FullFileView";
import { FileViewTabs } from "./FileViewTabs";
import { RepositoryFiles } from "./RepositoryFiles";
import { FilePicker } from "./FilePicker";
import { CommandDialog, type ReviewCommand } from "./Controls";
import { createEditorDrafts } from "../data/editor-drafts";
import { ThemePicker } from "./ThemePicker";
import { Icon } from "./Icon";
import { ui } from "../theme.stylex";
import "./VaultWorkspace.css";
const api = createApi(globalThis.fetch.bind(globalThis), "");
const request = async (action: string, body: object = {}, signal?: AbortSignal) =>
  api.json(`/api/service/${action}`, z.any(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
interface Source {
  id: string;
  name: string;
  path: string;
  kind: "repo" | "vault";
  index?: { state: string; revision: number; error?: string };
}
interface VaultTab {
  file: LocalRead;
  pinned: boolean;
}
const route = () => ({
  visible: location.pathname === "/sources" || location.pathname.startsWith("/vault/"),
  id: location.pathname.startsWith("/vault/") ? decodeURIComponent(location.pathname.slice(7)) : "",
  file: new URLSearchParams(location.search).get("file") ?? "",
});

export function VaultWorkspace({ children }: { children: ReactNode }) {
  const [locationState, setLocationState] = useState(route);
  const [sources, setSources] = useState<Source[]>([]);
  const [manifest, setManifest] = useState<{ id: string; entries: BrowseEntry[] }>({
    id: "",
    entries: [],
  });
  const [file, setFile] = useState<LocalRead>();
  const [tabs, setTabs] = useState<VaultTab[]>([]);
  const [backlinkState, setBacklinks] = useState<{
    key: string;
    links: { source: string; line: number }[];
  }>({ key: "", links: [] });
  const [error, setError] = useState("");
  const [themes, setThemes] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(300);
  const [refresh, setRefresh] = useState(0);
  const [line, setLine] = useState<number>();
  const [drafts] = useState(createEditorDrafts);
  const draftRevision = useSyncExternalStore(drafts.subscribe, drafts.getSnapshot);
  const generation = useRef(0);
  const retainedTabs = useRef<VaultTab[]>([]);
  const pinRequests = useRef(new Map<string, boolean>());
  const surface = useRef<HTMLDivElement>(null);
  const source = sources.find((s) => s.id === locationState.id);
  const entries = useMemo(
    () => (manifest.id === locationState.id ? manifest.entries : []),
    [manifest, locationState.id],
  );
  const currentFile =
    file?.vault?.id === locationState.id && file.vault.path === locationState.file
      ? file
      : undefined;
  const currentTabs = tabs.filter((tab) => tab.file.vault?.id === locationState.id);
  const backlinks =
    backlinkState.key === `${locationState.id}:${locationState.file}` ? backlinkState.links : [];
  const updateTabs = useCallback((next: VaultTab[]) => {
    retainedTabs.current = next;
    setTabs(next);
  }, []);
  const navigate = useCallback((url: string) => {
    if (location.pathname + location.search !== url) history.pushState(null, "", url);
    setLocationState(route());
  }, []);
  const open = useCallback(
    (path: string, at?: number, pinned = true) => {
      const key = `${locationState.id}:${path}`;
      pinRequests.current.set(key, pinned || pinRequests.current.get(key) === true);
      if (pinned)
        updateTabs(
          retainedTabs.current.map((tab) =>
            tab.file.vault?.id === locationState.id && tab.file.vault.path === path
              ? { ...tab, pinned: true }
              : tab,
          ),
        );
      const cached = retainedTabs.current.find(
        (tab) => tab.file.vault?.id === locationState.id && tab.file.vault.path === path,
      );
      if (cached) setFile(cached.file);
      setLine(at);
      navigate(`/vault/${locationState.id}?${new URLSearchParams({ file: path })}`);
    },
    [locationState.id, navigate, updateTabs],
  );
  const closeTabs = useCallback(
    (paths: string[]) => {
      if (paths.some((path) => drafts.get(path)?.dirty || drafts.get(path)?.saving)) {
        setError("Save or discard this draft before closing the file.");
        return;
      }
      const next = retainedTabs.current.filter((tab) => !paths.includes(tab.file.path));
      updateTabs(next);
      setError("");
      if (currentFile && paths.includes(currentFile.path)) {
        const target = next.filter((tab) => tab.file.vault?.id === locationState.id).at(-1);
        if (target) open(target.file.vault!.path, undefined, target.pinned);
        else navigate(`/vault/${locationState.id}`);
      }
    },
    [drafts, currentFile, locationState.id, navigate, open, updateTabs],
  );
  const pin = useCallback(
    (path: string) =>
      updateTabs(
        retainedTabs.current.map((tab) =>
          tab.file.path === path ? { ...tab, pinned: true } : tab,
        ),
      ),
    [updateTabs],
  );
  useEffect(() => {
    const next = retainedTabs.current.map((tab) =>
      !tab.pinned && (drafts.get(tab.file.path)?.dirty || drafts.get(tab.file.path)?.saving)
        ? { ...tab, pinned: true }
        : tab,
    );
    if (next.some((tab, index) => tab !== retainedTabs.current[index])) updateTabs(next);
  }, [draftRevision, drafts, updateTabs]);
  useEffect(() => {
    const pop = () => {
      setLine(undefined);
      setLocationState(route());
      setCommandsOpen(false);
      setPickerOpen(false);
    };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (drafts.hasDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [drafts]);
  useEffect(() => {
    if (!locationState.visible) return;
    let cancelled = false,
      busy = false;
    const update = async () => {
      if (busy) return;
      busy = true;
      try {
        const result = await request("status");
        if (!cancelled) setSources(result.sources);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        busy = false;
      }
    };
    void update();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void update();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [locationState.visible]);
  useEffect(() => {
    if (!locationState.id) return;
    const abort = new AbortController();
    request("files", { id: locationState.id }, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted)
          setManifest((previous) => {
            // A content-only index update must not reset folder expansion or tree scroll.
            if (
              previous.id === locationState.id &&
              previous.entries.length === result.files.length &&
              previous.entries.every((entry, index) => entry.path === result.files[index].path)
            )
              return previous;
            return {
              id: locationState.id,
              entries: result.files.map((item: { path: string }) => ({
                path: item.path,
                kind: "file" as const,
              })),
            };
          });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [locationState.id, source?.index?.revision, refresh]);
  useEffect(() => {
    const current = ++generation.current;
    if (!locationState.id || !locationState.file) return;
    const abort = new AbortController();
    request("read", { id: locationState.id, path: locationState.file }, abort.signal)
      .then((value) => {
        if (current !== generation.current || abort.signal.aborted) return;
        const read = localReadSchema.parse(value);
        const key = `${locationState.id}:${locationState.file}`;
        const pinned = pinRequests.current.get(key) ?? true;
        pinRequests.current.delete(key);
        const prior = retainedTabs.current.find((tab) => tab.file.path === read.path);
        const next = prior
          ? retainedTabs.current.map((tab) => (tab === prior ? { ...tab, file: read } : tab))
          : [
              ...retainedTabs.current.filter(
                (tab) =>
                  tab.file.vault?.id !== locationState.id ||
                  tab.pinned ||
                  drafts.get(tab.file.path)?.dirty ||
                  drafts.get(tab.file.path)?.saving,
              ),
              { file: read, pinned },
            ];
        if (
          next.length > 24 ||
          next.reduce((sum, tab) => sum + tab.file.size, 0) > 32 * 1024 * 1024
        )
          throw new Error("Close a note before opening more (24 files / 32 MiB limit).");
        setError("");
        setFile(read);
        updateTabs(next);
      })
      .catch((e) => {
        if (current === generation.current && !abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [locationState.id, locationState.file, source?.index?.revision, refresh, drafts, updateTabs]);
  useEffect(() => {
    if (!locationState.id || !locationState.file) return;
    const abort = new AbortController();
    request("backlinks", { id: locationState.id, path: locationState.file }, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted)
          setBacklinks({
            key: `${locationState.id}:${locationState.file}`,
            links: result.backlinks,
          });
      })
      .catch((e) => {
        if (!abort.signal.aborted) setError(String(e));
      });
    return () => abort.abort();
  }, [locationState.id, locationState.file, source?.index?.revision]);
  useEffect(() => {
    if (!locationState.visible) return;
    let active = true;
    const key = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "k") {
          event.preventDefault();
          event.stopImmediatePropagation();
          setThemes(false);
          if (event.shiftKey && locationState.id) {
            setCommandsOpen(false);
            setPickerOpen((value) => !value);
          } else {
            setPickerOpen(false);
            setCommandsOpen((value) => !value);
          }
        } else if (key === "b" && event.shiftKey && locationState.id) {
          event.preventDefault();
          event.stopImmediatePropagation();
          setSidebar((value) => !value);
        }
      } else if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !document.querySelector('[role="dialog"]')
      ) {
        if (event.code === "KeyW" && currentFile) {
          event.preventDefault();
          event.stopImmediatePropagation();
          closeTabs(
            event.shiftKey
              ? retainedTabs.current
                  .filter((tab) => tab.file.vault?.id === locationState.id)
                  .map((tab) => tab.file.path)
              : [currentFile.path],
          );
        } else if (event.code === "KeyP" && currentFile) {
          event.preventDefault();
          pin(currentFile.path);
        }
      }
    };
    const follow = (event: Event) => {
      const detail = (event as CustomEvent<{ href: string; syntax: string }>).detail;
      request("resolve", { id: locationState.id, path: locationState.file, ...detail })
        .then(async (target) => {
          if (!active) return;
          let at: number | undefined;
          if (target.fragment) {
            const read = await request("read", { id: locationState.id, path: target.path });
            const heading = String(read.text ?? "")
              .split("\n")
              .findIndex(
                (text) =>
                  /^#{1,6}\s+/.test(text) &&
                  text
                    .replace(/^#{1,6}\s+/, "")
                    .trim()
                    .toLowerCase() === decodeURIComponent(target.fragment).toLowerCase(),
              );
            if (heading >= 0) at = heading + 1;
          }
          if (active) open(target.path, at);
        })
        .catch((e) => {
          if (active) setError(String(e));
        });
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("med-vault-navigate", follow);
    return () => {
      active = false;
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("med-vault-navigate", follow);
    };
  }, [
    locationState.visible,
    locationState.id,
    locationState.file,
    currentFile,
    open,
    closeTabs,
    pin,
  ]);
  const previewReader = useMemo(
    () => ({
      scope: `vault:${locationState.id}`,
      async read(path: string, signal: AbortSignal) {
        return localReadSchema.parse(await request("read", { id: locationState.id, path }, signal));
      },
    }),
    [locationState.id],
  );
  const refreshFiles = () => {
    setRefresh((value) => value + 1);
    void request("index", { source: locationState.id }).catch((e) => setError(String(e)));
  };
  const commands: ReviewCommand[] = [
    {
      id: "find-file",
      label: "Find file in this workspace",
      shortcut: "⌘⇧K",
      disabled: !locationState.id,
      managesFocus: true,
      run: () => setPickerOpen(true),
    },
    {
      id: "browse-files",
      label: sidebar ? "Hide files sidebar" : "Show files sidebar",
      shortcut: "⌘⇧B",
      disabled: !locationState.id,
      run: () => setSidebar((value) => !value),
    },
    {
      id: "theme",
      managesFocus: true,
      label: "Change color theme",
      run: () => setThemes(true),
    },
    {
      id: "preview",
      label: "Toggle Markdown preview",
      shortcut: "⌘⇧V",
      disabled: !currentFile || !/\.(md|markdown|mdown|mkd)$/i.test(currentFile.path),
      run: () =>
        surface.current
          ?.querySelector<HTMLButtonElement>('[aria-label="Toggle Markdown preview"]')
          ?.click(),
    },
    {
      id: "close-file",
      label: "Close current file",
      shortcut: "⌥ W",
      disabled: !currentFile,
      run: () => currentFile && closeTabs([currentFile.path]),
    },
    {
      id: "close-files",
      label: "Close all files in this workspace",
      shortcut: "⌥ ⇧ W",
      disabled: !currentTabs.length,
      run: () => closeTabs(currentTabs.map((tab) => tab.file.path)),
    },
    {
      id: "close-others",
      label: "Close other files in this workspace",
      disabled: !currentFile || currentTabs.length < 2,
      run: () =>
        closeTabs(
          currentTabs
            .filter((tab) => tab.file.path !== currentFile?.path)
            .map((tab) => tab.file.path),
        ),
    },
    {
      id: "pin-file",
      label: "Keep current preview tab open",
      shortcut: "⌥ P",
      disabled:
        !currentFile || !!currentTabs.find((tab) => tab.file.path === currentFile.path)?.pinned,
      run: () => currentFile && pin(currentFile.path),
    },
    {
      id: "copy-link",
      label: "Copy link to current file",
      disabled: !currentFile,
      run: () => {
        void navigator.clipboard
          .writeText(location.href)
          .catch(() => setError("Could not copy the link."));
      },
    },
    {
      id: "refresh",
      label: "Refresh files",
      disabled: !locationState.id,
      run: refreshFiles,
    },
    { id: "sources", label: "Open registered sources", run: () => navigate("/sources") },
    {
      id: "repositories",
      label: "Go to repositories",
      run: () => {
        location.assign("/");
      },
    },
    {
      id: "local-files",
      label: "Open standalone files",
      run: () => {
        location.assign("/files");
      },
    },
  ];
  if (!locationState.visible) return <>{children}</>;
  return (
    <div className="med-vault" data-standalone-files>
      {error && (
        <p className="med-vault-notice" role="alert">
          {error}
        </p>
      )}
      {!locationState.id ? (
        <main className="med-vault-sources">
          <h1>Your sources</h1>
          <p>
            Add a repository or vault with <code>med add /path/to/folder</code>.
          </p>
          {sources.map((s) => (
            <a
              key={s.id}
              href={s.kind === "vault" ? `/vault/${s.id}` : "/"}
              onClick={(e) => {
                if (s.kind === "vault") {
                  e.preventDefault();
                  navigate(`/vault/${s.id}`);
                }
              }}
            >
              <strong>{s.name}</strong>
              <span>{s.kind === "vault" ? "Obsidian vault" : "Repository"}</span>
              <small>{s.path}</small>
            </a>
          ))}
          <button {...stylex.props(ui.button)} onClick={() => setCommandsOpen(true)}>
            Commands <span>⌘K</span>
          </button>
        </main>
      ) : (
        <div className="med-vault-layout">
          <main className="med-vault-main">
            <div className="med-vault-tabbar">
              <FileViewTabs
                showChanges={false}
                tabs={currentTabs.map((tab) => ({
                  id: tab.file.path,
                  path: tab.file.vault!.path,
                  pinned: tab.pinned,
                  dirty: drafts.get(tab.file.path)?.dirty,
                }))}
                active={currentFile?.path ?? ""}
                panelId="vault-file-panel"
                onSelect={(id) => {
                  const tab = currentTabs.find((t) => t.file.path === id);
                  if (tab) open(tab.file.vault!.path, undefined, tab.pinned);
                }}
                onPin={pin}
                onClose={(id) => closeTabs([id])}
              />
              <div className="med-vault-actions">
                <ActionTooltip label="Toggle files sidebar" shortcut="⌘ ⇧ B">
                  <button
                    {...stylex.props(ui.button, ui.iconButton)}
                    aria-label="Toggle files sidebar"
                    onClick={() => setSidebar((value) => !value)}
                  >
                    <Icon name="panelLeft" size={14} style={{ transform: "scaleX(-1)" }} />
                  </button>
                </ActionTooltip>
                <ToolButton
                  label="Open command palette"
                  shortcut="⌘ K"
                  icon="command"
                  onClick={() => setCommandsOpen(true)}
                />
              </div>
            </div>
            <div
              id="vault-file-panel"
              ref={surface}
              className="med-vault-surface"
              role="tabpanel"
              aria-label={currentFile ? `File ${locationState.file}` : "Files"}
            >
              {currentFile ? (
                <FullFileView
                  key={currentFile.path}
                  file={currentFile}
                  loading={false}
                  error={null}
                  vimEnabled
                  line={line}
                  sourceLabel={source?.name ?? "Vault"}
                  onClose={() => closeTabs([currentFile.path])}
                  refreshAvailable
                  onRefresh={() => setRefresh((value) => value + 1)}
                  editor={{
                    drafts,
                    key: currentFile.path,
                    write: async (current, text) => {
                      const next = await api.json("/api/local-files/write", localReadSchema, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          path: current.path,
                          expectedIdentity: current.identity,
                          text,
                        }),
                      });
                      const result = { ...next, vault: currentFile.vault };
                      setError("");
                      // Saving an inactive file must not replace the selected editor.
                      if (route().id === result.vault?.id && route().file === result.vault?.path)
                        setFile(result);
                      updateTabs(
                        retainedTabs.current.map((tab) =>
                          tab.file.path === result.path
                            ? { ...tab, file: result, pinned: true }
                            : tab,
                        ),
                      );
                      return result;
                    },
                  }}
                />
              ) : (
                <div className="med-vault-empty">
                  <button {...stylex.props(ui.button)} onClick={() => setPickerOpen(true)}>
                    Find file… <span>⌘⇧K</span>
                  </button>
                </div>
              )}
            </div>
          </main>
          {sidebar && (
            <div
              className="med-vault-resizer"
              role="separator"
              aria-label="Resize files sidebar"
              aria-orientation="vertical"
              aria-valuemin={200}
              aria-valuemax={520}
              aria-valuenow={sidebarWidth}
              tabIndex={0}
              onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
              onPointerMove={(e) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId))
                  setSidebarWidth(
                    Math.max(
                      200,
                      Math.min(
                        520,
                        e.currentTarget.parentElement!.getBoundingClientRect().right - e.clientX,
                      ),
                    ),
                  );
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                  e.preventDefault();
                  setSidebarWidth((value) =>
                    Math.max(200, Math.min(520, value + (e.key === "ArrowLeft" ? 16 : -16))),
                  );
                }
              }}
            />
          )}
          <aside
            className="med-vault-sidebar"
            aria-label="Workspace files"
            hidden={!sidebar}
            style={{ width: sidebarWidth }}
          >
            <RepositoryFiles
              key={locationState.id}
              label="Vault files"
              entries={entries}
              loading={false}
              error={null}
              truncated={false}
              sourceLabel={source?.name ?? "Vault"}
              selectedPath={locationState.file || null}
              onPreview={(path) => open(path, undefined, false)}
              onPin={(path) => open(path)}
              onRefresh={refreshFiles}
              onClose={() => setSidebar(false)}
            />
            {locationState.file && (
              <details className="med-vault-backlinks" open>
                <summary>
                  Backlinks <span>{backlinks.length}</span>
                </summary>
                <section aria-label="Backlinks">
                  {source?.index?.error && <p>{source.index.error}</p>}
                  {backlinks.map((link, i) => (
                    <button
                      key={`${link.source}:${link.line}:${i}`}
                      {...stylex.props(ui.button)}
                      onClick={() => open(link.source, link.line)}
                      title={link.source}
                    >
                      <Icon name="file" size={13} />
                      <span>{link.source}</span>
                      <small>:{link.line}</small>
                    </button>
                  ))}
                </section>
              </details>
            )}
          </aside>
        </div>
      )}
      <CommandDialog open={commandsOpen} onOpenChange={setCommandsOpen} commands={commands} />
      <FilePicker
        key={locationState.id}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        entries={entries}
        loading={false}
        error={null}
        sourceLabel={source?.name ?? "Vault"}
        onOpen={(path, at) => open(path, at)}
        previewReader={previewReader}
        sourceRevision={source?.index?.revision ?? 0}
        openPaths={currentTabs.map((tab) => tab.file.vault!.path)}
      />
      <ThemePicker open={themes} onOpenChange={setThemes} />
    </div>
  );
}
