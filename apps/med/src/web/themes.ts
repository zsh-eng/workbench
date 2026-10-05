import { useSyncExternalStore } from "react";

export interface ThemePalette {
  canvas: string;
  panel: string;
  raised: string;
  hover: string;
  border: string;
  text: string;
  muted: string;
  faint: string;
  accent: string;
  selected: string;
  green: string;
  red: string;
  warning: string;
  shadow: string;
}

export interface Theme {
  id: string;
  label: string;
  family: string;
  appearance: "dark" | "light";
  syntax:
    | "pierre-dark"
    | "pierre-light"
    | "vitesse-dark"
    | "vitesse-light"
    | "rose-pine"
    | "rose-pine-moon"
    | "rose-pine-dawn"
    | "tokyo-night";
  pierreTheme: string;
  source: string | null;
  palette: ThemePalette;
}

// Layered shadows: a tight contact shadow, a soft ambient one, and (dark only)
// a one-pixel top highlight that separates raised surfaces from the canvas.
const darkShadow =
  "0 1px 0 0 #ffffff08 inset, 0 2px 6px -1px #00000066, 0 16px 40px -12px #000000b3";
const lightShadow = "0 1px 2px -1px #1b1f2a1f, 0 4px 10px -4px #1b1f2a1a, 0 18px 40px -16px #1b1f2a33";

// Shell mappings use the named projects' public palettes. Syntax definitions are
// loaded by Pierre from its bundled Shiki themes; they are not copied here.
// Graphite is an original neutral palette, not an official Vercel/Geist theme.
export const themes: readonly Theme[] = [
  {
    id: "graphite-dark",
    label: "Graphite Dark",
    family: "Neutral",
    appearance: "dark",
    syntax: "pierre-dark",
    pierreTheme: "med-graphite-dark",
    source: null,
    // The frame (panel) sits darker than the review card (canvas).
    palette: {
      canvas: "#141416",
      panel: "#0d0d0f",
      raised: "#1b1b1e",
      hover: "#232327",
      border: "#28282d",
      text: "#ececef",
      muted: "#9d9da6",
      faint: "#686871",
      accent: "#8f9cff",
      selected: "#252946",
      green: "#82cfa1",
      red: "#ee8d98",
      warning: "#e8c17a",
      shadow: darkShadow,
    },
  },
  {
    id: "rose-pine",
    label: "Rosé Pine",
    family: "Rosé Pine",
    appearance: "dark",
    syntax: "rose-pine",
    pierreTheme: "med-rose-pine",
    source: "https://rosepinetheme.com/palette/",
    palette: {
      canvas: "#191724",
      panel: "#1f1d2e",
      raised: "#26233a",
      hover: "#26233a",
      border: "#403d52",
      text: "#e0def4",
      muted: "#908caa",
      faint: "#6e6a86",
      accent: "#c4a7e7",
      selected: "#403d52",
      green: "#9ccfd8",
      red: "#eb6f92",
      warning: "#f6c177",
      shadow: darkShadow,
    },
  },
  {
    id: "rose-pine-moon",
    label: "Rosé Pine Moon",
    family: "Rosé Pine",
    appearance: "dark",
    syntax: "rose-pine-moon",
    pierreTheme: "med-rose-pine-moon",
    source: "https://rosepinetheme.com/palette/",
    palette: {
      canvas: "#232136",
      panel: "#2a273f",
      raised: "#393552",
      hover: "#393552",
      border: "#44415a",
      text: "#e0def4",
      muted: "#908caa",
      faint: "#6e6a86",
      accent: "#c4a7e7",
      selected: "#44415a",
      green: "#9ccfd8",
      red: "#eb6f92",
      warning: "#f6c177",
      shadow: darkShadow,
    },
  },
  {
    id: "tokyo-night",
    label: "Tokyo Night",
    family: "Tokyo Night",
    appearance: "dark",
    syntax: "tokyo-night",
    pierreTheme: "med-tokyo-night",
    source: "https://github.com/folke/tokyonight.nvim/tree/main/lua/tokyonight/colors",
    palette: {
      canvas: "#1a1b26",
      panel: "#16161e",
      raised: "#24283b",
      hover: "#292e42",
      border: "#3b4261",
      text: "#c0caf5",
      muted: "#a9b1d6",
      faint: "#737aa2",
      accent: "#7aa2f7",
      selected: "#394b70",
      green: "#9ece6a",
      red: "#f7768e",
      warning: "#e0af68",
      shadow: darkShadow,
    },
  },
  {
    id: "vitesse-dark",
    label: "Vitesse Dark",
    family: "Vitesse",
    appearance: "dark",
    syntax: "vitesse-dark",
    pierreTheme: "med-vitesse-dark",
    source: "https://github.com/antfu/vscode-theme-vitesse/blob/main/themes/vitesse-dark.json",
    palette: {
      canvas: "#121212",
      panel: "#121212",
      raised: "#181818",
      hover: "#202020",
      border: "#292929",
      text: "#dbd7ca",
      muted: "#bfbaaa",
      faint: "#777777",
      accent: "#4d9375",
      selected: "#263a30",
      green: "#4d9375",
      red: "#cb7676",
      warning: "#d4976c",
      shadow: darkShadow,
    },
  },
  {
    id: "graphite-light",
    label: "Graphite Light",
    family: "Neutral",
    appearance: "light",
    syntax: "pierre-light",
    pierreTheme: "med-graphite-light",
    source: null,
    palette: {
      canvas: "#ffffff",
      panel: "#f4f4f5",
      raised: "#ffffff",
      hover: "#eaeaec",
      border: "#e1e1e5",
      text: "#18181b",
      muted: "#5f5f68",
      faint: "#8b8b94",
      accent: "#4f5bd5",
      selected: "#e8eafc",
      green: "#1f7a4a",
      red: "#c23a4c",
      warning: "#94651c",
      shadow: lightShadow,
    },
  },
  {
    id: "rose-pine-dawn",
    label: "Rosé Pine Dawn",
    family: "Rosé Pine",
    appearance: "light",
    syntax: "rose-pine-dawn",
    pierreTheme: "med-rose-pine-dawn",
    source: "https://rosepinetheme.com/palette/",
    palette: {
      canvas: "#faf4ed",
      panel: "#fffaf3",
      raised: "#fffaf3",
      hover: "#f2e9e1",
      border: "#dfdad9",
      text: "#575279",
      muted: "#797593",
      faint: "#9893a5",
      accent: "#907aa9",
      selected: "#dfdad9",
      green: "#286983",
      red: "#b4637a",
      warning: "#a87924",
      shadow: lightShadow,
    },
  },
  {
    id: "vitesse-light",
    label: "Vitesse Light",
    family: "Vitesse",
    appearance: "light",
    syntax: "vitesse-light",
    pierreTheme: "med-vitesse-light",
    source: "https://github.com/antfu/vscode-theme-vitesse/blob/main/themes/vitesse-light.json",
    palette: {
      canvas: "#ffffff",
      panel: "#ffffff",
      raised: "#f7f7f7",
      hover: "#f0f0f0",
      border: "#e1e4e8",
      text: "#393a34",
      muted: "#6a737d",
      faint: "#999999",
      accent: "#1c6b48",
      selected: "#e7eee9",
      green: "#1e754f",
      red: "#ab5959",
      warning: "#a65e2b",
      shadow: lightShadow,
    },
  },
];

export const THEME_STORAGE_KEY = "med:theme:v1";
export const defaultTheme = themes[0];

export function findTheme(id: string | null | undefined): Theme {
  return themes.find((theme) => theme.id === id) ?? defaultTheme;
}

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  for (const [name, color] of Object.entries(theme.palette)) {
    root.style.setProperty(`--med-${name}`, color);
  }
  root.style.colorScheme = theme.appearance;
  root.dataset.theme = theme.id;
}

export interface ThemeSnapshot {
  active: Theme;
  saved: Theme;
  persistenceError: string | null;
}

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
export interface ThemeControllerOptions {
  storage?: ThemeStorage;
  apply?: (theme: Theme) => void;
}

// Selection preview is temporary. Only commit writes storage. This follows the
// behavior of Zed's theme selector; no Zed source code is copied.
// https://github.com/zed-industries/zed/blob/main/crates/theme_selector/src/theme_selector.rs
export function createThemeController(options: ThemeControllerOptions = {}) {
  let storage = options.storage;
  let snapshot: ThemeSnapshot = {
    active: defaultTheme,
    saved: defaultTheme,
    persistenceError: null,
  };
  const listeners = new Set<() => void>();
  function publish(
    active: Theme,
    saved = snapshot.saved,
    persistenceError = snapshot.persistenceError,
  ) {
    options.apply?.(active);
    snapshot = { active, saved, persistenceError };
    for (const listener of listeners) listener();
  }
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    initialize(nextStorage = storage) {
      storage = nextStorage;
      let theme = defaultTheme;
      let error: string | null = null;
      try {
        const stored = storage?.getItem(THEME_STORAGE_KEY);
        const legacy = !stored ? storage?.getItem("med:theme") : null;
        theme = findTheme(stored ?? (legacy === "light" ? "graphite-light" : undefined));
      } catch {
        error = "Theme storage is unavailable. Changes apply to this session.";
      }
      publish(theme, theme, error);
    },
    preview(id: string) {
      const theme = findTheme(id);
      if (theme !== snapshot.active) publish(theme);
    },
    commit(id: string) {
      const theme = findTheme(id);
      let error: string | null = null;
      try {
        storage?.setItem(THEME_STORAGE_KEY, theme.id);
      } catch {
        error = "Theme could not be saved. It applies to this session.";
      }
      publish(theme, theme, error);
    },
    cancelPreview() {
      if (snapshot.active !== snapshot.saved) publish(snapshot.saved);
    },
  };
}

export const themeController = createThemeController({
  apply: (theme) => {
    if (typeof document !== "undefined") applyTheme(theme);
  },
});

/** Call once before React mounts to avoid an incorrect first frame. */
export function initializeTheme(): void {
  try {
    themeController.initialize(window.localStorage);
  } catch {
    // Accessing localStorage itself can throw in restricted browser contexts.
    themeController.initialize({
      getItem() {
        throw new Error("Storage unavailable");
      },
      setItem() {
        throw new Error("Storage unavailable");
      },
    });
  }
}

export function useTheme(): ThemeSnapshot {
  return useSyncExternalStore(
    themeController.subscribe,
    themeController.getSnapshot,
    themeController.getSnapshot,
  );
}
