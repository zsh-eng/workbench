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
  const { model } = useFileTree({
    paths: [],
    initialExpansion: "open",
    flattenEmptyDirectories: true,
    density: "compact",
    onSelectionChange: (paths) => {
      if (syncing.current) return;
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
        <span {...stylex.props(ui.faint, ui.mono)}>
          {filter ? `${files.length} / ${total}` : total}
        </span>
      </div>
      <div {...stylex.props(styles.filter)}>
        <Icon name="search" size={13} />
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
            {...stylex.props(ui.button, ui.iconButton)}
            onClick={() => onFilter("")}
            aria-label="Clear file filter"
          >
            <Icon name="close" size={12} />
          </button>
        )}
      </div>
      <FileTree
        model={model}
        onPointerDownCapture={(event) => {
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
          if (!onOpen || (!event.metaKey && !event.ctrlKey)) return;
          const row = event.nativeEvent
            .composedPath()
            .find((node) => node instanceof HTMLElement && node.dataset.itemType === "file") as
            | HTMLElement
            | undefined;
          const file = files.find((item) => item.path === row?.dataset.itemPath);
          if (!file) return;
          event.preventDefault();
          event.stopPropagation();
          onOpen(file.id, true);
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
            "--trees-theme-sidebar-header-fg": tokens.muted,
            "--trees-accent-override": tokens.accent,
            "--trees-theme-sidebar-bg": tokens.panel,
            "--trees-theme-sidebar-fg": tokens.text,
            "--trees-theme-list-active-selection-bg": tokens.selected,
            "--trees-theme-list-active-selection-fg": tokens.text,
            "--trees-theme-list-hover-bg": tokens.hover,
            "--trees-theme-focus-ring": tokens.accent,
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
  },
  heading: {
    height: 37,
    minHeight: 37,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: 14,
    color: tokens.muted,
    fontSize: 11,
    fontWeight: 600,
  },
  filter: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    marginInline: 10,
    marginBottom: 8,
    paddingLeft: 7,
    height: 27,
    borderWidth: 1,
    borderStyle: "solid",
    borderColor: tokens.border,
    borderRadius: 7,
    color: tokens.faint,
  },
  input: {
    borderWidth: 0,
    outline: "none",
    backgroundColor: "transparent",
    color: tokens.text,
    minWidth: 0,
    width: "100%",
    fontSize: 11,
    fontFamily: tokens.ui,
  },
  tree: { flex: "1", minHeight: 0, width: "100%", overflow: "hidden" },
  empty: { color: tokens.muted, fontSize: 12, paddingInline: 14 },
});
