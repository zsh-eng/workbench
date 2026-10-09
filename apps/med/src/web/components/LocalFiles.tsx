import { useDocumentTitle } from "../data/document-title";
import { mediaType, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES } from "../../shared/media";
import { ToolButton } from "./ToolButton";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type CSSProperties,
} from "react";
import * as stylex from "@stylexjs/stylex";
import { ui } from "../theme.stylex";
import { Dialog } from "@base-ui/react/dialog";
import { CommandDialog } from "./Controls";
import { FullFileView } from "./FullFileView";
import { ThemePicker } from "./ThemePicker";
import { createEditorDrafts } from "../data/editor-drafts";
import { createApi } from "../data/api";
import { localReadSchema, type FileRead } from "../../shared/local-file";
import { useTheme } from "../themes";
import "./LocalFiles.css";
import { visibleElement } from "../data/palette-focus";

const api = createApi(globalThis.fetch.bind(globalThis), "");
const request = (path: string, body: object) =>
  api.json(path, localReadSchema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
type Tab = { id: string; file: FileRead; line?: number; column?: number; edit?: boolean };
const initialStandalone = () =>
  location.pathname === "/files" || location.pathname.startsWith("/file/");

/** The review App stays mounted when a drop opens this file workspace. */
export function LocalFiles({ children }: { children: ReactNode }) {
  const { active: theme } = useTheme();
  const [visible, setVisible] = useState(initialStandalone);
  const [reviewMounted, setReviewMounted] = useState(() => !initialStandalone());
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [selected, setSelected] = useState("");
  const [commands, setCommands] = useState(false);
  const [opening, setOpening] = useState(false);
  const pathInput = useRef<HTMLInputElement>(null);
  const repositoryUrl = useRef(initialStandalone() ? "/" : location.pathname + location.search);
  const [path, setPath] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [themes, setThemes] = useState(false);
  const [copied, setCopied] = useState(false);
  const [drafts] = useState(createEditorDrafts);
  useSyncExternalStore(drafts.subscribe, drafts.getSnapshot);
  const active = tabs.find((tab) => tab.id === selected);
  useDocumentTitle(
    active ? `${active.file.path.split("/").at(-1)} — med` : "Files — med",
    1,
    visible,
  );
  const sequence = useRef(0);
  const currentTabs = useRef(tabs);
  currentTabs.current = tabs;
  const dropUrls = useRef(new Set<string>());
  useEffect(
    () => () => {
      for (const url of dropUrls.current) URL.revokeObjectURL(url);
    },
    [],
  );
  const copiedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const close = useCallback(
    (id: string) => {
      const draft = drafts.get(id);
      if (draft?.dirty || draft?.saving) {
        setError("Save or discard this draft before closing the file.");
        return;
      }
      const old = currentTabs.current.find((tab) => tab.id === id);
      if (old?.file.source.kind === "drop" && old.file.media) {
        URL.revokeObjectURL(old.file.identity);
        dropUrls.current.delete(old.file.identity);
      }
      const next = currentTabs.current.filter((tab) => tab.id !== id);
      currentTabs.current = next;
      setTabs(next);
      setSelected((selected) => (selected === id ? (next[0]?.id ?? "") : selected));
      setError("");
    },
    [drafts],
  );
  const add = (tab: Tab) => {
    const next = [...currentTabs.current.filter((item) => item.id !== tab.id), tab];
    if (
      next.length > 24 ||
      next.reduce((sum, item) => sum + (item.file.media ? 0 : item.file.size), 0) > 32 * 1024 * 1024
    )
      throw new Error("Close a file before opening more (24 files / 32 MiB limit).");
    currentTabs.current = next;
    setTabs((items) => [...items.filter((item) => item.id !== tab.id), tab]);
    setSelected(tab.id);
    setVisible(true);
  };
  const navigate = (url: string) => {
    if (location.pathname + location.search !== url) history.pushState(null, "", url);
  };
  const fileUrl = (path: string) => `/file${path.split("/").map(encodeURIComponent).join("/")}`;
  const repositories = () => {
    navigate(repositoryUrl.current);
    setReviewMounted(true);
    setVisible(false);
  };
  const open = async (
    path: string,
    line?: number,
    column?: number,
    edit = false,
    updateUrl = true,
  ) => {
    const id = ++sequence.current;
    setLoading(true);
    setError("");
    try {
      const file = await request("/api/local-files/open", { path });
      if (id !== sequence.current) return;
      add({ id: file.path, file, line, column, edit });
      setPath("");
      setOpening(false);
      if (updateUrl) navigate(fileUrl(file.path));
    } catch (error) {
      if (id === sequence.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (id === sequence.current) setLoading(false);
    }
  };
  useEffect(() => {
    const restoreRoute = () => {
      ++sequence.current;
      setLoading(false);
      const standalone = initialStandalone();
      setVisible(standalone);
      setCommands(false);
      setOpening(false);
      setThemes(false);
      if (!standalone) {
        ++sequence.current;
        setLoading(false);
        repositoryUrl.current = location.pathname + location.search;
        setReviewMounted(true);
        return;
      }
      if (!location.pathname.startsWith("/file/")) return;
      try {
        const path = decodeURIComponent(location.pathname.slice(5));
        const existing = currentTabs.current.find((tab) => tab.id === path);
        if (existing) {
          setSelected(existing.id);
          return;
        }
        const params = new URLSearchParams(location.search);
        const coordinate = (name: string) => {
          const value = Number(params.get(name));
          return Number.isSafeInteger(value) && value > 0 ? value : undefined;
        };
        void open(
          path,
          coordinate("line"),
          coordinate("column"),
          params.get("edit") === "1",
          false,
        );
      } catch {
        setError("This file link is not valid.");
      }
    };
    restoreRoute();
    const show = () => {
      if (!initialStandalone()) repositoryUrl.current = location.pathname + location.search;
      navigate("/files");
      setVisible(true);
      setOpening(true);
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (drafts.hasDirty()) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      setDragging(true);
    };
    const leave = (event: DragEvent) => {
      if (!event.relatedTarget) setDragging(false);
    };
    const drop = async (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes("Files")) return;
      event.preventDefault();
      ++sequence.current;
      setLoading(false);
      setDragging(false);
      setError("");
      if (!initialStandalone()) repositoryUrl.current = location.pathname + location.search;
      navigate("/files");
      setVisible(true);
      const files = [...event.dataTransfer.files];
      if (!files.length) {
        setError("Drop files, not folders.");
        return;
      }
      if (
        files.length > 12 ||
        files.reduce((sum, file) => sum + (mediaType(file.name) ? 0 : file.size), 0) >
          24 * 1024 * 1024
      ) {
        setError("Drop up to 12 files (24 MiB of text).");
        return;
      }
      for (const file of files) {
        try {
          const media = mediaType(file.name);
          if (media) {
            if (file.size > (media.kind === "image" ? MAX_IMAGE_BYTES : MAX_VIDEO_BYTES))
              throw new Error(`${file.name}: exceeds the media preview limit.`);
            const url = URL.createObjectURL(file);
            try {
              add({
                id: crypto.randomUUID(),
                file: {
                  source: { kind: "drop", id: url },
                  path: file.name,
                  kind: media.kind,
                  media,
                  identity: url,
                  size: file.size,
                },
              });
              dropUrls.current.add(url);
            } catch (error) {
              URL.revokeObjectURL(url);
              throw error;
            }
            continue;
          }
          if (file.size > 8 * 1024 * 1024)
            throw new Error(`${file.name}: exceeds the 8 MiB preview limit.`);
          const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
            await file.arrayBuffer(),
          );
          // Binary signatures intentionally contain control bytes.
          // oxlint-disable-next-line no-control-regex
          if (/[\x00-\x08\x0e-\x1f\x7f]/.test(text) || /^(?:%PDF-|GIF8[79]a)/.test(text))
            throw new Error(`${file.name}: binary preview is unavailable.`);
          const lines = text.split("\n");
          if (lines.length > 200_000 || lines.some((line) => line.length > 250_000))
            throw new Error(`${file.name}: exceeds the preview line limits.`);
          const id = crypto.randomUUID();
          add({
            id,
            file: {
              source: { kind: "drop", id },
              path: file.name,
              kind: "text",
              identity: id,
              text,
              size: file.size,
              plain: file.size > 1024 * 1024 || lines.some((line) => line.length > 20_000),
            },
          });
        } catch (error) {
          setError(error instanceof Error ? error.message : "Could not preview this file.");
        }
      }
    };
    window.addEventListener("popstate", restoreRoute);
    window.addEventListener("med-open-file", show);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      // These refs hold task lifetimes, not DOM nodes.
      // oxlint-disable-next-line react-hooks/exhaustive-deps
      ++sequence.current;
      clearTimeout(copiedTimer.current);
      window.removeEventListener("popstate", restoreRoute);
      window.removeEventListener("med-open-file", show);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [drafts]);
  useEffect(() => {
    if (!visible) return;
    const shortcuts = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      if (
        event.altKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        event.code === "KeyW" &&
        active &&
        !visibleElement('[role="dialog"]')
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) close(active.id);
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing)
        return;
      const key = event.key.toLowerCase();
      if (key !== "k" && key !== "o") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setThemes(false);
      if (key === "k") {
        setOpening(false);
        setCommands((value) => !value);
      } else {
        setCommands(false);
        setOpening(true);
      }
    };
    window.addEventListener("keydown", shortcuts, true);
    return () => window.removeEventListener("keydown", shortcuts, true);
  }, [visible, active, close]);
  return (
    <>
      {reviewMounted && (
        <div inert={visible} style={{ height: "100%", display: visible ? "none" : undefined }}>
          {children}
        </div>
      )}
      {visible && (
        <div
          role="region"
          aria-label="Standalone files"
          className="med-local"
          data-standalone-files
          style={
            {
              "--local-bg": theme.palette.canvas,
              "--local-fg": theme.palette.text,
              "--local-panel": theme.palette.panel,
              "--local-border": theme.palette.border,
              "--local-muted": theme.palette.muted,
              "--local-accent": theme.palette.accent,
            } as CSSProperties
          }
        >
          {error && (
            <div className="med-local-notice" role="alert">
              {error}
            </div>
          )}
          {loading && (
            <div className="med-local-notice" role="status">
              Opening file…
            </div>
          )}
          <div className="med-local-toolbar">
            <strong>med</strong>
            <div className="med-local-tabs" role="tablist" aria-label="Open files">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  role="tab"
                  aria-selected={selected === tab.id}
                  onClick={() => {
                    setSelected(tab.id);
                    setCopied(false);
                    navigate(tab.file.source.kind === "local" ? fileUrl(tab.file.path) : "/files");
                  }}
                  title={tab.file.path}
                >
                  {drafts.get(tab.id)?.dirty && <span aria-label="Unsaved changes">● </span>}
                  {tab.file.path.split("/").at(-1)}
                </button>
              ))}
            </div>
            <ToolButton
              label="Open file"
              icon="plus"
              shortcut="⌘ O"
              onClick={() => setOpening(true)}
            />
            <ToolButton
              label="Commands"
              icon="command"
              shortcut="⌘ K"
              onClick={() => setCommands(true)}
            />
            <ToolButton label="Theme" icon="theme" onClick={() => setThemes(true)} />
            <ToolButton label="Repositories" icon="gitBranch" onClick={repositories} />
            {active?.file.source.kind === "local" && (
              <ToolButton
                label="Copy link"
                icon={copied ? "check" : "copy"}
                onClick={() => {
                  const url = new URL(
                    `/file${active.file.path.split("/").map(encodeURIComponent).join("/")}`,
                    location.origin,
                  );
                  if (active.line) url.searchParams.set("line", String(active.line));
                  void navigator.clipboard
                    .writeText(url.href)
                    .then(() => {
                      setCopied(true);
                      clearTimeout(copiedTimer.current);
                      copiedTimer.current = setTimeout(() => setCopied(false), 1400);
                    })
                    .catch(() => setError("Could not copy the link."));
                }}
              />
            )}
          </div>
          {active ? (
            <FullFileView
              key={active.id}
              file={active.file}
              loading={false}
              error={null}
              line={active.line}
              column={active.column}
              vimEnabled
              refreshAvailable={active.file.source.kind !== "drop"}
              onOpenFile={
                active.file.source.kind === "local"
                  ? (path, line) => {
                      void open(path, line);
                    }
                  : undefined
              }
              sourceLabel={
                active.file.source.kind === "drop" ? "Dropped file · preview only" : "Local file"
              }
              onRefresh={() => {
                if (active.file.source.kind === "local") void open(active.file.path);
              }}
              onClose={() => close(active.id)}
              editor={
                active.file.source.kind === "local"
                  ? {
                      drafts,
                      key: active.id,
                      autoEdit: active.edit,
                      write: async (file, text) => {
                        const result = await request("/api/local-files/write", {
                          path: file.path,
                          expectedIdentity: file.identity,
                          text,
                        });
                        setTabs((items) =>
                          items.map((tab) =>
                            tab.id === active.id ? { ...tab, file: result } : tab,
                          ),
                        );
                        return result;
                      },
                    }
                  : undefined
              }
            />
          ) : (
            <div className="med-local-empty">
              <button {...stylex.props(ui.button)} onClick={() => setOpening(true)}>
                Open file… <span>⌘O</span>
              </button>
              <p>Drop a file to preview it.</p>
            </div>
          )}
          <CommandDialog
            open={commands}
            onOpenChange={setCommands}
            commands={[
              {
                id: "open",
                managesFocus: true,
                label: "Open file by absolute path",
                shortcut: "⌘ O",
                run: () => setOpening(true),
              },
              {
                id: "close",
                label: "Close current file",
                shortcut: "⌥ W",
                disabled: !active,
                run: () => active && close(active.id),
              },
              {
                id: "theme",
                managesFocus: true,
                label: "Change theme",
                run: () => setThemes(true),
              },
              {
                id: "repositories",
                label: "Go to repositories",
                run: repositories,
              },
              ...tabs.map((tab) => ({
                id: tab.id,
                label: `Switch to ${tab.file.path}`,
                run: () => {
                  setSelected(tab.id);
                  navigate(tab.file.source.kind === "local" ? fileUrl(tab.file.path) : "/files");
                },
              })),
            ]}
          />
          <Dialog.Root open={opening} onOpenChange={setOpening}>
            <Dialog.Portal>
              <Dialog.Backdrop className="med-local-backdrop" />
              <Dialog.Popup className="med-local-dialog" initialFocus={pathInput}>
                <Dialog.Title>Open file</Dialog.Title>
                <Dialog.Description>
                  Enter an absolute path to view or edit a local file.
                </Dialog.Description>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void open(path);
                  }}
                >
                  <input
                    ref={pathInput}
                    aria-label="Absolute file path"
                    placeholder="/path/to/file"
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
                  />
                  {error && <p role="alert">{error}</p>}
                  <div className="med-local-dialog-actions">
                    <Dialog.Close>Cancel</Dialog.Close>
                    <button disabled={!path.trim() || loading}>Open file</button>
                  </div>
                </form>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
          <ThemePicker open={themes} onOpenChange={setThemes} />
        </div>
      )}
      {dragging && <div className="med-local-drop">Drop files to preview</div>}
    </>
  );
}
