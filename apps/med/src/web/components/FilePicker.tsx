import { ShortcutKeys } from "./ShortcutKeys";
import { focusPaletteInput, visibleElement } from "../data/palette-focus";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Combobox } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import type { BrowseEntry, BrowseSource } from "../../shared/browse";
import { picked, tokens, ui } from "../theme.stylex";
import { FileIcon } from "./FileIcon";
import { Icon } from "./Icon";
import { FullFileView } from "./FullFileView";
import { Matched, matchRanges, PaletteKeys, PaletteTitle, usePaletteFade } from "./Palette";
import {
  browseSourceKey,
  useBrowseFiles,
  useVaultFiles,
  useVaultsFiles,
  type BrowseApi,
  type Vault,
} from "../data/browse";
import type { TabSource, VaultSource } from "../data/file-workspace";
import { usePickerPreview, type FilePreviewReader } from "../data/picker-preview";
import { setFilePreviewShown, useFilePreviewShown } from "../data/picker-preferences";
import type { BrowseSearch } from "../../shared/inspect";

import type { RegisteredRepository } from "../../shared/protocol";
import {
  isTestFile,
  matchScore,
  matchesFileFilters,
  parsePickerFilters,
} from "../data/file-filters";
import { checkoutName, repositoryLocation } from "../data/checkout-names";

/** A registered worktree, or a vault. Only a worktree's source holds its
 * absolute path: the picker shows and matches the short name and the
 * repository-relative location. */
type RepositoryScope = { id: string; name: string; location: string; source: TabSource };
const isVault = (scope?: RepositoryScope): scope is RepositoryScope & { source: VaultSource } =>
  scope?.source.kind === "vault";
function scopeLabel(scope: RepositoryScope) {
  return checkoutName(scope.name, scope.location);
}
const vaultReaders = new WeakMap<BrowseApi, Map<string, FilePreviewReader>>();
/** One preview reader for each vault, so a preview does not read again on each render. */
function vaultReader(api: BrowseApi | undefined, vault: string) {
  const read = api?.readVault;
  if (!api || !read) return undefined;
  let readers = vaultReaders.get(api);
  if (!readers) vaultReaders.set(api, (readers = new Map()));
  let reader = readers.get(vault);
  if (!reader) {
    reader = { scope: `vault:${vault}`, read: (path, signal) => read(vault, path, signal) };
    readers.set(vault, reader);
  }
  return reader;
}
export interface FilePickerProps {
  repositories?: RegisteredRepository[];
  /** Registered vaults, whose files open in this workspace's tabs. */
  vaults?: readonly Vault[];
  repositoryScopes?: RepositoryScope[];
  scopedRepository?: RepositoryScope;
  onRepository?(scope?: RepositoryScope, query?: string): void;
  open: boolean;
  onOpenChange(open: boolean): void;
  entries: BrowseEntry[];
  loading: boolean;
  error: string | null;
  sourceLabel: string;
  /** Opens the file in its tab. `sourceLabel` names a file from another repository. */
  onOpen(path: string, line?: number, source?: TabSource, sourceLabel?: string): void;
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

/** A vault's files, for the notes that Find file shows beside the files. */
type VaultNotes = { scope: RepositoryScope & { source: VaultSource }; entries: BrowseEntry[] };
const NO_NOTES: VaultNotes[] = [];
const isNote = (entry: BrowseEntry) => /\.(?:md|markdown)$/i.test(entry.path);
/** At most this many notes show beside a repository's files. */
const NOTE_MATCHES = 3;

export function parseFileQuery(query: string): { text: string; line?: number } {
  const match = /^(.*?):([1-9]\d*)(?::[1-9]\d*)?$/.exec(query.trim());
  if (!match || !Number.isSafeInteger(Number(match[2]))) return { text: query.trim() };
  return { text: match[1]!, line: Number(match[2]) };
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
type NoteProps = { vaultNotes?: VaultNotes[]; noteApi?: BrowseApi };
const NO_API: BrowseApi = {} as BrowseApi;
const NO_VAULTS: Vault[] = [];
type PickerResult = {
  id: string;
  path: string;
  line?: number;
  text?: string;
  repository?: RepositoryScope;
  /** A note of this vault, which opens without the Tab step. */
  note?: RepositoryScope & { source: VaultSource };
};
type PickerSession = { query: string; selected: string | null; scroll: Map<string, number> };
const emptyPaths: string[] = [];

export function FilePicker(props: FilePickerProps) {
  const [scopeQuery, setScopeQuery] = useState<string>();
  const [repository, setRepository] = useState<RepositoryScope>();
  const [previousOpen, setPreviousOpen] = useState(props.open);
  // Each opening lists the vaults' files again, for their notes.
  const [opened, setOpened] = useState(props.open ? 1 : 0);
  if (previousOpen !== props.open) {
    setPreviousOpen(props.open);
    setScopeQuery(undefined);
    if (props.open && !props.resume) setRepository(undefined);
    if (props.open) setOpened((count) => count + 1);
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
        return paths.map<RepositoryScope>((path) => ({
          id: `${repo.id}:${path}`,
          name: repo.name,
          location: repositoryLocation(repo.path, path),
          source: { kind: "worktree", repo: path },
        }));
      }),
    [props.repositories],
  );
  const vaultScopes = useMemo(
    () =>
      (props.vaults ?? []).map<RepositoryScope>((vault) => ({
        id: `vault:${vault.id}`,
        name: vault.name,
        location: "",
        source: { kind: "vault", id: vault.id },
      })),
    [props.vaults],
  );
  const scopes = useMemo(
    () => [...repositoryScopes, ...vaultScopes],
    [repositoryScopes, vaultScopes],
  );
  const selectedRepository = scopes.find((entry) => entry.id === repository?.id);
  const vault = isVault(selectedRepository) ? selectedRepository : undefined;
  const otherSource: BrowseSource | null =
    selectedRepository && selectedRepository.source.kind !== "vault"
      ? selectedRepository.source
      : null;
  const remote =
    !!otherSource &&
    (!props.source || browseSourceKey(otherSource) !== browseSourceKey(props.source));
  const files = useBrowseFiles(
    remote ? otherSource : null,
    props.open && remote,
    props.sourceRevision,
    { api: props.api },
  );
  const vaultFiles = useVaultFiles(props.api, vault?.source.id, props.open);
  const vaultsFiles = useVaultsFiles(
    props.api ?? NO_API,
    props.vaults ?? NO_VAULTS,
    props.open && props.api && !selectedRepository ? opened : 0,
  );
  const vaultNotes = useMemo(
    () =>
      vaultsFiles.flatMap(({ vault: entry, entries }) => {
        const scope = vaultScopes.find((item) => item.id === `vault:${entry.id}`);
        return isVault(scope) ? [{ scope, entries: entries.filter(isNote) }] : [];
      }),
    [vaultsFiles, vaultScopes],
  );
  const effective = vault
    ? {
        ...props,
        // A vault has no Git source: no content search, and its own preview.
        source: null,
        api: undefined,
        sourceLabel: vault.name,
        entries: vaultFiles.entries,
        loading: vaultFiles.loading,
        error: vaultFiles.error,
        openPaths: [],
        recentPaths: [],
        previewReader: vaultReader(props.api, vault.source.id),
      }
    : selectedRepository
      ? {
          ...props,
          source: remote ? otherSource : props.source,
          sourceLabel: `Working files · ${scopeLabel(selectedRepository)}`,
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
  const mode = vault
    ? "files"
    : ((props.resume ? lastModes.get(scope) : undefined) ?? props.initialMode ?? "files");
  return props.open ? (
    <PickerSessionView
      key={`${scope}:${mode}:${selectedRepository?.id ?? "current"}`}
      {...effective}
      repositoryScopes={scopes}
      scopedRepository={selectedRepository}
      onRepository={(scope, query) => {
        setScopeQuery(query ?? "");
        setRepository(scope);
      }}
      initialQuery={scopeQuery ?? effective.initialQuery}
      vaultNotes={selectedRepository ? NO_NOTES : vaultNotes}
      noteApi={props.api}
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
  vaultNotes,
  noteApi,
}: FilePickerProps &
  NoteProps & {
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
        vaultNotes,
        noteApi,
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
  vaultNotes = NO_NOTES,
  noteApi,
}: FilePickerProps &
  NoteProps & {
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
          matchScore(repository.location, filters.text),
        ),
      }))
      .filter((entry) => entry.score > -Infinity)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8)
      .map(({ repository }) => ({
        id: `repo:${repository.id}`,
        path: repository.location,
        repository,
      }));
  }, [repositoryScopes, scopedRepository, filters.text, repositoryMode, mode]);
  // A note whose name holds each word of the query shows at the top, so a
  // vault's note opens from any workspace without the Tab step.
  const noteMatches = useMemo<PickerResult[]>(() => {
    const words = filters.text.toLowerCase().split(/\s+/).filter(Boolean);
    if (mode !== "files" || scopedRepository || filters.text.trim().length < 2) return [];
    const found: PickerResult[] = [];
    for (const { scope, entries } of vaultNotes)
      for (const entry of findFiles(entries, filters.text)) {
        const name = entry.path.slice(entry.path.lastIndexOf("/") + 1).toLowerCase();
        if (!words.every((word) => name.includes(word))) continue;
        found.push({ id: `note:${scope.id}:${entry.path}`, path: entry.path, note: scope });
        if (found.length === NOTE_MATCHES) return found;
      }
    return found;
  }, [vaultNotes, filters.text, scopedRepository, mode]);
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
    return [
      ...repoMatches,
      ...noteMatches,
      ...matches.filter((entry) => matchesFileFilters(entry.path, filters)),
    ];
  }, [
    entries,
    filters,
    openPaths,
    recentPaths,
    mode,
    displayedSearch,
    restoreId,
    repoMatches,
    noteMatches,
  ]);
  const selectedResult = results.find((entry) => entry.id === selected) ?? results[0];
  // Find file lists the top 50 files; content search, the first 200 matches.
  const fileCount = results.length - repoMatches.length - noteMatches.length;
  const capped =
    mode === "files"
      ? fileCount === 50 && "Top 50 matches · type more to narrow"
      : !!displayedSearch &&
        (displayedSearch.truncated || displayedSearch.matches.length > 200) &&
        `First ${results.length} matches · type more to narrow`;
  const currentSearch = search.key === searchKey ? search.result : undefined;
  const resultSource = displayedSearch?.resultSource;
  const previewSource = resultSource ?? source;
  const previewSourceKey = previewSource ? browseSourceKey(previewSource) : "";
  const previewScrollKey = JSON.stringify([previewSourceKey, selectedResult?.id]);
  const previewShown = useFilePreviewShown();
  const previewAvailable = !!((api && source) || previewReader || noteMatches.length);
  const noteReader = selectedResult?.note
    ? vaultReader(noteApi, selectedResult.note.source.id)
    : undefined;
  const preview = usePickerPreview(
    api,
    previewSource,
    selectedResult?.repository || !previewShown ? undefined : selectedResult?.path,
    `${sourceRevision}:${refresh}`,
    noteReader ?? previewReader,
  );
  const busy =
    mode === "files" ? loading : !!query.trim() && search.key !== searchKey && !!api?.search;
  const failure = mode === "files" ? error : search.key === searchKey ? search.error : null;
  const accepted = useRef(false);
  const withPreview = previewShown && previewAvailable;
  const fade = usePaletteFade<HTMLDivElement>();
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
    if (entry.note) {
      accepted.current = true;
      onOpen(entry.path, undefined, entry.note.source, entry.note.name);
      onOpenChange(false);
      return;
    }
    if (busy || failure) return;
    accepted.current = true;
    if (isVault(scopedRepository))
      onOpen(entry.path, entry.line, scopedRepository.source, scopedRepository.name);
    else if (resultSource) onOpen(entry.path, entry.line, resultSource);
    else if (source && scopedRepository) onOpen(entry.path, entry.line, source, sourceLabel);
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
          <Dialog.Backdrop {...stylex.props(ui.scrim, ui.paletteScrim, ui.instant)} />
          <Dialog.Popup
            initialFocus={() => focusPaletteInput(inputRef.current)}
            finalFocus={() =>
              accepted.current ? (visibleElement('[data-file-pane="main"]') ?? false) : true
            }
            {...stylex.props(ui.palette, withPreview && ui.palettePreview, ui.instant)}
          >
            <PaletteTitle>{mode === "files" ? "Find file" : "Search files"}</PaletteTitle>
            <Dialog.Description {...stylex.props(ui.srOnly)}>
              Preview files in this source. Arrow keys select; Enter opens; Escape keeps your
              current file.
              {repoMatches.length > 0 && " Tab searches the highlighted repository."}
            </Dialog.Description>
            <div {...stylex.props(ui.paletteInput, ui.paletteInputOpen)}>
              <Icon name="search" />
              {scopedRepository && (
                <button
                  type="button"
                  {...stylex.props(styles.token)}
                  title={`${scopeLabel(scopedRepository)}\nBackspace in an empty query returns to the current repository`}
                  aria-label="Back to current repository"
                  onClick={() => {
                    selectRepository();
                    inputRef.current?.focus();
                  }}
                >
                  <Icon name={isVault(scopedRepository) ? "vault" : "branch"} size={13} />
                  <span {...stylex.props(styles.tokenName)}>{scopeLabel(scopedRepository)}</span>
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
                      ? `Find a file in ${scopedRepository.name}…`
                      : "Find a file…"
                    : "Search committed text…"
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
                {...stylex.props(ui.paletteField)}
              />
              {api?.search && (
                <div {...stylex.props(ui.paletteSegments)} role="group" aria-label="Search mode">
                  <button
                    type="button"
                    {...stylex.props(
                      ui.button,
                      ui.paletteSegment,
                      mode === "files" && ui.paletteSegmentOn,
                    )}
                    aria-pressed={mode === "files"}
                    onClick={() => setMode("files")}
                  >
                    Files
                  </button>
                  <button
                    type="button"
                    {...stylex.props(
                      ui.button,
                      ui.paletteSegment,
                      mode === "content" && ui.paletteSegmentOn,
                    )}
                    aria-pressed={mode === "content"}
                    onClick={() => setMode("content")}
                  >
                    Content
                  </button>
                </div>
              )}
              {repositoryScopes.length && !scopedRepository ? (
                <button
                  type="button"
                  {...stylex.props(ui.button, ui.paletteScope, repositoryMode && styles.scopeOpen)}
                  title="Search another registered repository or vault"
                  aria-label="Choose repository"
                  aria-pressed={repositoryMode}
                  onClick={() => {
                    setRepositoryMode((value) => !value);
                    setQuery("");
                    inputRef.current?.focus();
                  }}
                >
                  <span {...stylex.props(ui.truncate)}>{sourceLabel}</span>
                  <Icon name="chevron" size={12} />
                </button>
              ) : (
                !scopedRepository && (
                  <span {...stylex.props(ui.button, ui.paletteScope, styles.scopeStatic)}>
                    <span {...stylex.props(ui.truncate)}>{sourceLabel}</span>
                  </span>
                )
              )}
              {previewAvailable && (
                <button
                  type="button"
                  aria-pressed={previewShown}
                  aria-label="Show preview"
                  title={previewShown ? "Hide the file preview" : "Show the file preview"}
                  // Keep focus and the caret in the query.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => {
                    setFilePreviewShown(!previewShown);
                    inputRef.current?.focus();
                  }}
                  {...stylex.props(
                    ui.button,
                    ui.iconButton,
                    ui.paletteTool,
                    previewShown && styles.toolOn,
                  )}
                >
                  <Icon name="preview" />
                </button>
              )}
            </div>
            {mode === "files" ? (
              <div {...stylex.props(ui.paletteChips)} role="group" aria-label="File filters">
                {(["code", "tests", "docs"] as const).map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    {...stylex.props(
                      ui.button,
                      ui.paletteChip,
                      filters.kinds.includes(kind) && ui.paletteChipOn,
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
                {!scopedRepository &&
                  repositoryScopes.filter(isVault).map((vault) => (
                    <button
                      key={vault.id}
                      type="button"
                      {...stylex.props(ui.button, ui.paletteChip)}
                      title={`Find notes in ${vault.name} only`}
                      onClick={() => {
                        selectRepository(vault);
                        inputRef.current?.focus();
                      }}
                    >
                      <Icon name="vault" size={12} />
                      {vault.name}
                    </button>
                  ))}
                {filters.extensions.map((ext) => (
                  <button
                    key={ext}
                    type="button"
                    {...stylex.props(ui.button, ui.paletteChip, ui.paletteChipOn, styles.extension)}
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
                    type="button"
                    {...stylex.props(ui.button, styles.clear)}
                    onClick={() => {
                      updateQuery(filters.text);
                      inputRef.current?.focus();
                    }}
                  >
                    Clear filters
                  </button>
                )}
                <span {...stylex.props(styles.filterHint)}>
                  {repositoryScopes.length > 0 &&
                    !scopedRepository &&
                    "Tab searches a repository · "}
                  <code {...stylex.props(styles.syntax)}>type:</code>{" "}
                  <code {...stylex.props(styles.syntax)}>ext:</code> filter
                </span>
              </div>
            ) : (
              <p {...stylex.props(ui.paletteChips, styles.searchNotice)}>
                Committed files · uncommitted changes excluded
                {resultSource?.kind === "commit" && ` · ${resultSource.oid.slice(0, 8)}`}
                {displayedSearch?.engine &&
                  ` · ${displayedSearch.engine === "zoekt" ? "Zoekt" : "Git search"}`}
                {displayedSearch?.index?.state === "indexing" && " · Index updating"}
              </p>
            )}
            <div {...stylex.props(styles.body)}>
              <div {...stylex.props(styles.results, withPreview && styles.split)} aria-busy={busy}>
                {failure ? (
                  <p role="alert" {...stylex.props(ui.paletteEmpty)}>
                    {failure}
                  </p>
                ) : (
                  <>
                    {!busy && (
                      <Combobox.Empty>
                        <p {...stylex.props(ui.paletteEmpty)}>
                          {mode === "content" && !query.trim()
                            ? "Type text to search the selected commit."
                            : !filters.text.trim()
                              ? filters.kinds.length || filters.extensions.length
                                ? "No files match the filters."
                                : "No files"
                              : mode === "content"
                                ? `Nothing matches “${filters.text.trim()}”`
                                : `No files match “${filters.text.trim()}”`}
                        </p>
                      </Combobox.Empty>
                    )}
                    <Combobox.List
                      ref={fade}
                      aria-label="Files"
                      {...stylex.props(ui.paletteList, withPreview && ui.paletteListFill)}
                    >
                      {(entry: PickerResult) => {
                        const slash = entry.path.lastIndexOf("/");
                        const name = entry.repository?.name ?? entry.path.slice(slash + 1);
                        const folder = slash >= 0 ? entry.path.slice(0, slash) : "";
                        const aside = entry.repository
                          ? isVault(entry.repository)
                            ? "Vault"
                            : entry.path
                          : entry.note
                            ? [entry.note.name, folder, "Note"].filter(Boolean).join(" · ")
                            : [
                                folder,
                                mode === "files" && openPaths.includes(entry.path)
                                  ? "Open"
                                  : mode === "files" && recentPaths.includes(entry.path)
                                    ? "Recent"
                                    : "",
                              ]
                                .filter(Boolean)
                                .join(" · ");
                        return (
                          <Combobox.Item
                            key={entry.id}
                            value={entry}
                            disabled={busy && !entry.repository && !entry.note}
                            aria-label={
                              entry.repository
                                ? `${isVault(entry.repository) ? "Vault" : "Repository"} ${scopeLabel(entry.repository)}`
                                : undefined
                            }
                            className={(state) =>
                              stylex.props(
                                ui.paletteRow,
                                (state.highlighted ||
                                  (!selected && selectedResult?.id === entry.id)) && [
                                  ui.paletteRowOn,
                                  picked,
                                ],
                              ).className
                            }
                          >
                            <span
                              aria-hidden="true"
                              {...stylex.props(ui.paletteRowIcon)}
                              title={
                                entry.repository
                                  ? isVault(entry.repository)
                                    ? "Vault"
                                    : "Repository"
                                  : entry.note
                                    ? `Note in ${entry.note.name}`
                                    : isTestFile(entry.path)
                                      ? "Test file"
                                      : "File"
                              }
                            >
                              {entry.repository || entry.note ? (
                                <Icon
                                  name={
                                    entry.repository && !isVault(entry.repository)
                                      ? "branch"
                                      : "vault"
                                  }
                                />
                              ) : (
                                // The tree's icon for the file's type, as the tabs show.
                                <FileIcon path={entry.path} />
                              )}
                            </span>
                            <span {...stylex.props(styles.name)}>
                              <Matched
                                text={name}
                                ranges={matchRanges(name, filters.text, mode === "files")}
                              />
                              {mode === "content" ? `:${entry.line}` : ""}
                            </span>
                            {entry.text !== undefined ? (
                              <span {...stylex.props(styles.snippet)}>{entry.text.trim()}</span>
                            ) : (
                              <span {...stylex.props(ui.grow)} />
                            )}
                            {aside && <span {...stylex.props(ui.paletteAside)}>{aside}</span>}
                            {entry.repository && <PaletteKeys value="Tab" />}
                          </Combobox.Item>
                        );
                      }}
                    </Combobox.List>
                    {capped && !busy && <p {...stylex.props(ui.paletteCapped)}>{capped}</p>}
                  </>
                )}
              </div>
              {withPreview && (
                <div {...stylex.props(styles.preview)} aria-label="File preview">
                  {selectedResult && !selectedResult.repository ? (
                    <FullFileView
                      key={`${previewSourceKey}:${selectedResult.path}`}
                      compact
                      {...preview}
                      sourceLabel={
                        selectedResult.note
                          ? selectedResult.note.name
                          : resultSource?.kind === "commit"
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
                      <Icon
                        name={isVault(selectedResult.repository) ? "vault" : "branch"}
                        size={18}
                      />
                      <p {...stylex.props(styles.repositoryName)}>
                        {selectedResult.repository.name}
                      </p>
                      {selectedResult.repository.location && (
                        <p {...stylex.props(styles.repositoryPath)}>
                          {selectedResult.repository.location}
                        </p>
                      )}
                      <p {...stylex.props(styles.repositoryHint)}>
                        Press <ShortcutKeys value="Tab" /> to search its files. Filters stay.
                      </p>
                    </div>
                  ) : (
                    <p {...stylex.props(ui.paletteEmpty)}>Select a file to preview.</p>
                  )}
                </div>
              )}
            </div>
            {mode === "content" && search.key === searchKey && search.result?.reason && (
              <p role="status" {...stylex.props(ui.paletteNotice)}>
                {search.result.reason}
              </p>
            )}
            {mode === "content" && currentSearch?.index?.message && (
              <p {...stylex.props(ui.paletteNotice)}>{currentSearch.index.message}</p>
            )}
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Combobox.Root>
  );
}

const styles = stylex.create({
  extension: { gap: 4, paddingInlineEnd: 6, fontFamily: tokens.code, fontSize: 11 },
  clear: { minHeight: 24, height: 24, paddingInline: 7, fontSize: 12, color: tokens.faint },
  // At the chips' end: Tab, and the filters that typing makes.
  filterHint: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    minWidth: 0,
    marginInlineStart: "auto",
    overflow: "hidden",
    whiteSpace: "nowrap",
    color: tokens.faint,
    fontSize: 11.5,
  },
  syntax: { color: tokens.muted, fontFamily: tokens.code, fontSize: 11 },
  // The chip, open: the list shows the repositories and vaults.
  scopeOpen: {
    backgroundColor: {
      default: `color-mix(in srgb, ${tokens.text} 11%, transparent)`,
      ":hover:not(:disabled)": `color-mix(in srgb, ${tokens.text} 11%, transparent)`,
    },
    color: { default: tokens.text, ":hover:not(:disabled)": tokens.text },
  },
  // One source and nothing to choose: the chip is a label.
  scopeStatic: { cursor: "default", maxWidth: "40%" },
  toolOn: { color: { default: tokens.muted, ":hover:not(:disabled)": tokens.text } },
  // The repository scope reads as part of the query: Backspace removes it.
  token: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
    maxWidth: "40%",
    height: 26,
    marginInlineEnd: -4,
    paddingInlineStart: 8,
    paddingInlineEnd: 4,
    borderWidth: 0,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: { default: tokens.accentSoft, ":hover": tokens.accentSoft },
    color: tokens.accent,
    fontFamily: tokens.ui,
    fontSize: 13,
    fontWeight: 500,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  tokenName: {
    minWidth: 0,
    maxWidth: 280,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  tokenClose: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    borderRadius: `calc(4px * ${tokens.round})`,
    opacity: { default: 0.6, ":hover": 1 },
  },
  name: {
    flexShrink: 0,
    maxWidth: "70%",
    color: tokens.text,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  // A content match's line, after its file's name.
  snippet: {
    flex: "1",
    minWidth: 0,
    whiteSpace: "pre",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 11.5,
  },
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
  // Content search's source, in the chips' place.
  searchNotice: { margin: 0, minHeight: 36, color: tokens.faint, fontSize: 12 },
  body: { display: "flex", flex: "1", minHeight: 0, overflow: "hidden" },
  results: { display: "flex", flexDirection: "column", flex: "1", minWidth: 0, overflow: "hidden" },
  // Beside the preview, the list takes 42 % of the width.
  split: { flexGrow: 0, flexShrink: 0, flexBasis: "42%" },
  preview: {
    display: { default: "flex", "@media (max-width: 700px)": "none" },
    flexDirection: "column",
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    backgroundColor: tokens.canvas,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: `color-mix(in srgb, var(--med-line-from, ${tokens.text}) 7%, transparent)`,
  },
});
