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
 *
 * Chrome on Android leaves full screen when the app stops, and only a user
 * gesture can ask again. So the next tap on the page goes back to full
 * screen, as does a swipe when its page lands. Leaving on purpose, with the
 * back gesture, is respected: taps leave the bars alone until the reader
 * asks with the header's button or the Appearance switch, or opens a book.
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

function notify(): void {
  for (const listener of listeners) listener();
}

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
 * How long after an exit the page can still go hidden and the exit count as
 * the app leaving. Chrome sends both from one Activity stop, in either order.
 */
const EXIT_THEN_HIDDEN_MS = 1000;

/** What the last `fullscreenchange` reported. */
let fullscreen = false;
/** The page went hidden in full screen: Android takes full screen with it. */
let hiddenInFullscreen = false;
/** `leaveReadingFullscreen` asked, so the exit is not the reader's gesture. */
let leaving = false;
let leftOnPurpose = false;
let leftAt = -Infinity;

/**
 * Tells a reader's exit from Android's. A hidden page draws no frames and
 * `fullscreenchange` waits for a frame, so Android's exit can report long
 * after the page went hidden, once the app is back.
 */
function handleFullscreenChange(): void {
  const wasFullscreen = fullscreen;
  fullscreen = document.fullscreenElement !== null;
  if (fullscreen) {
    leftOnPurpose = false;
    hiddenInFullscreen = false;
  } else if (wasFullscreen) {
    if (!leaving && !hiddenInFullscreen) {
      leftOnPurpose = true;
      leftAt = performance.now();
    }
    leaving = false;
    hiddenInFullscreen = false;
  }
  notify();
}

function handleVisibilityChange(): void {
  if (!document.hidden) return;
  if (fullscreen) hiddenInFullscreen = true;
  else if (performance.now() - leftAt < EXIT_THEN_HIDDEN_MS)
    leftOnPurpose = false;
}

document.addEventListener("fullscreenchange", handleFullscreenChange);
document.addEventListener("visibilitychange", handleVisibilityChange);

/** The header's button shows while full screen is on and the bars are too. */
export function useFullscreenCanEnter(): boolean {
  const on = useReadingFullscreenPreference();
  const isFullscreen = useSyncExternalStore(
    subscribe,
    () => fullscreen,
    () => fullscreen,
  );
  return on && !isFullscreen && readingFullscreenSupported();
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

/**
 * Goes back to full screen after Android took it away. Call it in a tap's
 * handler or within seconds of one, while the gesture still counts.
 */
export function resumeReadingFullscreen(): void {
  // Still in full screen after the page was hidden: nothing took it away.
  if (document.fullscreenElement) hiddenInFullscreen = false;
  if (!leftOnPurpose) enterReadingFullscreen();
}

/** Shows the system bars again, if Reader hid them. */
export function leaveReadingFullscreen(): void {
  if (!document.fullscreenElement) return;
  leaving = true;
  document.exitFullscreen().catch(() => {
    leaving = false;
  });
}

/** The Appearance switch; it takes effect at once, in the switch's tap. */
export function setReadingFullscreenPreference(on: boolean): void {
  try {
    getRuntimeStorage().setItem(FULLSCREEN_STORAGE_KEY, on ? "on" : "off");
  } catch {
    // Keep the in-memory choice when storage is unavailable.
  }
  saved = on;
  notify();
  if (on) enterReadingFullscreen();
  else leaveReadingFullscreen();
}
