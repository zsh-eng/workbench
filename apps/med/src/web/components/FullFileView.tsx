import { MediaFileView } from "./MediaView";
import { ToolButton } from "./ToolButton";
import * as stylex from "@stylexjs/stylex";
import {
  CodeView,
  useWorkerPool,
  type CodeViewHandle,
  type CodeViewItem,
  type CodeViewReactOptions,
} from "@pierre/diffs/react";
import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
} from "react";
import { createMarkdownModel, type MarkdownModel } from "../markdown/model";
import "./MarkdownPreview.css";
import { preloadable } from "./preloadable";
import { createEditorDrafts, type EditorDrafts } from "../data/editor-drafts";
import { isBrowseFile, type FileRead as BrowseRead, type FileWrite } from "../../shared/local-file";
import type { BlameLoader, CommitLoader } from "../data/blame";
import { tokens, ui } from "../theme.stylex";
import { useTheme } from "../themes";
import { codeColors, highlightRules } from "../code-colors";
import { codeSurfaceStyle } from "./diff-surface";
import "../pierre-theme";
import { Icon } from "./Icon";
import { useFileVim, type FileNavigationCommand } from "../data/use-file-vim";
import { pierreFile } from "../data/file-prefetch";
import { getFiletypeFromFileName } from "@pierre/diffs";
import { supportedLanguage } from "../highlighting/languages";
import { createSearchHighlights } from "../data/search-highlights";
import { BlameTooltips } from "./BlameTooltips";
import type { FileChanges } from "../../shared/file-changes";
import { createChangeGutter } from "../data/change-gutter";
import { createBlameGutter } from "../data/blame-gutter";
import { createLineBlame } from "../data/line-blame";
import { LineBlame, lineBlameCSS } from "./LineBlame";
import { useQuietChrome } from "../data/chrome";
import { fileTitle } from "./QuietChrome";

export interface FileSymbolPreview {
  readonly origin?: { line: number; column: number };
  preview(line: number, column: number | undefined, name: string, selectLine?: boolean): void;
  finish(accept: boolean): void;
}
export type BeginFileSymbolPreview = () => FileSymbolPreview;

export interface FullFileViewProps {
  file: BrowseRead | null;
  previewControl?: ReactNode;
  /** A Markdown file shows rendered, or not, such as for a status line. */
  onReadingChange?(reading: boolean): void;
  onSourcePosition?(line: number, reason: "cursor" | "scroll"): void;
  markdownNavigation?: MarkdownModel;
  path?: string;
  loading: boolean;
  stale?: boolean;
  error: string | null;
  sourceLabel: string;
  line?: number;
  column?: number;
  vimEnabled?: boolean;
  onSymbolPreviewReady?(begin: BeginFileSymbolPreview | null): void;
  onNavigationReady?(command: FileNavigationCommand | null): void;
  onSelectionReaderReady?(read: (() => string) | null): void;
  onDefinition?(name: string): void;
  highlightQuery?: string;
  compact?: boolean;
  initialScrollTop?: number;
  onScrollPosition?(top: number): void;
  loadBlame?: BlameLoader;
  loadChanges?(file: BrowseRead, signal: AbortSignal): Promise<FileChanges>;
  blameEnabled?: boolean;
  onBlameEnabledChange?(enabled: boolean): void;
  /** Shows the cursor line's author and age after its text. Default: true. */
  lineBlame?: boolean;
  loadCommit?: CommitLoader;
  onRefresh(): void;
  refreshAvailable?: boolean;
  onClose?(): void;
  onOpenBefore?(): void;
  onOpenAfter?(): void;
  onOpenFile?(path: string, line?: number): void;
  onEdit?(): void;
  editor?: {
    drafts: EditorDrafts;
    key: string;
    write: FileWrite;
    autoEdit?: boolean;
  };
}

const notices = {
  image: "Image preview unavailable.",
  video: "Video preview unavailable.",
  binary: "Binary file — content preview is not available.",
  missing: "This file does not exist in this source.",
  "too-large": "This file exceeds the preview size limit.",
  unsupported: "This file type or encoding cannot be displayed.",
};

/** One read-only, virtualized file. Metadata responses never reach Pierre. */
function ReadOnlyFileView({
  file,
  previewControl,
  onSourcePosition,
  markdownNavigation,
  path,
  loading,
  stale = false,
  error,
  sourceLabel,
  line,
  column,
  vimEnabled = false,
  onNavigationReady,
  onSelectionReaderReady,
  onDefinition,
  onSymbolPreviewReady,
  highlightQuery = "",
  compact = false,
  initialScrollTop,
  onScrollPosition,
  loadBlame,
  loadChanges,
  blameEnabled,
  onBlameEnabledChange,
  lineBlame = true,
  loadCommit,
  onRefresh,
  refreshAvailable = true,
  onClose,
  onOpenBefore,
  onOpenAfter,
  onEdit,
}: FullFileViewProps) {
  const displayPath = path ?? file?.path;
  const { active } = useTheme();
  const quiet = useQuietChrome();
  const sourceCursorAt = useRef(0);
  const cursorLine = useRef((_line: number) => {});
  const followCursor = useCallback(
    (line: number) => {
      sourceCursorAt.current = performance.now();
      cursorLine.current(line);
      onSourcePosition?.(line, "cursor");
    },
    [onSourcePosition],
  );
  const workingColor = active.appearance === "dark" ? "#7db4ff" : "#245ea8";
  const viewer = useRef<CodeViewHandle<undefined, undefined>>(null);
  const vim = useFileVim({
    text: file?.kind === "text" ? (file.text ?? "") : "",
    identity: file?.identity ?? "",
    enabled: vimEnabled && !compact,
    viewer,
    line,
    column,
    onNavigationReady,
    onDefinition,
    onPosition: followCursor,
  });
  useLayoutEffect(() => {
    if (compact) return;
    onSelectionReaderReady?.(vim.selectedText);
    return () => onSelectionReaderReady?.(null);
  }, [compact, onSelectionReaderReady, vim.selectedText]);
  useLayoutEffect(
    () =>
      markdownNavigation?.subscribeNavigation((line) => {
        vim.position.jump(line);
        vim.pane.current?.focus({ preventScroll: true });
        onSourcePosition?.(line, "cursor");
      }),
    [markdownNavigation, vim.position, vim.pane, onSourcePosition],
  );
  const [symbolHighlight, setSymbolHighlight] = useState<string | null>(null);
  const beginSymbolPreview = useCallback<BeginFileSymbolPreview>(() => {
    const instance = viewer.current?.getInstance();
    const origin = vim.position.capture();
    const scrollTop = instance?.getScrollTop() ?? 0;
    const selected = instance?.getSelectedLines() ?? null;
    return {
      origin: { line: origin.line + 1, column: origin.column + 1 },
      preview(target, targetColumn, name, selectLine = true) {
        vim.position.jump(target, targetColumn);
        instance?.setSelectedLines(
          selectLine
            ? {
                id: file?.identity ?? "",
                range: { start: target, end: target },
              }
            : null,
        );
        instance?.render(true);
        setSymbolHighlight(name);
      },
      finish(accept) {
        setSymbolHighlight(null);
        if (accept) vim.position.accept(origin);
        else {
          vim.position.restore(origin);
          instance?.setSelectedLines(selected);
          instance?.scrollTo({ type: "position", position: scrollTop, behavior: "instant" });
          instance?.render(true);
        }
      },
    };
  }, [vim.position, file?.identity]);
  useLayoutEffect(() => {
    if (compact || file?.kind !== "text" || loading) return;
    onSymbolPreviewReady?.(beginSymbolPreview);
    return () => onSymbolPreviewReady?.(null);
  }, [beginSymbolPreview, compact, file?.kind, loading, onSymbolPreviewReady]);
  // Preview panes must never take focus from the picker input.
  useLayoutEffect(() => {
    if (!compact && !loading && file?.kind === "text")
      vim.pane.current?.focus({ preventScroll: true });
  }, [compact, loading, file?.identity, file?.kind, vim.pane]);
  const effectiveHighlightQuery = symbolHighlight ?? (vim.highlightQuery || highlightQuery);
  const currentHighlightQuery = useRef(effectiveHighlightQuery);
  currentHighlightQuery.current = effectiveHighlightQuery;
  const currentHighlightOptions = useRef(vim.highlightOptions);
  currentHighlightOptions.current =
    symbolHighlight !== null
      ? { caseSensitive: true, wholeWord: true }
      : vim.highlightQuery
        ? vim.highlightOptions
        : { caseSensitive: false, wholeWord: false };
  const vimRender = useRef(vim.onPostRender);
  vimRender.current = vim.onPostRender;
  const highlightId = `med-search-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const highlights = useMemo(() => createSearchHighlights(highlightId), [highlightId]);
  useLayoutEffect(() => {
    highlights.refresh(effectiveHighlightQuery, currentHighlightOptions.current);
  }, [
    highlights,
    effectiveHighlightQuery,
    vim.highlightOptions.wholeWord,
    vim.highlightOptions.caseSensitive,
    symbolHighlight,
  ]);
  useLayoutEffect(() => () => highlights.dispose(), [highlights]);
  const [localBlameEnabled, setLocalBlameEnabled] = useState(false);
  const blameOpen = !compact && (blameEnabled ?? localBlameEnabled);
  const [blameNotice, setBlameNotice] = useState<{
    file: BrowseRead | null;
    message: string;
  } | null>(null);
  const canBlame = !!loadBlame && file?.kind === "text" && !stale && !loading && !error;
  const gutter = useMemo(
    () =>
      createBlameGutter(
        file && isBrowseFile(file) ? file : null,
        loadBlame,
        !compact && canBlame,
        (message) => setBlameNotice({ file, message }),
      ),
    [file, loadBlame, compact, canBlame],
  );
  useLayoutEffect(() => () => gutter.dispose(), [gutter]);
  useLayoutEffect(() => gutter.setVisible(blameOpen), [gutter, blameOpen]);
  const blameCells = useSyncExternalStore(gutter.subscribe, gutter.getSnapshot);
  const setBlameOpen = (open: boolean) => {
    setLocalBlameEnabled(open);
    onBlameEnabledChange?.(open);
  };
  // The open gutter already names each line's commit, and a selection hides it.
  const lineBlameShown =
    lineBlame && vimEnabled && !compact && canBlame && !blameOpen && !vim.visualMode;
  const cursorBlame = useMemo(
    () =>
      createLineBlame(
        file && isBrowseFile(file) ? file : null,
        !compact && canBlame ? loadBlame : undefined,
      ),
    [file, loadBlame, compact, canBlame],
  );
  useLayoutEffect(() => () => cursorBlame.dispose(), [cursorBlame]);
  useLayoutEffect(() => {
    cursorLine.current = (line) => cursorBlame.setLine(lineBlameShown ? line : null);
    cursorBlame.setLine(lineBlameShown ? vim.position.capture().line + 1 : null);
  }, [cursorBlame, lineBlameShown, vim.position]);
  const blamedLine = useSyncExternalStore(cursorBlame.subscribe, cursorBlame.getSnapshot);
  const [lineBlameAnchor] = useState(() => {
    const anchor = document.createElement("span");
    anchor.dataset.medLineBlame = "";
    return anchor;
  });
  // Pierre rebuilds rows as they scroll, so each render places the label again.
  const blameHost = useRef<HTMLElement | null>(null);
  const placeLineBlame = useRef(() => {});
  useLayoutEffect(() => {
    placeLineBlame.current = () => {
      const row =
        lineBlameShown && blamedLine
          ? blameHost.current?.shadowRoot?.querySelector(`[data-line="${blamedLine.line}"]`)
          : null;
      if (!row) lineBlameAnchor.remove();
      else if (row.lastChild !== lineBlameAnchor) row.append(lineBlameAnchor);
    };
    placeLineBlame.current();
  }, [lineBlameShown, blamedLine, lineBlameAnchor]);
  const changes = useMemo(createChangeGutter, []);
  const [changeLabel, setChangeLabel] = useState("");
  useEffect(() => {
    changes.set(undefined);
    if (!file || file.kind !== "text" || stale || loading || !loadChanges) return;
    const abort = new AbortController();
    void loadChanges(file, abort.signal)
      .then((result) => {
        if (!abort.signal.aborted) {
          changes.set(result);
          setChangeLabel(result.label);
        }
      })
      .catch(() => {
        if (!abort.signal.aborted) setChangeLabel("");
      });
    return () => {
      abort.abort();
      changes.set(undefined);
    };
  }, [file, stale, loading, loadChanges, changes]);
  const plain = !!file?.plain;
  const language = getFiletypeFromFileName(file?.path ?? "");
  const unsupportedSyntax =
    import.meta.env.MED_HIGHLIGHTER !== "shiki" &&
    language !== "text" &&
    !supportedLanguage(language);
  const items = useMemo<CodeViewItem<undefined>[]>(() => {
    if (file?.kind !== "text" || typeof file.text !== "string") return [];
    return [
      {
        id: file.identity,
        type: "file",
        file: pierreFile(file),
      },
    ];
  }, [file]);
  const workerPool = useWorkerPool();
  useLayoutEffect(() => {
    if (loading || file?.kind !== "text" || file.plain || !workerPool?.isWorkingPool()) return;
    const input = pierreFile(file);
    if (workerPool.getFileResultCache(input)) return;
    let cancelled = false;
    // The pool deduplicates this with the early read and CodeView requests.
    // Commit the visible file as soon as its result is ready instead of waiting
    // for an additional virtualizer frame. Other files still use normal batching.
    void workerPool
      .primeFileHighlightCache(input)
      .then(() => {
        if (!cancelled) viewer.current?.getInstance()?.render(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [file, loading, workerPool]);
  const visualName = vim.visualName;
  const activeSearchName = vim.activeSearchName;
  const options = useMemo<CodeViewReactOptions<undefined, undefined>>(
    () => ({
      theme: active.pierreTheme,
      themeType: active.appearance,
      overflow: "scroll",
      disableFileHeader: true,
      enableLineSelection: true,
      // Keep hover and gutter dragging active immediately after keyboard scrolling.
      pointerEventsOnScroll: true,
      tokenizeMaxLineLength: 1000,
      unsafeCSS: `[data-line] { tab-size: 2; }
        [data-column-number] { position: relative; }
        [data-med-change] { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; border-radius: 1px; background: ${active.palette.green}; }
        [data-med-change="deleted"] { background: ${active.palette.red}; }
        [data-med-change="working"] { background: ${workingColor}; width: 4px; }
        [data-change-edge] { width: 9px; height: 3px; top: auto; bottom: 0; }
        [data-change-edge="before"] { top: 0; bottom: auto; }
        ${highlightRules(active, { match: highlightId, current: activeSearchName, visual: visualName })}
        [data-vim-visual-line] { background: ${codeColors(active).selection} !important; }
        [data-vim-visual-empty] { position: relative; }
        ${lineBlameCSS("[data-line]", active.palette.faint)}
        ${
          blameOpen && canBlame
            ? `[data-column-number] { padding-left: 196px; }
        [data-med-blame] { position: absolute; left: 8px; top: 0; width: 176px; height: 100%; display: flex; align-items: baseline; gap: 8px; font-family: var(--diffs-header-font-family); font-size: 10px; text-align: left; color: ${active.palette.muted}; user-select: none; overflow: hidden; white-space: nowrap; }
        [data-med-blame-trigger] { display: flex; align-items: baseline; gap: 6px; width: 100%; height: 100%; }
        [data-med-blame-trigger] > :first-child { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
        [data-med-blame-trigger] > :not(:first-child) { flex-shrink: 0; color: ${active.palette.faint}; }`
            : ""
        }
        [data-vim-visual-empty]::before { content: ""; position: absolute; width: 1ch; height: 100%; background: ${codeColors(active).selection}; pointer-events: none; }`,
      onPostRender(node, _instance, phase) {
        blameHost.current = phase === "unmount" ? null : node;
        placeLineBlame.current();
        gutter.update(node, phase);
        changes.update(node, phase);
        vimRender.current(node, phase);
        if (phase === "unmount") highlights.dispose();
        else
          highlights.update(node, currentHighlightQuery.current, currentHighlightOptions.current);
      },
      layout: { gap: 0, paddingTop: 8, paddingBottom: 16 },
    }),
    [
      active,
      highlightId,
      highlights,
      visualName,
      activeSearchName,
      gutter,
      blameOpen,
      canBlame,
      changes,
      workingColor,
    ],
  );
  useLayoutEffect(() => {
    if (!file || !items.length || loading) return;
    const instance = viewer.current?.getInstance();
    if (!instance) return;
    if (line && line > 0) {
      instance.setSelectedLines({ id: file.identity, range: { start: line, end: line } });
      instance.scrollTo({
        type: "line",
        id: file.identity,
        lineNumber: line,
        align: "center",
        behavior: "instant",
      });
    } else if (initialScrollTop !== undefined) {
      instance.scrollTo({ type: "position", position: initialScrollTop, behavior: "instant" });
    } else return;
    // scrollTo queues Pierre's virtualizer. Flush it before the browser paints,
    // so a new preview never shows line 1 on its way to the requested location.
    instance.render(true);
    // initialScrollTop is a mount/source restore value, not a controlled scroll
    // position. Feeding onScrollPosition back must not move the user's viewport.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file?.identity, loading, line, column]);
  return (
    <section
      {...stylex.props(styles.root)}
      aria-label="Full file"
      onWheelCapture={() => {
        sourceCursorAt.current = 0;
      }}
      onTouchStartCapture={() => {
        sourceCursorAt.current = 0;
      }}
      onPointerDownCapture={() => {
        sourceCursorAt.current = 0;
      }}
      aria-busy={loading}
      data-full-file-kind={file?.kind}
      data-file-plain={plain}
    >
      {!compact && (
        <header data-lift-row="" {...stylex.props(styles.header)}>
          <Icon name="file" size={15} />
          <span
            {...stylex.props(styles.path)}
            title={displayPath && fileTitle(displayPath, file?.size, quiet)}
          >
            {displayPath}
          </span>
          <span {...stylex.props(styles.badge)} title={sourceLabel}>
            {sourceLabel.replace(/^Working files\b/, "Working file")}
          </span>
          {loadChanges && !stale && (
            <span
              {...stylex.props(styles.badge)}
              title={changeLabel || "Change markers follow the displayed file version"}
              aria-label="Change marker legend"
            >
              <span style={{ color: active.palette.green }}>▏</span>Added{" "}
              <span style={{ color: active.palette.red }}>▏</span>Deleted{" "}
              <span style={{ color: workingColor }}>▏</span>Working
            </span>
          )}
          <span {...stylex.props(styles.badge)}>Read-only</span>
          {onEdit && (
            <button {...stylex.props(ui.button)} onClick={onEdit}>
              Edit
            </button>
          )}
          {loadBlame && (
            <ToolButton
              label="Toggle Git blame"
              icon="history"
              shortcut="⌥ B"
              active={blameOpen}
              aria-pressed={blameOpen}
              disabled={file?.kind !== "text" || loading}
              onClick={() => setBlameOpen(!blameOpen)}
            />
          )}
          {onOpenBefore && (
            <button {...stylex.props(ui.button)} onClick={onOpenBefore}>
              Open before
            </button>
          )}
          {onOpenAfter && (
            <button {...stylex.props(ui.button)} onClick={onOpenAfter}>
              Open after
            </button>
          )}
          {refreshAvailable && (
            <ToolButton
              label="Refresh file"
              icon="refresh"
              disabled={loading}
              onClick={onRefresh}
            />
          )}
          {previewControl}
          {onClose && <ToolButton label="Close file" icon="close" onClick={onClose} />}
        </header>
      )}
      {stale && !loading && (
        <div role="status" {...stylex.props(styles.banner)}>
          <span>Workspace changed. Refresh this file to read the latest contents.</span>
          <button {...stylex.props(ui.button)} onClick={onRefresh}>
            Refresh contents
          </button>
        </div>
      )}
      {blameOpen && (stale || (blameNotice?.file === file && blameNotice.message)) && (
        <div role="status" {...stylex.props(styles.banner)}>
          {stale ? "Refresh the file before reading its line history." : blameNotice?.message}
        </div>
      )}
      {error ? (
        <div role="alert" {...stylex.props(styles.notice)}>
          {error}
        </div>
      ) : loading ? (
        <div {...stylex.props(styles.pending)} aria-hidden="true" />
      ) : file ? (
        <>
          {(plain || file.truncated || unsupportedSyntax) && file.kind === "text" && (
            <div role="status" {...stylex.props(styles.banner)}>
              {file.truncated ? "Partial preview" : "Plain text preview"} ·{" "}
              {file.reason ??
                (unsupportedSyntax
                  ? `Syntax highlighting is not available for ${language}.`
                  : "Syntax highlighting is disabled for this file.")}
            </div>
          )}
          {items.length ? (
            <div
              ref={vim.pane}
              data-file-pane={compact ? "preview" : "main"}
              {...stylex.props(styles.viewport)}
              tabIndex={vimEnabled ? 0 : -1}
              role="textbox"
              aria-readonly="true"
              aria-multiline="true"
              aria-label={vimEnabled ? "File navigation" : "File content"}
              onKeyDown={vim.keyDown}
              onCopy={vim.onCopy}
              onFocus={vim.onFocus}
              onBlur={vim.onBlur}
              onClick={vim.onClick}
            >
              <CodeView
                key={file.identity}
                ref={viewer}
                items={items}
                options={options}
                onScroll={(top) => {
                  onScrollPosition?.(top);
                  if (performance.now() - sourceCursorAt.current >= 200)
                    onSourcePosition?.(Math.max(1, (top - 16) / 20 + 1), "scroll");
                }}
                className={stylex.props(styles.code).className}
                style={
                  {
                    "--diffs-font-family": tokens.code,
                    "--diffs-font-size": "12px",
                    "--diffs-line-height": "20px",
                    "--diffs-bg-context-override": tokens.canvas,
                    "--diffs-bg-context-gutter-override": tokens.canvas,
                    ...codeSurfaceStyle,
                  } as CSSProperties
                }
              />
              <span
                ref={vim.caret}
                data-vim-caret=""
                hidden
                aria-hidden="true"
                {...stylex.props(styles.caret)}
              />
            </div>
          ) : (
            <div {...stylex.props(styles.notice)}>
              <p>
                {file.kind === "missing" && file.source.kind === "worktree"
                  ? "This file does not exist in this worktree."
                  : file.kind === "text"
                    ? "Text content is unavailable."
                    : notices[file.kind]}
              </p>
              <p {...stylex.props(styles.detail)}>
                {file.reason ?? `${file.size.toLocaleString()} bytes`}
              </p>
            </div>
          )}
        </>
      ) : (
        <div {...stylex.props(styles.notice)}>Choose a file to preview.</div>
      )}
      {vim.commandLine && (
        <form
          {...stylex.props(styles.search)}
          onSubmit={(event) => {
            event.preventDefault();
            vim.submitCommandLine();
          }}
        >
          <span>:</span>
          <input
            ref={(element) => element?.focus()}
            aria-label="Go to line"
            aria-invalid={!!vim.commandLine.error}
            placeholder="Line number"
            inputMode="numeric"
            autoComplete="off"
            maxLength={16}
            value={vim.commandLine.value}
            {...stylex.props(styles.searchInput)}
            onChange={(event) => vim.updateCommandLine(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                vim.cancelCommandLine();
              }
            }}
          />
          {vim.commandLine.error && <span role="alert">{vim.commandLine.error}</span>}
          <kbd>Enter</kbd>
          <span>go</span>
          <kbd>Esc</kbd>
          <span>cancel</span>
        </form>
      )}
      {vim.search && (
        <form
          {...stylex.props(styles.search)}
          onSubmit={(event) => {
            event.preventDefault();
            vim.submitSearch();
          }}
        >
          <span>{vim.search.direction === 1 ? "/" : "?"}</span>
          <input
            ref={(element) => element?.focus()}
            aria-label="Search in file"
            placeholder="Search text (literal, smart case)"
            value={vim.search.query}
            {...stylex.props(styles.searchInput)}
            onChange={(event) => vim.updateSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                vim.cancelSearch();
              }
            }}
          />
          <kbd>Enter</kbd>
          <span>accept</span>
          <kbd>Esc</kbd>
          <span>cancel</span>
        </form>
      )}
      {(vimEnabled || vim.message) && !compact && (
        <div {...stylex.props(styles.vimStatus)}>
          {vimEnabled
            ? vim.commandLine
              ? "COMMAND · "
              : vim.visualMode === "line"
                ? "VISUAL LINE · "
                : vim.visualMode
                  ? "VISUAL · "
                  : "NORMAL · "
            : ""}
          <span role={vim.copyError ? "alert" : undefined}>
            {vim.copyMessage ||
              (vim.visualMode
                ? "y to copy · Esc to cancel"
                : vim.message || "Read-only navigation")}
          </span>
        </div>
      )}
      <BlameTooltips cells={blameCells} />
      <LineBlame
        blame={lineBlameShown ? blamedLine : null}
        anchor={lineBlameAnchor}
        file={file && isBrowseFile(file) ? file : null}
        loadCommit={loadCommit}
      />
    </section>
  );
}
const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    height: "100%",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.ui,
    fontSize: 12,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 32,
    minHeight: 32,
    boxSizing: "border-box",
    flexShrink: 0,
    paddingInline: 12,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  // As FileEditor.css lays out the editor's header.
  editorHeader: { gap: 4, paddingInline: 8, fontSize: 12 },
  saveDot: {
    flexShrink: 0,
    width: 7,
    height: 7,
    boxSizing: "border-box",
    borderRadius: "50%",
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: "currentColor",
    color: tokens.muted,
  },
  unsaved: { color: tokens.warning, backgroundColor: "currentColor" },
  path: {
    flex: "1",
    minWidth: 30,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  badge: {
    color: tokens.muted,
    fontSize: 11,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "35%",
  },
  viewport: {
    position: "relative",
    display: "flex",
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    outline: "none",
  },
  pending: { flex: "1", minHeight: 0 },
  caret: {
    position: "absolute",
    pointerEvents: "none",
    backgroundColor: tokens.accent,
    opacity: 0.45,
    zIndex: 5,
    transitionProperty: { default: "none", ':is([data-animate="true"])': "left, top" },
    transitionDuration: { default: "65ms", "@media (prefers-reduced-motion: reduce)": "0ms" },
    transitionTimingFunction: "ease-out",
  },
  search: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: 8,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  searchInput: {
    flex: "1",
    minWidth: 0,
    borderWidth: 0,
    outline: "none",
    backgroundColor: tokens.canvas,
    color: tokens.text,
    fontFamily: tokens.code,
  },
  vimStatus: {
    paddingBlock: 3,
    paddingInline: 12,
    color: tokens.muted,
    fontSize: 10,
    borderTopWidth: 1,
    borderTopStyle: "solid",
    borderTopColor: tokens.border,
  },
  code: {
    flex: "1",
    minHeight: 0,
    minWidth: 0,
    overflow: "auto",
    scrollbarWidth: "thin",
    overscrollBehavior: "contain",
  },
  notice: { padding: 28, color: tokens.muted, lineHeight: 1.7 },
  detail: { color: tokens.faint, overflowWrap: "anywhere" },
  banner: {
    paddingBlock: 7,
    paddingInline: 12,
    backgroundColor: tokens.panel,
    color: tokens.muted,
    fontSize: 11,
  },
});

const MarkdownPreview = lazy(() => import("./MarkdownPreview"));
const EditableFile = preloadable(() => import("./FileEditor"));
/** Loads the editor early, such as once a vault opens, so its first note opens at once. */
export const preloadFileEditor = EditableFile.preload;
const noDrafts = createEditorDrafts();
/** Markdown files that the reader switched to their source, by source and path. */
const markdownSources = new Set<string>();
/** The source line of the first rendered block in view. */
function topBlockLine(view: HTMLElement | null) {
  const pane = view?.querySelector<HTMLElement>(".med-md-scroll");
  if (!pane) return undefined;
  const top = pane.getBoundingClientRect().top;
  const block = [...pane.querySelectorAll<HTMLElement>("[data-block-line]")].find(
    (entry) => entry.getBoundingClientRect().bottom > top + 8,
  );
  return block ? Number(block.dataset.blockLine) : undefined;
}
/** Memoized: the review renders again for unrelated state, such as a palette. */
export const FullFileView = memo(function FullFileView(props: FullFileViewProps) {
  const store = props.editor?.drafts ?? noDrafts;
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  const draft = props.editor ? store.get(props.editor.key) : undefined;
  const [editError, setEditError] = useState("");
  const quiet = useQuietChrome();
  const markdown =
    !props.compact &&
    props.file?.kind === "text" &&
    /\.(md|markdown|mdown|mkd)$/i.test(props.file.path);
  const sourceKey = props.file ? JSON.stringify(props.file.source) + props.file.path : "";
  // A Markdown file shows one view at a time: rendered to read, or its source
  // to edit. It opens rendered, unless it has unsaved changes or the reader
  // chose its source before.
  const readingFor = (key: string) =>
    !markdownSources.has(key) && !(props.editor && store.get(props.editor.key)?.dirty);
  const [mode, setMode] = useState(() => ({ key: sourceKey, reading: readingFor(sourceKey) }));
  if (mode.key !== sourceKey) setMode({ key: sourceKey, reading: readingFor(sourceKey) });
  const reading = markdown && mode.reading;
  const onReadingChange = props.onReadingChange;
  useEffect(() => onReadingChange?.(reading), [onReadingChange, reading]);
  // The bridge remains stable through disk saves and editor draft notifications.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const markdownModel = useMemo(() => createMarkdownModel(props.file?.text ?? ""), [sourceKey]);
  useLayoutEffect(() => {
    markdownModel.setText(
      draft?.editing ? (draft.state?.sliceDoc() ?? draft.savedText) : (props.file?.text ?? ""),
    );
  }, [markdownModel, props.file?.text, draft, draft?.editing, reading]);
  // A file opened at a line reads from that line.
  const openedLine = props.line;
  useLayoutEffect(() => {
    if (openedLine) markdownModel.follow(openedLine, "cursor");
  }, [markdownModel, openedLine]);
  // The source's cursor and scroll keep the rendered view's place, so each
  // view opens where the other one was.
  const followSource = useCallback(
    (line: number, reason: "cursor" | "scroll") => markdownModel.follow(line, reason),
    [markdownModel],
  );
  const reader = useRef<HTMLDivElement>(null);
  const toggleReading = () => {
    if (reading) {
      markdownSources.add(sourceKey);
      // The source opens at the first line in view.
      const line = topBlockLine(reader.current);
      const current = props.editor && store.get(props.editor.key);
      if (line && current) store.update(current, { line, column: 1 });
    } else markdownSources.delete(sourceKey);
    setMode({ key: sourceKey, reading: !reading });
  };
  const toggleButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!markdown) return;
    const shortcut = (event: KeyboardEvent) => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        !event.shiftKey ||
        event.altKey ||
        event.isComposing ||
        event.key.toLowerCase() !== "v"
      )
        return;
      const button = toggleButton.current;
      // Retained workspaces stay mounted. Only the visible main file owns this shortcut.
      const visible = [
        ...document.querySelectorAll<HTMLButtonElement>("[data-markdown-preview-toggle]"),
      ].find((candidate) => candidate.getClientRects().length > 0);
      if (!button || visible !== button) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (!event.repeat) button.click();
    };
    window.addEventListener("keydown", shortcut, true);
    return () => window.removeEventListener("keydown", shortcut, true);
  }, [markdown]);
  const previewControl = markdown ? (
    <ToolButton
      ref={toggleButton}
      data-markdown-preview-toggle
      label={reading ? "Edit source" : "Read"}
      shortcut="⌘ ⇧ V"
      icon={reading ? "edit" : "read"}
      aria-keyshortcuts="Meta+Shift+V Control+Shift+V"
      onClick={toggleReading}
    />
  ) : undefined;
  const canEdit =
    !!props.editor &&
    !props.compact &&
    (props.file?.source.kind === "worktree" || props.file?.source.kind === "local") &&
    props.file.kind === "text" &&
    !props.file.truncated &&
    props.file.size <= 1024 * 1024 &&
    !props.loading;
  // The source is a keystroke away: its editor loads while the file reads.
  useEffect(() => {
    if (reading && canEdit) EditableFile.preload();
  }, [reading, canEdit]);
  const begin = (insert = false, position?: { line: number; column: number }) => {
    if (!canEdit || !props.file || !props.editor) return;
    try {
      const draft = store.open(props.editor.key, props.file, position?.line ?? props.line);
      store.update(draft, { insertOnOpen: insert, column: position?.column ?? props.column });
      setEditError("");
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    }
  };
  const editorKey = props.editor?.key;
  // Reconcile only a new host read, not a save notification with old view props.
  useLayoutEffect(() => {
    if (!editorKey || props.loading || props.file?.kind !== "text") return;
    const existing = store.get(editorKey);
    if (
      existing?.editing &&
      !existing.dirty &&
      !existing.saving &&
      existing.file.identity !== props.file.identity
    )
      store.open(editorKey, props.file, props.line);
  }, [store, editorKey, props.file, props.loading, props.line]);
  const autoOpened = useRef("");
  useLayoutEffect(() => {
    if (canEdit && autoOpened.current !== sourceKey) {
      autoOpened.current = sourceKey;
      begin();
    }
  });
  if (props.file?.media && !props.loading)
    return <MediaFileView key={props.file.identity} {...props} file={props.file} />;
  if (reading && props.file && !props.loading && !props.error)
    return (
      <div ref={reader} className="med-markdown-reader">
        {/* The header matches the source view's, so nothing moves as the views change. */}
        <header
          data-lift-row={draft?.editing ? "editor" : ""}
          {...stylex.props(styles.header, draft?.editing && styles.editorHeader)}
        >
          {draft?.editing ? (
            <span
              role="img"
              aria-label={draft.dirty ? "Unsaved changes" : "Saved"}
              title={draft.dirty ? "Unsaved changes" : "Saved"}
              {...stylex.props(styles.saveDot, draft.dirty && styles.unsaved)}
            />
          ) : (
            <Icon name="file" size={15} />
          )}
          <span
            {...stylex.props(styles.path)}
            title={fileTitle(props.file.path, props.file.size, quiet)}
          >
            {props.path ?? props.file.path}
          </span>
          {!draft?.editing && (
            <span {...stylex.props(styles.badge)} title={props.sourceLabel}>
              {props.sourceLabel.replace(/^Working files\b/, "Working file")}
            </span>
          )}
          {props.refreshAvailable && (
            <ToolButton
              label="Refresh file"
              icon="refresh"
              disabled={!!draft?.dirty}
              onClick={props.onRefresh}
            />
          )}
          {previewControl}
          {props.onClose && <ToolButton label="Close file" icon="close" onClick={props.onClose} />}
        </header>
        <Suspense fallback={<div className="med-markdown" aria-hidden="true" />}>
          <MarkdownPreview
            key={sourceKey}
            model={markdownModel}
            onOpenFile={props.onOpenFile}
            file={draft?.editing ? draft.file : props.file}
          />
        </Suspense>
      </div>
    );
  if (draft?.editing && props.editor)
    return (
      <Suspense fallback={null}>
        <EditableFile
          key={props.editor.key}
          draft={draft}
          drafts={store}
          write={props.editor.write}
          onClose={() => props.onClose?.()}
          context={props}
          previewControl={previewControl}
          onSourcePosition={markdown ? followSource : undefined}
        />
      </Suspense>
    );
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0, minWidth: 0 }}>
      {editError && <div role="alert">{editError}</div>}
      <ReadOnlyFileView
        {...props}
        previewControl={previewControl}
        onSourcePosition={markdown ? followSource : undefined}
      />
    </div>
  );
});
