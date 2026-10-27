import { useSyncExternalStore } from "react";

/**
 * Display and reading settings, kept per browser as Reader keeps its own.
 * A theme is a pair of palettes; the appearance picks the light or dark one.
 * public/appearance.js applies the theme before the first paint.
 */
export type Settings = {
  appearance: "system" | "light" | "dark";
  theme: "arctic" | "flexoki" | "night";
  font: "sans" | "serif" | "book";
  size: number;
  spacing: "tight" | "normal" | "loose";
  width: "narrow" | "normal" | "wide";
  align: "left" | "justify";
  layout: "cards" | "list" | "magazine";
  /** Download every saved text after each sync. */
  offline: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  appearance: "system",
  theme: "arctic",
  font: "sans",
  size: 20,
  spacing: "normal",
  width: "normal",
  align: "left",
  // A phone shows more of the library as a list; a wider touch screen, such
  // as an iPad's, shows each link's picture (docs/MAGAZINE.md).
  layout: matchMedia("(max-width: 720px)").matches
    ? "list"
    : matchMedia("(any-pointer: coarse)").matches
      ? "magazine"
      : "cards",
  offline: false,
};

export const SIZES = { min: 15, max: 28 };

export const FONTS: Record<Settings["font"], { label: string; stack: string }> =
  {
    sans: { label: "Sans", stack: "var(--ui)" },
    serif: {
      label: "Serif",
      stack: 'ui-serif, "New York", Charter, Georgia, serif',
    },
    book: {
      label: "Book",
      stack:
        '"Iowan Old Style", "Sitka Text", Palatino, "Book Antiqua", Georgia, serif',
    },
  };
const SPACING = { tight: 1.45, normal: 1.62, loose: 1.8 };
const WIDTHS = { narrow: 560, normal: 640, wide: 760 };

const KEY = "arctic:settings";
const listeners = new Set<() => void>();
let current = read();
const dark = matchMedia("(prefers-color-scheme: dark)");

function read(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    const settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(settings) as (keyof Settings)[])
      if (typeof saved[key] === typeof settings[key])
        Object.assign(settings, { [key]: saved[key] });
    settings.size = Math.min(SIZES.max, Math.max(SIZES.min, settings.size));
    return settings;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function getSettings() {
  return current;
}

export function updateSettings(patch: Partial<Settings>) {
  current = { ...current, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* Storage is blocked: the change lasts until the page closes. */
  }
  applySettings();
  listeners.forEach((listener) => listener());
}

export function useSettings() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => current,
  );
}

/** Sets the theme and the reading type on the page. */
export function applySettings() {
  const root = document.documentElement;
  const mode =
    current.appearance === "system"
      ? dark.matches
        ? "dark"
        : "light"
      : current.appearance;
  root.dataset.theme = current.theme;
  root.dataset.mode = mode;
  root.style.setProperty("--reading-font", FONTS[current.font].stack);
  root.style.setProperty("--reading-size", `${current.size}px`);
  root.style.setProperty("--reading-leading", String(SPACING[current.spacing]));
  root.style.setProperty("--measure", `${WIDTHS[current.width]}px`);
  root.dataset.align = current.align;
  // The browser and the installed app match the page's background.
  const background = getComputedStyle(root).getPropertyValue("--bg").trim();
  for (const meta of document.querySelectorAll('meta[name="theme-color"]'))
    meta.setAttribute("content", background);
}

dark.addEventListener("change", () => {
  if (current.appearance === "system") applySettings();
});
// Another tab changed the settings.
window.addEventListener("storage", (event) => {
  if (event.key !== KEY) return;
  current = read();
  applySettings();
  listeners.forEach((listener) => listener());
});
