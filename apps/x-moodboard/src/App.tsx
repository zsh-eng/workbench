import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import type { LibraryProjection } from "../shared/schema";
import { Detail, preloadPost } from "./components/Detail";
import { Grid, type CardGeometry, type GridHandle } from "./components/Grid";
import { DisplayPrefs, Header, type Theme } from "./components/Header";
import { LibraryInfoDialog, LibraryState, Modal, NoResults, ShortcutsDialog, Toasts } from "./components/Panels";
import { Rail } from "./components/Rail";
import { ResultBar, activeTokens } from "./components/ResultBar";
import { fetchLibrary, fetchVersion, HttpError } from "./lib/api";
import { count, plural } from "./lib/format";
import type { Density } from "./lib/layout";
import {
  EMPTY_QUERY,
  buildIndex,
  isFiltered,
  queryFromSearch,
  runQuery,
  searchFromQuery,
  textMatches,
  toLibrary,
  type Library,
  type Query,
} from "./lib/model";
import { isEditable, usePref } from "./lib/prefs";
import { searchTerms } from "./lib/text";
import { showToast } from "./lib/toasts";
import { useUserState } from "./lib/userState";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; library: Library }
  | { kind: "missing" | "offline" | "error" | "empty"; message?: string };

interface DetailState {
  postId: string;
  origin: CardGeometry | null;
  closing: boolean;
}

interface HistoryState {
  detail?: string;
  fromGrid?: boolean;
  anchor?: { postId: string; offset: number };
}

function readLocation() {
  const match = /^\/post\/(\d{1,30})\/?$/.exec(location.pathname);
  return { postId: match ? match[1] : null, query: queryFromSearch(location.search) };
}
const urlFor = (postId: string | null, query: Query) => `${postId ? `/post/${postId}` : "/"}${searchFromQuery(query)}`;
const historyState = (): HistoryState => (history.state as HistoryState | null) ?? {};

function markMorph(postId: string | null) {
  document.querySelectorAll(".card[data-morph]").forEach((el) => el.removeAttribute("data-morph"));
  if (postId) document.querySelector(`.card[data-post="${postId}"]`)?.setAttribute("data-morph", "");
}

const DENSITIES = ["comfortable", "compact"] as const;
const THEMES = ["auto", "light", "dark"] as const;

export function App() {
  const [load, setLoad] = useState<LoadState>({ kind: "loading" });
  const libraryRef = useRef<Library | null>(null);
  const user = useUserState();
  const initial = useMemo(readLocation, []);
  const [query, setQuery] = useState<Query>(initial.query);
  const [detail, setDetail] = useState<DetailState | null>(initial.postId ? { postId: initial.postId, origin: null, closing: false } : null);
  const [density, setDensity] = usePref<Density>("density", DENSITIES, "comfortable");
  const [theme, setTheme] = usePref<Theme>("theme", THEMES, "auto");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [activePostId, setActivePostId] = useState<string | null>(initial.postId);
  const [announcement, setAnnouncement] = useState("");
  const gridRef = useRef<GridHandle>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const restoreAnchor = useRef(historyState().anchor ?? null);
  const detailRef = useRef(detail);
  detailRef.current = detail;

  // ------------------------------------------------------------ library

  const loadLibrary = useCallback(async (mode: "initial" | "refresh") => {
    try {
      const projection: LibraryProjection = await fetchLibrary();
      const next = toLibrary(projection);
      const previous = libraryRef.current;
      if (previous && previous.version === next.version) return;
      libraryRef.current = next;
      setLoad(next.items.length ? { kind: "ready", library: next } : { kind: "empty" });
      if (mode === "refresh" && previous) {
        const before = new Map(previous.items.map((i) => [i.postId, i.rev]));
        let changed = 0;
        for (const item of next.items) if (before.get(item.postId) !== item.rev) changed++;
        const removed = previous.items.filter((i) => !next.byPostId.has(i.postId)).length;
        showToast({
          tone: "info",
          message: `Library updated: ${plural(changed, "post")} new or changed${removed ? `, ${count(removed)} removed` : ""}.`,
        });
      }
    } catch (error) {
      if (mode === "refresh") return; // keep showing the current library
      const status = error instanceof HttpError ? error.status : -1;
      setLoad({
        kind: status === 503 ? "missing" : status === 0 ? "offline" : "error",
        message: (error as Error).message,
      });
    }
  }, []);

  useEffect(() => {
    void loadLibrary("initial");
  }, [loadLibrary]);

  // Adopt newer snapshots in place. The pointer file changes only after validation.
  useEffect(() => {
    const check = async () => {
      if (document.hidden || !libraryRef.current) return;
      try {
        const { version } = await fetchVersion();
        if (version !== libraryRef.current?.version) await loadLibrary("refresh");
      } catch {
        // The server may be restarting; try again on the next tick.
      }
    };
    const timer = setInterval(check, 30_000);
    window.addEventListener("focus", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [loadLibrary]);

  useEffect(() => {
    if (user.loadError)
      showToast({ tone: "error", message: `Favourites and topic edits could not be loaded: ${user.loadError}`, action: { label: "Try again", run: user.reload } });
  }, [user.loadError, user.reload]);

  const library = load.kind === "ready" ? load.library : null;

  // ------------------------------------------------------------ search and filters

  const deferredQ = useDeferredValue(query.q);
  const index = useMemo(() => (library ? buildIndex(library, user.edits) : null), [library, user.edits]);
  const text = useMemo(() => (index ? textMatches(index, deferredQ) : null), [index, deferredQ]);
  const effectiveQuery = useMemo(() => ({ ...query, q: deferredQ }), [query, deferredQ]);
  const rawResults = useMemo(
    () => (index ? runQuery(index, effectiveQuery, text, user.favourites) : null),
    [index, effectiveQuery, text, user.favourites],
  );
  // Keep the id array identity when the content is the same, so the grid does not relayout.
  const stableIds = useRef<Int32Array>(new Int32Array(0));
  const results = useMemo(() => {
    if (!rawResults) return null;
    const prev = stableIds.current;
    const next = rawResults.ids;
    let same = prev.length === next.length;
    for (let i = 0; same && i < next.length; i++) same = prev[i] === next[i];
    if (!same) stableIds.current = next;
    return { ...rawResults, ids: stableIds.current };
  }, [rawResults]);

  const positionOf = useMemo(() => {
    const map = new Map<number, number>();
    results?.ids.forEach((itemIndex, k) => map.set(itemIndex, k));
    return map;
  }, [results?.ids]);

  const updateQuery = useCallback((change: Partial<Query>) => setQuery((q) => ({ ...q, ...change })), []);
  const clearFilters = useCallback(() => setQuery((q) => ({ ...EMPTY_QUERY, sort: q.sort })), []);

  // Mirror filters in the URL without adding history entries.
  const urlTimer = useRef(0);
  useEffect(() => {
    window.clearTimeout(urlTimer.current);
    urlTimer.current = window.setTimeout(() => {
      const postId = readLocation().postId;
      history.replaceState(historyState(), "", urlFor(postId, query));
    }, 250);
  }, [query]);

  // Polite result announcements once typing settles.
  useEffect(() => {
    if (!results) return;
    const t = setTimeout(
      () => setAnnouncement(isFiltered(effectiveQuery) ? `${plural(results.ids.length, "post")} found` : ""),
      700,
    );
    return () => clearTimeout(t);
  }, [results, effectiveQuery]);

  // ------------------------------------------------------------ detail

  const itemIndexOf = (postId: string) => library?.byPostId.get(postId);

  const openDetail = useCallback(
    (postId: string) => {
      const origin = gridRef.current?.geometry(postId) ?? null;
      markMorph(postId);
      history.pushState({ ...historyState(), detail: postId, fromGrid: true } satisfies HistoryState, "", urlFor(postId, query));
      setActivePostId(postId);
      setDetail({ postId, origin, closing: false });
    },
    [query],
  );

  const beginClose = useCallback((postId: string) => {
    // Bring the card into the (hidden) grid first, so the image can land on it.
    flushSync(() => {
      gridRef.current?.reveal(postId);
    });
    markMorph(postId);
    setDetail((d) => (d ? { ...d, closing: true } : d));
  }, []);

  const requestClose = useCallback(() => {
    if (!detail || detail.closing) return;
    if (historyState().fromGrid && historyState().detail) history.back();
    else {
      history.replaceState({ ...historyState(), detail: undefined, fromGrid: undefined }, "", urlFor(null, query));
      beginClose(detail.postId);
    }
  }, [detail, query, beginClose]);

  useEffect(() => {
    const onPop = () => {
      const loc = readLocation();
      setQuery((q) => (searchFromQuery(q) === searchFromQuery(loc.query) ? q : loc.query));
      const open = detailRef.current;
      if (!loc.postId) {
        if (open && !open.closing) beginClose(open.postId);
      } else {
        markMorph(null);
        setDetail({ postId: loc.postId, origin: null, closing: false });
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [beginClose]);

  const onExited = useCallback(() => {
    const postId = detail?.postId ?? null;
    markMorph(null);
    // Commit now so the library is no longer inert when focus returns to the card.
    flushSync(() => setDetail(null));
    if (postId) gridRef.current?.focus(postId);
  }, [detail?.postId]);

  const step = useCallback(
    (delta: 1 | -1) => {
      if (!detail || !library || !results) return;
      const pos = positionOf.get(library.byPostId.get(detail.postId) ?? -1);
      if (pos === undefined) return;
      const next = results.ids[pos + delta];
      if (next === undefined) return;
      const postId = library.items[next].postId;
      markMorph(null);
      history.replaceState({ ...historyState(), detail: postId }, "", urlFor(postId, query));
      setActivePostId(postId);
      setDetail({ postId, origin: null, closing: false });
      preloadPost(library.items[results.ids[pos + delta * 2]]);
    },
    [detail, library, results, positionOf, query],
  );

  // Warm the following post when a detail opens.
  useEffect(() => {
    if (!detail || !library || !results) return;
    const pos = positionOf.get(library.byPostId.get(detail.postId) ?? -1);
    if (pos !== undefined) preloadPost(library.items[results.ids[pos + 1]]);
  }, [detail?.postId, library, results, positionOf]); // eslint-disable-line react-hooks/exhaustive-deps

  // A refresh can remove the open post.
  useEffect(() => {
    if (detail && library && !library.byPostId.has(detail.postId)) {
      showToast({ tone: "info", message: "That post is not in the library any more." });
      history.replaceState({}, "", urlFor(null, query));
      setDetail(null);
    }
  }, [library, detail, query]);

  useEffect(() => {
    document.documentElement.classList.toggle("is-locked", !!detail);
  }, [detail]);

  // ------------------------------------------------------------ preferences and keys

  useEffect(() => {
    if (theme === "auto") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    history.scrollRestoration = "manual";
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (detail || document.querySelector("dialog[open]")) return;
      const editable = isEditable(event.target);
      const key = event.key.toLowerCase();
      if ((event.metaKey && key === "k") || (event.ctrlKey && key === "k" && !editable)) {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
        return;
      }
      if (editable || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (event.key === "?") {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const firstResult = () => (library && results?.ids.length ? library.items[results.ids[0]].postId : null);

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      if (query.q) updateQuery({ q: "" });
      else {
        const target = activePostId ?? firstResult();
        if (target) gridRef.current?.focus(target);
        else searchRef.current?.blur();
      }
    } else if (event.key === "ArrowDown" || event.key === "Enter") {
      const target = firstResult();
      if (target) {
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: "instant" });
        requestAnimationFrame(() => gridRef.current?.focus(target));
      }
    }
  };

  // Remember the scroll anchor in history, so reload and Back return to the same place.
  const anchorTimer = useRef(0);
  const onAnchor = useCallback((anchor: { postId: string; offset: number } | null) => {
    window.clearTimeout(anchorTimer.current);
    anchorTimer.current = window.setTimeout(() => {
      if (!anchor || historyState().detail) return;
      history.replaceState({ ...historyState(), anchor }, "");
    }, 300);
  }, []);

  const topicsOf = useCallback((i: number) => index!.effectiveTopics[i], [index]);
  const onToggleFavourite = useCallback(
    (postId: string) => void user.setFavourite(postId, user.favourites[postId] === undefined),
    [user],
  );

  // ------------------------------------------------------------ render

  if (load.kind !== "ready" || !library || !index || !results) {
    return (
      <>
        <LibraryState kind={load.kind === "ready" ? "loading" : load.kind} message={"message" in load ? load.message : undefined} onRetry={() => {
          setLoad({ kind: "loading" });
          void loadLibrary("initial");
        }} />
        <Toasts />
      </>
    );
  }

  const tokens = activeTokens(query);
  const filtersActive = tokens.filter((t) => t.key !== "q").length;
  const detailIndex = detail ? itemIndexOf(detail.postId) : undefined;
  const search = searchFromQuery(query);

  const rail = (
    <Rail
      query={query}
      counts={results.counts}
      taxonomy={library.taxonomy}
      onQuery={updateQuery}
      onInfo={() => setInfoOpen(true)}
      onShortcuts={() => setShortcutsOpen(true)}
    />
  );

  return (
    <>
      <a className="skip-link" href="#results">
        Skip to results
      </a>
      <div className="app" inert={detail ? true : undefined}>
        <Header
          ref={searchRef}
          q={query.q}
          total={library.items.length}
          density={density}
          theme={theme}
          activeFilters={filtersActive}
          filtersOpen={sheetOpen}
          onQ={(q) => updateQuery({ q })}
          onSearchKey={onSearchKey}
          onDensity={setDensity}
          onTheme={setTheme}
          onHome={() => {
            clearFilters();
            window.scrollTo({ top: 0, behavior: "instant" });
          }}
          onFilters={() => setSheetOpen(true)}
        />
        <div className="shell">
          <aside className="rail-wrap">{rail}</aside>
          <main className="main" id="results" tabIndex={-1} data-rendered-query={searchFromQuery(effectiveQuery)}>
            <ResultBar query={query} shown={results.ids.length} total={results.total} onQuery={updateQuery} onClear={clearFilters} />
            {results.ids.length ? (
              <Grid
                ref={gridRef}
                items={library.items}
                ids={results.ids}
                density={density}
                favourites={user.favourites}
                topicsOf={topicsOf}
                search={search}
                resultsKey={search}
                activePostId={activePostId}
                onActiveChange={setActivePostId}
                onOpen={openDetail}
                onToggleFavourite={onToggleFavourite}
                initialAnchor={restoreAnchor.current}
                onAnchor={onAnchor}
              />
            ) : (
              <NoResults
                query={query.q.trim()}
                favouritesOnly={query.view === "favourites"}
                hasFilters={tokens.some((t) => t.key !== "q")}
                onClearSearch={() => updateQuery({ q: "" })}
                onClearFilters={() => setQuery((q) => ({ ...EMPTY_QUERY, q: q.q, sort: q.sort }))}
                onShowAll={() => updateQuery({ view: "all" })}
              />
            )}
          </main>
        </div>
      </div>

      {detail && detailIndex !== undefined ? (
        <Detail
          library={library}
          index={index}
          itemIndex={detailIndex}
          position={positionOf.get(detailIndex) ?? null}
          resultCount={results.ids.length}
          favourite={user.favourites[detail.postId] !== undefined}
          terms={searchTerms(deferredQ)}
          origin={detail.origin}
          closing={detail.closing}
          returnGeometry={(postId) => gridRef.current?.geometry(postId) ?? null}
          onClose={requestClose}
          onStep={step}
          onExited={onExited}
          onToggleFavourite={() => onToggleFavourite(detail.postId)}
          onSaveEdit={(edit) => void user.setEdit(detail.postId, edit)}
          onResetEdit={() => void user.setEdit(detail.postId, null)}
        />
      ) : null}

      <Modal open={sheetOpen} onClose={() => setSheetOpen(false)} label="Filters" className="sheet">
        <div className="sheet-head">
          <h2>Filters</h2>
          <button type="button" className="button button--primary" onClick={() => setSheetOpen(false)}>
            Show {count(results.ids.length)}
          </button>
        </div>
        <Rail
          query={query}
          counts={results.counts}
          taxonomy={library.taxonomy}
          onQuery={updateQuery}
          onInfo={() => {
            setSheetOpen(false);
            setInfoOpen(true);
          }}
          onShortcuts={() => {
            setSheetOpen(false);
            setShortcutsOpen(true);
          }}
          footer={
            <div className="rail-group rail-prefs-only" role="group" aria-labelledby="sheet-display">
              <h2 className="eyebrow" id="sheet-display">
                Display
              </h2>
              <div className="rail-prefs">
                <DisplayPrefs density={density} theme={theme} onDensity={setDensity} onTheme={setTheme} />
              </div>
            </div>
          }
        />
      </Modal>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <LibraryInfoDialog open={infoOpen} onClose={() => setInfoOpen(false)} library={library} />
      <Toasts />
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {announcement}
      </div>
    </>
  );
}
