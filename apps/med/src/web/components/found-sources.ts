import { useCallback, useMemo, useRef, useState } from "react";
import { HttpError } from "../data/api";
import type { Discovery, FoundSource, SetupApi, SourceKind } from "../data/setup";

const DAY = 86_400_000;
/** What counts as recent: used within these days, and at most this many of
 * a kind. A long tail of old checkouts is not. */
const RECENT = { repo: { days: 21, count: 10 }, vault: { days: 60, count: 6 } };

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A repository or vault on this computer that Med does not have yet. */
export interface FoundRow extends FoundSource {
  kind: SourceKind;
  state: "idle" | "adding" | "failed";
  /** Used lately: Add the N recent takes it. */
  recent: boolean;
}

/** What Sources shows of this computer: the search, its rows, and the adds. */
export interface FoundSources {
  /** The search has an answer; before it, the rows are not known. */
  searched: boolean;
  /** A search runs: the first one, or one that reaches the guarded folders. */
  searching: boolean;
  /** This server has no setup, as a foreground review server. */
  unavailable: boolean;
  /** Most recently active first, repositories and vaults together. */
  rows: FoundRow[];
  /** The searched home folder, for showing paths as ~/… */
  home?: string;
  /** Home folders left out until the reader asks. */
  skipped: string[];
  /** Add the N recent runs. */
  addingRecent: boolean;
  /** The search's failure, or else that of the row that failed last, as
   * `name: message`. It stays until that row is added or tried again. */
  error: string;
  /** Searches once; later calls keep the answer. */
  start(): void;
  /** Searches again, with the guarded folders. */
  searchAll(): void;
  add(row: FoundRow): void;
  addRecent(): void;
  /** Adds a folder by its path; `~/` is the home folder. Rejects with the reason. */
  addPath(path: string): Promise<void>;
}

/**
 * The repositories and vaults that the server finds under the home folder,
 * without those that Med has. A click adds one; `refresh` reads the
 * registered sources again, and the added row leaves when they hold it.
 */
export function useFoundSources({
  api,
  registered,
  home,
  refresh,
}: {
  api: SetupApi;
  registered: readonly { path: string }[];
  /** The home folder, until a search names its own. */
  home?: string;
  refresh(): Promise<void>;
}): FoundSources {
  const [search, setSearch] = useState<{ found: Discovery; at: number } | null>(null);
  const [searching, setSearching] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [searchError, setSearchError] = useState("");
  // A row that is being added, or why its add failed.
  const [pending, setPending] = useState<Record<string, "adding" | { failed: string }>>({});
  const [addingRecent, setAddingRecent] = useState(false);
  const started = useRef(false);
  const adding = useRef(new Set<string>());

  const scan = useCallback(
    async (deep: boolean) => {
      setSearching(true);
      setSearchError("");
      try {
        const found = await api.discover(deep);
        setSearch({ found, at: Date.now() });
      } catch (reason) {
        if (reason instanceof HttpError && reason.status === 404) setUnavailable(true);
        else {
          setSearchError(message(reason));
          // The next time the section opens, it searches again.
          started.current = false;
        }
      } finally {
        setSearching(false);
      }
    },
    [api],
  );
  const start = useCallback(() => {
    if (started.current) return;
    started.current = true;
    void scan(false);
  }, [scan]);
  const searchAll = useCallback(() => void scan(true), [scan]);

  const rows = useMemo(() => {
    if (!search) return [];
    const have = new Set(registered.map((source) => source.path));
    const list = (kind: SourceKind, found: FoundSource[]): FoundRow[] => {
      const open = found.filter((entry) => !have.has(entry.path));
      const recent = new Set(
        open
          .filter((entry) => entry.activity > search.at - RECENT[kind].days * DAY)
          .slice(0, RECENT[kind].count)
          .map((entry) => entry.path),
      );
      return open.map((entry) => ({
        ...entry,
        kind,
        state: !pending[entry.path]
          ? "idle"
          : pending[entry.path] === "adding"
            ? "adding"
            : "failed",
        recent: recent.has(entry.path),
      }));
    };
    return [...list("repo", search.found.repositories), ...list("vault", search.found.vaults)].sort(
      (a, b) => b.activity - a.activity || a.name.localeCompare(b.name),
    );
  }, [search, registered, pending]);

  /** Adds one source. Its row shows Adding… until the registered sources hold it. */
  const addOne = useCallback(
    async (row: Pick<FoundRow, "path" | "name" | "kind">) => {
      if (adding.current.has(row.path)) return;
      adding.current.add(row.path);
      setSearchError("");
      setPending((current) => ({ ...current, [row.path]: "adding" }));
      try {
        await api.add(row.path, row.kind);
        await refresh();
        setPending((current) => {
          const next = { ...current };
          delete next[row.path];
          return next;
        });
      } catch (reason) {
        setPending((current) => {
          // The newest failure goes last, so the page shows it.
          const next = { ...current };
          delete next[row.path];
          next[row.path] = { failed: `${row.name}: ${message(reason)}` };
          return next;
        });
      } finally {
        adding.current.delete(row.path);
      }
    },
    [api, refresh],
  );
  const add = useCallback((row: FoundRow) => void addOne(row), [addOne]);
  const addRecent = useCallback(async () => {
    setAddingRecent(true);
    try {
      for (const row of rows) if (row.recent) await addOne(row);
    } finally {
      setAddingRecent(false);
    }
  }, [addOne, rows]);

  const base = search?.found.home ?? home;
  const addPath = useCallback(
    async (path: string) => {
      await api.add(base && path.startsWith("~/") ? `${base}${path.slice(1)}` : path);
      await refresh();
    },
    [api, base, refresh],
  );

  // A failed row that Med got another way, as from a terminal, has left the list.
  const listed = new Set(rows.map((row) => row.path));
  let failed = "";
  for (const [path, state] of Object.entries(pending))
    if (typeof state === "object" && listed.has(path)) failed = state.failed;
  return {
    searched: search !== null,
    searching,
    unavailable,
    rows,
    home: base,
    skipped: search?.found.skipped ?? [],
    addingRecent,
    error: searchError || failed,
    start,
    searchAll,
    add,
    addRecent,
    addPath,
  };
}
