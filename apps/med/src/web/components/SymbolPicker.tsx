import { ShortcutKeys } from "./ShortcutKeys";
import { focusPaletteInput } from "../data/palette-focus";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Combobox } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import type { BrowseRead, BrowseSource } from "../../shared/browse";
import type { SymbolMatch, SymbolSearch } from "../../shared/symbols";
import { browseSourceKey, type BrowseApi } from "../data/browse";
import { usePickerPreview } from "../data/picker-preview";
import { findSymbols, symbolMatchId } from "../data/symbol-matches";
import { tokens, ui } from "../theme.stylex";
import { FullFileView, type BeginFileSymbolPreview, type FileSymbolPreview } from "./FullFileView";
import { Icon } from "./Icon";

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
  const enabled =
    !definitionResult && !!source && !!api.symbols && (mode === "file" ? !!path : !!query.trim());
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
  const results = useMemo(
    () =>
      mode === "file" || definitionResult
        ? findSymbols(displayed?.matches ?? [], query, 100, mode === "file" ? origin : undefined)
        : (displayed?.matches ?? []).slice(0, 100),
    [displayed, mode, query, definitionResult, origin],
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
  // Project locations are bound to the resolved commit returned by the index.
  const resultSource = definitionResult
    ? (definitionResult.resultSource ?? definitionResult.source)
    : mode === "project"
      ? displayed?.resultSource?.kind === "commit"
        ? displayed.resultSource
        : undefined
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
            {...stylex.props(styles.backdrop, mode === "file" && styles.clearBackdrop, ui.instant)}
          />
          <Dialog.Popup
            initialFocus={() => focusPaletteInput(inputRef.current)}
            finalFocus={() =>
              document.querySelector<HTMLElement>('[data-file-pane="main"]') ?? true
            }
            {...stylex.props(
              styles.popup,
              mode === "file" && styles.filePopup,
              mode === "file" && styles.fileWidth(Math.max(240, sidebarWidth - 16)),
              ui.instant,
            )}
          >
            <div {...stylex.props(styles.heading)}>
              <Dialog.Title {...stylex.props(styles.title)}>
                {definitionResult ? "Go to definition" : "Find symbol"}
              </Dialog.Title>
              <span {...stylex.props(styles.scope)} title={sourceLabel}>
                {sourceLabel}
              </span>
              {onModeChange && mode === "project" && (
                <div {...stylex.props(styles.modes)}>
                  <button
                    {...stylex.props(ui.button, styles.mode)}
                    aria-pressed={false}
                    onClick={() => onModeChange("file")}
                  >
                    File
                  </button>
                  <button
                    {...stylex.props(
                      ui.button,
                      styles.mode,
                      mode === "project" && styles.selectedMode,
                    )}
                    aria-pressed={mode === "project"}
                    onClick={() => onModeChange("project")}
                  >
                    Project
                  </button>
                </div>
              )}
              <Dialog.Close aria-label="Close symbol picker" {...stylex.props(ui.button)}>
                <ShortcutKeys value="Esc" />
              </Dialog.Close>
            </div>
            <Dialog.Description {...stylex.props(styles.hidden)}>
              Search symbol declarations. Arrow keys preview; Enter accepts; Escape restores your
              position.
            </Dialog.Description>
            <div {...stylex.props(styles.search)}>
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
                {...stylex.props(styles.input)}
              />
            </div>
            <p {...stylex.props(styles.notice)}>
              {definitionResult
                ? `Ctags declarations · ${resultSource?.kind === "commit" ? `Commit ${resultSource.oid.slice(0, 8)}` : "Current file"}`
                : mode === "file"
                  ? (path ?? "Open a file to search its symbols.")
                  : `Committed files · uncommitted changes excluded${resultSource?.kind === "commit" ? ` · ${resultSource.oid.slice(0, 8)}` : ""}`}
            </p>
            <div {...stylex.props(styles.body)}>
              <div {...stylex.props(styles.results)} aria-busy={busy}>
                {previewChanged ? (
                  <p role="alert" {...stylex.props(styles.message)}>
                    The file changed. Close and reopen symbol search to refresh.
                  </p>
                ) : failure ? (
                  <p role="alert" {...stylex.props(styles.message)}>
                    {failure}
                  </p>
                ) : (
                  <>
                    {!busy && (
                      <Combobox.Empty>
                        <div {...stylex.props(styles.message)}>
                          {definitionResult
                            ? `No declaration named “${definitionResult.query}” was found.`
                            : !source
                              ? "Select a repository."
                              : !api.symbols
                                ? "Symbol search is unavailable."
                                : mode === "file" && !path
                                  ? "Open a file to search its symbols."
                                  : mode === "project" && !query.trim()
                                    ? "Type a symbol name to search the selected commit."
                                    : "No matching symbols."}
                        </div>
                      </Combobox.Empty>
                    )}
                    <Combobox.List
                      ref={listRef}
                      aria-label="Symbols"
                      {...stylex.props(styles.list)}
                    >
                      {(match: SymbolMatch) => (
                        <Combobox.Item
                          key={symbolMatchId(match)}
                          value={match}
                          disabled={busy || !!previewChanged}
                          className={() =>
                            stylex.props(styles.item, chosen === match && styles.highlighted)
                              .className
                          }
                        >
                          <span {...stylex.props(styles.itemText)}>
                            <span {...stylex.props(styles.itemTop)}>
                              <span {...stylex.props(styles.name)}>{match.name}</span>
                              <span {...stylex.props(styles.kind)}>{match.kind}</span>
                            </span>
                            <span {...stylex.props(styles.path)}>
                              {match.scope ? `${match.scope} · ` : ""}
                              {mode === "project" ? `${match.path}:` : "Line "}
                              {match.line}
                            </span>
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
                    <p role="alert" {...stylex.props(styles.message)}>
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
                    <p {...stylex.props(styles.message)}>Select a symbol to preview.</p>
                  )}
                </div>
              )}
            </div>
            <div {...stylex.props(styles.footer)}>
              <span>
                <kbd {...stylex.props(styles.kbd)}>↑</kbd>
                <kbd {...stylex.props(styles.kbd)}>↓</kbd> preview ·{" "}
                <kbd {...stylex.props(styles.kbd)}>Enter</kbd> open
              </span>
              <span>
                {results.length} symbols
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
  backdrop: { position: "fixed", inset: 0, backgroundColor: tokens.scrim, zIndex: 110 },
  fileWidth: (width: number) => ({ width, maxWidth: "calc(100vw - 16px)" }),
  clearBackdrop: { backgroundColor: "transparent" },
  filePopup: {
    left: 8,
    top: 48,
    transform: "none",
    width: "min(340px, calc(100vw - 16px))",
    height: "min(620px, calc(100vh - 80px))",
    maxHeight: "calc(100vh - 80px)",
  },
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
    flex: "1",
    minWidth: 0,
    color: tokens.muted,
    fontSize: 11,
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  },
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
  input: {
    flex: "1",
    minWidth: 0,
    backgroundColor: "transparent",
    color: tokens.text,
    borderWidth: 0,
    outline: "none",
    fontFamily: tokens.ui,
    fontSize: 14,
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
    cursor: "default",
    outline: "none",
  },
  highlighted: { backgroundColor: tokens.fillStrong },
  name: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" },
  path: {
    minWidth: 0,
    color: tokens.faint,
    fontSize: 11,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  message: { padding: 24, textAlign: "center", color: tokens.muted, fontSize: 12 },
  notice: {
    margin: 0,
    paddingBlock: 6,
    paddingInline: 14,
    color: tokens.muted,
    fontSize: 11,
  },
  footer: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    paddingBlock: 8,
    paddingInline: 14,
    fontSize: 11,
    color: tokens.faint,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.line,
  },
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
  itemText: { display: "flex", flexDirection: "column", flex: "1", minWidth: 0, gap: 4 },
  itemTop: { display: "flex", gap: 8, minWidth: 0 },
  kind: { color: tokens.faint, fontSize: 10, flexShrink: 0 },
  kbd: {
    fontFamily: tokens.ui,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: 3,
    paddingBlock: 1,
    paddingInline: 4,
    marginInline: 2,
  },
  hidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
  },
});
