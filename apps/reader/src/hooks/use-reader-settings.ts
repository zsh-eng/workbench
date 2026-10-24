import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import { toReadingFontId } from "@/lib/reading-fonts";
import {
  READER_FONT_SIZE_DEFAULT_PX,
  READER_FONT_SIZE_MAX_PX,
  READER_FONT_SIZE_MIN_PX,
  THEME_CLASSES,
  type ReaderSettings,
} from "@/types/reader.types";
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { toast } from "sonner";

const STORAGE_KEY = "epub-reader-settings";
const APPEARANCE_STORAGE_KEY = "epub-reader-appearance";
const THEME_TRANSITION_CLASS = "theme-transitioning";
const LEGACY_FONT_SIZE_BASE_PX = 16;

export type AppearanceMode = "light" | "dark" | "system";

const DEFAULT_SETTINGS = {
  fontSize: READER_FONT_SIZE_DEFAULT_PX,
  lineHeight: 1.5,
  fontFamily: "lora",
  theme: "light",
  textAlign: "left",
  contentWidth: "narrow",
  publisherBookStylingEnabled: false,
  matchPublisherBodyTextSize: false,
  pageAnimationsEnabled: true,
  showPageNumbers: true,
} satisfies ReaderSettings;

const THEME_TRANSITION_DURATION_MS = 0;

function clampFontSizePx(value: number): number {
  return Math.min(
    READER_FONT_SIZE_MAX_PX,
    Math.max(READER_FONT_SIZE_MIN_PX, value),
  );
}

// Older builds stored font size as a percentage of a 16px base.
// Normalize on read/update so saved preferences carry forward cleanly.
function normalizeFontSize(fontSize: unknown): number {
  if (typeof fontSize !== "number" || !Number.isFinite(fontSize)) {
    return READER_FONT_SIZE_DEFAULT_PX;
  }

  if (fontSize > READER_FONT_SIZE_MAX_PX) {
    return clampFontSizePx(
      Math.round((fontSize / 100) * LEGACY_FONT_SIZE_BASE_PX),
    );
  }

  return clampFontSizePx(Math.round(fontSize));
}

function normalizeReaderSettings(settings: ReaderSettings): ReaderSettings {
  return {
    ...settings,
    fontSize: normalizeFontSize(settings.fontSize),
    fontFamily: toReadingFontId(
      settings.fontFamily,
      DEFAULT_SETTINGS.fontFamily,
    ),
  };
}

function isDarkReaderTheme(theme: ReaderSettings["theme"]): boolean {
  return theme === "dark" || theme === "night" || theme === "flexoki-dark";
}

function resolveAppearanceTheme(
  currentTheme: ReaderSettings["theme"],
  useDarkTheme: boolean,
): ReaderSettings["theme"] {
  const useFlexoki = currentTheme.startsWith("flexoki");
  if (useFlexoki) return useDarkTheme ? "flexoki-dark" : "flexoki-light";
  if (currentTheme === "night") return useDarkTheme ? "night" : "light";
  return useDarkTheme ? "dark" : "light";
}

function isAppearanceMode(value: string | null): value is AppearanceMode {
  return value === "light" || value === "dark" || value === "system";
}

interface ReaderSettingsContextValue {
  settings: ReaderSettings;
  updateSettings: (newSettings: Partial<ReaderSettings>) => void;
  resetSettings: () => void;
  appearanceMode: AppearanceMode;
  setAppearanceMode: (appearanceMode: AppearanceMode) => void;
}

const ReaderSettingsContext = createContext<ReaderSettingsContextValue | null>(
  null,
);

/**
 * Owns reader settings for the full application session.
 *
 * A single provider keeps the sidebar, library, and mounted reader on the same
 * settings snapshot while localStorage remains the durable backing store.
 */
export function ReaderSettingsProvider({ children }: { children: ReactNode }) {
  // Track timeout for theme transition cleanup
  const themeTransitionTimeoutRef = useRef<number | null>(null);
  // Track if this is the initial mount - skip transitions on first load
  const isInitialMount = useRef(true);

  const storageErrorReported = useRef(false);
  // Do not overwrite saved preferences with fallback values after a failed read.
  const settingsChanged = useRef(false);
  const settingsReadFailed = useRef(false);
  const appearanceChanged = useRef(false);

  const reportStorageError = useCallback(() => {
    if (storageErrorReported.current) return;
    storageErrorReported.current = true;
    toast.error("Appearance changes weren’t saved.", {
      id: "reader-settings-storage-error",
    });
  }, []);

  // Initialize state from localStorage or defaults
  const [settings, setSettings] = useState<ReaderSettings>(() => {
    if (typeof window === "undefined") return DEFAULT_SETTINGS;

    try {
      const item = getRuntimeStorage().getItem(STORAGE_KEY);
      if (!item) {
        return DEFAULT_SETTINGS;
      }

      return normalizeReaderSettings({
        ...DEFAULT_SETTINGS,
        ...JSON.parse(item),
      });
    } catch (error) {
      settingsReadFailed.current = true;
      console.warn("Error reading settings from localStorage:", error);
      return DEFAULT_SETTINGS;
    }
  });
  const [appearanceMode, setAppearanceModeState] = useState<AppearanceMode>(
    () => {
      if (typeof window === "undefined") return "light";

      try {
        const storedAppearance = getRuntimeStorage().getItem(
          APPEARANCE_STORAGE_KEY,
        );
        if (isAppearanceMode(storedAppearance)) return storedAppearance;
      } catch (error) {
        console.warn("Error reading appearance from localStorage:", error);
      }
      return isDarkReaderTheme(settings.theme) ? "dark" : "light";
    },
  );

  // Update localStorage when settings change
  useEffect(() => {
    if (settingsChanged.current) {
      try {
        getRuntimeStorage().setItem(STORAGE_KEY, JSON.stringify(settings));
      } catch {
        reportStorageError();
      }
    }

    // Manually handle theme switching since we removed next-themes
    const root = window.document.documentElement;

    // Clear any existing timeout to ensure only the latest transition completes
    if (themeTransitionTimeoutRef.current !== null) {
      clearTimeout(themeTransitionTimeoutRef.current);
    }

    // Only add transition class after initial mount to avoid flash/stagger on page load
    // This is combined with the initial setting of the theme in index.html
    if (isInitialMount.current) {
      isInitialMount.current = false;
    } else {
      root.classList.add(THEME_TRANSITION_CLASS);
      themeTransitionTimeoutRef.current = window.setTimeout(() => {
        root.classList.remove(THEME_TRANSITION_CLASS);
        themeTransitionTimeoutRef.current = null;
      }, THEME_TRANSITION_DURATION_MS);
    }

    // Read the theme token, not the transitioning body colour. This also runs
    // on first mount so restored dark themes do not retain a white browser bar.
    root.classList.remove(...THEME_CLASSES);
    root.classList.add(settings.theme);
    // Commit the new palette while descendant transitions are suppressed.
    void root.offsetHeight;
    window.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute(
        "content",
        getComputedStyle(root).getPropertyValue("--background").trim(),
      );

    // Cleanup: clear timeout if component unmounts
    return () => {
      if (themeTransitionTimeoutRef.current !== null) {
        clearTimeout(themeTransitionTimeoutRef.current);
      }
    };
  }, [settings, reportStorageError]);

  useEffect(() => {
    if (!appearanceChanged.current) return;
    try {
      getRuntimeStorage().setItem(APPEARANCE_STORAGE_KEY, appearanceMode);
    } catch {
      reportStorageError();
    }
  }, [appearanceMode, reportStorageError]);

  useEffect(() => {
    if (appearanceMode !== "system") return;

    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const applySystemTheme = (useDarkTheme: boolean) => {
      if (!settingsReadFailed.current) settingsChanged.current = true;
      setSettings((previousSettings) => ({
        ...previousSettings,
        theme: resolveAppearanceTheme(previousSettings.theme, useDarkTheme),
      }));
    };

    applySystemTheme(systemTheme.matches);
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      applySystemTheme(event.matches);
    };
    systemTheme.addEventListener("change", handleSystemThemeChange);
    return () => {
      systemTheme.removeEventListener("change", handleSystemThemeChange);
    };
  }, [appearanceMode]);

  const updateSettings = useCallback((newSettings: Partial<ReaderSettings>) => {
    settingsChanged.current = true;
    setSettings((prev) => normalizeReaderSettings({ ...prev, ...newSettings }));

    if (newSettings.theme) {
      appearanceChanged.current = true;
      setAppearanceModeState(
        isDarkReaderTheme(newSettings.theme) ? "dark" : "light",
      );
    }
  }, []);

  const setAppearanceMode = useCallback((nextAppearance: AppearanceMode) => {
    settingsChanged.current = true;
    appearanceChanged.current = true;
    const useDarkTheme =
      nextAppearance === "system"
        ? window.matchMedia("(prefers-color-scheme: dark)").matches
        : nextAppearance === "dark";

    setAppearanceModeState(nextAppearance);
    setSettings((previousSettings) => ({
      ...previousSettings,
      theme: resolveAppearanceTheme(previousSettings.theme, useDarkTheme),
    }));
  }, []);

  const resetSettings = useCallback(() => {
    settingsChanged.current = true;
    appearanceChanged.current = true;
    setSettings(DEFAULT_SETTINGS);
    setAppearanceModeState("light");
  }, []);

  const value = useMemo<ReaderSettingsContextValue>(
    () => ({
      settings,
      updateSettings,
      resetSettings,
      appearanceMode,
      setAppearanceMode,
    }),
    [
      appearanceMode,
      resetSettings,
      setAppearanceMode,
      settings,
      updateSettings,
    ],
  );

  return createElement(ReaderSettingsContext.Provider, { value }, children);
}

export function useReaderSettings(): ReaderSettingsContextValue {
  const context = useContext(ReaderSettingsContext);
  if (!context) {
    throw new Error(
      "useReaderSettings must be used within ReaderSettingsProvider",
    );
  }
  return context;
}
