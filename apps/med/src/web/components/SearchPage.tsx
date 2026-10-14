import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { BrowseSource } from "../../shared/browse";
import type { BrowseSearch } from "../../shared/inspect";
import { readBrowserToken } from "../data/auth";
import { browseSourceKey, createBrowseApi } from "../data/browse";
import { visibleElement } from "../data/palette-focus";
import { matchRepositories, parseSearchQuery } from "../data/search-query";
import { useTitleBarOverlay } from "../data/title-bar";
import { picked, tokens, ui } from "../theme.stylex";
import { CardTab, tabbedCard } from "./CardTab";
import { ToolButton } from "./ToolButton";

export const SEARCH_PATH = "/search";

export interface SearchRepository {
  id: string;
  name: string;
  path: string;
}

/** The workspace that opened the search page: its repository's results open
 * there, and search the workspace's own checkout. */
export interface SearchOrigin {
  workspace: string;
  repository: SearchRepository;
  source: BrowseSource;
}

/** A match that the reader opens, in the commit that the search read. */
export interface SearchOpen {
  repository: SearchRepository;
  path: string;
  line: number;
  source: BrowseSource;
}

interface SearchState {
  searchFrom?: SearchOrigin;
  /** Each opening of the page is a new page, as a link to it is. */
  search?: string;
}

/** Shows the search page with a query, as ⌘⇧F does from a workspace. */
export function openSearchPage(query: string, origin?: SearchOrigin) {
  const state: SearchState = { searchFrom: origin, search: crypto.randomUUID() };
  history.pushState(state, "", `${SEARCH_PATH}?${new URLSearchParams({ q: query })}`);
  window.dispatchEvent(new PopStateEvent("popstate", { state }));
}

/** The search page that the address shows, if any. */
export function readSearchAddress() {
  if (location.pathname !== SEARCH_PATH) return null;
  const state = history.state as SearchState | null;
  return {
    key: state?.search ?? "",
    query: new URLSearchParams(location.search).get("q") ?? "",
    origin: state?.searchFrom,
  };
}

/** Repositories that one query searches, and how many at once. */
const MAX_REPOSITORIES = 20;
const PARALLEL = 4;
/** Typing pauses this long before a search starts. */
const DEBOUNCE_MS = 120;
/** The host takes one line of up to 256 characters. */
const MAX_TEXT = 256;

interface Entry {
  repository: SearchRepository;
  source: BrowseSource;
  result?: BrowseSearch;
  error?: string;
  /** The last query's result, shown faded until this one arrives. */
  previous?: BrowseSearch;
}

/**
 * Text search across the registered repositories, as a page: `repo:name`
 * picks repositories, and the rest is found as written in their committed
 * files. Results show as you type, by file; arrows move through them, Enter
 * opens one at its line, and Escape goes back.
 */
export function SearchPage({
  repositories,
  loaded,
  origin,
  initialQuery,
  fetcher,
  onBack,
  onOpen,
}: {
  repositories: readonly SearchRepository[];
  loaded: boolean;
  origin?: SearchOrigin;
  initialQuery: string;
  fetcher: typeof fetch;
  onBack(): void;
  onOpen(open: SearchOpen): void;
}) {
  const tab = useTitleBarOverlay();
  const [api] = useState(() => createBrowseApi(fetcher, readBrowserToken()));
  const [query, setQuery] = useState(initialQuery);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const id = useId();
  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const targets = useMemo(
    () =>
      matchRepositories(
        // A checkout that is not registered is searched as its own repository.
        origin && !repositories.some((repository) => repository.path === origin.repository.path)
          ? [origin.repository, ...repositories]
          : repositories,
        parsed.repos,
      )
        .slice(0, MAX_REPOSITORIES)
        .map((repository) => ({
          repository,
          // The workspace's own checkout, which can be a thread's worktree.
          source:
            origin && origin.repository.path === repository.path
              ? origin.source
              : ({ kind: "worktree", repo: repository.path } as BrowseSource),
        })),
    [repositories, parsed.repos, origin],
  );
  const runKey = JSON.stringify([
    parsed.text,
    targets.map(({ source }) => browseSourceKey(source)),
  ]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState(0);

  // The address keeps the query, so Back and a reload return to it.
  useEffect(() => {
    const url = `${SEARCH_PATH}?${new URLSearchParams({ q: query })}`;
    if (location.pathname + location.search !== url) history.replaceState(history.state, "", url);
  }, [query]);

  useEffect(() => {
    const text = parsed.text;
    setSelected(0);
    setEntries((last) =>
      targets.map(({ repository, source }) => {
        const before = last.find(
          (entry) => browseSourceKey(entry.source) === browseSourceKey(source),
        );
        return { repository, source, previous: before?.result ?? before?.previous };
      }),
    );
    if (!text || text.length > MAX_TEXT) return;
    const abort = new AbortController();
    const timer = setTimeout(() => {
      const queue = [...targets];
      const next = async (): Promise<void> => {
        const target = queue.shift();
        if (!target || abort.signal.aborted) return;
        const key = browseSourceKey(target.source);
        const stream = `search-${target.repository.id.replace(/[^\w-]/g, "-").slice(0, 40)}`;
        const settle = (patch: Partial<Entry>) =>
          setEntries((current) =>
            current.map((entry) =>
              browseSourceKey(entry.source) === key
                ? { ...entry, ...patch, previous: undefined }
                : entry,
            ),
          );
        try {
          settle({ result: await api.search(target.source, text, abort.signal, stream) });
        } catch (error) {
          if (abort.signal.aborted) return;
          settle({ error: error instanceof Error ? error.message : "The search failed." });
        }
        return next();
      };
      for (let at = 0; at < PARALLEL; at++) void next();
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
    // The run key names the text and the sources; the others follow from them.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  // Every match in page order, for the arrows and Enter.
  const rows = useMemo(
    () =>
      entries.flatMap((entry) => {
        const result = entry.result ?? entry.previous;
        return (result?.matches ?? []).map((match) => ({ entry, result: result!, match }));
      }),
    [entries],
  );
  const current = Math.min(selected, Math.max(0, rows.length - 1));
  const optionId = (index: number) => `${id}-match-${index}`;
  useEffect(() => {
    list.current
      ?.querySelector(`[id="${CSS.escape(optionId(current))}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });

  const open = (index: number) => {
    const row = rows[index];
    if (!row) return;
    onOpen({
      repository: row.entry.repository,
      path: row.match.path,
      line: row.match.line,
      source: row.result.resultSource ?? row.result.source,
    });
  };
  const keydown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setSelected(Math.max(0, Math.min(rows.length - 1, current + step)));
    } else if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      open(current);
    }
  };

  // Escape goes back to the workspace; ⌘⇧F here selects the query.
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        event.stopPropagation();
        input.current?.focus();
        input.current?.select();
        return;
      }
      if (event.key !== "Escape") return;
      if (visibleElement('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      onBack();
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onBack]);

  const searching = entries.filter((entry) => !entry.result && !entry.error).length;
  const shown = entries.filter((entry) => entry.result ?? entry.previous);
  const files = new Set(rows.map((row) => `${row.entry.repository.path}\0${row.match.path}`)).size;
  const truncated = entries.filter((entry) => entry.result?.truncated);
  // The host says why a search read less, such as Git while the index builds.
  const notes = [
    ...new Set(
      entries.flatMap((entry) => [
        ...(entry.result?.reason ? [entry.result.reason] : []),
        ...(entry.result?.engine === "git" && entry.result.index?.message
          ? [entry.result.index.message]
          : []),
      ]),
    ),
  ];
  const unmatched = loaded && parsed.repos.length > 0 && !targets.length;

  let status: ReactNode = null;
  if (!parsed.text) status = null;
  else if (parsed.text.length > MAX_TEXT) status = `Use at most ${MAX_TEXT} characters.`;
  else if (unmatched)
    status = `No repository matches ${parsed.repos.map((name) => `repo:${name}`).join(" ")}.`;
  else if (!searching || rows.length)
    status = (
      <>
        {rows.length === 0
          ? "No results"
          : `${rows.length} ${rows.length === 1 ? "result" : "results"} in ${files} ${files === 1 ? "file" : "files"}`}
        {targets.length === 1
          ? ` in ${targets[0]!.repository.name}`
          : ` across ${targets.length} repositories`}
        {searching > 0 && " · Searching…"}
      </>
    );
  else status = "Searching…";

  let index = -1;
  return (
    <div {...stylex.props(styles.page, tab && styles.pageTab)}>
      <main aria-label="Search" {...stylex.props(styles.card, tab && tabbedCard.card)}>
        {tab && <CardTab />}
        <header {...stylex.props(styles.header)}>
          <ToolButton label="Back" shortcut="Esc" icon="arrowLeft" onClick={onBack} />
          <h1 {...stylex.props(styles.title)}>Search</h1>
        </header>
        <div {...stylex.props(styles.bar)}>
          <input
            ref={input}
            // The page opens for typing, as a search box does.
            // oxlint-disable-next-line jsx-a11y/no-autofocus
            autoFocus
            type="text"
            role="combobox"
            aria-label="Search query"
            aria-expanded={rows.length > 0}
            aria-controls={`${id}-results`}
            aria-activedescendant={rows.length ? optionId(current) : undefined}
            spellCheck={false}
            autoComplete="off"
            placeholder="Search text in committed files · repo:name"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={keydown}
            onFocus={(event) => {
              // The cursor goes after the filters, where the text is typed.
              const end = event.currentTarget.value.length;
              event.currentTarget.setSelectionRange(end, end);
            }}
            {...stylex.props(ui.input, styles.input)}
          />
        </div>
        <div ref={list} {...stylex.props(styles.scroller)}>
          <div {...stylex.props(styles.column)}>
            {!parsed.text ? (
              <Help repositories={targets.map((target) => target.repository.name)} />
            ) : (
              <>
                <p role="status" {...stylex.props(styles.status)}>
                  {status}
                </p>
                {truncated.length > 0 && (
                  <p {...stylex.props(styles.note)}>
                    Showing the first matches in{" "}
                    {truncated.map((entry) => entry.repository.name).join(", ")}. Add text to see
                    fewer.
                  </p>
                )}
                {notes.map((note) => (
                  <p key={note} {...stylex.props(styles.note)}>
                    {note}
                  </p>
                ))}
                {entries
                  .filter((entry) => entry.error)
                  .map((entry) => (
                    <p
                      key={entry.repository.path}
                      role="alert"
                      {...stylex.props(styles.note, styles.error)}
                    >
                      {entry.repository.name}: {entry.error}
                    </p>
                  ))}
                <div id={`${id}-results`} role="listbox" aria-label="Results">
                  {shown.map((entry) => {
                    const result = (entry.result ?? entry.previous)!;
                    const groups = byFile(result.matches);
                    return groups.map(([path, matches]) => (
                      <section
                        key={`${entry.repository.path}\0${path}`}
                        role="group"
                        aria-label={`${entry.repository.name} ${path}`}
                        {...stylex.props(styles.file, !entry.result && styles.stale)}
                      >
                        <h2 {...stylex.props(styles.fileHead)}>
                          {shown.length > 1 && (
                            <span {...stylex.props(styles.repository)}>
                              {entry.repository.name}
                            </span>
                          )}
                          <span {...stylex.props(styles.path)}>
                            <span {...stylex.props(styles.folder)}>
                              {path.slice(0, path.lastIndexOf("/") + 1)}
                            </span>
                            {path.slice(path.lastIndexOf("/") + 1)}
                          </span>
                          <span {...stylex.props(styles.count)}>{matches.length}</span>
                        </h2>
                        <div {...stylex.props(styles.lines)}>
                          {matches.map((match) => {
                            const at = ++index;
                            return (
                              // The query field takes the keys and names the chosen line.
                              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
                              <div
                                key={match.line}
                                id={optionId(at)}
                                role="option"
                                tabIndex={-1}
                                aria-selected={at === current}
                                onPointerMove={() => at !== current && setSelected(at)}
                                onClick={() => open(at)}
                                {...stylex.props(
                                  styles.line,
                                  at === current && [styles.lineSelected, picked],
                                )}
                              >
                                <span {...stylex.props(styles.number)}>{match.line}</span>
                                <code {...stylex.props(styles.text)}>
                                  <Marked text={match.text} needle={result.query} />
                                </code>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    ));
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

/** Matches in one file each, in the order that the search found them. */
function byFile(matches: BrowseSearch["matches"]) {
  const files = new Map<string, BrowseSearch["matches"]>();
  for (const match of matches) {
    const list = files.get(match.path);
    if (list) list.push(match);
    else files.set(match.path, [match]);
  }
  return [...files];
}

/** A line with each place that the text occurs marked, in any case. */
function Marked({ text, needle }: { text: string; needle: string }) {
  const parts: ReactNode[] = [];
  const haystack = text.toLowerCase();
  const wanted = needle.toLowerCase();
  let from = 0;
  for (let at = haystack.indexOf(wanted); wanted && at >= 0; at = haystack.indexOf(wanted, from)) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(
      <mark key={at} {...stylex.props(styles.mark)}>
        {text.slice(at, at + wanted.length)}
      </mark>,
    );
    from = at + wanted.length;
  }
  parts.push(text.slice(from));
  return <>{parts}</>;
}

function Help({ repositories }: { repositories: string[] }) {
  return (
    <div {...stylex.props(styles.help)}>
      <p {...stylex.props(styles.helpLead)}>
        Type to find text in the committed files of{" "}
        {repositories.length === 1 ? repositories[0] : "your repositories"}. Results show as you
        type.
      </p>
      <dl {...stylex.props(styles.syntax)}>
        <dt>
          <code {...stylex.props(styles.code)}>repo:name</code>
        </dt>
        <dd {...stylex.props(styles.syntaxText)}>
          Search one repository. Add more to search several; with none, every repository.
        </dd>
        <dt>
          <kbd {...stylex.props(styles.code)}>↑ ↓</kbd> <kbd {...stylex.props(styles.code)}>↵</kbd>
        </dt>
        <dd {...stylex.props(styles.syntaxText)}>
          Move through the results, and open one at its line.
        </dd>
      </dl>
    </div>
  );
}

const narrow = "@media (max-width: 640px)";

const styles = stylex.create({
  // The review's frame, as the Sources page: a 6px gutter and one card.
  page: {
    position: "absolute",
    inset: 0,
    zIndex: 30,
    display: "flex",
    padding: 6,
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
    WebkitFontSmoothing: "antialiased",
  },
  pageTab: { top: "calc(-1 * var(--med-titlebar-height))" },
  card: {
    position: "relative",
    flex: "1",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderRadius: tokens.frame,
    boxShadow: `0 0 0 1px ${tokens.line}, 0 1px 3px #0000000f`,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    height: 38,
    paddingInline: 6,
    boxSizing: "border-box",
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  title: {
    margin: 0,
    marginInlineStart: 2,
    fontSize: 13,
    fontWeight: 500,
    letterSpacing: "-0.005em",
    whiteSpace: "nowrap",
  },
  bar: {
    flexShrink: 0,
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 928,
    marginInline: "auto",
    paddingTop: { default: 20, [narrow]: 12 },
    paddingInline: { default: 24, [narrow]: 8 },
  },
  input: {
    width: "100%",
    height: 34,
    boxSizing: "border-box",
    fontFamily: tokens.code,
    fontSize: 13,
  },
  scroller: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
  },
  column: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 928,
    marginInline: "auto",
    paddingTop: 10,
    paddingBottom: 40,
    paddingInline: { default: 24, [narrow]: 8 },
  },
  status: {
    marginBlock: 0,
    marginBottom: 10,
    color: tokens.muted,
    fontVariantNumeric: "tabular-nums",
  },
  note: { marginBlock: 0, marginBottom: 10, color: tokens.faint, lineHeight: 1.5 },
  error: { color: tokens.red },
  file: {
    marginBottom: 10,
    overflow: "hidden",
    borderRadius: `calc(8px * ${tokens.round})`,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    transitionProperty: "opacity",
    transitionDuration: "120ms",
  },
  stale: { opacity: 0.55 },
  fileHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    margin: 0,
    paddingBlock: 6,
    paddingInline: 10,
    fontSize: 12.5,
    fontWeight: 400,
    backgroundColor: tokens.fill,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  repository: { flexShrink: 0, color: tokens.muted },
  path: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: 500,
  },
  folder: { color: tokens.muted, fontWeight: 400 },
  count: { flexShrink: 0, color: tokens.faint, fontVariantNumeric: "tabular-nums" },
  lines: { paddingBlock: 2 },
  line: {
    display: "flex",
    gap: 12,
    paddingBlock: 2,
    paddingInline: 10,
    cursor: "pointer",
    fontFamily: tokens.code,
    fontSize: 12,
    lineHeight: "20px",
  },
  lineSelected: { backgroundColor: tokens.pick, color: tokens.selectedText },
  number: {
    flexShrink: 0,
    minWidth: "4ch",
    textAlign: "end",
    color: tokens.faint,
    fontVariantNumeric: "tabular-nums",
    userSelect: "none",
  },
  text: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "pre",
    fontFamily: "inherit",
  },
  mark: {
    color: "inherit",
    backgroundColor: tokens.accentSoft,
    borderRadius: 2,
    boxShadow: `0 0 0 1px ${tokens.accentLine}`,
  },
  help: { paddingTop: 12, color: tokens.muted, fontSize: 13, lineHeight: 1.6 },
  helpLead: { marginBlock: 0, marginBottom: 14 },
  syntax: {
    display: "grid",
    gridTemplateColumns: "max-content 1fr",
    columnGap: 16,
    rowGap: 8,
    margin: 0,
  },
  syntaxText: { margin: 0 },
  code: { fontFamily: tokens.code, fontSize: 12, color: tokens.text },
});
