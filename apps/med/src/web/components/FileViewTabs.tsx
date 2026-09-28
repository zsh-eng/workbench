import { ActionTooltip } from "./ToolButton";
import * as stylex from "@stylexjs/stylex";
import { Tabs } from "@base-ui/react/tabs";
import { distinctLabels } from "../data/tab-labels";
import { tokens, ui } from "../theme.stylex";
import { Icon } from "./Icon";

export interface FileViewTab {
  id: string;
  path: string;
  pinned: boolean;
  dirty?: boolean;
  sourceLabel?: string;
}
export function FileViewTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onPin,
  panelId = "file-view-panel",
  showChanges = true,
}: {
  tabs: FileViewTab[];
  active: string;
  panelId?: string;
  showChanges?: boolean;
  onSelect(id: string): void;
  onClose(id: string): void;
  onPin(id: string): void;
}) {
  const labels = distinctLabels(
    tabs.map((tab) => ({
      label: tab.path.split("/").at(-1)!,
      qualifier: tabs.some((other) => other.id !== tab.id && other.path === tab.path)
        ? `${tab.sourceLabel ?? "File"}/${tab.path.split("/").slice(0, -1).join("/")}`
        : tab.path.split("/").slice(0, -1).join("/"),
    })),
  );
  return (
    <Tabs.Root
      value={active}
      onValueChange={(value) => onSelect(String(value))}
      {...stylex.props(styles.root)}
    >
      <Tabs.List aria-label="Open files" {...stylex.props(styles.list)}>
        {showChanges && (
          <Tabs.Tab
            value="changes"
            aria-controls={panelId}
            {...stylex.props(
              styles.tab,
              active === "changes" && styles.active,
              active === "changes" && styles.selectedItem,
            )}
          >
            Changes
          </Tabs.Tab>
        )}
        {tabs.map((tab, index) => (
          <div
            key={tab.id}
            {...stylex.props(styles.item, active === tab.id && styles.selectedItem)}
          >
            <ActionTooltip
              label={`${tab.path}${tab.sourceLabel ? ` · ${tab.sourceLabel}` : ""}${tab.pinned ? "" : " · Preview (double-click to keep open)"}`}
            >
              <Tabs.Tab
                value={tab.id}
                aria-controls={panelId}
                onDoubleClick={() => onPin(tab.id)}
                {...stylex.props(
                  styles.tab,
                  !tab.pinned && styles.preview,
                  active === tab.id && styles.active,
                )}
              >
                <Icon name="file" size={13} />
                <span {...stylex.props(styles.name)}>{labels[index]}</span>
                {tab.dirty && (
                  <span
                    aria-label="Unsaved changes"
                    title="Unsaved changes"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: "currentColor",
                      flexShrink: 0,
                    }}
                  />
                )}
              </Tabs.Tab>
            </ActionTooltip>
            <ActionTooltip
              label={`Close ${tab.path}`}
              shortcut={active === tab.id ? "⌥ W" : undefined}
            >
              <button
                {...stylex.props(ui.button, styles.close)}
                aria-label={`Close ${tab.path}`}
                onClick={() => onClose(tab.id)}
              >
                <Icon name="close" size={12} />
              </button>
            </ActionTooltip>
          </div>
        ))}
      </Tabs.List>
    </Tabs.Root>
  );
}
const styles = stylex.create({
  root: {
    flexShrink: 0,
    minWidth: 0,
    backgroundColor: tokens.panel,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: tokens.border,
  },
  list: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    paddingBlock: 2,
    paddingInline: 4,
    overflowX: "auto",
    scrollbarWidth: "thin",
    minHeight: 32,
  },
  item: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    borderRadius: 7,
  },
  selectedItem: { backgroundColor: tokens.canvas, boxShadow: `inset 0 -2px ${tokens.accent}` },
  tab: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    borderWidth: 0,
    borderRadius: 6,
    backgroundColor: { default: "transparent", ":hover": tokens.hover },
    color: tokens.muted,
    paddingBlock: 4,
    paddingInline: 9,
    minHeight: 28,
    fontFamily: tokens.ui,
    fontSize: 12,
    cursor: "pointer",
    outline: { default: "none", ":focus-visible": `2px solid ${tokens.accent}` },
    outlineOffset: -2,
    whiteSpace: "nowrap",
  },
  active: { color: tokens.text, backgroundColor: "transparent" },
  preview: { fontStyle: "italic" },
  name: { maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" },
  close: { width: 22, minHeight: 22, paddingInline: 3, marginRight: 6 },
});
