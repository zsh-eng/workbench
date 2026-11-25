import { ActionMenu } from "./Controls";
import { Icon } from "./Icon";
import * as stylex from "@stylexjs/stylex";
import { prepareFileTreeInput } from "@pierre/trees";
import { StableFileTree, useStableFileTree } from "./StableFileTree";
import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { BrowseEntry } from "../../shared/browse";
import { tokens, ui } from "../theme.stylex";
import { treeIcons } from "./tree-icons";
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
  /** The column's controls, at the heading's end. */
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
    controls,
  } = props;
  const [showLoading, setShowLoading] = useState(false);
  // A load that ends hides its note at once; one that lasts shows it.
  if (!loading && showLoading) setShowLoading(false);
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => setShowLoading(true), 300);
    return () => clearTimeout(timer);
  }, [loading]);
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
    <aside {...stylex.props(styles.panel)} aria-label={props.label ?? "Repository files"}>
      {/* One row, as tall as the file's own header beside it: what the tree
          shows, and its tools. */}
      <div {...stylex.props(styles.paneHeading)}>
        <span title={sourceLabel} {...stylex.props(styles.paneTitle)}>
          {sourceLabel?.split(" · ")[0] || "Files"}
        </span>
        <span {...stylex.props(ui.grow)} />
        <ActionMenu
          label="Files options"
          sections={[
            [
              { label: "Refresh files", onClick: onRefresh },
              ...(onIgnoredChange
                ? [
                    {
                      label: "Show ignored files",
                      checked: ignored,
                      onClick: () => onIgnoredChange(!ignored),
                    },
                  ]
                : []),
            ],
          ]}
        >
          <Icon name="more" size={15} />
        </ActionMenu>
        {controls}
      </div>
      {loading && showLoading && (
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
                // On the canvas, as every pane: apart from the app's sidebar.
                "--trees-theme-sidebar-bg": tokens.canvas,
                "--trees-theme-sidebar-fg": tokens.text,
                "--trees-theme-list-active-selection-bg": tokens.pick,
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
    // The pane or column it sits in gives the color.
    backgroundColor: "transparent",
    color: tokens.text,
    fontFamily: tokens.ui,
    overflow: "hidden",
  },
  paneHeading: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    boxSizing: "border-box",
    height: tokens.bar,
    flexShrink: 0,
    marginBottom: 6,
    paddingInlineStart: 14,
    paddingInlineEnd: 6,
    color: tokens.muted,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  paneTitle: {
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: tokens.text,
    fontSize: 12.5,
    fontWeight: 500,
  },
  treeFrame: { flex: "1", minHeight: 0, display: "flex", flexDirection: "column" },
  tree: { flex: "1", minHeight: 0, width: "100%", overflow: "hidden" },
  message: { fontSize: 12, lineHeight: 1.6, color: tokens.muted, paddingInline: 14 },
});
