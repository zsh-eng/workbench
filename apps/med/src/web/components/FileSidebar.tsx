import * as stylex from "@stylexjs/stylex";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { GitStatusEntry } from "@pierre/trees";
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from "react";
import type { ParsedReviewFile } from "../data/controller";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

export function FileSidebar({
  files,
  total,
  selected,
  filter,
  onFilter,
  onSelect,
  onOpen,
  onPrefetch,
  filterRef,
}: {
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
  const { model } = useFileTree({
    paths: [],
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    density: "compact",
    onSelectionChange: (paths) => {
      if (syncing.current || pointer.current) return;
      const file = latest.current.files.find((entry) => entry.path === paths.at(-1));
      if (file) latest.current.onSelect(file.id);
    },
  });
  useEffect(() => {
    syncing.current = true;
    model.resetPaths(files.map((file) => file.path));
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
      <div {...stylex.props(styles.heading)}>
        <span>Changes</span>
        <span {...stylex.props(styles.count)}>{filter ? `${files.length} / ${total}` : total}</span>
      </div>
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
      <FileTree
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
        onPointerOver={(event) => {
          const row = event.nativeEvent
            .composedPath()
            .find((node) => node instanceof HTMLElement && node.dataset.itemType === "file") as
            | HTMLElement
            | undefined;
          if (row?.dataset.itemPath) onPrefetch?.(row.dataset.itemPath);
        }}
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
            "--trees-border-radius-override": "6px",
            "--trees-item-margin-x-override": "6px",
            "--trees-fg-muted-override": tokens.faint,
            "--trees-indent-guide-bg-override": tokens.line,
            "--trees-theme-sidebar-header-fg": tokens.muted,
            "--trees-accent-override": tokens.accent,
            "--trees-theme-sidebar-bg": tokens.panel,
            "--trees-theme-sidebar-fg": tokens.text,
            "--trees-theme-list-active-selection-bg": tokens.selected,
            "--trees-selected-bg-override": tokens.selected,
            "--trees-theme-list-active-selection-fg": tokens.text,
            "--trees-theme-list-hover-bg": tokens.fill,
            "--trees-theme-focus-ring": tokens.accentLine,
            "--trees-theme-git-added-fg": tokens.green,
            "--trees-theme-git-deleted-fg": tokens.red,
            "--trees-theme-git-modified-fg": tokens.accent,
          } as CSSProperties
        }
      />
      {files.length === 0 && (
        <p {...stylex.props(styles.empty)}>{filter ? "No matching files" : "No changed files"}</p>
      )}
    </section>
  );
}

const styles = stylex.create({
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
  heading: {
    height: 36,
    minHeight: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 14,
    color: tokens.muted,
    fontSize: 11.5,
    fontWeight: 500,
  },
  count: {
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
    borderRadius: 7,
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
  tree: { flex: "1", minHeight: 0, width: "100%", overflow: "hidden" },
  empty: { color: tokens.muted, fontSize: 12, paddingInline: 14 },
});
