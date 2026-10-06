import { ShortcutKeys } from "./ShortcutKeys";
import { focusPaletteInput, visibleElement } from "../data/palette-focus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Combobox } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import type { BrowseEntry, BrowseSource } from "../../shared/browse";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import { FullFileView } from "./FullFileView";
import { browseSourceKey, useBrowseFiles, type BrowseApi } from "../data/browse";
import { usePickerPreview, type FilePreviewReader } from "../data/picker-preview";
import type { BrowseSearch } from "../../shared/inspect";

import type { RegisteredRepository } from "../../shared/protocol";
import { isTestFile, matchesFileFilters, parsePickerFilters } from "../data/file-filters";

type RepositoryScope = { id: string; name: string; path: string; source: BrowseSource };
export interface FilePickerProps {
  repositories?: RegisteredRepository[];
  repositoryScopes?: RepositoryScope[];
  scopedRepository?: RepositoryScope;
  onRepository?(scope?: RepositoryScope, query?: string): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  entries: BrowseEntry[];
  loading: boolean;
  error: string | null;
  sourceLabel: string;
  onOpen(path: string, line?: number, source?: BrowseSource): void;
  source?: BrowseSource | null;
  api?: BrowseApi;
  sourceRevision?: number | string;
  previewReader?: FilePreviewReader;
  openPaths?: string[];
  recentPaths?: string[];
  initialMode?: "files" | "content";
  initialQuery?: string;
  resume?: boolean;
}

export function parseFileQuery(query: string): { text: string; line?: number } {
  const match = /^(.*?):([1-9]\d*)(?::[1-9]\d*)?$/.exec(query.trim());
  if (!match || !Number.isSafeInteger(Number(match[2]))) return { text: query.trim() };
  return { text: match[1]!, line: Number(match[2]) };
}

function matchScore(path: string, query: string): number {
  if (!query) return 0;
  const smartCase = query !== query.toLowerCase();
  const value = smartCase ? path : path.toLowerCase();
  const name = value.slice(value.lastIndexOf("/") + 1);
  if (name === query) return 10_000;
  if (name.startsWith(query)) return 8_000 - name.length;
  const direct = name.indexOf(query);
  if (direct >= 0) return 6_000 - direct - name.length;
  if (value.includes(query)) return 4_000 - value.length;
  let cursor = 0;
  let gap = 0;
  for (const character of query) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return -Infinity;
    gap += index - cursor;
    cursor = index + 1;
  }
  return 2_000 - gap - value.length;
}

export function findFiles(
  entries: BrowseEntry[],
  query: string,
  openPaths: string[] = [],
  recentPaths: string[] = [],
  filters?: ReturnType<typeof parsePickerFilters>,
): BrowseEntry[] {
  const { text } = parseFileQuery(query);
  // Keep only the best 50 entries while scanning; never sort or mount the full repository.
  const opened = new Set(openPaths);
  const recent = new Map(recentPaths.map((path, index) => [path, Math.max(0, 100 - index)]));
  const best: { entry: BrowseEntry; score: number }[] = [];
  for (const entry of entries) {
    if (entry.kind === "directory" || (filters && !matchesFileFilters(entry.path, filters)))
      continue;
    const score =
      matchScore(entry.path, text) +
      (opened.has(entry.path) ? 200 : 0) +
      (recent.get(entry.path) ?? 0);
    if (score === -Infinity) continue;
    if (best.length === 50 && score <= best[49]!.score) continue;
    let index = best.findIndex((candidate) => candidate.score < score);
    if (index === -1) index = best.length;
    best.splice(index, 0, { entry, score });
    if (best.length > 50) best.pop();
  }
  return best.map(({ entry }) => entry);
}

type PickerMode = "files" | "content";
type PickerResult = {
  id: string;
  path: string;
  line?: number;
  text?: string;
  repository?: RepositoryScope;
};
type PickerSession = { query: string; selected: string | null; scroll: Map<string, number> };
const emptyPaths: string[] = [];

export function FilePicker(props: FilePickerProps) {
  const [scopeQuery, setScopeQuery] = useState<string>();
  const [repository, setRepository] = useState<RepositoryScope>();
  const [previousOpen, setPreviousOpen] = useState(props.open);
  if (previousOpen !== props.open) {
    setPreviousOpen(props.open);
    setScopeQuery(undefined);
    if (props.open && !props.resume) setRepository(undefined);
  }
  const repositoryScopes = useMemo(
    () =>
      (props.repositories ?? []).flatMap((repo) => {
        if (repo.error) return [];
        const paths = [
          ...new Set([
            repo.path,
            ...repo.worktrees.filter((tree) => !tree.bare).map((tree) => tree.path),
          ]),
        ];
        return paths.map((path) => ({
          id: `${repo.id}:${path}`,
          name: repo.name,
          path,
          source: { kind: "worktree" as const, repo: path },
        }));
      }),
    [props.repositories],
  );
  const selectedRepository = repositoryScopes.find((entry) => entry.id === repository?.id);
  const remote =
    !!selectedRepository &&
    (!props.source || browseSourceKey(selectedRepository.source) !== browseSourceKey(props.source));
  const files = useBrowseFiles(
    remote ? selectedRepository.source : null,
    props.open && remote,
    props.sourceRevision,
    { api: props.api },
  );
  const effective = selectedRepository
    ? {
        ...props,
        source: remote ? selectedRepository.source : props.source,
        sourceLabel: selectedRepository.path,
        ...(remote
          ? {
              entries: files.entries,
              loading: files.loading,
              error: files.error,
              openPaths: [],
              recentPaths: [],
              previewReader: undefined,
            }
          : {}),
      }
    : props;
  const [sessions] = useState(() => new Map<string, PickerSession>());
  const [lastModes] = useState(() => new Map<string, PickerMode>());
  const scope = effective.source ? browseSourceKey(effective.source) : effective.sourceLabel;
  const rememberMode = useCallback(
    (next: PickerMode) => {
      lastModes.delete(scope);
      lastModes.set(scope, next);
      while (lastModes.size > 8) lastModes.delete(lastModes.keys().next().value!);
    },
    [lastModes, scope],
  );
  const mode = (props.resume ? lastModes.get(scope) : undefined) ?? props.initialMode ?? "files";
  return props.open ? (
    <PickerSessionView
      key={`${scope}:${mode}:${selectedRepository?.id ?? "current"}`}
      {...effective}
      repositoryScopes={repositoryScopes}
      scopedRepository={selectedRepository}
      onRepository={(scope, query) => {
        setScopeQuery(query ?? "");
        setRepository(scope);
      }}
      initialQuery={scopeQuery ?? effective.initialQuery}
      initialMode={mode}
      scope={scope}
      sessions={sessions}
      onModeChange={rememberMode}
    />
  ) : null;
}

function PickerSessionView({
  repositoryScopes,
  scopedRepository,
  onRepository,
  open,
  onOpenChange,
  entries,
  loading,
  error,
  sourceLabel,
  onOpen,
  source,
  api,
  sourceRevision = 0,
  previewReader,
  openPaths = emptyPaths,
  recentPaths = emptyPaths,
  initialMode = "files",
  initialQuery,
  scope,
  sessions,
  onModeChange,
}: FilePickerProps & {
  scope: string;
  sessions: Map<string, PickerSession>;
  onModeChange(mode: PickerMode): void;
}) {
  const [mode, setMode] = useState<PickerMode>(initialMode);
  const [selectionQuery, setSelectionQuery] = useState(initialQuery);
  useEffect(() => onModeChange(initialMode), [initialMode, onModeChange]);
  const sessionKey = `${scope}:${mode}`;
  const session = useMemo(() => {
    const saved = sessions.get(sessionKey) ?? {
      query: "",
      selected: null,
      scroll: new Map<string, number>(),
    };
    sessions.delete(sessionKey);
    sessions.set(sessionKey, saved);
    while (sessions.size > 16) sessions.delete(sessions.keys().next().value!);
    return saved;
  }, [sessions, sessionKey]);
  return (
    <PickerContents
      key={sessionKey}
      onSave={(patch) => sessions.set(sessionKey, { ...sessions.get(sessionKey)!, ...patch })}
      {...{
        repositoryScopes,
        scopedRepository,
        onRepository,
        open,
        onOpenChange,
        entries,
        loading,
        error,
        sourceLabel,
        onOpen,
        source,
        api,
        sourceRevision,
        previewReader,
        openPaths,
        recentPaths,
        mode,
        initialQuery: selectionQuery,
        setMode: (next: PickerMode) => {
          setSelectionQuery(undefined);
          setMode(next);
          onModeChange(next);
        },
        session,
      }}
    />
  );
}

function PickerContents({
  repositoryScopes = [],
  scopedRepository,
  onRepository,
  open,
  onOpenChange,
  entries,
  loading,
  error,
  sourceLabel,
  onOpen,
  source,
  api,
  sourceRevision = 0,
  previewReader,
  openPaths = emptyPaths,
  recentPaths = emptyPaths,
  mode,
  setMode,
  session,
  initialQuery,
  onSave,
}: FilePickerProps & {
  mode: PickerMode;
  setMode(mode: PickerMode): void;
  session: PickerSession;
  onSave(patch: Partial<PickerSession>): void;
}) {
  const [query, setQuery] = useState(initialQuery ?? session.query);
  const filters = useMemo(
    () =>
      mode === "files" ? parsePickerFilters(query) : { text: query, kinds: [], extensions: [] },
    [query, mode],
  );
  const [repositoryMode, setRepositoryMode] = useState(false);
  const repoMatches = useMemo(() => {
    if (mode !== "files" || scopedRepository || (!filters.text && !repositoryMode)) return [];
    return repositoryScopes
      .map((repository) => ({
        repository,
        score: Math.max(
          matchScore(repository.name, filters.text),
          matchScore(repository.path, filters.text),
        ),
      }))
      .filter((entry) => entry.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ repository }) => ({
        id: `repo:${repository.id}`,
        path: repository.path,
        repository,
      }));
  }, [repositoryScopes, scopedRepository, filters.text, repositoryMode, mode]);
  const [selected, setSelected] = useState(initialQuery === undefined ? session.selected : null);
  const [restoreId, setRestoreId] = useState(initialQuery === undefined ? session.selected : null);
  const [refresh, setRefresh] = useState(0);
  const updateQuery = (value: string) => {
    setQuery(value);
    onSave({ query: value, selected: null });
    setSelected(null);
    setRestoreId(null);
  };
  const inputRef = useRef<HTMLInputElement>(null);
  const sourceKey = source ? browseSourceKey(source) : "";
  const searchScope = JSON.stringify([sourceKey, sourceRevision]);
  const searchKey = JSON.stringify([searchScope, query]);
  const [search, setSearch] = useState<{
    key: string;
    scope: string;
    result?: BrowseSearch;
    error?: string;
  }>({ key: "", scope: "" });
  useEffect(() => {
    if (mode !== "content" || !source || !api?.search || !filters.text.trim()) return;
    const controller = new AbortController();
    void api
      .search(source, filters.text, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSearch({ key: searchKey, scope: searchScope, result });
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setSearch({
            key: searchKey,
            scope: searchScope,
            error: cause instanceof Error ? cause.message : "Search failed.",
          });
      });
    return () => controller.abort();
  }, [mode, sourceKey, source, api, filters.text, searchKey, searchScope]);
  // Keep the last result and its commit preview while this source's next query runs.
  const displayedSearch =
    mode === "content" && query.trim() && search.scope === searchScope ? search.result : undefined;
  const results = useMemo<PickerResult[]>(() => {
    const matches =
      mode === "files"
        ? findFiles(entries, filters.text, openPaths, recentPaths, filters).map((entry) => ({
            id: entry.path,
            path: entry.path,
            line: parseFileQuery(filters.text).line,
          }))
        : (displayedSearch?.matches ?? [])
            .slice(0, 200)
            .map((match) => ({ ...match, id: `${match.path}:${match.line}` }));
    // Place the previously selected result first on resume. Base UI owns keyboard highlight.
    const index = matches.findIndex((entry) => entry.id === restoreId);
    if (index > 0) matches.unshift(matches.splice(index, 1)[0]!);
    return [...repoMatches, ...matches.filter((entry) => matchesFileFilters(entry.path, filters))];
  }, [entries, filters, openPaths, recentPaths, mode, displayedSearch, restoreId, repoMatches]);
  const selectedResult = results.find((entry) => entry.id === selected) ?? results[0];
  const fileCount = results.length - repoMatches.length;
  const currentSearch = search.key === searchKey ? search.result : undefined;
  const resultSource = displayedSearch?.resultSource;
  const previewSource = resultSource ?? source;
  const previewSourceKey = previewSource ? browseSourceKey(previewSource) : "";
  const previewScrollKey = JSON.stringify([previewSourceKey, selectedResult?.id]);
  const preview = usePickerPreview(
    api,
    previewSource,
    selectedResult?.repository ? undefined : selectedResult?.path,
    `${sourceRevision}:${refresh}`,
    previewReader,
  );
  const busy =
    mode === "files" ? loading : !!query.trim() && search.key !== searchKey && !!api?.search;
  const failure = mode === "files" ? error : search.key === searchKey ? search.error : null;
  const accepted = useRef(false);
  const selectRepository = (repository?: RepositoryScope) =>
    onRepository?.(
      repository,
      query
        .match(/(?:^|\s)(?:type:(?:code|tests|docs)|ext:[a-z0-9,+.-]+)(?=\s|$)/gi)
        ?.map((token) => token.trim())
        .join(" ")
        .trim() ?? "",
    );
  const choose = (entry: PickerResult) => {
    if (entry.repository) {
      selectRepository(entry.repository);
      return;
    }
    if (busy || failure) return;
    accepted.current = true;
    if (resultSource) onOpen(entry.path, entry.line, resultSource);
    else if (source && scopedRepository) onOpen(entry.path, entry.line, source);
    else onOpen(entry.path, entry.line);
    onOpenChange(false);
  };
  return (
    <Combobox.Root<PickerResult>
      inline
      open={open}
      onOpenChange={onOpenChange}
      items={results}
      filter={null}
      value={null}
      inputValue={query}
      onInputValueChange={(value, details) => {
        if (details.reason !== "input-change" && details.reason !== "input-clear") return;
        setQuery(value);
        onSave({ query: value, selected: null });
        setRestoreId(null);
        setSelected(null);
      }}
      itemToStringLabel={(entry) => entry.path}
      autoHighlight
      onItemHighlighted={(entry) => {
        if (entry) {
          setSelected(entry.id);
          onSave({ selected: entry.id });
        }
      }}
      onValueChange={(entry) => {
        if (entry) choose(entry);
      }}
    >
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop {...stylex.props(ui.scrim, styles.backdrop, ui.instant)} />
          <Dialog.Popup
            initialFocus={() => focusPaletteInput(inputRef.current)}
            finalFocus={() =>
              accepted.current ? (visibleElement('[data-file-pane="main"]') ?? false) : true
            }
            {...stylex.props(styles.popup, ui.instant)}
          >
            <div {...stylex.props(styles.heading)}>
              <Dialog.Title {...stylex.props(styles.title)}>
                {mode === "files" ? "Find file" : "Search files"}
              </Dialog.Title>
              {repositoryScopes.length && !scopedRepository ? (
                <button
                  type="button"
                  {...stylex.props(ui.button, styles.scope, repositoryMode && styles.scopeOpen)}
                  title="Search another registered repository"
                  aria-label="Choose repository"
                  aria-pressed={repositoryMode}
                  onClick={() => {
                    setRepositoryMode((value) => !value);
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                >
                  <span {...stylex.props(styles.scopeText)}>{sourceLabel}</span>
                  <Icon name="chevron" size={14} />
                </button>
              ) : (
                <span {...stylex.props(styles.scope, styles.scopeStatic)} title={sourceLabel}>
                  <span {...stylex.props(styles.scopeText)}>{sourceLabel}</span>
                </span>
              )}
              {api?.search && (
                <div {...stylex.props(styles.modes)} role="group" aria-label="Search mode">
                  <button
                    {...stylex.props(
                      ui.button,
                      styles.mode,
                      mode === "files" && styles.selectedMode,
                    )}
                    aria-pressed={mode === "files"}
                    onClick={() => setMode("files")}
                  >
                    Files
                  </button>
                  <button
                    {...stylex.props(
                      ui.button,
                      styles.mode,
                      mode === "content" && styles.selectedMode,
                    )}
                    aria-pressed={mode === "content"}
                    onClick={() => setMode("content")}
                  >
                    Content
                  </button>
                </div>
              )}
              <Dialog.Close
                aria-label="Close file picker"
                {...stylex.props(ui.button, styles.close)}
              >
                <ShortcutKeys value="Esc" />
              </Dialog.Close>
            </div>
            <Dialog.Description {...stylex.props(styles.hidden)}>
              Preview files in this source. Arrow keys select; Enter opens; Escape keeps your
              current file.
            </Dialog.Description>
            <div {...stylex.props(styles.search)}>
              <Icon name="search" />
              {scopedRepository && (
                <button
                  type="button"
                  {...stylex.props(styles.token)}
                  title={`${scopedRepository.path}\nBackspace in an empty query returns to the current repository`}
                  aria-label="Back to current repository"
                  onClick={() => {
                    selectRepository();
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name="branch" size={13} />
                  <span {...stylex.props(styles.tokenName)}>{scopedRepository.name}</span>
                  <span aria-hidden="true" {...stylex.props(styles.tokenClose)}>
                    <Icon name="close" size={12} />
                  </span>
                </button>
              )}
              <Combobox.Input
                ref={inputRef}
                onFocus={(event) => event.currentTarget.select()}
                aria-label={mode === "files" ? "Find file" : "Search file contents"}
                placeholder={
                  mode === "files"
                    ? scopedRepository
                      ? `Find a file in ${scopedRepository.name}`
                      : "Find a file, or type a repository and press Tab"
                    : "Search committed text"
                }
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Tab" && !event.shiftKey && repoMatches.length) {
                    event.preventDefault();
                    event.preventBaseUIHandler();
                    selectRepository(selectedResult?.repository ?? repoMatches[0]!.repository);
                    return;
                  }
                  if (event.key === "Backspace" && !query && scopedRepository) {
                    event.preventDefault();
                    event.preventBaseUIHandler();
                    selectRepository();
                    return;
                  }
                  if (
                    event.key === "Enter" &&
                    busy &&
                    !selectedResult?.repository &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.preventBaseUIHandler();
                    return;
                  }
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    (!busy || !!selectedResult?.repository) &&
                    (!failure || !!selectedResult?.repository) &&
                    selectedResult
                  ) {
                    event.preventDefault();
                    event.preventBaseUIHandler();
                    choose(selectedResult);
                  }
                }}
                {...stylex.props(styles.input)}
              />
            </div>
            {mode === "files" && (
              <div {...stylex.props(styles.filters)} role="group" aria-label="File filters">
                {(["code", "tests", "docs"] as const).map((kind) => (
                  <button
                    key={kind}
                    {...stylex.props(
                      ui.button,
                      styles.chip,
                      filters.kinds.includes(kind) && styles.chipOn,
                    )}
                    aria-pressed={filters.kinds.includes(kind)}
                    onClick={() => {
                      const next = filters.kinds.includes(kind)
                        ? query
                            .replace(new RegExp(`(?:^|\\s)type:${kind}(?=\\s|$)`, "gi"), " ")
                            .trim()
                        : `${query} type:${kind}`.trim();
                      updateQuery(next);
                      inputRef.current?.focus();
                    }}
                  >
                    {kind[0]!.toUpperCase() + kind.slice(1)}
                  </button>
                ))}
                {filters.extensions.map((ext) => (
                  <button
                    key={ext}
                    {...stylex.props(ui.button, styles.chip, styles.chipOn, styles.extension)}
                    aria-label={`Remove .${ext} filter`}
                    onClick={() => {
                      updateQuery(
                        [
                          filters.text,
                          ...filters.kinds.map((kind) => `type:${kind}`),
                          ...filters.extensions
                            .filter((value) => value !== ext)
                            .map((value) => `ext:${value}`),
                        ]
                          .filter(Boolean)
                          .join(" "),
                      );
                      inputRef.current?.focus();
                    }}
                  >
                    .{ext}
                    <Icon name="close" size={12} />
                  </button>
                ))}
                {(filters.kinds.length > 0 || filters.extensions.length > 0) && (
                  <button
                    {...stylex.props(ui.button, styles.clear)}
                    onClick={() => {
                      updateQuery(filters.text);
                      inputRef.current?.focus();
                    }}
                  >
                    Clear filters
                  </button>
                )}
                {!filters.kinds.length && !filters.extensions.length && (
                  <span {...stylex.props(styles.filterHint)}>
                    or type <code {...stylex.props(styles.syntax)}>type:tests</code>{" "}
                    <code {...stylex.props(styles.syntax)}>ext:java,kt</code>
                  </span>
                )}
              </div>
            )}
            {mode === "content" && (
              <p {...stylex.props(styles.searchNotice)}>
                Committed files · uncommitted changes excluded
                {resultSource?.kind === "commit" && ` · ${resultSource.oid.slice(0, 8)}`}
                {displayedSearch?.engine &&
                  ` · ${displayedSearch.engine === "zoekt" ? "Zoekt" : "Git search"}`}
                {displayedSearch?.index?.state === "indexing" && " · Index updating"}
              </p>
            )}
            <div {...stylex.props(styles.body)}>
              <div {...stylex.props(styles.results)} aria-busy={busy}>
                {failure ? (
                  <p role="alert" {...stylex.props(styles.message)}>
                    {failure}
                  </p>
                ) : (
                  <>
                    {!busy && (
                      <Combobox.Empty>
                        <div {...stylex.props(styles.message)}>
                          {mode === "content" && !query.trim()
                            ? "Type text to search the selected commit."
                            : "No matching files."}
                        </div>
                      </Combobox.Empty>
                    )}
                    <Combobox.List aria-label="Files" {...stylex.props(styles.list)}>
                      {(entry: PickerResult) => {
                        const slash = entry.path.lastIndexOf("/");
                        return (
                          <Combobox.Item
                            key={entry.id}
                            value={entry}
                            disabled={busy && !entry.repository}
                            aria-label={
                              entry.repository
                                ? `Repository ${entry.repository.name} · ${entry.path}`
                                : undefined
                            }
                            className={(state) =>
                              stylex.props(
                                styles.item,
                                (state.highlighted ||
                                  (!selected && selectedResult?.id === entry.id)) &&
                                  styles.highlighted,
                              ).className
                            }
                          >
                            <span
                              aria-hidden="true"
                              title={
                                entry.repository
                                  ? "Repository"
                                  : isTestFile(entry.path)
                                    ? "Test file"
                                    : "File"
                              }
                            >
                              <Icon
                                name={
                                  entry.repository
                                    ? "branch"
                                    : isTestFile(entry.path)
                                      ? "testFile"
                                      : "file"
                                }
                                size={14}
                              />
                            </span>
                            <span {...stylex.props(styles.itemText)}>
                              <span {...stylex.props(styles.itemTop)}>
                                <span {...stylex.props(styles.name)}>
                                  {entry.repository?.name ?? entry.path.slice(slash + 1)}
                                  {mode === "content" ? `:${entry.line}` : ""}
                                </span>
                                <span {...stylex.props(styles.path)}>
                                  {entry.repository
                                    ? entry.path
                                    : slash >= 0
                                      ? entry.path.slice(0, slash)
                                      : ""}
                                </span>
                              </span>
                              {entry.text !== undefined && (
                                <span {...stylex.props(styles.snippet)}>{entry.text}</span>
                              )}
                            </span>
                            {entry.repository && <ShortcutKeys value="Tab" />}
                            {!entry.repository &&
                              mode === "files" &&
                              (openPaths.includes(entry.path) ? (
                                <span {...stylex.props(styles.label)}>Open</span>
                              ) : recentPaths.includes(entry.path) ? (
                                <span {...stylex.props(styles.label)}>Recent</span>
                              ) : null)}
                          </Combobox.Item>
                        );
                      }}
                    </Combobox.List>
                  </>
                )}
              </div>
              {((api && source) || previewReader) && (
                <div {...stylex.props(styles.preview)} aria-label="File preview">
                  {selectedResult && !selectedResult.repository ? (
                    <FullFileView
                      key={`${previewSourceKey}:${selectedResult.path}`}
                      compact
                      {...preview}
                      sourceLabel={
                        resultSource?.kind === "commit"
                          ? `Commit ${resultSource.oid.slice(0, 8)}`
                          : sourceLabel
                      }
                      line={selectedResult.line}
                      highlightQuery={displayedSearch?.query}
                      initialScrollTop={session.scroll.get(previewScrollKey)}
                      onScrollPosition={(top) => {
                        session.scroll.delete(previewScrollKey);
                        session.scroll.set(previewScrollKey, top);
                        while (session.scroll.size > 50)
                          session.scroll.delete(session.scroll.keys().next().value!);
                      }}
                      onRefresh={() => setRefresh((value) => value + 1)}
                    />
                  ) : selectedResult?.repository ? (
                    <div {...stylex.props(styles.repositoryPreview)}>
                      <Icon name="branch" size={18} />
                      <p {...stylex.props(styles.repositoryName)}>
                        {selectedResult.repository.name}
                      </p>
                      <p {...stylex.props(styles.repositoryPath)}>
                        {selectedResult.repository.path}
                      </p>
                      <p {...stylex.props(styles.repositoryHint)}>
                        Press <ShortcutKeys value="Tab" /> to search its files. Filters stay.
                      </p>
                    </div>
                  ) : (
                    <p {...stylex.props(styles.message)}>Select a file to preview.</p>
                  )}
                </div>
              )}
            </div>
            {mode === "content" && search.key === searchKey && search.result?.reason && (
              <p role="status" {...stylex.props(styles.searchNotice)}>
                {search.result.reason}
              </p>
            )}
            {mode === "content" && currentSearch?.index?.message && (
              <p {...stylex.props(styles.searchNotice)}>{currentSearch.index.message}</p>
            )}
            <div {...stylex.props(styles.footer)}>
              <span {...stylex.props(styles.hints)}>
                <span {...stylex.props(styles.hint)}>
                  <ShortcutKeys value="↑ ↓" /> Select
                </span>
                {selectedResult?.repository ? (
                  <span {...stylex.props(styles.hint)}>
                    <ShortcutKeys value="↵" /> or <ShortcutKeys value="Tab" /> Search{" "}
                    {selectedResult.repository.name}
                  </span>
                ) : (
                  <>
                    <span {...stylex.props(styles.hint)}>
                      <ShortcutKeys value="↵" /> Open
                    </span>
                    {repoMatches.length > 0 && (
                      <span {...stylex.props(styles.hint)}>
                        <ShortcutKeys value="Tab" /> Search {repoMatches[0]!.repository.name}
                      </span>
                    )}
                  </>
                )}
                {scopedRepository && !query && (
                  <span {...stylex.props(styles.hint)}>
                    <ShortcutKeys value="⌫" /> Back to this workspace
                  </span>
                )}
              </span>
              <span>
                {mode === "files"
                  ? fileCount === 50
                    ? "Top 50 matches"
                    : `${fileCount} ${fileCount === 1 ? "file" : "files"}`
                  : `${results.length} matches${displayedSearch?.truncated || (displayedSearch?.matches.length ?? 0) > 200 ? " · more available" : ""}`}
              </span>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Combobox.Root>
  );
}

const styles = stylex.create({
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 4,
    alignItems: "center",
    paddingInline: 12,
    paddingBlock: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  chip: {
    minHeight: 24,
    height: 24,
    paddingInline: 9,
    borderRadius: 12,
    fontSize: 11.5,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  chipOn: {
    color: { default: tokens.accent, ":hover:not(:disabled)": tokens.accent },
    backgroundColor: { default: tokens.accentSoft, ":hover:not(:disabled)": tokens.accentSoft },
    boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${tokens.accent} 30%, transparent)`,
  },
  extension: { gap: 4, paddingInlineEnd: 6, fontFamily: tokens.code, fontSize: 11 },
  clear: { minHeight: 24, height: 24, fontSize: 11.5, color: tokens.faint },
  filterHint: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    marginLeft: "auto",
    color: tokens.faint,
    fontSize: 11,
  },
  syntax: {
    paddingInline: 4,
    borderRadius: 4,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10.5,
    lineHeight: "16px",
  },
  backdrop: { zIndex: 110 },
  popup: {
    position: "fixed",
    top: "10vh",
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(1120px, calc(100vw - 32px))",
    height: "min(680px, 80vh)",
    maxHeight: "80vh",
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.raised,
    color: tokens.text,
    fontFamily: tokens.ui,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.lineStrong,
    boxShadow: tokens.shadow,
    zIndex: 111,
    overflow: "hidden",
    outline: "none",
  },
  heading: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 44,
    paddingInlineStart: 16,
    paddingInlineEnd: 10,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  title: { fontSize: 12.5, fontWeight: 550, margin: 0, whiteSpace: "nowrap" },
  scope: {
    gap: 4,
    justifyContent: "flex-start",
    minWidth: 0,
    maxWidth: "48%",
    paddingInlineEnd: 5,
    color: tokens.muted,
    fontSize: 12,
  },
  scopeOpen: { color: tokens.text, backgroundColor: tokens.fill },
  scopeStatic: {
    display: "inline-flex",
    alignItems: "center",
    paddingInline: 8,
    color: tokens.faint,
  },
  scopeText: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  scopeName: { flexShrink: 0, color: tokens.text, fontSize: 12 },
  close: { fontSize: 10, color: tokens.faint, marginInlineStart: 2 },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 48,
    paddingInline: 16,
    color: tokens.faint,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  // The repository scope reads as part of the query: Backspace removes it.
  token: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    maxWidth: "40%",
    height: 26,
    paddingInlineStart: 8,
    paddingInlineEnd: 4,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft },
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 12.5,
    fontWeight: 500,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  tokenName: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  tokenClose: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: 4,
    opacity: { default: 0.6, ":hover": 1 },
  },
  input: {
    flex: "1",
    minWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    borderWidth: 0,
    outline: "none",
    fontFamily: tokens.ui,
    fontSize: 14,
    "::placeholder": { color: tokens.faint },
  },
  list: { overflowY: "auto", minHeight: 0, flex: "1", padding: 6 },
  item: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    minHeight: 34,
    paddingBlock: 6,
    paddingInline: 10,
    boxSizing: "border-box",
    fontSize: 12.5,
    borderRadius: 7,
    color: tokens.muted,
    cursor: "default",
    outline: "none",
  },
  highlighted: { backgroundColor: tokens.fillStrong, color: tokens.text },
  name: {
    flexShrink: 0,
    maxWidth: "100%",
    color: tokens.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  path: {
    flexShrink: 1,
    marginLeft: "auto",
    minWidth: 0,
    color: tokens.faint,
    fontSize: 11.5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  message: { padding: 24, textAlign: "center", color: tokens.muted, fontSize: 12.5 },
  repositoryPreview: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    flex: "1",
    padding: 24,
    color: tokens.faint,
    textAlign: "center",
  },
  repositoryName: { margin: 0, marginTop: 8, color: tokens.text, fontSize: 14, fontWeight: 550 },
  repositoryPath: { margin: 0, fontFamily: tokens.code, fontSize: 11.5, overflowWrap: "anywhere" },
  repositoryHint: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    margin: 0,
    marginTop: 14,
    color: tokens.muted,
    fontSize: 12,
  },
  searchNotice: {
    margin: 0,
    paddingBlock: 6,
    paddingInline: 16,
    color: tokens.faint,
    fontSize: 11.5,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  footer: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    minHeight: 34,
    paddingInline: 16,
    fontSize: 11,
    color: tokens.faint,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
  hints: { display: "inline-flex", alignItems: "center", gap: 14, minWidth: 0 },
  hint: { display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap" },
  body: { display: "flex", flex: "1", minHeight: 0, overflow: "hidden" },
  results: { display: "flex", flexDirection: "column", flex: "1", minWidth: 0, overflow: "hidden" },
  preview: {
    display: { default: "flex", "@media (max-width: 700px)": "none" },
    flexDirection: "column",
    width: "56%",
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: tokens.line,
  },
  modes: {
    display: "flex",
    gap: 2,
    marginLeft: "auto",
    padding: 2,
    borderRadius: 8,
    backgroundColor: tokens.fill,
    boxShadow: `inset 0 0 0 1px ${tokens.line}`,
  },
  mode: { minHeight: 24, height: 24, paddingInline: 10, fontSize: 12, borderRadius: 6 },
  selectedMode: {
    backgroundColor: { default: tokens.raised, ":hover:not(:disabled)": tokens.raised },
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
    boxShadow: `0 0 0 1px ${tokens.lineStrong}, 0 1px 2px #0000001f`,
  },
  itemText: { display: "flex", flexDirection: "column", flex: "1", minWidth: 0, gap: 3 },
  itemTop: { display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 },
  snippet: {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11,
  },
  label: { color: tokens.faint, fontSize: 11, flexShrink: 0 },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
