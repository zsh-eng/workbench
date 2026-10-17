import { fileChangesSchema } from "../../shared/file-changes";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  browseListResponseSchema,
  browseReadResponseSchema,
  type BrowseSource,
  type BrowseEntry,
} from "../../shared/browse";
import { createApi } from "./api";
import { symbolSearchSchema } from "../../shared/symbols";
import { browseSearchResponseSchema } from "../../shared/inspect";
import { localReadSchema, type LocalRead } from "../../shared/local-file";
import { z } from "zod";

const vaultStatusSchema = z.object({
  sources: z.array(
    z.object({ id: z.string(), name: z.string(), path: z.string(), kind: z.string() }),
  ),
});
const vaultFilesSchema = z.object({ files: z.array(z.object({ path: z.string() })) });
const vaultLinkSchema = z.object({ path: z.string(), fragment: z.string().optional() });
export type Vault = { id: string; name: string; path: string };

export function browseSourceKey(source: BrowseSource): string {
  return JSON.stringify(
    source.kind === "commit" ? [source.kind, source.repo, source.oid] : [source.kind, source.repo],
  );
}

export function createBrowseApi(fetcher: typeof fetch, token: string) {
  const api = createApi(fetcher, token);
  // Each query replaces the last one on the host, which stops its work.
  const streams = crypto.randomUUID();
  const latest = (name: string) => ({ "X-Med-Latest": `${name}:${streams}` });
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
        headers: {
          "Content-Type": "application/json",
          ...(options?.path ? {} : latest("symbols")),
        },
        body: JSON.stringify({ source, query, ...options }),
        signal,
      });
      if (
        browseSourceKey(result.source) !== browseSourceKey(source) ||
        result.query !== query ||
        result.path !== options?.path
      )
        throw new Error("The symbols belong to another source or query.");
      // The answer comes from the same repository: its working files for a
      // checkout, or the commit that the index resolved.
      if (
        result.resultSource &&
        (result.resultSource.repo !== source.repo ||
          (result.resultSource.kind === "worktree"
            ? source.kind !== "worktree"
            : source.kind === "commit" && result.resultSource.oid !== source.oid))
      )
        throw new Error("The symbols belong to another commit.");
      return result;
    },
    /** `stream` names the query that this one replaces on the host, such as
     * one for each repository that a search page searches at once. */
    async search(source: BrowseSource, query: string, signal?: AbortSignal, stream = "search") {
      const result = await api.json("/api/browse/search", browseSearchResponseSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...latest(stream) },
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
    /** The registered vaults. */
    async vaults(signal?: AbortSignal) {
      const result = await api.json("/api/service/status", vaultStatusSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal,
      });
      return result.sources
        .filter((source) => source.kind === "vault")
        .map(({ id, name, path }) => ({ id, name, path }));
    },
    /** A vault's files, by their paths in the vault. */
    async vaultFiles(vault: string, signal?: AbortSignal) {
      const result = await api.json("/api/service/files", vaultFilesSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vault }),
        signal,
      });
      return result.files.map((file) => file.path);
    },
    /** A vault's file by its path in the vault. */
    async readVault(vault: string, path: string, signal?: AbortSignal) {
      const result = await api.json("/api/service/read", localReadSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vault, path }),
        signal,
      });
      if (result.vault?.id !== vault || result.vault.path !== path)
        throw new Error("The file belongs to another vault.");
      return result;
    },
    /** Where a note's wiki or Markdown link goes in its vault, and the line of
     * the heading that it names, if any. */
    async followVaultLink(
      vault: string,
      document: string,
      link: { href: string; syntax: string },
    ): Promise<{ path: string; line?: number }> {
      const target = await api.json("/api/service/resolve", vaultLinkSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vault, path: document, ...link }),
      });
      if (!target.fragment) return { path: target.path };
      const heading = decodeURIComponent(target.fragment).toLowerCase();
      const read = await api.json("/api/service/read", localReadSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: vault, path: target.path }),
      });
      const index = (read.text ?? "").split("\n").findIndex(
        (text) =>
          /^#{1,6}\s+/.test(text) &&
          text
            .replace(/^#{1,6}\s+/, "")
            .trim()
            .toLowerCase() === heading,
      );
      return { path: target.path, ...(index >= 0 ? { line: index + 1 } : {}) };
    },
    /** The transcript of a thread's agent session, which names it to another agent. */
    async transcript(review: string, session: string) {
      const result = await api.json(
        `/api/reviews/${encodeURIComponent(review)}/sessions/${encodeURIComponent(session)}/transcript`,
        z.object({ path: z.string() }),
      );
      return result.path;
    },
    /** Saves a vault's file, if it has not changed on disk since it was read. */
    async writeVault(file: LocalRead, text: string): Promise<LocalRead> {
      const result = await api.json("/api/local-files/write", localReadSchema, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: file.path, expectedIdentity: file.identity, text }),
      });
      if (result.path !== file.path) throw new Error("The saved file is another file.");
      return { ...result, vault: file.vault };
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
type OptionalBrowse =
  | "search"
  | "symbols"
  | "write"
  | "changes"
  | "vaults"
  | "vaultFiles"
  | "readVault"
  | "followVaultLink"
  | "transcript"
  | "writeVault";
export type BrowseApi = Omit<CompleteBrowseApi, OptionalBrowse> &
  Partial<Pick<CompleteBrowseApi, OptionalBrowse>>;

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
  // Stable, so a memoized file tree does not render again for each parent render.
  const refresh = useCallback(() => setRefreshRevision((value) => value + 1), []);
  return {
    entries: current || stale ? state.entries : emptyEntries,
    loading: enabled && !!source && !current && !stale,
    error: current ? state.error : null,
    truncated: (current || stale) && state.truncated,
    ignored,
    setIgnored,
    refresh,
  };
}

/** A vault's files as entries, listed again each time `enabled` turns on. */
export function useVaultFiles(
  api: BrowseApi | undefined,
  vault: string | undefined,
  enabled: boolean,
) {
  const key = enabled && vault && api?.vaultFiles ? vault : "";
  const [state, setState] = useState<{ key: string; entries: BrowseEntry[]; error: string | null }>(
    { key: "", entries: emptyEntries, error: null },
  );
  useEffect(() => {
    if (!key || !api?.vaultFiles) return;
    const controller = new AbortController();
    api.vaultFiles(key, controller.signal).then(
      (paths) => {
        if (!controller.signal.aborted)
          setState({ key, entries: paths.map((path) => ({ path, kind: "file" })), error: null });
      },
      (cause: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key,
            entries: emptyEntries,
            error: cause instanceof Error ? cause.message : "Could not list the vault.",
          });
      },
    );
    return () => controller.abort();
  }, [api, key]);
  return state.key === key
    ? { entries: state.entries, loading: false, error: state.error }
    : { entries: emptyEntries, loading: !!key, error: null };
}

const vaultLists = new WeakMap<BrowseApi, { at: number; list: Promise<Vault[]> }>();
/** The registered vaults while `enabled`, read again at most every ten seconds. */
export function useVaults(api: BrowseApi, enabled: boolean) {
  const [vaults, setVaults] = useState<readonly Vault[]>([]);
  useEffect(() => {
    if (!enabled || !api.vaults) return;
    let cached = vaultLists.get(api);
    if (!cached || Date.now() - cached.at > 10_000) {
      cached = { at: Date.now(), list: api.vaults() };
      vaultLists.set(api, cached);
    }
    const { list } = cached;
    let live = true;
    list.then(
      (next) => {
        if (live)
          setVaults((previous) =>
            JSON.stringify(previous) === JSON.stringify(next) ? previous : next,
          );
      },
      () => {
        if (vaultLists.get(api)?.list === list) vaultLists.delete(api);
      },
    );
    return () => {
      live = false;
    };
  }, [api, enabled]);
  return vaults;
}

/** Every vault's files, listed again for each new `round`; round 0 lists none. */
export function useVaultsFiles(api: BrowseApi, vaults: readonly Vault[], round: number) {
  const [lists, setLists] = useState<readonly { vault: Vault; entries: BrowseEntry[] }[]>([]);
  useEffect(() => {
    const list = api.vaultFiles;
    if (!round || !list || !vaults.length) return;
    const controller = new AbortController();
    void Promise.all(
      vaults.map(async (vault) => ({
        vault,
        entries: (await list(vault.id, controller.signal).catch(() => [])).map((path) => ({
          path,
          kind: "file" as const,
        })),
      })),
    ).then((next) => {
      if (!controller.signal.aborted) setLists(next);
    });
    return () => controller.abort();
  }, [api, vaults, round]);
  return lists;
}
