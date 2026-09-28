import { ToolButton } from "./ToolButton";
import * as stylex from "@stylexjs/stylex";
import { prepareFileTreeInput } from "@pierre/trees";
import { FileTree, useFileTree } from "@pierre/trees/react";
import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import type { BrowseEntry } from "../../shared/browse";
import { tokens, ui } from "../theme.stylex";

export interface RepositoryFilesProps {
  entries: BrowseEntry[];
  loading: boolean;
  error: string | null;
  truncated: boolean;
  sourceLabel: string;
  selectedPath: string | null;
  onPreview(path: string): void;
  onPin(path: string): void;
  onPrefetch?(path: string): void;
  ignored?: boolean;
  onIgnoredChange?(value: boolean): void;
  label?: string;
  onRefresh(): void;
  onClose(): void;
}

export function RepositoryFiles(props: RepositoryFilesProps) {
  const {
    entries,
    loading,
    error,
    truncated,
    sourceLabel,
    selectedPath,
    onPreview,
    onPin,
    onPrefetch,
    ignored,
    onIgnoredChange,
    onRefresh,
    onClose,
  } = props;
  const latest = useRef({ entries, onPreview });
  useLayoutEffect(() => {
    latest.current = { entries, onPreview };
  }, [entries, onPreview]);
  const syncing = useRef(false);
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
  const { model } = useFileTree({
    preparedInput,
    initialExpansion: 1,
    flattenEmptyDirectories: true,
    density: "compact",
    onSelectionChange(paths) {
      if (syncing.current) return;
      const path = paths.at(-1);
      if (
        path &&
        latest.current.entries.some((entry) => entry.path === path && entry.kind !== "directory")
      )
        latest.current.onPreview(path);
    },
  });
  useEffect(() => {
    if (appliedInput.current === preparedInput) return;
    syncing.current = true;
    model.resetPaths({ preparedInput });
    appliedInput.current = preparedInput;
    syncing.current = false;
  }, [preparedInput, model]);
  useEffect(() => {
    if (!selectedPath || model.getSelectedPaths().includes(selectedPath)) return;
    syncing.current = true;
    for (const selected of model.getSelectedPaths()) model.getItem(selected)?.deselect();
    const parts = selectedPath.split("/");
    for (let depth = 1; depth < parts.length; depth++) {
      const parent = model.getItem(parts.slice(0, depth).join("/"));
      if (parent && "expand" in parent) parent.expand();
    }
    model.getItem(selectedPath)?.select();
    model.scrollToPath(selectedPath, { focus: false, offset: "nearest" });
    syncing.current = false;
  }, [selectedPath, entries, model]);
  function pinSelected() {
    const path = model.getSelectedPaths().at(-1);
    if (path && entries.some((entry) => entry.path === path && entry.kind !== "directory"))
      onPin(path);
  }
  return (
    <aside {...stylex.props(styles.panel)} aria-label={props.label ?? "Repository files"}>
      <div {...stylex.props(styles.heading)}>
        <span>Files</span>
        <span {...stylex.props(ui.grow)} />
        <ToolButton label="Refresh files" icon="refresh" onClick={onRefresh} />
        <ToolButton label="Close files sidebar" icon="close" onClick={onClose} />
      </div>
      <div {...stylex.props(styles.source)} title={sourceLabel}>
        {sourceLabel}
      </div>
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
        <FileTree
          model={model}
          onPointerOver={(event) => {
            const row = event.nativeEvent
              .composedPath()
              .find((node) => node instanceof HTMLElement && node.dataset.itemType === "file") as
              | HTMLElement
              | undefined;
            if (row?.dataset.itemPath) onPrefetch?.(row.dataset.itemPath);
          }}
          aria-label="Files"
          className={stylex.props(styles.tree).className}
          onDoubleClick={pinSelected}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              pinSelected();
            }
          }}
          style={
            {
              "--trees-font-family-override": tokens.ui,
              "--trees-theme-sidebar-header-fg": tokens.muted,
              "--trees-accent-override": tokens.accent,
              "--trees-theme-sidebar-bg": tokens.panel,
              "--trees-theme-sidebar-fg": tokens.text,
              "--trees-theme-list-active-selection-bg": tokens.selected,
              "--trees-theme-list-active-selection-fg": tokens.text,
              "--trees-theme-list-hover-bg": tokens.hover,
              "--trees-theme-focus-ring": tokens.accent,
            } as CSSProperties
          }
        />
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
}
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
  tree: { flex: "1", minHeight: 0, width: "100%", overflow: "hidden" },
  message: { fontSize: 12, lineHeight: 1.6, color: tokens.muted, paddingInline: 14 },
});
