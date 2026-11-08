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
  showBrief = false,
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
  /** The Pull request tab, after Review and before Changes. */
  showBrief?: boolean;
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
        {showBrief && (
          <Tabs.Tab
            value="brief"
            aria-controls={panelId}
            aria-label="Pull request"
            {...stylex.props(
              styles.tab,
              styles.changes,
              styles.enter,
              active === "brief" && styles.active,
            )}
          >
            Pull request
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
  // Plain rectangles, a line between each. The strip's bottom line is a
  // shadow inside it, so the current tab, on the file's color, covers it
  // and joins the file below.
  root: {
    display: "flex",
    alignItems: "stretch",
    flexShrink: 0,
    minWidth: 0,
    height: 32,
    minHeight: 32,
    boxSizing: "border-box",
    backgroundColor: tokens.panel,
    boxShadow: `inset 0 -1px 0 ${tokens.line}`,
  },
  // The tabs narrow as more open and never scroll.
  list: {
    display: "flex",
    alignItems: "stretch",
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
  },
  // Longhands win over the list's flex shorthand. In a narrow row the tabs
  // narrow before the row's last controls shrink.
  keep: { flexBasis: "auto", flexShrink: 100 },
  item: {
    position: "relative",
    display: "flex",
    alignItems: "stretch",
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 200,
    minWidth: 56,
  },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    minWidth: 0,
    borderWidth: 0,
    borderRadius: 0,
    boxShadow: `inset -1px 0 0 ${tokens.line}`,
    backgroundColor: { default: "transparent", ":hover": tokens.fill },
    color: { default: tokens.muted, ":hover": tokens.text },
    paddingInline: 12,
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
  fileTab: { width: "100%", paddingInlineStart: 10, paddingInlineEnd: 28 },
  active: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.canvas, ":hover": tokens.canvas },
  },
  // A long name fades at the tab's edge; a short one never reaches it.
  name: {
    flex: "1",
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textAlign: "start",
    maskImage: "linear-gradient(to right, #000 calc(100% - 18px), transparent)",
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
    insetInlineEnd: 12,
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
    insetInlineEnd: 6,
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
