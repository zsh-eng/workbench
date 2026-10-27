import { useSyncExternalStore } from "react";

/**
 * The one rule for phone, tablet and desktop layouts in Reader, Arctic for
 * the web and Spaced (docs/SIZE_CLASSES.md).
 *
 * The window's width class is Android's: compact below 600 px, medium from
 * 600 (tablets in portrait), expanded from 840 (tablets in landscape). In
 * Chrome on Android a CSS pixel is a dp. An app's bars, sidebars and
 * popovers follow the width class, as Android advises. The height class
 * (compact below 480 px, as a phone on its side) only keeps a second pane
 * off a short window.
 *
 * Sheets follow the device: a touch screen whose shortest side is at least
 * 600 px is a tablet (Android's sw600dp), in either orientation and whatever
 * the browser's bars take. In a window that is compact in neither width nor
 * height, a tablet's sheets take UIKit's form layout (`sheetPlacement` in
 * sheet-body.tsx). A phone turned on its side stays a phone.
 */
export const MEDIUM_WIDTH = 600;
export const EXPANDED_WIDTH = 840;
export const MEDIUM_HEIGHT = 480;
export const TABLET_SHORTEST_SIDE = 600;

/** Media queries for the width classes, for `matchMedia` and CSS. */
export const COMPACT_QUERY = `(width < ${MEDIUM_WIDTH}px)`;
export const EXPANDED_QUERY = `(width >= ${EXPANDED_WIDTH}px)`;
export const COMPACT_HEIGHT_QUERY = `(height < ${MEDIUM_HEIGHT}px)`;
const TOUCH_QUERY = "(any-pointer: coarse)";

export type WidthClass = "compact" | "medium" | "expanded";

type Queries = Record<
  "compact" | "expanded" | "short" | "touch",
  MediaQueryList
>;
let queries: Queries | undefined;
let madeWith: typeof matchMedia | undefined;
/** The lists, made once, and again if the page replaces `matchMedia`. */
const media = (): Queries => {
  if (!queries || madeWith !== window.matchMedia) {
    madeWith = window.matchMedia;
    queries = {
      compact: window.matchMedia(COMPACT_QUERY),
      expanded: window.matchMedia(EXPANDED_QUERY),
      short: window.matchMedia(COMPACT_HEIGHT_QUERY),
      touch: window.matchMedia(TOUCH_QUERY),
    };
  }
  return queries;
};

/** The window's width class now. */
export function widthClass(): WidthClass {
  const { compact, expanded } = media();
  return compact.matches ? "compact" : expanded.matches ? "expanded" : "medium";
}

/** Whether the window is shorter than 480 px: a phone on its side. */
export function isCompactHeight(): boolean {
  return media().short.matches;
}

/**
 * A touch screen whose shortest side is at least 600 px. `screen` keeps the
 * whole display in either orientation; the window can be narrower.
 */
export function isTabletScreen(): boolean {
  return (
    media().touch.matches &&
    Math.min(screen.width, screen.height) >= TABLET_SHORTEST_SIDE
  );
}

/**
 * Whether sheets take a tablet's form layout now: on a tablet, in a window
 * compact in neither width nor height (UIKit's form sheet needs room).
 */
export function tabletSheets(): boolean {
  const { compact, short } = media();
  return isTabletScreen() && !compact.matches && !short.matches;
}

/** Calls `listener` when a size class or the pointer changes. */
function subscribe(listener: () => void) {
  const lists = Object.values(media());
  for (const list of lists) list.addEventListener("change", listener);
  return () => {
    for (const list of lists) list.removeEventListener("change", listener);
  };
}

/** As `subscribe`, and on a resize too: a new display size changes `screen`. */
function subscribeScreen(listener: () => void) {
  const stop = subscribe(listener);
  window.addEventListener("resize", listener);
  return () => {
    stop();
    window.removeEventListener("resize", listener);
  };
}

/** The window's width class; it changes as the window turns or resizes. */
export function useWidthClass(): WidthClass {
  return useSyncExternalStore(subscribe, widthClass, () => "expanded");
}

/** Whether the window is shorter than 480 px; see `isCompactHeight`. */
export function useCompactHeight(): boolean {
  return useSyncExternalStore(subscribe, isCompactHeight, () => false);
}

/** Whether sheets take a tablet's form layout; see `tabletSheets`. */
export function useTabletSheets(): boolean {
  return useSyncExternalStore(subscribeScreen, tabletSheets, () => false);
}
