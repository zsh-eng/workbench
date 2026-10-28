import { useViewSetting, viewSettings } from "./view-settings";

/**
 * How much chrome surrounds the code. "quiet" gives each pane one row and
 * says each thing once: the thread's title in the sidebar (or the title band
 * while the sidebar is hidden), its branch in the title band, the range in
 * the review's row, and the agent's state in the session's row. Rare actions
 * go to the review's ⋯ menu and ⌘K, and the status bar goes. "full" is the
 * layout before. Every window and workspace shares the choice
 * (view-settings.ts).
 */
export type ChromeMode = "quiet" | "full";

/** Uses a chrome, and stores the choice for other windows and the next visit.
 * Without `store`, the choice holds for this page only. */
export function setChromeMode(next: ChromeMode, store = true) {
  viewSettings.chrome.set(next, { store });
}

/** Whether the quiet chrome shows. */
export function useQuietChrome() {
  return useViewSetting(viewSettings.chrome) === "quiet";
}
