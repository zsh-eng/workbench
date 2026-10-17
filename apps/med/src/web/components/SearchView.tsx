import {
  memo,
  useCallback,
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
import { useWorkerPool } from "@pierre/diffs/react";
import type { BrowseRead, BrowseSource } from "../../shared/browse";
import type { BrowseSearch } from "../../shared/inspect";
import { codeColors } from "../code-colors";
import { browseSourceKey, type BrowseApi } from "../data/browse";
import { pierreFile } from "../data/file-prefetch";
import {
  agrees,
  excerpts,
  occurrences,
  pieces,
  tokensOf,
  type Piece,
  type Token,
} from "../data/search-excerpts";
import { matchRepositories, parseSearchQuery } from "../data/search-query";
import { picked, tokens, ui } from "../theme.stylex";
import { useTheme } from "../themes";
import { Icon } from "./Icon";

export interface SearchRepository {
  id: string;
  name: string;
  path: string;
}

/** A match that the reader opens, in the files that the search read: a
 * checkout's working files, or a commit's. */
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
/** Files read and highlighted at once, and how far outside the view they start. */
const LOADS = 3;
const NEAR = "600px 0px";
/** Files whose text stays read for a later theme or query. */
const KEPT_READS = 60;

interface Entry {
  repository: SearchRepository;
  source: BrowseSource;
  result?: BrowseSearch;
  error?: string;
  /** The last query's result, shown faded until this one arrives. */
  previous?: BrowseSearch;
}

type Match = BrowseSearch["matches"][number];

/** One file of results: its matches in line order, and the place of its first
 * match among all of them, for the arrow keys. */
interface Group {
  key: string;
  repository: SearchRepository;
  source: BrowseSource;
  path: string;
  query: string;
  /** Whether the search that found the matches matched case. */
  matchCase: boolean;
  stale: boolean;
  matches: Match[];
  first: number;
  /** The search that found the matches: a working file is read again for a
   * newer search, since it can change between searches. */
  run: number;
}

/** Each search result's number, in the order the results arrived. */
const runs = new WeakMap<BrowseSearch, number>();
let lastRun = 0;
const runOf = (result: BrowseSearch) => {
  let run = runs.get(result);
  if (run === undefined) runs.set(result, (run = ++lastRun));
  return run;
};

type LoadFile = Pick<Group, "source" | "path" | "run">;

/** A file's text, and its lines as the file view highlights them. */
interface Loaded {
  lines?: string[];
  code?: readonly unknown[];
}

type Pool = ReturnType<typeof useWorkerPool>;

/**
 * Reads and highlights the files of the results near the view, a few at a
 * time, with the same worker, cache, and theme as the file view; a file far
 * off screen is not read until the reader scrolls near it.
 */
function createFileLoader(
  read: BrowseApi["read"],
  pool: Pool,
  publish: (key: string, loaded: Loaded) => void,
) {
  const abort = new AbortController();
  // Each file's state: "loading", "failed", "plain", or the theme it was highlighted for.
  const status = new Map<string, string>();
  // The search for which each working file was last read.
  const readFor = new Map<string, number>();
  const reads = new Map<string, Promise<BrowseRead>>();
  const near = new Set<string>();
  let files = new Map<string, LoadFile>();
  let theme = "";
  let running = 0;
  const working = (file: LoadFile | undefined) => file?.source.kind === "worktree";
  const due = (key: string) => {
    const state = status.get(key);
    if (state === undefined) return true;
    if (state === "loading") return false;
    const file = files.get(key);
    if (working(file) && readFor.get(key) !== file!.run) return true;
    return state.startsWith("theme:") && state !== `theme:${theme}`;
  };
  const load = async (key: string, file: LoadFile) => {
    // A commit's file never changes; a working file is read for each search.
    const readKey = working(file) ? `${key}\0${file.run}` : key;
    let text = reads.get(readKey);
    if (!text) {
      text = read(file.source, file.path, abort.signal);
      reads.set(readKey, text);
      while (reads.size > KEPT_READS) reads.delete(reads.keys().next().value!);
    }
    readFor.set(key, file.run);
    const value = await text.catch((error: unknown) => {
      reads.delete(readKey);
      throw error;
    });
    if (value.kind !== "text" || value.text === undefined) return { status: "plain", loaded: {} };
    const lines = value.text.split("\n").map((line) => line.replace(/\r$/, ""));
    if (lines.length > 1 && lines.at(-1) === "") lines.pop();
    if (!pool?.isWorkingPool() || value.plain) return { status: "plain", loaded: { lines } };
    const wanted = theme;
    const input = pierreFile(value);
    if (!pool.getFileResultCache(input)) await pool.primeFileHighlightCache(input);
    const code = pool.getFileResultCache(input)?.result.code;
    return { status: code ? `theme:${wanted}` : "plain", loaded: { lines, code } };
  };
  const pump = () => {
    while (running < LOADS && !abort.signal.aborted) {
      const key = [...near].find(due);
      if (key === undefined) return;
      const file = files.get(key);
      if (!file) {
        near.delete(key);
        continue;
      }
      status.set(key, "loading");
      running++;
      load(key, file)
        .then(
          (result) => {
            status.set(key, result.status);
            publish(key, result.loaded);
          },
          () => {
            if (abort.signal.aborted) return;
            status.set(key, "failed");
          },
        )
        .finally(() => {
          running--;
          pump();
        });
    }
  };
  return {
    /** The files of the shown results; others are forgotten. */
    setFiles(next: Map<string, LoadFile>) {
      files = next;
      for (const key of status.keys())
        if (!next.has(key)) {
          status.delete(key);
          readFor.delete(key);
        }
      pump();
    },
    setTheme(name: string) {
      theme = name;
      pump();
    },
    near(key: string, shown: boolean) {
      if (shown) near.add(key);
      else near.delete(key);
      pump();
    },
    dispose() {
      abort.abort();
    },
  };
}

/**
 * The workspace's Search tab: text search in the working files of its
 * checkout, with uncommitted changes (in a very large checkout, its last
 * commit). `repo:name` searches other registered repositories instead, and
 * `repo:*` every one. Results show as you type, by file, each match with two
 * lines around it, highlighted as the file view highlights them; arrows move
 * through the matches, Enter opens one at its line in a file tab, and Escape
 * shows the tab that showed before. The tab stays mounted while it is open,
 * so its query, results, and scroll survive a switch to another tab.
 */
export function SearchView({
  api,
  source,
  repository,
  repositories,
  query,
  matchCase,
  active,
  focusRequest,
  onQueryChange,
  onMatchCaseChange,
  onOpen,
  onLeave,
}: {
  api: Pick<BrowseApi, "search" | "read">;
  /** The workspace's checkout, such as a thread's worktree. */
  source: BrowseSource;
  repository: SearchRepository;
  /** Registered repositories, for `repo:` filters. */
  repositories: readonly SearchRepository[];
  query: string;
  /** Whether the search finds the text only as typed. */
  matchCase: boolean;
  active: boolean;
  /** Changes when ⌘⇧F asks for the query field: it takes the focus and selects its text. */
  focusRequest: number;
  onQueryChange(query: string): void;
  onMatchCaseChange(matchCase: boolean): void;
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
    matchCase,
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
          settle({
            result: await search(target.source, text, abort.signal, { stream, matchCase }),
          });
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

  // The results by file, each file's matches in line order. The host matched
  // case or not, as each search asked.
  const groups = useMemo(() => {
    const result: Group[] = [];
    let first = 0;
    for (const entry of entries) {
      const found = entry.result ?? entry.previous;
      if (!found) continue;
      const at = found.resultSource ?? found.source;
      const files = new Map<string, Match[]>();
      for (const match of found.matches) {
        const file = files.get(match.path);
        if (file) file.push(match);
        else files.set(match.path, [match]);
      }
      for (const [path, matches] of files) {
        matches.sort((a, b) => a.line - b.line);
        result.push({
          key: `${browseSourceKey(at)}\0${path}`,
          repository: entry.repository,
          source: at,
          path,
          query: found.query,
          matchCase: !!found.matchCase,
          stale: !entry.result,
          matches,
          first,
          run: runOf(found),
        });
        first += matches.length;
      }
    }
    return result;
  }, [entries]);
  const count = groups.reduce((sum, group) => sum + group.matches.length, 0);
  const current = Math.min(selected, Math.max(0, count - 1));
  const optionId = useCallback((index: number) => `${id}-match-${index}`, [id]);
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current) return;
    moved.current = false;
    list.current
      ?.querySelector(`[id="${CSS.escape(optionId(current))}"]`)
      ?.scrollIntoView({ block: "nearest" });
  });

  // The files near the view are read and highlighted; see createFileLoader.
  const pool = useWorkerPool();
  const { active: theme } = useTheme();
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Loaded>>(() => new Map());
  const [loader] = useState(() =>
    createFileLoader(api.read, pool, (key, value) =>
      setLoaded((map) => new Map(map).set(key, value)),
    ),
  );
  useEffect(() => () => loader.dispose(), [loader]);
  useEffect(() => loader.setTheme(theme.pierreTheme), [loader, theme.pierreTheme]);
  useEffect(() => {
    loader.setFiles(new Map(groups.map((group) => [group.key, group])));
    // Results that went keep no text.
    setLoaded((map) => {
      const keep = new Map([...map].filter(([key]) => groups.some((group) => group.key === key)));
      return keep.size === map.size ? map : keep;
    });
  }, [loader, groups]);
  const [observer, setObserver] = useState<IntersectionObserver>();
  useEffect(() => {
    const root = list.current;
    if (!root) return;
    const next = new IntersectionObserver(
      (changes) => {
        for (const change of changes) {
          const key = (change.target as HTMLElement).dataset.searchFile;
          if (key) loader.near(key, change.isIntersecting);
        }
      },
      { root, rootMargin: NEAR },
    );
    setObserver(next);
    return () => next.disconnect();
  }, [loader]);

  const openLine = useCallback(
    (group: Group, line: number) =>
      onOpen({ repository: group.repository, path: group.path, line, source: group.source }),
    [onOpen],
  );
  const open = (index: number) => {
    const group = groups.find(
      (entry) => index >= entry.first && index < entry.first + entry.matches.length,
    );
    if (group) openLine(group, group.matches[index - group.first]!.line);
  };
  const keydown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      moved.current = true;
      setSelected(Math.max(0, Math.min(count - 1, current + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      open(current);
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onLeave();
    } else if (event.altKey && event.code === "KeyC" && !event.metaKey && !event.ctrlKey) {
      // ⌥C, as in VS Code.
      event.preventDefault();
      onMatchCaseChange(!matchCase);
    }
  };

  const searching = entries.filter((entry) => !entry.result && !entry.error).length;
  const repositoriesShown = new Set(groups.map((group) => group.repository.path)).size;
  // One quiet line for each reason that a search read less, such as its
  // 200-line cap, named by repository when several answer; and the host's
  // rare line on where the index would help.
  const notes = [
    ...new Set(
      entries.flatMap((entry) => {
        const reason =
          entry.result?.reason ??
          (entry.result?.truncated ? "Showing the first matches. Add text to see fewer." : "");
        return [
          ...(reason ? [targets.length > 1 ? `${entry.repository.name}: ${reason}` : reason] : []),
          ...(entry.result?.index?.message ? [entry.result.index.message] : []),
        ];
      }),
    ),
  ];
  const unmatched = parsed.repos.length > 0 && !targets.length;

  let status: ReactNode = null;
  if (!parsed.text) status = null;
  else if (parsed.text.length > MAX_TEXT) status = `Use at most ${MAX_TEXT} characters.`;
  else if (unmatched)
    status = `No repository matches ${parsed.repos.map((name) => `repo:${name}`).join(" ")}.`;
  else if (!searching || count)
    status = (
      <>
        {count === 0
          ? "No results"
          : `${count} ${count === 1 ? "result" : "results"} in ${groups.length} ${groups.length === 1 ? "file" : "files"}`}
        {targets.length === 1
          ? ` in ${targets[0]!.repository.name}`
          : ` across ${targets.length} repositories`}
        {searching > 0 && " · Searching…"}
      </>
    );
  else status = "Searching…";

  const colors = codeColors(theme);
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
          aria-expanded={count > 0}
          aria-controls={`${id}-results`}
          aria-activedescendant={count ? optionId(current) : undefined}
          spellCheck={false}
          autoComplete="off"
          placeholder={`Search text in ${repository.name} · repo:name for others`}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={keydown}
          {...stylex.props(ui.input, styles.input)}
        />
        <button
          type="button"
          aria-label="Match case"
          aria-pressed={matchCase}
          title="Match case (⌥C)"
          onClick={() => {
            onMatchCaseChange(!matchCase);
            input.current?.focus({ preventScroll: true });
          }}
          {...stylex.props(styles.option, matchCase && styles.optionOn)}
        >
          Aa
        </button>
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
              {groups.map((group) => (
                <ResultFile
                  key={group.key}
                  group={group}
                  loaded={loaded.get(group.key)}
                  current={
                    current >= group.first && current < group.first + group.matches.length
                      ? current
                      : -1
                  }
                  showRepository={repositoriesShown > 1}
                  markColor={colors.match}
                  currentColor={colors.matchCurrent}
                  currentBorder={colors.matchBorder}
                  currentText={colors.matchText}
                  observer={observer}
                  optionId={optionId}
                  onPick={setSelected}
                  onOpen={openLine}
                />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One file of results: excerpts of two lines around each match, merged when
 * they meet, with a gap between excerpts. Lines that are not read yet keep
 * their place, so the results do not move as files load. */
const ResultFile = memo(function ResultFile({
  group,
  loaded,
  current,
  showRepository,
  markColor,
  currentColor,
  currentBorder,
  currentText,
  observer,
  optionId,
  onPick,
  onOpen,
}: {
  group: Group;
  loaded: Loaded | undefined;
  /** The chosen match, when it is in this file; else -1. */
  current: number;
  showRepository: boolean;
  markColor: string;
  currentColor: string;
  currentBorder: string;
  currentText: string | null;
  observer: IntersectionObserver | undefined;
  optionId(index: number): string;
  onPick(index: number): void;
  onOpen(group: Group, line: number): void;
}) {
  const section = useRef<HTMLElement>(null);
  useEffect(() => {
    const node = section.current;
    if (!node || !observer) return;
    observer.observe(node);
    return () => observer.unobserve(node);
  }, [observer]);
  // A working file read before it changed waits for its next read.
  const lines = loaded?.lines && agrees(loaded.lines, group.matches) ? loaded.lines : undefined;
  const highlighted = lines && loaded?.code;
  const hits = new Map(group.matches.map((match, index) => [match.line, group.first + index]));
  const width = `${String(group.matches.at(-1)!.line + 2).length + 1}ch`;
  const slash = group.path.lastIndexOf("/") + 1;
  return (
    <section
      ref={section}
      data-search-file={group.key}
      data-highlighted={highlighted ? "" : undefined}
      role="group"
      aria-label={`${group.repository.name} ${group.path}`}
      {...stylex.props(styles.file, group.stale && styles.stale)}
    >
      <h2 {...stylex.props(styles.fileHead)}>
        {showRepository && (
          <span {...stylex.props(styles.repository)}>{group.repository.name}</span>
        )}
        <span {...stylex.props(styles.path)}>
          <span {...stylex.props(styles.folder)}>{group.path.slice(0, slash)}</span>
          {group.path.slice(slash)}
        </span>
        <span {...stylex.props(styles.count)}>{group.matches.length}</span>
      </h2>
      {excerpts(
        group.matches.map((match) => match.line),
        lines?.length,
      ).map((excerpt, place) => (
        <div key={excerpt.start} {...stylex.props(styles.excerpt, place > 0 && styles.excerptGap)}>
          {Array.from({ length: excerpt.end - excerpt.start + 1 }, (_, offset) => {
            const line = excerpt.start + offset;
            const index = hits.get(line);
            const match = index === undefined ? undefined : group.matches[index - group.first];
            const text = lines?.[line - 1] ?? match?.text;
            const runs: Token[] | undefined =
              text === undefined
                ? undefined
                : ((highlighted ? tokensOf(highlighted[line - 1], text) : undefined) ?? [{ text }]);
            const chosen = index !== undefined && index === current;
            const code = (
              <code {...stylex.props(styles.text)}>
                {runs ? (
                  <Runs
                    parts={pieces(
                      runs,
                      match ? occurrences(text!, group.query, group.matchCase) : [],
                    )}
                    // The file view's colors for find matches, and for the current one.
                    mark={stylex.props(
                      styles.mark,
                      styles.markFill(chosen ? currentColor : markColor),
                      chosen && styles.markCurrent(currentBorder),
                      chosen && currentText !== null && styles.markText(currentText),
                    )}
                  />
                ) : (
                  " "
                )}
              </code>
            );
            const number = (
              <span {...stylex.props(styles.number, styles.numberWidth(width))}>{line}</span>
            );
            if (index === undefined)
              return (
                // A context line opens the file at that line; the arrows skip it.
                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
                <div
                  key={line}
                  aria-hidden="true"
                  onClick={() => onOpen(group, line)}
                  {...stylex.props(styles.line, styles.context)}
                >
                  {number}
                  {code}
                </div>
              );
            return (
              // The query field takes the keys and names the chosen line.
              // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
              <div
                key={line}
                id={optionId(index)}
                role="option"
                tabIndex={-1}
                aria-selected={chosen}
                onPointerMove={() => !chosen && onPick(index)}
                onClick={() => onOpen(group, line)}
                {...stylex.props(styles.line, chosen && [styles.lineSelected, picked])}
              >
                {number}
                {code}
              </div>
            );
          })}
        </div>
      ))}
    </section>
  );
});

/** A line's runs, each in its syntax color, with each match marked. */
function Runs({ parts, mark }: { parts: Piece[]; mark: ReturnType<typeof stylex.props> }) {
  const nodes: ReactNode[] = [];
  const run = (part: Piece, key: number) =>
    part.color ? (
      <span key={key} style={{ color: part.color }}>
        {part.text}
      </span>
    ) : (
      part.text
    );
  for (let at = 0; at < parts.length;) {
    const part = parts[at]!;
    if (part.mark < 0) {
      nodes.push(run(part, at++));
      continue;
    }
    const start = at;
    const marked: ReactNode[] = [];
    while (at < parts.length && parts[at]!.mark === part.mark) marked.push(run(parts[at]!, at++));
    nodes.push(
      <mark key={`mark-${start}`} {...mark}>
        {marked}
      </mark>,
    );
  }
  return <>{nodes}</>;
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
          <kbd {...stylex.props(styles.code)}>⌥C</kbd>
        </dt>
        <dd {...stylex.props(styles.syntaxText)}>Match case, or match in any case.</dd>
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
    paddingInlineEnd: 40,
    fontFamily: tokens.code,
    fontSize: 13,
  },
  // The options sit inside the field's end, as in VS Code and Zed.
  option: {
    position: "absolute",
    insetInlineEnd: { default: 22, [narrow]: 14 },
    height: 22,
    minWidth: 26,
    paddingInline: 4,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "transparent",
    borderRadius: `calc(5px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    fontFamily: tokens.ui,
    fontSize: 11.5,
    fontWeight: 500,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  optionOn: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft },
    borderColor: tokens.accentLine,
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
  excerpt: { paddingBlock: 3 },
  // Lines skipped between two excerpts of one file.
  excerptGap: {
    borderTopWidth: 1,
    borderTopStyle: "dashed",
    borderTopColor: tokens.line,
  },
  line: {
    display: "flex",
    gap: 12,
    paddingInline: 10,
    cursor: "pointer",
    fontFamily: tokens.code,
    fontSize: 12,
    lineHeight: "20px",
    tabSize: 2,
  },
  context: { opacity: { default: 0.7, ":hover": 1 } },
  lineSelected: { backgroundColor: tokens.pick },
  number: {
    flexShrink: 0,
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
  mark: { color: "inherit", borderRadius: 2 },
  markFill: (backgroundColor: string) => ({ backgroundColor }),
  markCurrent: (textDecorationColor: string) => ({
    textDecorationLine: "underline",
    textDecorationThickness: 2,
    textDecorationColor,
    textUnderlineOffset: 3,
  }),
  markText: (color: string) => ({ color }),
  numberWidth: (minWidth: string) => ({ minWidth }),
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
