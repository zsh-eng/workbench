import * as stylex from "@stylexjs/stylex";
import { StableFileTree, useStableFileTree } from "./StableFileTree";
import type { GitStatusEntry } from "@pierre/trees";
import { memo, useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import type { ParsedReviewFile } from "../data/controller";
import { hoveredPath } from "../data/hovered-path";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";
import { paneHandle } from "./PaneTree";
import { PathContextMenu, treeRowPath, type PathActions } from "./PathMenu";
import { treeIcons } from "./tree-icons";

// A solid accent selection (Paper) draws the selected row's Git color in the
// row's text color; --med-selected-git is unset in other themes, which keep it.
const selectedGitColors = ["added", "deleted", "modified", "renamed", "untracked", "ignored"]
  .map(
    (status) =>
      `[data-item-selected="true"][data-item-git-status="${status}"] { --trees-item-git-status-color: var(--med-selected-git, var(--trees-git-${status}-color)); }`,
  )
  .join("\n");

// A row of folders, as "src / components / forms", gives way from its first
// folder, one folder at a time, so the folder nearest its files stays whole.
// Each folder keeps a letter and its "…"; 2ch leaves no gap after "src".
const folderRows = `
[data-item-flattened-subitems] { display: flex; min-width: 0; white-space: pre; }
[data-item-flattened-subitem] { flex: 0 1 auto; min-width: 2ch; white-space: normal; }
[data-item-flattened-subitem]:nth-child(1) { flex-shrink: 1e10; }
[data-item-flattened-subitem]:nth-child(2) { flex-shrink: 1e8; }
[data-item-flattened-subitem]:nth-child(3) { flex-shrink: 1e6; }
[data-item-flattened-subitem]:nth-child(n + 4) { flex-shrink: 1e4; }
[data-item-flattened-subitem]:last-child { flex-shrink: 1; }`;

/** Memoized: the review renders again for unrelated state, such as a palette. */
export const FileSidebar = memo(function FileSidebar({
  files,
  total,
  selected,
  filter,
  onFilter,
  onSelect,
  onOpen,
  onPrefetch,
  filterRef,
  repo = null,
  pathActions,
  controls,
  top,
}: {
  /** A pane's controls, at the heading's end. */
  controls?: React.ReactNode;
  /** Under the heading, above the filter, such as a stack's layers. */
  top?: React.ReactNode;
  /** The checkout that holds the files, for Reveal in Finder. */
  repo?: string | null;
  pathActions?: PathActions;
  files: ParsedReviewFile[];
  total: number;
  selected: string | null;
  filter: string;
  onFilter(value: string): void;
  onSelect(id: string): void;
  onOpen?(id: string, background?: boolean): void;
  onPrefetch?(path: string): void;
  filterRef: React.RefObject<HTMLInputElement | null>;
}) {
  const latest = useRef({ files, selected, onSelect });
  useLayoutEffect(() => {
    latest.current = { files, selected, onSelect };
  }, [files, selected, onSelect]);
  const syncing = useRef(false);
  // A pointer click reveals its file even when the row is already selected, so
  // selection changes from a pointer leave the reveal to the click handler.
  const pointer = useRef(false);
  const model = useStableFileTree({
    paths: [],
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    density: "compact",
    icons: treeIcons,
    unsafeCSS: `${selectedGitColors}\n${folderRows}`,
    onSelectionChange: (paths) => {
      if (syncing.current || pointer.current) return;
      const file = latest.current.files.find((entry) => entry.path === paths.at(-1));
      if (file) latest.current.onSelect(file.id);
    },
  });
  // Effects run again when a hidden workspace shows; the same files keep the tree.
  const applied = useRef<ParsedReviewFile[] | null>(null);
  useEffect(() => {
    if (applied.current === files) return;
    applied.current = files;
    syncing.current = true;
    // The tree throws on a repeated path, which would blank the app; show it once.
    model.resetPaths([...new Set(files.map((file) => file.path))]);
    const statuses: GitStatusEntry[] = files.map((file) => ({
      path: file.path,
      status: file.info.untracked
        ? "untracked"
        : file.info.status.startsWith("A")
          ? "added"
          : file.info.status.startsWith("D")
            ? "deleted"
            : file.info.previousPath
              ? "renamed"
              : "modified",
    }));
    model.setGitStatus(statuses);
    syncing.current = false;
  }, [files, model]);
  useEffect(() => {
    const path = files.find((file) => file.id === selected)?.path;
    if (!path || model.getSelectedPaths().includes(path)) return;
    syncing.current = true;
    for (const selectedPath of model.getSelectedPaths()) model.getItem(selectedPath)?.deselect();
    model.getItem(path)?.select();
    model.scrollToPath(path, { focus: false, offset: "nearest" });
    syncing.current = false;
  }, [selected, files, model]);
  return (
    <section {...stylex.props(styles.panel)} aria-label="Changed files">
      <div {...(controls ? paneHandle : {})} {...stylex.props(styles.heading)}>
        <span {...stylex.props(ui.label)}>Changes</span>
        <span {...stylex.props(styles.count)}>{filter ? `${files.length} / ${total}` : total}</span>
        {controls && <span {...stylex.props(styles.controls)}>{controls}</span>}
      </div>
      {top}
      <div {...stylex.props(styles.filter)}>
        <Icon name="search" size={14} />
        <input
          ref={filterRef}
          value={filter}
          onChange={(event) => onFilter(event.target.value)}
          placeholder="Filter files…"
          aria-label="Filter changed files"
          {...stylex.props(styles.input)}
        />
        {filter && (
          <button
            {...stylex.props(ui.button, ui.iconButton, styles.clear)}
            onClick={() => onFilter("")}
            aria-label="Clear file filter"
          >
            <Icon name="close" size={13} />
          </button>
        )}
      </div>
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
          onPointerDownCapture={(event) => {
            pointer.current = true;
            if (!onOpen || (!event.metaKey && !event.ctrlKey)) return;
            if (
              !event.nativeEvent
                .composedPath()
                .some((node) => node instanceof HTMLElement && node.dataset.itemType === "file")
            )
              return;
            event.preventDefault();
            event.stopPropagation();
          }}
          onClickCapture={(event) => {
            pointer.current = false;
            const row = event.nativeEvent
              .composedPath()
              .find((node) => node instanceof HTMLElement && node.dataset.itemType === "file") as
              | HTMLElement
              | undefined;
            const file = files.find((item) => item.path === row?.dataset.itemPath);
            if (!file) return;
            if (onOpen && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              event.stopPropagation();
              onOpen(file.id, true);
            } else if (!event.shiftKey) onSelect(file.id);
          }}
          onKeyDownCapture={() => {
            pointer.current = false;
          }}
          // A cut name shows its path in the app's tooltip (AppTooltip).
          data-tooltip-tree=""
          onPointerOver={(event) => {
            const row = event.nativeEvent
              .composedPath()
              .find((node) => node instanceof HTMLElement && node.dataset.itemType === "file") as
              | HTMLElement
              | undefined;
            if (row?.dataset.itemPath) onPrefetch?.(row.dataset.itemPath);
            hoveredPath.set(row?.dataset.itemPath ?? null);
          }}
          onPointerLeave={() => hoveredPath.set(null)}
          onDoubleClick={(event) => {
            const row = event.nativeEvent
              .composedPath()
              .find((node) => node instanceof HTMLElement && node.dataset.itemType === "file") as
              | HTMLElement
              | undefined;
            const file = files.find((item) => item.path === row?.dataset.itemPath);
            if (file) onOpen?.(file.id);
          }}
          className={stylex.props(styles.tree).className}
          style={
            {
              "--trees-font-family-override": tokens.ui,
              "--trees-font-size-override": "12.5px",
              "--trees-border-radius-override": `calc(6px * ${tokens.round})`,
              "--trees-item-margin-x-override": "6px",
              "--trees-fg-muted-override": tokens.faint,
              "--trees-indent-guide-bg-override": tokens.line,
              "--trees-theme-sidebar-header-fg": tokens.muted,
              "--trees-accent-override": tokens.accent,
              "--trees-theme-sidebar-bg": tokens.panel,
              "--trees-theme-sidebar-fg": tokens.text,
              "--trees-theme-list-active-selection-bg": tokens.selected,
              "--trees-selected-bg-override": tokens.selected,
              "--trees-theme-list-active-selection-fg": tokens.selectedText,
              "--trees-selected-fg-override": tokens.selectedText,
              "--trees-theme-list-hover-bg": tokens.fill,
              "--trees-theme-focus-ring": tokens.accentLine,
              "--trees-theme-git-added-fg": tokens.green,
              "--trees-theme-git-deleted-fg": tokens.red,
              "--trees-theme-git-modified-fg": tokens.accent,
            } as CSSProperties
          }
        />
      </PathContextMenu>
      {files.length === 0 && (
        <p {...stylex.props(styles.empty)}>{filter ? "No matching files" : "No changed files"}</p>
      )}
    </section>
  );
});

const styles = stylex.create({
  controls: { display: "flex", alignItems: "center", marginBlock: -4, marginInlineEnd: -8 },
  panel: {
    flex: "1",
    minHeight: 140,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    // An inset hairline separates the two scroll areas without boxing them.
    backgroundImage: `linear-gradient(${tokens.line}, ${tokens.line})`,
    backgroundSize: "calc(100% - 24px) 1px",
    backgroundPosition: "12px 0",
    backgroundRepeat: "no-repeat",
  },
  // A pane's row: 38 pixels, as the review's tab row.
  heading: {
    height: 38,
    minHeight: 38,
    display: "flex",
    alignItems: "center",
    gap: 8,
    paddingInline: 14,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
  },
  count: {
    marginInlineStart: "auto",
    color: tokens.faint,
    fontFamily: tokens.code,
    fontSize: 10.5,
    fontVariantNumeric: "tabular-nums",
  },
  filter: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    marginInline: 8,
    marginBottom: 6,
    paddingInlineStart: 9,
    paddingInlineEnd: 2,
    height: 28,
    borderRadius: `calc(7px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    boxShadow: {
      default: `inset 0 0 0 1px ${tokens.line}`,
      ":focus-within": `inset 0 0 0 1px ${tokens.accentLine}, 0 0 0 3px ${tokens.accentSoft}`,
    },
    color: tokens.faint,
  },
  input: {
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    minWidth: 0,
    width: "100%",
    height: "100%",
    fontSize: 12,
    fontFamily: tokens.ui,
    "::placeholder": { color: tokens.faint },
  },
  clear: { width: 24, minWidth: 24, minHeight: 24, height: 24 },
  treeFrame: { flex: "1", minHeight: 0, display: "flex", flexDirection: "column" },
  tree: { flex: "1", minHeight: 0, width: "100%", overflow: "hidden" },
  empty: { color: tokens.muted, fontSize: 12, paddingInline: 14 },
});
