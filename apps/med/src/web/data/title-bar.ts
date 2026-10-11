import { useSyncExternalStore } from "react";

/**
 * The installed app's title bar. The manifest lets the page draw there
 * (window-controls-overlay): when the reader hides the title bar, only the
 * window controls stay, over the page. The root then has
 * data-titlebar="overlay", and TitleRow.css reads the free area from env().
 */
interface ControlsOverlay extends EventTarget {
  readonly visible: boolean;
}

const root = () => document.documentElement;

export function watchTitleBar() {
  const overlay = (navigator as Navigator & { windowControlsOverlay?: ControlsOverlay })
    .windowControlsOverlay;
  if (!overlay) return;
  const update = () => {
    if (overlay.visible) root().dataset.titlebar = "overlay";
    else delete root().dataset.titlebar;
  };
  overlay.addEventListener("geometrychange", update);
  update();
}

const subscribe = (listener: () => void) => {
  const observer = new MutationObserver(listener);
  observer.observe(root(), { attributes: true, attributeFilter: ["data-titlebar"] });
  return () => observer.disconnect();
};

/** Whether the page draws the title bar, beside the window controls. */
export const useTitleBarOverlay = () =>
  useSyncExternalStore(
    subscribe,
    () => root().dataset.titlebar === "overlay",
    () => false,
  );
