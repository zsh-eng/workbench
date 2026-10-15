import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Comparison } from "../../shared/protocol";
import type { EndpointNames } from "../../shared/saved-review";
import type { ReviewControllerSnapshot } from "../data/controller";
import { tokens } from "../theme.stylex";
import type { Choice, MenuAction, MenuEntry } from "./Controls";

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
    /** `blocked` says why Push… cannot open yet, such as remotes that Med
     * still reads. */
    push?: { blocked?: string; open(): void };
    refresh: { disabled: boolean; run(): void };
    /** The comparison, when the row has no room for it. */
    comparison?: {
      label: string;
      value: string;
      choices: Choice[];
      select(value: string): void;
      /** A `checked` action is a toggle, such as Only this session's files. */
      actions: { label: string; checked?: boolean; onSelect(): void }[];
    };
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
  const comparison = diff?.comparison;
  return [
    diff
      ? [
          // Named by what the diff shows, as the row's control is.
          ...(comparison
            ? [
                {
                  label: comparison.label,
                  sections: [
                    comparison.choices.map((choice) => ({
                      label: choice.label,
                      checked: choice.value === comparison.value,
                      choice: true,
                      onClick: () => comparison.select(choice.value),
                    })),
                    comparison.actions.map((action) => ({
                      label: action.label,
                      ...(action.checked !== undefined && { checked: action.checked }),
                      onClick: action.onSelect,
                    })),
                  ],
                },
              ]
            : []),
          { label: "Find in diffs", shortcut: "Mod+F", letter: "f", onClick: diff.find },
          {
            label: "View",
            sections: [
              [
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
                {
                  label: "Show comments",
                  checked: diff.comments.on,
                  onClick: diff.comments.toggle,
                },
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
            diff.push && {
              label: "Push…",
              disabled: !!diff.push.blocked,
              hint: diff.push.blocked,
              onClick: diff.push.open,
            },
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

/** A file header's tooltip: its path and, as quiet chrome has no status bar,
 * its size. */
export function fileTitle(path: string, size: number | undefined, quiet: boolean) {
  return quiet && size !== undefined ? `${path} · ${size.toLocaleString()} bytes` : path;
}

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const short = (revision: string) => (OBJECT_ID.test(revision) ? revision.slice(0, 7) : revision);

/** What the diff compares, as the review's row says it: in full, and short
 * for a narrow row. */
export interface ComparisonLabel {
  long: string;
  short: string;
}

/**
 * The comparison's label. A range says the names that Med saved with its
 * endpoints ("main → week-view"), or a branch's newest commits ("2 commits on
 * main"); without names, such as in an older record, short object IDs. A live
 * range's head at the tip of `branch` takes the branch's name.
 */
export function comparisonLabel(
  comparison: Comparison,
  names?: EndpointNames,
  branch?: { name: string; head: string },
): ComparisonLabel {
  switch (comparison.kind) {
    case "working":
      return { long: "Working changes", short: "Working" };
    case "staged":
      return { long: "Staged changes", short: "Staged" };
    case "unstaged":
      return { long: "Unstaged changes", short: "Unstaged" };
    case "commit":
      return { long: short(comparison.commit), short: short(comparison.commit) };
    case "patch":
      return { long: "Patch review", short: "Patch" };
    case "files":
      return { long: "File comparison", short: "Files" };
  }
  if (names?.on && !names.base) {
    const count = `${names.on.commits} ${names.on.commits === 1 ? "commit" : "commits"}`;
    return { long: `${count} on ${names.on.branch}`, short: count };
  }
  const name = (ref: string) => short(ref.replace(/^refs\/(heads|remotes)\//, ""));
  const head =
    names?.head ??
    (branch && comparison.head === branch.head ? branch.name : name(comparison.head));
  const label = `${names?.base ?? name(comparison.base)} → ${head}`;
  return { long: label, short: label };
}

/** How the comparison fits in the review's row. */
export type RowFit = "long" | "short" | "menu";

/**
 * The room that a slot of the review's row has: the row's width less its
 * tabs and its other controls. The slot counts while it is hidden too, so
 * that the room it needs does not change as it shows.
 */
function rowRoom(row: HTMLElement, slot: HTMLElement) {
  const style = getComputedStyle(row);
  const gap = parseFloat(style.columnGap) || 0;
  let used = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  let items = 1;
  for (const child of row.children) {
    if (child === slot) continue;
    const { display, position } = getComputedStyle(child);
    if (display === "none" || position === "absolute" || position === "fixed") continue;
    items++;
    if (child.getAttribute("role") === "tablist") {
      // The tabs' own width, not the room that the list takes.
      const first = child.firstElementChild?.getBoundingClientRect();
      const last = child.lastElementChild?.getBoundingClientRect();
      used += first && last ? last.right - first.left : 0;
    } else used += child.getBoundingClientRect().width;
  }
  return row.clientWidth - used - gap * (items - 1) - 2;
}

/**
 * Whether a control of a fixed width, such as the Commit tab's Stage all,
 * fits in the review's row beside the tabs. `slot` is its place in the row,
 * also while it is hidden; its width is the one that it had when it showed.
 */
export function useSlotFits(slot: HTMLElement | null, fallbackWidth: number) {
  const [fits, setFits] = useState(true);
  const width = useRef(fallbackWidth);
  useLayoutEffect(() => {
    const row = slot?.parentElement;
    if (!slot || !row) return;
    const measure = () => {
      // A hidden workspace has no width; it keeps its fit for its return.
      if (!row.clientWidth) return;
      const shown = slot.getBoundingClientRect().width;
      if (shown) width.current = shown;
      setFits(rowRoom(row, slot) >= width.current);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(row);
    for (const child of row.children) resize.observe(child);
    const mutation = new MutationObserver(measure);
    mutation.observe(row, { childList: true, subtree: true, characterData: true });
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [slot]);
  return fits;
}

/**
 * Which label of the comparison fits in the review's row: its full one, its
 * short one, or none, when the comparison goes into ⋯. The row's tabs and
 * other controls keep their width; the comparison has the room that is left.
 * `slot` is the comparison's place in the row, also while it is empty.
 */
export function useRowFit(
  slot: RefObject<HTMLElement | null>,
  label: ComparisonLabel | null,
): RowFit {
  const [fit, setFit] = useState<RowFit>("long");
  const long = label?.long;
  const shortLabel = label?.short;
  // The trigger's font, and its width around the text, from the last time
  // it showed; the comparison is not in the row while it is in ⋯.
  const seen = useRef({ font: "", padding: 30 });
  useLayoutEffect(() => {
    const element = slot.current;
    const row = element?.parentElement;
    if (long === undefined || shortLabel === undefined || !element || !row) return;
    const context = document.createElement("canvas").getContext("2d");
    const measure = () => {
      // A hidden workspace has no width; it keeps its fit for its return.
      if (!row.clientWidth || !context) return;
      const trigger = element.querySelector("button");
      const value = trigger?.querySelector<HTMLElement>("[data-choice-value]");
      if (trigger && value) {
        const style = getComputedStyle(value);
        seen.current = {
          font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
          padding: trigger.getBoundingClientRect().width - value.getBoundingClientRect().width,
        };
      }
      if (!seen.current.font) return;
      context.font = seen.current.font;
      const room = rowRoom(row, element);
      const needs = (text: string) => context.measureText(text).width + seen.current.padding;
      setFit(room >= needs(long) ? "long" : room >= needs(shortLabel) ? "short" : "menu");
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(row);
    for (const child of row.children) resize.observe(child);
    // Controls and tabs that come and go, and text that changes.
    const mutation = new MutationObserver(measure);
    mutation.observe(row, { childList: true, subtree: true, characterData: true });
    void document.fonts?.ready.then(measure);
    return () => {
      resize.disconnect();
      mutation.disconnect();
    };
  }, [slot, long, shortLabel]);
  return label ? fit : "long";
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
