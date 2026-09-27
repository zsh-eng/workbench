import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type CSSProperties,
} from "react";
import { createApi } from "../data/api";
import { z } from "zod";
import { localReadSchema, type LocalRead } from "../../shared/local-file";
import { FullFileView } from "./FullFileView";
import { createEditorDrafts } from "../data/editor-drafts";
import { useTheme } from "../themes";
import { ThemePicker } from "./ThemePicker";
import "./VaultWorkspace.css";
const api = createApi(globalThis.fetch.bind(globalThis), "");
const request = async (action: string, body: object = {}) =>
  api.json(`/api/service/${action}`, z.any(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
interface Source {
  id: string;
  name: string;
  path: string;
  kind: "repo" | "vault";
  index?: { state: string; revision: number; error?: string };
}
const route = () => ({
  visible: location.pathname === "/sources" || location.pathname.startsWith("/vault/"),
  id: location.pathname.startsWith("/vault/") ? decodeURIComponent(location.pathname.slice(7)) : "",
  file: new URLSearchParams(location.search).get("file") ?? "",
});

export function VaultWorkspace({ children }: { children: ReactNode }) {
  const { active: theme } = useTheme();
  const [locationState, setLocationState] = useState(route);
  const [sources, setSources] = useState<Source[]>([]);
  const [files, setFiles] = useState<{ path: string; markdown: boolean }[]>([]);
  const [file, setFile] = useState<LocalRead>();
  const [tabs, setTabs] = useState<LocalRead[]>([]);
  const [backlinks, setBacklinks] = useState<{ source: string; line: number }[]>([]);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");
  const [themes, setThemes] = useState(false);
  const [line, setLine] = useState<number>();
  const [drafts] = useState(createEditorDrafts);
  useSyncExternalStore(drafts.subscribe, drafts.getSnapshot);
  const search = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const retainedTabs = useRef<LocalRead[]>([]);
  const source = sources.find((s) => s.id === locationState.id);
  const navigate = useCallback((url: string) => {
    history.pushState(null, "", url);
    setLocationState(route());
  }, []);
  const open = useCallback(
    (path: string, at?: number) => {
      setLine(at);
      navigate(`/vault/${locationState.id}?${new URLSearchParams({ file: path })}`);
    },
    [locationState.id, navigate],
  );
  useEffect(() => {
    const pop = () => {
      setLine(undefined);
      setLocationState(route());
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
    if (!locationState.id) {
      return;
    }
    let cancelled = false;
    request("files", { id: locationState.id })
      .then((result) => {
        if (!cancelled) setFiles(result.files);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [locationState.id, source?.index?.revision]);
  useEffect(() => {
    const current = ++generation.current;
    if (!locationState.id || !locationState.file) {
      return;
    }
    request("read", { id: locationState.id, path: locationState.file })
      .then((value) => {
        if (current !== generation.current) return;
        const read = localReadSchema.parse(value);
        const next = [...retainedTabs.current.filter((f) => f.path !== read.path), read];
        if (next.length > 24 || next.reduce((sum, f) => sum + f.size, 0) > 32 * 1024 * 1024)
          throw new Error("Close a note before opening more (24 files / 32 MiB limit).");
        setError("");
        setFile(read);
        retainedTabs.current = next;
        setTabs(next);
      })
      .catch((e) => {
        if (current === generation.current) setError(String(e));
      });
  }, [locationState.id, locationState.file, source?.index?.revision]);
  useEffect(() => {
    if (!locationState.id || !locationState.file) return;
    let cancelled = false;
    request("backlinks", { id: locationState.id, path: locationState.file })
      .then((result) => {
        if (!cancelled) setBacklinks(result.backlinks);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [locationState.id, locationState.file, source?.index?.revision]);
  useEffect(() => {
    if (!locationState.visible) return;
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        event.stopImmediatePropagation();
        search.current?.focus();
      }
    };
    let active = true;
    const follow = (event: Event) => {
      const detail = (event as CustomEvent<{ href: string; syntax: string }>).detail;
      request("resolve", { id: locationState.id, path: locationState.file, ...detail })
        .then((target) => {
          if (!active) return;
          if (target.fragment) {
            request("read", { id: locationState.id, path: target.path })
              .then((read) => {
                if (!active) return;
                const lines = String(read.text ?? "").split("\n");
                const heading = lines.findIndex(
                  (text) =>
                    text
                      .replace(/^#{1,6}\s+/, "")
                      .trim()
                      .toLowerCase() === decodeURIComponent(target.fragment).toLowerCase(),
                );
                open(target.path, heading >= 0 ? heading + 1 : undefined);
              })
              .catch((e) => setError(String(e)));
          } else open(target.path);
        })
        .catch((e) => setError(String(e)));
    };
    window.addEventListener("keydown", key, true);
    window.addEventListener("med-vault-navigate", follow);
    return () => {
      active = false;
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("med-vault-navigate", follow);
    };
  }, [locationState.visible, locationState.id, locationState.file, open]);
  if (!locationState.visible) return <>{children}</>;
  const visible = files.filter(
    (f) => f.markdown && f.path.toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <div
      className="med-vault"
      data-standalone-files
      style={
        {
          "--vault-bg": theme.palette.canvas,
          "--vault-fg": theme.palette.text,
          "--vault-border": theme.palette.border,
          "--vault-accent": theme.palette.accent,
        } as CSSProperties
      }
    >
      <header>
        <a
          href="/sources"
          onClick={(e) => {
            e.preventDefault();
            navigate("/sources");
          }}
        >
          med
        </a>
        <span>{source?.name ?? "Sources"}</span>
        <div className="med-vault-tabs" role="tablist" aria-label="Vault files">
          {tabs
            .filter((t) => t.vault?.id === locationState.id)
            .map((tab) => (
              <button
                key={tab.path}
                role="tab"
                aria-selected={file?.path === tab.path}
                onClick={() => open(tab.vault!.path)}
              >
                {drafts.get(tab.path)?.dirty ? "● " : ""}
                {tab.path.split("/").at(-1)}
              </button>
            ))}
        </div>
        <button onClick={() => setThemes(true)}>Theme</button>
        <a href="/files">Files</a>
        <a href="/">Repositories</a>
      </header>
      {error && <p role="alert">{error}</p>}
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
        </main>
      ) : (
        <div className="med-vault-layout">
          <aside aria-label="Vault navigation">
            <input
              ref={search}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              aria-label="Find vault note"
              placeholder="Find note · ⌘K"
            />
            <nav aria-label="Vault notes">
              {visible.slice(0, 500).map((item) => (
                <button
                  key={item.path}
                  aria-current={locationState.file === item.path ? "page" : undefined}
                  onClick={() => open(item.path)}
                  title={item.path}
                >
                  {item.path.split("/").at(-1)}
                  <small>
                    {item.path.includes("/") ? item.path.slice(0, item.path.lastIndexOf("/")) : ""}
                  </small>
                </button>
              ))}
            </nav>
            {visible.length > 500 && <small>Refine the search to see more notes.</small>}
            <section aria-label="Backlinks">
              <h2>
                Backlinks <span>{backlinks.length}</span>
              </h2>
              {source?.index?.error && <small>{source.index.error}</small>}
              {backlinks.map((link, i) => (
                <button key={i} onClick={() => open(link.source, link.line)}>
                  {link.source.split("/").at(-1)}
                  <small>Line {link.line}</small>
                </button>
              ))}
            </section>
          </aside>
          <main>
            {file &&
            file.vault?.id === locationState.id &&
            file.vault.path === locationState.file ? (
              <FullFileView
                key={file.path}
                file={file}
                loading={false}
                error={null}
                vimEnabled
                line={line}
                sourceLabel={source?.name ?? "Vault"}
                onClose={() => {
                  const next = retainedTabs.current.filter((t) => t.path !== file.path);
                  retainedTabs.current = next;
                  setTabs(next);
                  const target = next.find((t) => t.vault?.id === locationState.id);
                  if (target) open(target.vault!.path);
                  else navigate(`/vault/${locationState.id}`);
                }}
                refreshAvailable
                onRefresh={() => {
                  request("read", { id: locationState.id, path: locationState.file })
                    .then((v) => setFile(localReadSchema.parse(v)))
                    .catch((e) => setError(String(e)));
                }}
                editor={{
                  drafts,
                  key: file.path,
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
                    const result = { ...next, vault: file.vault };
                    setFile(result);
                    return result;
                  },
                }}
              />
            ) : (
              <div className="med-vault-empty">
                <h1>{source?.name ?? "Vault"}</h1>
                <p>Choose a note or press ⌘K to find one.</p>
              </div>
            )}
          </main>
        </div>
      )}
      <ThemePicker open={themes} onOpenChange={setThemes} />
    </div>
  );
}
