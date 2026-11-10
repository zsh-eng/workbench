import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { distinctLabels } from "../data/tab-labels";
import { tokens } from "../theme.stylex";
import { FileIcon } from "./FileIcon";
import { Icon } from "./Icon";
import { paneHandle } from "./PaneTree";
import { PathContextMenu, type PathActions } from "./PathMenu";

export interface FileViewTab {
  id: string;
  path: string;
  dirty?: boolean;
  sourceLabel?: string;
  /** The source checkout's absolute path, to compare sources and reveal files. */
  sourcePath?: string;
  /** The source checkout's short name, to tell apart tabs with the same path. */
  sourceName?: string;
}
export function FileViewTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onCloseOthers,
  onCloseAll,
  panelId = "file-view-panel",
  showChanges = true,
  showReview = false,
  showCommit = false,
  search,
  changesCount,
  leading,
  trailing,
  pathActions,
}: {
  pathActions?: PathActions;
  tabs: FileViewTab[];
  active: string;
  panelId?: string;
  showChanges?: boolean;
  /** What the agent handed off, with its Guide, comes first. */
  showReview?: boolean;
  /** Stage, commit, and push a live checkout. */
  showCommit?: boolean;
  /** The Search tab's label, its query, after Commit; without one, no Search tab. */
  search?: string;
  /** Changed-file count shown beside the Changes tab. */
  changesCount?: number;
  /** Controls placed before the tabs and at the end of the tab row. */
  leading?: ReactNode;
  trailing?: ReactNode;
  onSelect(id: string): void;
  onClose(id: string): void;
  /** Close every file tab but this one; in the tab's context menu. */
  onCloseOthers?(id: string): void;
  /** Close every file tab; in the tab's context menu. */
  onCloseAll?(): void;
}) {
  const searchLabel = search?.trim();
  // The row scrolls; the tab on screen stays in view, also when it opens.
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = list.current;
    const tab = row?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    if (!row || !tab) return;
    // Only the row scrolls, never the pane or the page around it.
    const bounds = row.getBoundingClientRect();
    // A file's tab and its close button share one item.
    const place = (tab.parentElement === row ? tab : tab.parentElement!).getBoundingClientRect();
    if (place.left < bounds.left) row.scrollLeft -= bounds.left - place.left;
    else if (place.right > bounds.right) row.scrollLeft += place.right - bounds.right;
  }, [active, tabs.length]);
  const labels = distinctLabels(
    tabs.map((tab) => ({
      label: tab.path.split("/").at(-1)!,
      qualifier: tabs.some((other) => other.id !== tab.id && other.path === tab.path)
        ? `${tabs.some((other) => other.path === tab.path && other.sourcePath !== tab.sourcePath) ? (tab.sourceName ?? tab.sourceLabel ?? "File") : (tab.sourceLabel ?? "File")}/${tab.path.split("/").slice(0, -1).join("/")}`
        : tab.path.split("/").slice(0, -1).join("/"),
    })),
  );
  return (
    <Tabs.Root
      value={active}
      onValueChange={(value) => onSelect(String(value))}
      {...paneHandle}
      {...stylex.props(styles.root)}
    >
      {leading}
      <Tabs.List ref={list} aria-label="Open files" {...stylex.props(styles.list, styles.keep)}>
        {showReview && (
          <Tabs.Tab
            value="review"
            aria-controls={panelId}
            aria-label="Review"
            title="What the agent handed off"
            {...stylex.props(
              styles.tab,
              styles.changes,
              styles.enter,
              active === "review" && styles.active,
            )}
          >
            Review
          </Tabs.Tab>
        )}
        {showChanges && (
          <Tabs.Tab
            value="changes"
            aria-controls={panelId}
            aria-label="Changes"
            {...stylex.props(styles.tab, styles.changes, active === "changes" && styles.active)}
          >
            Changes
            {changesCount !== undefined && (
              <span {...stylex.props(styles.count)}>{changesCount.toLocaleString()}</span>
            )}
          </Tabs.Tab>
        )}
        {showCommit && (
          <Tabs.Tab
            value="commit"
            aria-controls={panelId}
            aria-label="Commit"
            title="Stage, commit, and push (q)"
            {...stylex.props(styles.tab, styles.changes, active === "commit" && styles.active)}
          >
            Commit
          </Tabs.Tab>
        )}
        {search !== undefined && (
          <div {...stylex.props(styles.item, stylex.defaultMarker())}>
            <Tabs.Tab
              value="search"
              aria-controls={panelId}
              aria-label={searchLabel ? `Search: ${searchLabel}` : "Search"}
              title={searchLabel ? `Search: ${searchLabel} (⌘⇧F)` : "Search (⌘⇧F)"}
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose("search");
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              {...stylex.props(styles.tab, styles.fileTab, active === "search" && styles.active)}
            >
              <Icon name="search" size={12} />
              <span {...stylex.props(styles.name, styles.query)}>{searchLabel || "Search"}</span>
            </Tabs.Tab>
            <button
              {...stylex.props(styles.close, active === "search" && styles.closeVisible)}
              aria-label="Close search"
              title="Close search"
              onClick={() => onClose("search")}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
        )}
        {tabs.map((tab, index) => (
          <PathContextMenu
            key={tab.id}
            actions={pathActions}
            render={<div />}
            className={stylex.props(styles.item, stylex.defaultMarker()).className}
            locate={() => ({ repo: tab.sourcePath ?? null, path: tab.path })}
            items={() => [
              { label: "Close", run: () => onClose(tab.id) },
              ...(onCloseOthers
                ? [
                    {
                      label: "Close other files",
                      disabled: tabs.length < 2,
                      run: () => onCloseOthers(tab.id),
                    },
                  ]
                : []),
              ...(onCloseAll ? [{ label: "Close all files", run: onCloseAll }] : []),
            ]}
          >
            <Tabs.Tab
              value={tab.id}
              aria-controls={panelId}
              title={`${tab.path}${tab.sourceLabel ? ` · ${tab.sourceLabel}` : ""}`}
              // A middle click closes the tab, as in a browser.
              onAuxClick={(event) => {
                if (event.button !== 1) return;
                event.preventDefault();
                onClose(tab.id);
              }}
              onMouseDown={(event) => {
                if (event.button === 1) event.preventDefault();
              }}
              {...stylex.props(styles.tab, styles.fileTab, active === tab.id && styles.active)}
            >
              <FileIcon path={tab.path} />
              <span {...stylex.props(styles.name)}>{labels[index]}</span>
            </Tabs.Tab>
            {/* An unsaved file's dot takes the close button's place, until hover. */}
            {tab.dirty && (
              <span
                aria-label="Unsaved changes"
                title="Unsaved changes"
                {...stylex.props(styles.dirty)}
              />
            )}
            <button
              {...stylex.props(
                styles.close,
                active === tab.id && !tab.dirty && styles.closeVisible,
              )}
              aria-label={`Close ${tab.path}`}
              title={`Close ${tab.path}`}
              onClick={() => onClose(tab.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </PathContextMenu>
        ))}
      </Tabs.List>
      {trailing}
    </Tabs.Root>
  );
}
const tabEnter = stylex.keyframes({
  from: { opacity: 0, transform: "translateX(-4px)" },
  to: { opacity: 1, transform: "none" },
});
const styles = stylex.create({
  // Plain tabs: a name on the page's own background, filled while the pointer
  // is on it and more firmly for the file on screen.
  root: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    minWidth: 0,
    height: 34,
    minHeight: 34,
    boxSizing: "border-box",
    paddingInline: 6,
    backgroundColor: tokens.canvas,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
  },
  // The tabs narrow as more open and never scroll.
  list: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
  },
  // Longhands win over the list's flex shorthand. In a narrow row the tabs
  // narrow before the row's last controls shrink.
  keep: { flexBasis: "auto", flexShrink: 100 },
  // A tab is as wide as its name, to a limit, and narrows as more open.
  item: {
    position: "relative",
    display: "flex",
    alignItems: "center",
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: "auto",
    minWidth: 56,
    maxWidth: 240,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    minWidth: 0,
    borderWidth: 0,
    borderRadius: `calc(6px * ${tokens.round})`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    paddingInline: 8,
    fontFamily: tokens.ui,
    fontSize: 12,
    fontWeight: 450,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
    outlineOffset: -2,
    whiteSpace: "nowrap",
  },
  changes: { flexShrink: 0 },
  enter: {
    animationName: { default: tabEnter, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "200ms",
    animationTimingFunction: tokens.easeOut,
  },
  fileTab: { width: "100%", paddingInlineStart: 8, paddingInlineEnd: 26 },
  active: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
  },
  // A long name ends in an ellipsis where the tab stops.
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    textAlign: "start",
  },
  query: { maxWidth: 180, whiteSpace: "pre" },
  count: {
    minWidth: 18,
    paddingInline: 5,
    borderRadius: `calc(9px * ${tokens.round})`,
    backgroundColor: tokens.fill,
    color: tokens.muted,
    fontFamily: tokens.code,
    fontSize: 10,
    lineHeight: "16px",
    textAlign: "center",
    fontStyle: "normal",
    fontVariantNumeric: "tabular-nums",
  },
  dirty: {
    position: "absolute",
    zIndex: 2,
    insetInlineEnd: 10,
    top: "calc(50% - 3px)",
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.warning,
    pointerEvents: "none",
    opacity: { default: 1, [stylex.when.ancestor(":hover")]: 0 },
  },
  close: {
    position: "absolute",
    zIndex: 2,
    insetInlineEnd: 4,
    top: "calc(50% - 9px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: `calc(5px * ${tokens.round})`,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1, ":focus-visible": 1 },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  closeVisible: { opacity: 1 },
});
