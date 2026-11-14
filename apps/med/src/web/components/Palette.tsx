import * as stylex from "@stylexjs/stylex";
import { Dialog } from "@base-ui/react/dialog";
import { Fragment, useCallback, type ReactNode } from "react";
import { keyLabel, parseShortcut, platform, splitLegacyKeys } from "../data/keys";
import { ui } from "../theme.stylex";

/**
 * A palette's name, for screen readers only. On screen, its placeholder
 * names it: "Search commands…", "Find a file…".
 */
export function PaletteTitle({ children }: { children: ReactNode }) {
  return <Dialog.Title {...stylex.props(ui.srOnly)}>{children}</Dialog.Title>;
}

/**
 * A shortcut's keys as one run of glyphs, such as ⌘⇧K, for a palette row;
 * a sequence's steps have a thin space between them, as "g g". Elsewhere
 * ShortcutKeys draws keycaps.
 */
export function shortcutGlyphs(value: string) {
  const chord = (keys: string[]) =>
    keys.map((key) => keyLabel(key)).join(platform === "mac" ? "" : "+");
  if (!/\w\+\S/.test(value)) return chord(splitLegacyKeys(value));
  return parseShortcut(value).map(chord).join("\u2009");
}

/** A shortcut at a row's end: faint, and muted on the selected row. */
export function PaletteKeys({ value }: { value?: string }) {
  if (!value) return null;
  return <kbd {...stylex.props(ui.paletteKeys)}>{shortcutGlyphs(value)}</kbd>;
}

/**
 * The selected row's actions at its end, in place of its end text, such as
 * "Open ↵   New workspace ⌘↵". Hidden from screen readers: the dialog's
 * description says the keys once.
 */
export function PaletteActions({ actions }: { actions: { label: string; keys: string }[] }) {
  return (
    <span aria-hidden="true" {...stylex.props(ui.paletteActions)}>
      {actions.map((action) => (
        <span key={action.label} {...stylex.props(ui.paletteAction)}>
          {action.label}
          <kbd {...stylex.props(ui.paletteKeys, ui.paletteActionKeys)}>
            {shortcutGlyphs(action.keys)}
          </kbd>
        </span>
      ))}
    </span>
  );
}

/**
 * Where a query's text shows in a name, for bold: the query itself, else
 * each of its words, else (`fuzzy`) its letters in order. Undefined if it
 * does not.
 */
export function matchRanges(
  text: string,
  query: string,
  fuzzy = false,
): [number, number][] | undefined {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return undefined;
  const value = text.toLowerCase();
  const at = value.indexOf(wanted);
  if (at >= 0) return [[at, at + wanted.length]];
  const words = wanted.split(/\s+/);
  if (words.length > 1) {
    const ranges = words
      .map((word) => [value.indexOf(word), word.length] as const)
      .filter(([index]) => index >= 0)
      .map(([index, length]): [number, number] => [index, index + length])
      .sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const range of ranges) {
      const last = merged.at(-1);
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range);
    }
    return merged.length ? merged : undefined;
  }
  if (!fuzzy) return undefined;
  const ranges: [number, number][] = [];
  let cursor = 0;
  for (const letter of wanted) {
    const index = value.indexOf(letter, cursor);
    if (index < 0) return undefined;
    const last = ranges.at(-1);
    if (last && last[1] === index) last[1] = index + 1;
    else ranges.push([index, index + 1]);
    cursor = index + 1;
  }
  return ranges;
}

/** Text with its typed matches in bold. `ranges` are [start, end) pairs, in order. */
export function Matched({ text, ranges }: { text: string; ranges?: readonly [number, number][] }) {
  if (!ranges?.length) return text;
  const parts: ReactNode[] = [];
  let at = 0;
  for (const [start, end] of ranges) {
    if (start > at) parts.push(text.slice(at, start));
    parts.push(
      <b key={start} {...stylex.props(ui.paletteMatch)}>
        {text.slice(start, end)}
      </b>,
    );
    at = end;
  }
  if (at < text.length) parts.push(text.slice(at));
  return <Fragment>{parts}</Fragment>;
}

/**
 * A ref for a palette's list: while more rows wait below the visible ones,
 * the list's foot fades out (`data-more`).
 */
export function usePaletteFade<T extends HTMLElement>() {
  return useCallback((node: T | null) => {
    if (!node) return;
    const update = () =>
      node.toggleAttribute("data-more", node.scrollTop + node.clientHeight < node.scrollHeight - 1);
    update();
    const resize = new ResizeObserver(update);
    resize.observe(node);
    const rows = new MutationObserver(update);
    rows.observe(node, { childList: true, subtree: true });
    node.addEventListener("scroll", update, { passive: true });
    return () => {
      resize.disconnect();
      rows.disconnect();
      node.removeEventListener("scroll", update);
    };
  }, []);
}
