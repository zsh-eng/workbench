import * as stylex from "@stylexjs/stylex";
import type { ReviewControllerSnapshot } from "../data/controller";
import { tokens } from "../theme.stylex";
import type { MenuAction, MenuEntry } from "./Controls";

interface Toggle {
  on: boolean;
  toggle(): void;
}

/** What the review's ⋯ menu can do; a missing entry has no item. */
export interface QuietMenuActions {
  /** The diff shows: its find, its view, push, and refresh. */
  diff?: {
    find(): void;
    layout: { mode: "split" | "unified"; canSplit: boolean; set(mode: "split" | "unified"): void };
    comments: Toggle;
    wrap: Toggle;
    rail?: Toggle;
    collapse?: { collapsed: boolean; toggle(): void };
    push?: { disabled: boolean; open(): void };
    refresh: { disabled: boolean; run(): void };
  };
  workingFile?: { label: string; open(): void };
  session?: Toggle;
  files?: Toggle;
  openBranch?: () => void;
  zen(): void;
  commands(): void;
  shortcuts(): void;
}

/**
 * Quiet chrome's ⋯ menu: the toolbar's view options in a View submenu, the
 * buttons that left the review's rows, and the panes. It fits in its popup
 * without a scroll. A pane that opens or closes closes the menu; a view
 * option keeps it open.
 *
 * It is a hook so that the React Compiler knows that it does not call the
 * actions during render: the menu calls them when you choose an item.
 */
export function useQuietMenu(actions: QuietMenuActions): MenuEntry[][] {
  const { diff } = actions;
  const item = (entry: MenuAction | false | undefined) => (entry ? [entry] : []);
  return [
    diff
      ? [
          { label: "Find in diffs", shortcut: "Mod+F", letter: "f", onClick: diff.find },
          {
            label: "View",
            items: [
              {
                label: "Split diff",
                checked: diff.layout.mode === "split",
                choice: true,
                disabled: !diff.layout.canSplit,
                onClick: () => diff.layout.set("split"),
              },
              {
                label: "Unified diff",
                checked: diff.layout.mode === "unified",
                choice: true,
                onClick: () => diff.layout.set("unified"),
              },
              { label: "Show comments", checked: diff.comments.on, onClick: diff.comments.toggle },
              {
                label: "Wrap long lines",
                checked: diff.wrap.on,
                letter: "w",
                onClick: diff.wrap.toggle,
              },
              ...item(
                diff.rail && {
                  label: "Files and commits",
                  checked: diff.rail.on,
                  onClick: diff.rail.toggle,
                },
              ),
              ...item(
                diff.collapse && {
                  label: diff.collapse.collapsed ? "Expand all files" : "Collapse all files",
                  onClick: diff.collapse.toggle,
                },
              ),
            ],
          },
        ]
      : [],
    [
      ...item(
        actions.workingFile && {
          label: actions.workingFile.label,
          letter: "o",
          onClick: actions.workingFile.open,
        },
      ),
      ...item(
        actions.session && {
          label: "Agent session",
          shortcut: "Mod+Shift+B",
          checked: actions.session.on,
          choice: true,
          onClick: actions.session.toggle,
        },
      ),
      ...item(
        actions.files && {
          label: "Files",
          checked: actions.files.on,
          choice: true,
          onClick: actions.files.toggle,
        },
      ),
      ...item(
        actions.openBranch && {
          label: "Open branch or worktree…",
          shortcut: "Mod+Shift+G",
          onClick: actions.openBranch,
        },
      ),
      { label: "Zen mode", shortcut: "Alt+Z", letter: "z", onClick: actions.zen },
    ],
    diff
      ? [
          ...item(
            diff.push && { label: "Push…", disabled: diff.push.disabled, onClick: diff.push.open },
          ),
          {
            label: "Refresh review",
            letter: "r",
            disabled: diff.refresh.disabled,
            onClick: diff.refresh.run,
          },
        ]
      : [],
    [
      { label: "Commands", shortcut: "Mod+K", onClick: actions.commands },
      { label: "Keyboard shortcuts", shortcut: "?", onClick: actions.shortcuts },
    ],
  ];
}

/**
 * Quiet chrome has no status bar. Its connection dot said "live" all the
 * time; this says only when the live updates stop and Med tries again.
 */
export function ConnectionNotice({
  connection,
}: {
  connection: ReviewControllerSnapshot["connection"];
}) {
  if (connection !== "reconnecting") return null;
  return (
    <div role="status" {...stylex.props(styles.notice)}>
      <span {...stylex.props(styles.dot)} />
      Reconnecting…
    </div>
  );
}

const styles = stylex.create({
  // Low at the workspace's end, clear of the session's message box and the
  // scroll bar.
  notice: {
    position: "absolute",
    right: 22,
    bottom: 14,
    zIndex: 30,
    display: "flex",
    alignItems: "center",
    gap: 7,
    height: 26,
    paddingInline: 10,
    borderRadius: `calc(8px * ${tokens.round})`,
    backgroundColor: tokens.raised,
    boxShadow: `0 0 0 1px ${tokens.line}`,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    pointerEvents: "none",
  },
  dot: { width: 6, height: 6, borderRadius: "50%", backgroundColor: tokens.warning },
});
