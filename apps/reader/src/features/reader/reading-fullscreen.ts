import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import {
  currentTraits,
  isInstalled,
  isIos,
} from "@/features/install/install-platform";
import { useSyncExternalStore } from "react";

export const FULLSCREEN_STORAGE_KEY = "reader-fullscreen-v1";

/**
 * Full screen while reading, for Reader installed as an app on a touch
 * screen (an Android tablet or phone; also a touch Windows PWA): opening a
 * book hides the system bars with the Fullscreen API, and the Library shows
 * them again. A browser tab, a desktop without touch and iOS keep their
 * bars.
 */
export function readingFullscreenSupported(): boolean {
  return (
    document.fullscreenEnabled &&
    // Standalone, and "fullscreen" once the Fullscreen API is on.
    isInstalled() &&
    matchMedia("(any-pointer: coarse)").matches &&
    !isIos(currentTraits())
  );
}

/** On unless the reader turned it off on this device. */
function readSaved(): boolean {
  try {
    return getRuntimeStorage().getItem(FULLSCREEN_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

let saved = readSaved();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadingFullscreenPreference(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => saved,
    () => saved,
  );
}

/**
 * Asks for full screen. Call it in the handler of the tap that opens a book
 * (the browser needs a user gesture). A refusal leaves the bars in place.
 */
export function enterReadingFullscreen(): void {
  if (!saved || document.fullscreenElement || !readingFullscreenSupported())
    return;
  document.documentElement
    .requestFullscreen({ navigationUI: "hide" })
    .catch(() => {});
}

/** Shows the system bars again, if Reader hid them. */
export function leaveReadingFullscreen(): void {
  if (!document.fullscreenElement) return;
  document.exitFullscreen().catch(() => {});
}

/** The Appearance switch; it takes effect at once, in the switch's tap. */
export function setReadingFullscreenPreference(on: boolean): void {
  try {
    getRuntimeStorage().setItem(FULLSCREEN_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  saved = on;
  for (const listener of listeners) listener();
  if (on) enterReadingFullscreen();
  else leaveReadingFullscreen();
}
