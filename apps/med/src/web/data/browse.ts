import { fileChangesSchema } from "../../shared/file-changes";
import { useEffect, useMemo, useState } from "react";
import {
  browseListResponseSchema,
  browseReadResponseSchema,
  type BrowseSource,
  type BrowseEntry,
} from "../../shared/browse";
import { createApi } from "./api";
import { symbolSearchSchema } from "../../shared/symbols";
import { browseSearchResponseSchema } from "../../shared/inspect";

export function browseSourceKey(source: BrowseSource): string {
  return JSON.stringify(
    source.kind === "commit" ? [source.kind, source.repo, source.oid] : [source.kind, source.repo],
  );
}

export function createBrowseApi(fetcher: typeof fetch, token: string) {
  const api = createApi(fetcher, token);
  return {
    async changes(
      source: BrowseSource,
      path: string,
      identity: string,
      reviewId?: string,
      signal?: AbortSignal,
      saved?: { id: string; target: string },
    ) {
      const result = await api.json("/api/browse/changes", fileChangesSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, path, identity, reviewId, saved }),
        signal,
      });
      if (result.identity !== identity)
        throw new Error("The change markers belong to another file version.");
      return result;
    },
    async symbols(
      source: BrowseSource,
      query: string,
      options?: { path?: string; identity?: string },
      signal?: AbortSignal,
    ) {
      const result = await api.json("/api/browse/symbols", symbolSearchSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, query, ...options }),
        signal,
      });
      if (
        browseSourceKey(result.source) !== browseSourceKey(source) ||
        result.query !== query ||
        result.path !== options?.path
      )
        throw new Error("The symbols belong to another source or query.");
      if (
        result.resultSource &&
        (result.resultSource.kind !== "commit" ||
          result.resultSource.repo !== source.repo ||
          (source.kind === "commit" && result.resultSource.oid !== source.oid))
      )
        throw new Error("The symbols belong to another commit.");
      return result;
    },
    async search(source: BrowseSource, query: string, signal?: AbortSignal) {
      const result = await api.json("/api/browse/search", browseSearchResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, query }),
        signal,
      });
      if (browseSourceKey(result.source) !== browseSourceKey(source) || result.query !== query)
        throw new Error("The search belongs to another workspace or query.");
      if (
        result.resultSource &&
        (result.resultSource.kind !== "commit" ||
          result.resultSource.repo !== source.repo ||
          (source.kind === "commit" && result.resultSource.oid !== source.oid))
      )
        throw new Error("The search results belong to another repository or commit.");
      return result;
    },
    async list(source: BrowseSource, ignored = false, signal?: AbortSignal) {
      const result = await api.json("/api/browse/list", browseListResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, ignored }),
        signal,
      });
      if (browseSourceKey(result.source) !== browseSourceKey(source))
        throw new Error("The file list belongs to another workspace.");
      return result;
    },
    async write(source: BrowseSource, path: string, expectedIdentity: string, text: string) {
      const result = await api.json("/api/browse/write", browseReadResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, path, expectedIdentity, text }),
      });
      if (browseSourceKey(result.source) !== browseSourceKey(source) || result.path !== path)
        throw new Error("The saved file belongs to another workspace.");
      return result;
    },
    async read(source: BrowseSource, path: string, signal?: AbortSignal) {
      const result = await api.json("/api/browse/read", browseReadResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source, path }),
        signal,
      });
      if (browseSourceKey(result.source) !== browseSourceKey(source) || result.path !== path)
        throw new Error("The file belongs to another workspace.");
      return result;
    },
  };
}
type CompleteBrowseApi = ReturnType<typeof createBrowseApi>;
export type BrowseApi = Omit<CompleteBrowseApi, "search" | "symbols" | "write" | "changes"> &
  Partial<Pick<CompleteBrowseApi, "search" | "symbols" | "write" | "changes">>;

export function createDefaultBrowseApi(): BrowseApi {
  const token =
    typeof location === "undefined"
      ? ""
      : (new URLSearchParams(location.hash.slice(1)).get("token") ?? "");
  return createBrowseApi(globalThis.fetch.bind(globalThis), token);
}

const emptyEntries: BrowseEntry[] = [];
export function useBrowseFiles(
  source: BrowseSource | null,
  enabled: boolean,
  revision: number | string = 0,
  options?: { api?: BrowseApi },
) {
  const defaultApi = useMemo(() => createDefaultBrowseApi(), []);
  const api = options?.api ?? defaultApi;
  const [ignored, setIgnored] = useState(false);
  const [refreshRevision, setRefreshRevision] = useState(0);
  const sourceKey = source ? browseSourceKey(source) : "";
  const requestKey = JSON.stringify([sourceKey, ignored, revision, refreshRevision]);
  const listKey = JSON.stringify([sourceKey, ignored]);
  const [state, setState] = useState<{
    api: BrowseApi | null;
    key: string;
    listKey: string;
    entries: BrowseEntry[];
    truncated: boolean;
    error: string | null;
  }>({ api: null, key: "", listKey: "", entries: [], truncated: false, error: null });
  const current = state.key === requestKey && state.api === api;
  // A newer revision of the same list keeps showing the last one until it
  // arrives, so live updates do not empty the tree or show "Loading".
  const stale = !current && state.listKey === listKey && state.api === api && !state.error;
  // Visibility does not invalidate a successful list. Source, revision, ignored
  // files, and explicit refresh still do; failed requests can retry on reopen.
  const cached = current && state.error === null;
  useEffect(() => {
    if (!enabled || !sourceKey || cached) return;
    const controller = new AbortController();
    const [kind, repo, oid] = JSON.parse(sourceKey) as ["worktree" | "commit", string, string?];
    const requestSource: BrowseSource =
      kind === "commit" ? { kind, repo, oid: oid! } : { kind, repo };
    void api
      .list(requestSource, ignored, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted)
          setState((previous) => ({
            api,
            key: requestKey,
            listKey,
            // The same files keep the same array, so the tree is not rebuilt.
            entries:
              previous.listKey === listKey &&
              JSON.stringify(previous.entries) === JSON.stringify(result.entries)
                ? previous.entries
                : result.entries,
            truncated: result.truncated,
            error: null,
          }));
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            api,
            key: requestKey,
            listKey,
            entries: [],
            truncated: false,
            error: error instanceof Error ? error.message : "Cannot list files.",
          });
      });
    return () => controller.abort();
  }, [api, sourceKey, ignored, requestKey, listKey, enabled, cached]);
  return {
    entries: current || stale ? state.entries : emptyEntries,
    loading: enabled && !!source && !current && !stale,
    error: current ? state.error : null,
    truncated: (current || stale) && state.truncated,
    ignored,
    setIgnored,
    refresh: () => setRefreshRevision((value) => value + 1),
  };
}
