import { focusPaletteInput, visibleElement } from "../data/palette-focus";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Combobox } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import type { BrowseRead, BrowseSource } from "../../shared/browse";
import type { SymbolMatch, SymbolSearch } from "../../shared/symbols";
import { browseSourceKey, type BrowseApi } from "../data/browse";
import { usePickerPreview } from "../data/picker-preview";
import { findSymbolKeys, symbolKeys, symbolMatchId } from "../../shared/symbol-matches";
import { picked, tokens, ui } from "../theme.stylex";
import { FullFileView, type BeginFileSymbolPreview, type FileSymbolPreview } from "./FullFileView";
import { Icon } from "./Icon";
import { PaletteHeader, PaletteHint, plural } from "./Palette";

export interface SymbolPickerProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  mode: "file" | "project";
  onModeChange?(mode: "file" | "project"): void;
  source: BrowseSource | null;
  sourceLabel: string;
  path?: string;
  identity?: string;
  currentFile?: BrowseRead | null;
  sourceRevision?: number | string;
  api: BrowseApi;
  sidebarWidth?: number;
  beginFilePreview?: BeginFileSymbolPreview;
  definitionResult?: SymbolSearch;
  onOpen(path: string, line: number, source: BrowseSource, column?: number): void;
}

export function SymbolPicker(props: SymbolPickerProps) {
  const [queries] = useState(() => new Map<string, string>());
  const scope = props.source ? browseSourceKey(props.source) : "";
  const queryKey = JSON.stringify([scope, props.mode, props.mode === "file" ? props.path : null]);
  return props.open ? (
    <SymbolPickerContents
      key={JSON.stringify([scope, props.mode, props.path, props.identity, props.sourceRevision])}
      {...props}
      initialQuery={queries.get(queryKey) ?? ""}
      onQueryChange={(query) => {
        queries.delete(queryKey);
        queries.set(queryKey, query);
        while (queries.size > 32) queries.delete(queries.keys().next().value!);
      }}
    />
  ) : null;
}

function SymbolPickerContents({
  open,
  onOpenChange,
  mode,
  onModeChange,
  source,
  sourceLabel,
  path,
  identity,
  currentFile,
  sourceRevision = 0,
  api,
  onOpen,
  beginFilePreview,
  definitionResult,
  sidebarWidth = 300,
  initialQuery,
  onQueryChange,
}: SymbolPickerProps & { initialQuery: string; onQueryChange(query: string): void }) {
  const [query, setQuery] = useState(initialQuery);
  const session = useRef<FileSymbolPreview | null>(null);
  const accepted = useRef(false);
  useLayoutEffect(() => {
    if (mode !== "file") return;
    const preview = beginFilePreview?.() ?? null;
    session.current = preview;
    accepted.current = false;
    return () => {
      preview?.finish(accepted.current);
      session.current = null;
    };
  }, [mode, beginFilePreview]);
  const [selected, setSelected] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const sourceKey = source ? browseSourceKey(source) : "";
  const requestQuery = mode === "file" ? "" : query;
  const requestKey = JSON.stringify([sourceKey, mode, path, identity, requestQuery, refresh]);
  const [state, setState] = useState<{
    key: string;
    result?: SymbolSearch;
    error?: string;
    origin?: FileSymbolPreview["origin"];
  }>({ key: "" });
  // Project mode asks with an empty query too, so the host reads the
  // checkout's symbols before the first key.
  const enabled =
    !definitionResult && !!source && !!api.symbols && (mode === "file" ? !!path : true);
  useEffect(() => {
    if (!enabled || !sourceKey || !api.symbols) return;
    const [kind, repo, oid] = JSON.parse(sourceKey) as ["worktree" | "commit", string, string?];
    const requestSource: BrowseSource =
      kind === "commit" ? { kind, repo, oid: oid! } : { kind, repo };
    const controller = new AbortController();
    void api
      .symbols(
        requestSource,
        requestQuery,
        mode === "file" ? { path, identity } : {},
        controller.signal,
      )
      .then((result) => {
        if (!controller.signal.aborted)
          setState({ key: requestKey, result, origin: session.current?.origin });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key: requestKey,
            error: error instanceof Error ? error.message : "Cannot search symbols.",
          });
      });
    return () => controller.abort();
  }, [api, enabled, sourceKey, mode, path, identity, requestQuery, requestKey]);
  const busy = enabled && state.key !== requestKey;
  const displayed = definitionResult ?? (enabled ? state.result : undefined);
  const failure =
    definitionResult?.unavailable ??
    (state.key === requestKey ? (state.error ?? state.result?.unavailable) : null);
  // The preview session captures the imperative cursor before the symbol
  // request resolves. Use that fixed origin when the async results arrive.
  const origin = state.origin;
  // A file's symbols rank here at each key; the host ranks the project's.
  const ranked = mode === "file" || !!definitionResult;
  const keys = useMemo(
    () => (ranked ? symbolKeys(displayed?.matches ?? []) : []),
    [ranked, displayed],
  );
  const results = useMemo(
    () =>
      ranked
        ? findSymbolKeys(keys, query, 100, mode === "file" ? origin : undefined)
        : (displayed?.matches ?? []).slice(0, 100),
    [ranked, keys, displayed, mode, query, origin],
  );
  const chosen = results.find((match) => symbolMatchId(match) === selected) ?? results[0];
  const chosenIndex = chosen ? results.indexOf(chosen) : -1;
  useLayoutEffect(() => {
    const option = listRef.current?.querySelectorAll<HTMLElement>('[role="option"]')[chosenIndex];
    if (option) {
      inputRef.current?.setAttribute("aria-activedescendant", option.id);
      option.scrollIntoView({ block: "nearest" });
    } else inputRef.current?.removeAttribute("aria-activedescendant");
  }, [chosenIndex, results]);
  // Project locations are bound to the source that answered: the working
  // files, or the commit that the index resolved.
  const resultSource = definitionResult
    ? (definitionResult.resultSource ?? definitionResult.source)
    : mode === "project"
      ? displayed?.resultSource
      : displayed?.source;
  const exactFile =
    mode === "file" &&
    currentFile &&
    resultSource &&
    currentFile.path === chosen?.path &&
    currentFile.identity === displayed?.identity &&
    browseSourceKey(currentFile.source) === browseSourceKey(resultSource)
      ? currentFile
      : null;
  const preview = usePickerPreview(
    mode === "file" ? undefined : api,
    resultSource,
    chosen?.path,
    `${sourceRevision}:${refresh}`,
  );
  const previewFile = exactFile ?? preview.file;
  const previewChanged =
    mode === "file" &&
    chosen &&
    displayed &&
    (!exactFile || currentFile?.identity !== displayed.identity);
  useLayoutEffect(() => {
    if (mode === "file" && chosen && !busy && !failure && !previewChanged)
      session.current?.preview(chosen.line, chosen.column, chosen.name);
  }, [mode, chosen, busy, failure, previewChanged]);
  const choose = (match: SymbolMatch) => {
    if (busy || failure || !resultSource || previewChanged) return;
    session.current?.preview(match.line, match.column, match.name);
    accepted.current = true;
    if (!session.current) onOpen(match.path, match.line, resultSource, match.column);
    onOpenChange(false);
  };
  return (
    <Combobox.Root<SymbolMatch>
      inline
      open={open}
      onOpenChange={onOpenChange}
      items={results}
      filter={null}
      value={chosen ?? null}
      inputValue={query}
      onInputValueChange={(value, details) => {
        if (details.reason !== "input-change" && details.reason !== "input-clear") return;
        setQuery(value);
        onQueryChange(value);
        setSelected(null);
      }}
      itemToStringLabel={(match) => match.name}
      onItemHighlighted={(match, details) => {
        if (match && details.reason === "pointer") setSelected(symbolMatchId(match));
      }}
      onValueChange={(match) => {
        if (match) choose(match);
      }}
    >
      <Dialog.Root open={open} onOpenChange={onOpenChange}>
        <Dialog.Portal>
          <Dialog.Backdrop
            {...stylex.props(
              ui.scrim,
              ui.paletteScrim,
              mode === "file" && styles.clearBackdrop,
              ui.instant,
            )}
          />
          <Dialog.Popup
            initialFocus={() => focusPaletteInput(inputRef.current)}
            finalFocus={() => visibleElement('[data-file-pane="main"]') ?? true}
            {...stylex.props(
              ui.palette,
              ui.palettePreview,
              mode === "file" && styles.docked,
              mode === "file" && styles.dockedWidth(Math.max(240, sidebarWidth - 16)),
              ui.instant,
            )}
          >
            <PaletteHeader
              title={definitionResult ? "Go to definition" : "Find symbol"}
              // Docked, the file is the list's label.
              context={mode === "file" ? undefined : sourceLabel}
              closeLabel="Close symbol picker"
            >
              {onModeChange && (
                <div {...stylex.props(ui.paletteSegments)}>
                  <button
                    {...stylex.props(
                      ui.button,
                      ui.paletteSegment,
                      mode === "file" && ui.paletteSegmentOn,
                    )}
                    aria-pressed={mode === "file"}
                    onClick={() => onModeChange("file")}
                  >
                    File
                  </button>
                  <button
                    {...stylex.props(
                      ui.button,
                      ui.paletteSegment,
                      mode === "project" && ui.paletteSegmentOn,
                    )}
                    aria-pressed={mode === "project"}
                    onClick={() => onModeChange("project")}
                  >
                    Project
                  </button>
                </div>
              )}
            </PaletteHeader>
            <Dialog.Description {...stylex.props(ui.srOnly)}>
              Search symbol declarations. Arrow keys preview; Enter accepts; Escape restores your
              position.
            </Dialog.Description>
            <div {...stylex.props(ui.paletteInput)}>
              <Icon name="search" />
              <Combobox.Input
                ref={inputRef}
                onFocus={(event) => event.currentTarget.select()}
                maxLength={256}
                aria-label={
                  definitionResult
                    ? "Filter definitions"
                    : mode === "file"
                      ? "Find symbol in file"
                      : "Find symbol in project"
                }
                placeholder={
                  mode === "file" ? "Search symbols in this file…" : "Search committed symbols…"
                }
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  // Include the initial nearest result in keyboard navigation,
                  // even before the user types a query.
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    event.preventBaseUIHandler();
                    const next =
                      results[
                        (chosenIndex + (event.key === "ArrowDown" ? 1 : -1) + results.length) %
                          results.length
                      ];
                    if (next) setSelected(symbolMatchId(next));
                    return;
                  }
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  event.preventBaseUIHandler();
                  if (chosen) choose(chosen);
                }}
                {...stylex.props(ui.paletteField)}
              />
            </div>
            <div {...stylex.props(styles.body)}>
              <div
                {...stylex.props(ui.paletteList, ui.paletteListFill, styles.results)}
                aria-busy={busy}
              >
                <p {...stylex.props(ui.label, ui.paletteSection, styles.section)}>
                  {definitionResult
                    ? `Ctags declarations · ${resultSource?.kind === "commit" ? `Commit ${resultSource.oid.slice(0, 8)}` : "Current file"}`
                    : mode === "file"
                      ? (path ?? "Open a file to search its symbols.")
                      : resultSource?.kind === "commit"
                        ? `Committed files · uncommitted changes excluded · ${resultSource.oid.slice(0, 8)}`
                        : "Working files · with uncommitted changes"}
                </p>
                {previewChanged ? (
                  <p role="alert" {...stylex.props(ui.paletteEmpty)}>
                    The file changed. Close and reopen symbol search to refresh.
                  </p>
                ) : failure ? (
                  <p role="alert" {...stylex.props(ui.paletteEmpty)}>
                    {failure}
                  </p>
                ) : (
                  <>
                    {!busy && (
                      <Combobox.Empty>
                        <div {...stylex.props(ui.paletteEmpty)}>
                          {definitionResult
                            ? `No declaration named “${definitionResult.query}” was found.`
                            : !source
                              ? "Select a repository."
                              : !api.symbols
                                ? "Symbol search is unavailable."
                                : mode === "file" && !path
                                  ? "Open a file to search its symbols."
                                  : mode === "project" && !query.trim()
                                    ? source.kind === "commit"
                                      ? "Type a symbol name to search the selected commit."
                                      : "Type a symbol name to search the project."
                                    : "No matching symbols."}
                        </div>
                      </Combobox.Empty>
                    )}
                    <Combobox.List ref={listRef} aria-label="Symbols">
                      {(match: SymbolMatch) => (
                        <Combobox.Item
                          key={symbolMatchId(match)}
                          value={match}
                          disabled={busy || !!previewChanged}
                          className={() =>
                            stylex.props(
                              ui.paletteRow,
                              ui.paletteRowBare,
                              chosen === match && [ui.menuHighlighted, picked],
                            ).className
                          }
                        >
                          <span {...stylex.props(styles.name)}>{match.name}</span>
                          <span {...stylex.props(styles.kind)}>{match.kind}</span>
                          <span {...stylex.props(ui.paletteRowSecondary, styles.where)}>
                            {[match.scope, mode === "project" ? match.path : ""]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                          <span {...stylex.props(styles.line)}>
                            <span {...stylex.props(ui.srOnly)}>Line </span>
                            {match.line}
                          </span>
                        </Combobox.Item>
                      )}
                    </Combobox.List>
                  </>
                )}
              </div>
              {mode === "project" && (
                <div {...stylex.props(styles.preview)} aria-label="Symbol preview">
                  {previewChanged ? (
                    <p role="alert" {...stylex.props(ui.paletteEmpty)}>
                      The file changed. Close and reopen symbol search to refresh.
                    </p>
                  ) : chosen && resultSource ? (
                    <FullFileView
                      key={`${browseSourceKey(resultSource)}:${chosen.path}`}
                      compact
                      file={previewFile}
                      loading={exactFile ? false : preview.loading}
                      error={exactFile ? null : preview.error}
                      sourceLabel={
                        resultSource.kind === "commit"
                          ? `Commit ${resultSource.oid.slice(0, 8)}`
                          : sourceLabel
                      }
                      line={chosen.line}
                      highlightQuery={chosen.name}
                      onRefresh={() => setRefresh((value) => value + 1)}
                    />
                  ) : (
                    <p {...stylex.props(ui.paletteEmpty)}>Select a symbol to preview.</p>
                  )}
                </div>
              )}
            </div>
            <div {...stylex.props(ui.paletteFooter)}>
              <PaletteHint keys="↑ ↓">Preview</PaletteHint>
              <PaletteHint keys="↵">Open</PaletteHint>
              <span {...stylex.props(ui.paletteCount)}>
                {plural(results.length, "symbol")}
                {displayed?.truncated || results.length >= 100 ? " · refine to see more" : ""}
              </span>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </Combobox.Root>
  );
}

const styles = stylex.create({
  clearBackdrop: { backgroundColor: "transparent" },
  // Symbols in this file dock at the left, over the tree, so the file
  // previews beside them.
  docked: {
    top: 48,
    left: 8,
    right: "auto",
    marginInline: 0,
    height: "min(620px, calc(100vh - 80px))",
    maxHeight: "calc(100vh - 80px)",
  },
  dockedWidth: (width: number) => ({ width, maxWidth: "calc(100vw - 16px)" }),
  body: { display: "flex", flex: "1", minHeight: 0, overflow: "hidden" },
  results: { minWidth: 0 },
  // The list's label scrolls with its rows. A path keeps its case in a theme
  // whose labels are capitals, and wraps rather than losing its file name.
  section: {
    display: "block",
    overflowWrap: "anywhere",
    textTransform: "none",
    letterSpacing: "normal",
  },
  name: {
    flexShrink: 0,
    maxWidth: "70%",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  kind: { flexShrink: 0, color: tokens.faint, fontSize: 11 },
  // The scope, and in the project the file, before the line at the row's end.
  where: { flex: "1", textAlign: "end" },
  line: {
    flexShrink: 0,
    minWidth: 20,
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    textAlign: "end",
  },
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
});
