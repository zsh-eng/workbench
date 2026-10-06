import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { Tabs } from "@base-ui/react/tabs";
import { distinctLabels } from "../data/tab-labels";
import { tokens } from "../theme.stylex";
import { Icon } from "./Icon";

export interface FileViewTab {
  id: string;
  path: string;
  pinned: boolean;
  dirty?: boolean;
  sourceLabel?: string;
  sourcePath?: string;
}
export function FileViewTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onPin,
  panelId = "file-view-panel",
  showChanges = true,
  showBrief = false,
  changesCount,
  leading,
  trailing,
}: {
  tabs: FileViewTab[];
  active: string;
  panelId?: string;
  showChanges?: boolean;
  /** A saved review's brief comes first, before Changes. */
  showBrief?: boolean;
  /** Changed-file count shown beside the Changes tab. */
  changesCount?: number;
  /** Controls placed before the tabs and at the end of the tab row. */
  leading?: ReactNode;
  trailing?: ReactNode;
  onSelect(id: string): void;
  onClose(id: string): void;
  onPin(id: string): void;
}) {
  const labels = distinctLabels(
    tabs.map((tab) => ({
      label: tab.path.split("/").at(-1)!,
      qualifier: tabs.some((other) => other.id !== tab.id && other.path === tab.path)
        ? `${tabs.some((other) => other.path === tab.path && other.sourcePath !== tab.sourcePath) ? (tab.sourcePath ?? tab.sourceLabel ?? "File") : (tab.sourceLabel ?? "File")}/${tab.path.split("/").slice(0, -1).join("/")}`
        : tab.path.split("/").slice(0, -1).join("/"),
    })),
  );
  return (
    <Tabs.Root
      value={active}
      onValueChange={(value) => onSelect(String(value))}
      {...stylex.props(styles.root)}
    >
      {leading}
      <Tabs.List aria-label="Open files" {...stylex.props(styles.list)}>
        {showBrief && (
          <Tabs.Tab
            value="brief"
            aria-controls={panelId}
            aria-label="Brief"
            {...stylex.props(
              styles.tab,
              styles.changes,
              styles.enter,
              active === "brief" && styles.active,
            )}
          >
            <Icon name="brief" size={14} />
            Brief
          </Tabs.Tab>
        )}
        {showChanges && (
          <Tabs.Tab
            value="changes"
            aria-controls={panelId}
            aria-label="Changes"
            {...stylex.props(styles.tab, styles.changes, active === "changes" && styles.active)}
          >
            <Icon name="diff" size={14} />
            Changes
            {changesCount !== undefined && (
              <span {...stylex.props(styles.count)}>{changesCount.toLocaleString()}</span>
            )}
          </Tabs.Tab>
        )}
        {tabs.map((tab, index) => (
          <div key={tab.id} {...stylex.props(styles.item, stylex.defaultMarker())}>
            <Tabs.Tab
              value={tab.id}
              aria-controls={panelId}
              title={`${tab.path}${tab.sourceLabel ? ` · ${tab.sourceLabel}` : ""}${tab.pinned ? "" : " · Preview (double-click to keep open)"}`}
              onDoubleClick={() => onPin(tab.id)}
              {...stylex.props(
                styles.tab,
                styles.fileTab,
                !tab.pinned && styles.preview,
                active === tab.id && styles.active,
              )}
            >
              <Icon name="file" size={14} />
              <span {...stylex.props(styles.name)}>{labels[index]}</span>
              {tab.dirty && (
                <span
                  aria-label="Unsaved changes"
                  title="Unsaved changes"
                  {...stylex.props(styles.dirty)}
                />
              )}
            </Tabs.Tab>
            <button
              {...stylex.props(styles.close, active === tab.id && styles.closeVisible)}
              aria-label={`Close ${tab.path}`}
              title={`Close ${tab.path}`}
              onClick={() => onClose(tab.id)}
            >
              <Icon name="close" size={12} />
            </button>
          </div>
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
  root: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexShrink: 0,
    minWidth: 0,
    height: 38,
    minHeight: 38,
    boxSizing: "border-box",
    paddingInline: 6,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.line,
  },
  list: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    flex: "1",
    minWidth: 0,
    overflowX: "auto",
    scrollbarWidth: "none",
  },
  item: { position: "relative", display: "flex", alignItems: "center", flexShrink: 0 },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 26,
    borderWidth: 0,
    borderRadius: 6,
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
  changes: { paddingInlineEnd: 6 },
  enter: {
    animationName: { default: tabEnter, "@media (prefers-reduced-motion: reduce)": "none" },
    animationDuration: "200ms",
    animationTimingFunction: tokens.easeOut,
  },
  fileTab: { paddingInlineEnd: 26 },
  active: {
    color: { default: tokens.text, ":hover": tokens.text },
    backgroundColor: { default: tokens.fillStrong, ":hover": tokens.fillStrong },
  },
  preview: { fontStyle: "italic" },
  name: { maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" },
  count: {
    minWidth: 18,
    paddingInline: 5,
    borderRadius: 9,
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
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.warning,
    flexShrink: 0,
  },
  close: {
    position: "absolute",
    insetInlineEnd: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 18,
    height: 18,
    padding: 0,
    borderWidth: 0,
    borderRadius: 5,
    cursor: "pointer",
    backgroundColor: { default: "transparent", ":hover": tokens.fillStrong },
    color: { default: tokens.faint, ":hover": tokens.text },
    opacity: { default: 0, [stylex.when.ancestor(":hover")]: 1, ":focus-visible": 1 },
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accentLine}` },
  },
  closeVisible: { opacity: 1 },
});
