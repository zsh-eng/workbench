import * as stylex from "@stylexjs/stylex";
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import type { Comparison } from "../../shared/protocol";
import type { EndpointNames } from "../../shared/saved-review";
import type { ReviewControllerSnapshot } from "../data/controller";
import { tokens } from "../theme.stylex";
import type { Choice, MenuAction, MenuEntry } from "./Controls";

/** What a narrow review row folds into its ⋯ menu; a missing entry has no
 * item. */
export interface QuietMenuActions {
  /** The comparison, when the row has no room for it. */
  comparison?: {
    label: string;
    value: string;
    choices: Choice[];
    select(value: string): void;
    /** A `checked` action is a toggle, such as Only this session's files. */
    actions: { label: string; checked?: boolean; onSelect(): void }[];
  };
  /** The pane's own Expand and Hide, when its row has no room for them. */
  pane?: { label: string; zoomed: boolean; zoom?(): void; hide?(): void };
}

/**
 * Quiet chrome's ⋯ menu holds only what a narrow row folds away: what the
 * diff compares, and the pane's Expand and Hide. The rest is in ⌘K and on
 * its keys, and Copy comments has its own button. With nothing folded, the
 * row has no ⋯.
 *
 * It is a hook so that the React Compiler knows that it does not call the
 * actions during render: the menu calls them when you choose an item.
 */
export function useQuietMenu(actions: QuietMenuActions): MenuEntry[][] {
  const item = (entry: MenuAction | false | undefined) => (entry ? [entry] : []);
  const { comparison, pane } = actions;
  return [
    // Named by what the diff shows, as the row's control is. With nothing to
    // choose, it only says what the diff shows.
    comparison && comparison.choices.length <= 1 && !comparison.actions.length
      ? [{ label: comparison.label, disabled: true, onClick: () => {} }]
      : comparison
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
        : [],
    [
      ...item(
        pane?.zoom && {
          label: pane.zoomed ? "Restore the other panes" : `Expand ${pane.label}`,
          shortcut: "Mod+E",
          onClick: pane.zoom,
        },
      ),
      ...item(pane?.hide && { label: `Hide ${pane.label}`, onClick: pane.hide }),
    ],
  ];
}

/** A file header's tooltip: its path and, as quiet chrome has no status bar,
 * its size. */
export function fileTitle(path: string, size: number | undefined) {
  return size !== undefined ? `${path} · ${size.toLocaleString()} bytes` : path;
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
/**
 * An item's width with its shortened names whole (up to its own max-width),
 * so the row's optional controls give way before a title shortens.
 */
function wholeWidth(child: Element, rowWidth: number) {
  const width = child.getBoundingClientRect().width;
  let hidden = 0;
  for (const name of child.querySelectorAll("[data-truncates]"))
    hidden += name.scrollWidth - name.clientWidth;
  if (!hidden) return width;
  const max = getComputedStyle(child).maxWidth;
  const cap = max.endsWith("%")
    ? (parseFloat(max) / 100) * rowWidth
    : max === "none"
      ? Infinity
      : parseFloat(max);
  return Math.max(width, Math.min(width + hidden, cap));
}

function rowRoom(row: HTMLElement, slot: HTMLElement) {
  const style = getComputedStyle(row);
  const gap = parseFloat(style.columnGap) || 0;
  let used = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  let items = 1;
  const count = (children: HTMLCollection) => {
    for (const child of children) {
      // The slot, and the space that only fills the row.
      if (child === slot || child.hasAttribute("data-row-grow")) continue;
      const { display, position, marginLeft, marginRight } = getComputedStyle(child);
      // A wrapper with `display: contents`, as the totals, puts its children in the row.
      if (display === "contents") {
        count(child.children);
        continue;
      }
      if (display === "none" || position === "absolute" || position === "fixed") continue;
      items++;
      used += (parseFloat(marginLeft) || 0) + (parseFloat(marginRight) || 0);
      used += wholeWidth(child, row.clientWidth);
    }
  };
  count(row.children);
  return row.clientWidth - used - gap * (items - 1) - 2;
}

/**
 * Whether a control of a fixed width, such as the Commit page's Stage all,
 * fits in the review's row beside the title and the pages. `slot` is its place in the row,
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
 * Whether the row that holds `slot` is at least `width` pixels wide. It
 * goes by the row's width alone, not by what the page puts in the row, so
 * that a control shown by it stays as the pages switch and the tabs keep
 * their places.
 */
export function useRowWide(slot: HTMLElement | null, width: number) {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const row = slot?.parentElement;
    if (!row) return;
    // A hidden workspace has no width; it keeps its answer for its return.
    const measure = () => {
      if (row.clientWidth) setWide(row.clientWidth >= width);
    };
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(row);
    return () => resize.disconnect();
  }, [slot, width]);
  return wide;
}

/**
 * Whether an optional part of a control in the review's row, such as the
 * word "comments" after a count, may show: it shows while the row has room
 * for it beside the title's whole width. `part` is the part's element, also
 * while it is hidden; its width is the one that it had when it showed. A new
 * `text` shows first, to measure it.
 */
export function useRowPart(part: HTMLElement | null, text: string) {
  const [state, setState] = useState({ text, fits: true });
  const width = useRef(0);
  useLayoutEffect(() => {
    width.current = 0;
    // The row is the element whose child is the space that fills it, and
    // the control is its child that holds the part.
    let control: HTMLElement | null = part;
    const isRow = (element: Element) =>
      [...element.children].some((child) => child.hasAttribute("data-row-grow"));
    while (control?.parentElement && !isRow(control.parentElement)) control = control.parentElement;
    const row = control?.parentElement;
    if (!part || !control || !row) return;
    const measure = () => {
      // A hidden workspace has no width; it keeps its fit for its return.
      if (!row.clientWidth) return;
      const shown = part.getBoundingClientRect().width;
      if (shown) width.current = shown;
      // The row's room for the control without its part, less the control.
      const free = rowRoom(row, control) - (control.getBoundingClientRect().width - shown);
      const fits = free >= width.current;
      setState((current) =>
        current.text === text && current.fits === fits ? current : { text, fits },
      );
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
  }, [part, text]);
  return state.text === text ? state.fits : true;
}

/**
 * Which label of the comparison fits in the review's row: its full one, its
 * short one, or none, when the comparison goes into ⋯. The row's pages and
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
      // The select's trigger.
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
