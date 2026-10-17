import { ToolButton } from "./ToolButton";
import * as stylex from "@stylexjs/stylex";
import { prepareFileTreeInput } from "@pierre/trees";
import { StableFileTree, useStableFileTree } from "./StableFileTree";
import { memo, useEffect, useMemo, useRef, type CSSProperties, type ReactNode } from "react";
import type { BrowseEntry } from "../../shared/browse";
import { tokens, ui } from "../theme.stylex";
import { treeIcons } from "./tree-icons";
import { paneHandle } from "./PaneTree";
import { PathContextMenu, treeRowPath, type PathActions } from "./PathMenu";

export interface RepositoryFilesProps {
  entries: BrowseEntry[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  /** What the files are from, when nothing nearby names it. */
  sourceLabel?: string;
  /** The checkout that holds the files, for Reveal in Finder. */
  repo?: string | null;
  pathActions?: PathActions;
  selectedPath: string | null;
  /** A click or Enter opens a file in its tab; ⌘-click opens it in the background. */
  onOpen(path: string, background?: boolean): void;
  onPrefetch?(path: string): void;
  ignored?: boolean;
  onIgnoredChange?(value: boolean): void;
  label?: string;
  onRefresh(): void;
  onClose(): void;
  /** The column's pane controls, in place of the close button. */
  controls?: ReactNode;
}

/** Memoized: the review renders again for unrelated state, such as a palette. */
export const RepositoryFiles = memo(function RepositoryFiles(props: RepositoryFilesProps) {
  const {
    entries,
    loading,
    error,
    truncated,
    sourceLabel,
    repo = null,
    pathActions,
    selectedPath,
    onOpen,
    onPrefetch,
    ignored,
    onIgnoredChange,
    onRefresh,
    onClose,
    controls,
  } = props;
  // Parse and sort once per manifest, not on sidebar toggles or file selection.
  const preparedInput = useMemo(
    () =>
      prepareFileTreeInput(
        entries.map((entry) =>
          entry.kind === "directory" ? `${entry.path.replace(/\/$/, "")}/` : entry.path,
        ),
      ),
    [entries],
  );
  const appliedInput = useRef(preparedInput);
  const model = useStableFileTree({
    preparedInput,
    initialExpansion: 1,
    flattenEmptyDirectories: true,
    density: "compact",
    icons: treeIcons,
  });
  useEffect(() => {
    if (appliedInput.current === preparedInput) return;
    model.resetPaths({ preparedInput });
    appliedInput.current = preparedInput;
  }, [preparedInput, model]);
  useEffect(() => {
    if (!selectedPath || model.getSelectedPaths().includes(selectedPath)) return;
    for (const selected of model.getSelectedPaths()) model.getItem(selected)?.deselect();
    const parts = selectedPath.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = model.getItem(parts.slice(0, depth).join("/"));
      if (parent && "expand" in parent) parent.expand();
    }
    model.getItem(selectedPath)?.select();
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" });
  }, [selectedPath, entries, model]);
  const isFile = (path: string | undefined): path is string =>
    !!path && entries.some((entry) => entry.path === path && entry.kind !== "directory");
  // The arrow keys move the focus without opening each file they pass; Enter
  // opens the focused file, or opens or closes the focused folder.
  function openFocused() {
    const item = model.getFocusedItem();
    const path = model.getFocusedPath() ?? model.getSelectedPaths().at(-1);
    if (isFile(path)) onOpen(path);
    else if (item && "expand" in item) {
      if (item.isExpanded()) item.collapse();
      else item.expand();
    }
  }
  const rowPath = (event: { nativeEvent: Event }) =>
    (
      event.nativeEvent
        .composedPath()
        .find((node) => node instanceof HTMLElement && node.dataset.itemType === "file") as
        | HTMLElement
        | undefined
    )?.dataset.itemPath;
  return (
    <aside
      {...stylex.props(styles.panel, controls !== undefined && styles.inColumn)}
      aria-label={props.label ?? "Repository files"}
    >
      {controls !== undefined ? (
        <div {...paneHandle} {...stylex.props(styles.paneHeading)}>
          <span {...stylex.props(styles.paneTitle)}>Files</span>
          <span {...stylex.props(ui.grow)} />
          <ToolButton label="Refresh files" icon="refresh" onClick={onRefresh} />
          {controls}
        </div>
      ) : (
        <div {...stylex.props(styles.heading)}>
          <span {...stylex.props(ui.label)}>Files</span>
          <span {...stylex.props(ui.grow)} />
          <ToolButton label="Refresh files" icon="refresh" onClick={onRefresh} />
          <ToolButton label="Close files sidebar" icon="close" onClick={onClose} />
        </div>
      )}
      {sourceLabel && (
        <div {...stylex.props(styles.source)} title={sourceLabel}>
          {sourceLabel}
        </div>
      )}
      {onIgnoredChange && (
        <label {...stylex.props(styles.ignored)}>
          <input
            type="checkbox"
            checked={ignored}
            onChange={(event) => onIgnoredChange(event.target.checked)}
          />
          Show ignored files
        </label>
      )}
      {loading && (
        <p role="status" {...stylex.props(styles.message)}>
          Loading files…
        </p>
      )}
      {error && (
        <p role="alert" {...stylex.props(styles.message)}>
          {error}
        </p>
      )}
      {!loading && !error && (
        <PathContextMenu
          actions={pathActions}
          render={<div />}
          className={stylex.props(styles.treeFrame).className}
          locate={(event) => {
            const path = treeRowPath(event);
            return path ? { repo, path } : null;
          }}
        >
          <StableFileTree
            model={model}
            onPointerOver={(event) => {
              const path = rowPath(event);
              if (path) onPrefetch?.(path);
            }}
            aria-label="Files"
            className={stylex.props(styles.tree).className}
            onClick={(event) => {
              const path = rowPath(event);
              if (!isFile(path) || event.shiftKey || event.altKey) return;
              onOpen(path, event.metaKey || event.ctrlKey);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                openFocused();
              }
            }}
            style={
              {
                "--trees-font-family-override": tokens.ui,
                "--trees-theme-sidebar-header-fg": tokens.muted,
                "--trees-accent-override": tokens.accent,
                "--trees-theme-sidebar-bg": controls !== undefined ? tokens.canvas : tokens.panel,
                "--trees-theme-sidebar-fg": tokens.text,
                "--trees-theme-list-active-selection-bg": tokens.selected,
                "--trees-theme-list-active-selection-fg": tokens.selectedText,
                "--trees-theme-list-hover-bg": tokens.hover,
                "--trees-theme-focus-ring": tokens.accent,
              } as CSSProperties
            }
          />
        </PathContextMenu>
      )}
      {!loading && !error && entries.length === 0 && (
        <p {...stylex.props(styles.message)}>No files in this source.</p>
      )}
      {truncated && (
        <p role="status" {...stylex.props(styles.message)}>
          File list limit reached. Some files are not shown.
        </p>
      )}
    </aside>
  );
});
const styles = stylex.create({
  panel: {
    flex: "1",
    height: "100%",
    minHeight: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    backgroundColor: tokens.panel,
    color: tokens.text,
    fontFamily: tokens.ui,
    overflow: "hidden",
  },
  // In the pane column: the column's card color, and its 40-pixel header.
  inColumn: { backgroundColor: tokens.canvas },
  paneHeading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 38,
    flexShrink: 0,
    marginBottom: 8,
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  paneTitle: { color: tokens.text, fontSize: 12.5, fontWeight: 500 },
  heading: {
    height: 32,
    minHeight: 32,
    display: "flex",
    alignItems: "center",
    gap: 3,
    paddingInline: 12,
    fontSize: 11,
    fontWeight: 600,
    color: tokens.muted,
  },
  source: {
    paddingInline: 14,
    paddingBottom: 9,
    fontSize: 11,
    color: tokens.muted,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
  },
  ignored: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    paddingInline: 11,
    paddingBottom: 8,
    fontSize: 11,
    color: tokens.muted,
  },
  treeFrame: { flex: "1", minHeight: 0, display: "flex", flexDirection: "column" },
  tree: { flex: "1", minHeight: 0, width: "100%", overflow: "hidden" },
  message: { fontSize: 12, lineHeight: 1.6, color: tokens.muted, paddingInline: 14 },
});
