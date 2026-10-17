import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import * as stylex from "@stylexjs/stylex";
import type { BrowseSource } from "../../shared/browse";
import type { BrowseSearch } from "../../shared/inspect";
import { browseSourceKey, type BrowseApi } from "../data/browse";
import { matchRepositories, parseSearchQuery } from "../data/search-query";
import { picked, tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

export interface SearchRepository {
  id: string;
  name: string;
  path: string;
}

/** A match that the reader opens, in the commit that the search read. */
export interface SearchOpen {
  repository: SearchRepository;
  path: string;
  line: number;
  source: BrowseSource;
}

/** A match in another repository: the workspaces open it in that
 * repository's workspace (`components/Workspaces.tsx`). */
export const SEARCH_OPEN_EVENT = "med:search-open";

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
 * The workspace's Search tab: text search in the committed files of its
 * checkout. `repo:name` searches other registered repositories instead, and
 * `repo:*` every one. Results show as you type, by file; arrows move through
 * them, Enter opens one at its line in a file tab, and Escape shows the tab
 * that showed before. The tab stays mounted while it is open, so its query,
 * results, and scroll survive a switch to another tab.
 */
export function SearchView({
  api,
  source,
  repository,
  repositories,
  query,
  active,
  focusRequest,
  onQueryChange,
  onOpen,
  onLeave,
}: {
  api: Pick<BrowseApi, "search">;
  /** The workspace's checkout, such as a thread's worktree. */
  source: BrowseSource;
  repository: SearchRepository;
  /** Registered repositories, for `repo:` filters. */
  repositories: readonly SearchRepository[];
  query: string;
  active: boolean;
  /** Changes when ⌘⇧F asks for the query field: it takes the focus and selects its text. */
  focusRequest: number;
  onQueryChange(query: string): void;
  onOpen(open: SearchOpen): void;
  onLeave(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const scroll = useRef(0);
  const id = useId();
  const parsed = useMemo(() => parseSearchQuery(query), [query]);
  const targets = useMemo(() => {
    if (!parsed.repos.length) return [{ repository, source }];
    const all = repositories.some((entry) => entry.path === repository.path)
      ? repositories
      : [repository, ...repositories];
    return (parsed.repos.includes("*") ? [...all] : matchRepositories(all, parsed.repos))
      .slice(0, MAX_REPOSITORIES)
      .map((entry) => ({
        repository: entry,
        // The workspace's own checkout; the others' main checkouts.
        source:
          entry.path === repository.path
            ? source
            : ({ kind: "worktree", repo: entry.path } as BrowseSource),
      }));
  }, [repositories, repository, source, parsed.repos]);
  const runKey = JSON.stringify([
    parsed.text,
    targets.map((target) => browseSourceKey(target.source)),
  ]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    const text = parsed.text;
    // A new query starts at its first result.
    setSelected(0);
    scroll.current = 0;
    if (list.current) list.current.scrollTop = 0;
    setEntries((last) =>
      targets.map((target) => {
        const before = last.find(
          (entry) => browseSourceKey(entry.source) === browseSourceKey(target.source),
        );
        return { ...target, previous: before?.result ?? before?.previous };
      }),
    );
    if (!text || text.length > MAX_TEXT || !api.search) return;
    const search = api.search;
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
          settle({ result: await search(target.source, text, abort.signal, stream) });
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

  // The tab takes the keys when it shows; ⌘⇧F also selects the query.
  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true });
  }, [active]);
  useEffect(() => {
    if (!focusRequest) return;
    input.current?.focus({ preventScroll: true });
    input.current?.select();
  }, [focusRequest]);
  // A hidden tab has no scroll position, so it keeps its own (`scroll`).
  useLayoutEffect(() => {
    if (active && list.current) list.current.scrollTop = scroll.current;
  }, [active]);

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
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
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
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      moved.current = true;
      setSelected(Math.max(0, Math.min(rows.length - 1, current + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(current);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
    }
  };

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
  const unmatched = parsed.repos.length > 0 && !targets.length;

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
    <div {...stylex.props(styles.view)}>
      <div {...stylex.props(styles.bar)}>
        <span {...stylex.props(styles.barIcon)}>
          <Icon name="search" size={14} />
        </span>
        <input
          ref={input}
          // ⌥W, ⌥1–9, and ⌘⇧[ ⌘⇧] work here as in the editor.
          data-tab-keys=""
          type="text"
          role="combobox"
          aria-label="Search query"
          aria-expanded={rows.length > 0}
          aria-controls={`${id}-results`}
          aria-activedescendant={rows.length ? optionId(current) : undefined}
          spellCheck={false}
          autoComplete="off"
          placeholder={`Search text in ${repository.name} · repo:name for others`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={keydown}
          {...stylex.props(ui.input, styles.input)}
        />
      </div>
      <div
        ref={list}
        onScroll={(event) => {
          scroll.current = event.currentTarget.scrollTop;
        }}
        {...stylex.props(styles.scroller)}
      >
        {!parsed.text ? (
          <Help repository={repository.name} />
        ) : (
          <>
            <p role="status" {...stylex.props(styles.status)}>
              {status}
            </p>
            {truncated.length > 0 && (
              <p {...stylex.props(styles.note)}>
                Showing the first matches in{" "}
                {truncated.map((entry) => entry.repository.name).join(", ")}. Add text to see fewer.
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
                return byFile(result.matches).map(([path, matches]) => (
                  <section
                    key={`${entry.repository.path}\0${path}`}
                    role="group"
                    aria-label={`${entry.repository.name} ${path}`}
                    {...stylex.props(styles.file, !entry.result && styles.stale)}
                  >
                    <h2 {...stylex.props(styles.fileHead)}>
                      {shown.length > 1 && (
                        <span {...stylex.props(styles.repository)}>{entry.repository.name}</span>
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

function Help({ repository }: { repository: string }) {
  return (
    <div {...stylex.props(styles.help)}>
      <p {...stylex.props(styles.helpLead)}>
        Type to find text in the committed files of {repository}. Results show as you type.
      </p>
      <dl {...stylex.props(styles.syntax)}>
        <dt>
          <code {...stylex.props(styles.code)}>repo:name</code>
        </dt>
        <dd {...stylex.props(styles.syntaxText)}>
          Search another repository instead. Add more to search several, or{" "}
          <code {...stylex.props(styles.code)}>repo:*</code> for every one.
        </dd>
        <dt>
          <kbd {...stylex.props(styles.code)}>↑ ↓</kbd> <kbd {...stylex.props(styles.code)}>↵</kbd>
        </dt>
        <dd {...stylex.props(styles.syntaxText)}>
          Move through the results, and open one at its line in a tab.
        </dd>
        <dt>
          <kbd {...stylex.props(styles.code)}>Esc</kbd>
        </dt>
        <dd {...stylex.props(styles.syntaxText)}>
          Show the tab that showed before. This tab keeps its results.
        </dd>
      </dl>
    </div>
  );
}

const narrow = "@media (max-width: 640px)";

const styles = stylex.create({
  view: {
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  bar: {
    position: "relative",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    paddingTop: 12,
    paddingBottom: 4,
    paddingInline: { default: 16, [narrow]: 8 },
  },
  barIcon: {
    position: "absolute",
    insetInlineStart: { default: 26, [narrow]: 18 },
    display: "flex",
    color: tokens.faint,
    pointerEvents: "none",
  },
  input: {
    width: "100%",
    height: 32,
    boxSizing: "border-box",
    paddingInlineStart: 30,
    fontFamily: tokens.code,
    fontSize: 13,
  },
  scroller: {
    flex: "1",
    minHeight: 0,
    overflowY: "auto",
    paddingTop: 8,
    paddingBottom: 40,
    paddingInline: { default: 16, [narrow]: 8 },
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
  help: { paddingTop: 4, color: tokens.muted, fontSize: 13, lineHeight: 1.6, maxWidth: 640 },
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
