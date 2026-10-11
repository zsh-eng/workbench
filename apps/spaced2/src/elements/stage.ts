import { createContext, useContext } from "react";

export type PreviewTheme = "light" | "dark";
export type InlineZoom = "1" | "2" | "3";
export type FrameZoom = "fit" | "actual";

/** Page-wide settings from the bar. The theme is a preview only. */
export interface StageSettings {
  theme: PreviewTheme;
  /** Zoom for inline stages. */
  zoom: InlineZoom;
  /** Fit scales each row of frames to the page; actual shows device pixels. */
  frameZoom: FrameZoom;
}

export const StageContext = createContext<StageSettings>({
  theme: "light",
  zoom: "1",
  frameZoom: "fit",
});

export const useStage = () => useContext(StageContext);

/** A frame posts this to the page once its specimen listens for states. */
export const FRAME_READY = "elements:ready";

/**
 * Keeps `theme` on a document while the app's ThemeProvider sets its own
 * class. Returns a function that stops and restores the earlier class.
 */
export function previewTheme(doc: Document, theme: PreviewTheme) {
  const root = doc.documentElement;
  const saved = root.classList.contains("dark") ? "dark" : "light";
  const other = theme === "dark" ? "light" : "dark";
  const apply = () => {
    if (root.classList.contains(theme) && !root.classList.contains(other))
      return;
    root.classList.remove(other);
    root.classList.add(theme);
  };
  apply();
  const observer = new MutationObserver(apply);
  observer.observe(root, { attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
    root.classList.remove("light", "dark");
    root.classList.add(saved);
  };
}
