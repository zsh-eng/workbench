import { useSyncExternalStore } from "react";
import { z } from "zod";
import {
  THEME_DARK_KEY,
  THEME_LIGHT_KEY,
  THEME_MODE_KEY,
  THEME_STORAGE_KEY,
  initializeTheme,
  themes,
} from "../themes";
import { createApi } from "./api";
import { readBrowserToken } from "./auth";
import { reconnectPause } from "./reconnect";
import { readServerEvents } from "./sse";
import { onStored } from "./stored-settings";
import { CODE_SIZES } from "./view-settings";

// Every setting lives in ~/.config/med/settings.json, so an agent can change
// one by editing the file. The page keeps each one in localStorage, as it
// always has, and this keeps the two the same: the reader's choice goes to
// the file, and a save of the file comes to the page at once.
// docs/usage/settings.md describes each key.

type FileValue = string | number | boolean;
/** A key in the file, the localStorage key it mirrors, and how each reads the other. */
interface Mirror {
  file: string;
  storage: string;
  toFile(stored: string): FileValue | undefined;
  fromFile(value: unknown): string | undefined;
}

const word = (file: string, storage: string, values: readonly string[]): Mirror => ({
  file,
  storage,
  toFile: (stored) => (values.includes(stored) ? stored : undefined),
  fromFile: (value) => (typeof value === "string" && values.includes(value) ? value : undefined),
});
const flag = (file: string, storage: string, on: string, off: string): Mirror => ({
  file,
  storage,
  toFile: (stored) => (stored === on ? true : stored === off ? false : undefined),
  fromFile: (value) => (value === true ? on : value === false ? off : undefined),
});
const size = (file: string, storage: string, values: readonly string[]): Mirror => ({
  file,
  storage,
  toFile: (stored) => (values.includes(stored) ? Number(stored) : undefined),
  fromFile: (value) =>
    typeof value === "number" && values.includes(String(value)) ? String(value) : undefined,
});
const theme = (file: string, storage: string, appearance: "light" | "dark"): Mirror => ({
  file,
  storage,
  toFile: (stored) => stored,
  fromFile: (value) =>
    themes.some((entry) => entry.id === value && entry.appearance === appearance)
      ? (value as string)
      : undefined,
});

/** The settings in the file, by page. */
export const FILE_SETTINGS = {
  appearance: [
    word("appearance.theme", THEME_MODE_KEY, ["system", "light", "dark"]),
    theme("appearance.lightTheme", THEME_LIGHT_KEY, "light"),
    theme("appearance.darkTheme", THEME_DARK_KEY, "dark"),
  ],
  code: [
    word("diffs.layout", "med:mode", ["split", "unified"]),
    flag("diffs.wrap", "med:wrap", "on", "off"),
    flag("diffs.comments", "med:comments", "shown", "hidden"),
    size("code.textSize", "med:code-size", CODE_SIZES),
    flag("files.vim", "med:vim", "on", "off"),
    flag("files.lineBlame", "med:line-blame", "on", "off"),
    flag("files.findPreview", "med:picker-preview", "on", "off"),
    word("session.followUp", "med:follow-up", ["now", "queue"]),
  ],
  sources: [flag("sources.pullBase", "med:pull-base", "on", "off")],
} satisfies Record<string, Mirror[]>;
const MIRRORS = Object.values(FILE_SETTINGS).flat();
const THEME_KEYS = new Set([THEME_MODE_KEY, THEME_LIGHT_KEY, THEME_DARK_KEY]);

const snapshotSchema = z.object({
  path: z.string(),
  settings: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  error: z.string().nullable(),
});
export type SettingsFile = z.infer<typeof snapshotSchema>;

let current: SettingsFile | null = null;
const watchers = new Set<() => void>();
const publish = (next: SettingsFile) => {
  current = next;
  for (const watcher of watchers) watcher();
};
/** The settings file as Med read it last; null before the host answers. */
export function useSettingsFile() {
  return useSyncExternalStore(
    (listener) => {
      watchers.add(listener);
      return () => watchers.delete(listener);
    },
    () => current,
    () => null,
  );
}

const read = (key: string) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

/** The file's values, into the page's storage; each store hears of its change. */
function apply(settings: SettingsFile["settings"]) {
  const changed: string[] = [];
  for (const mirror of MIRRORS) {
    const stored = mirror.fromFile(settings[mirror.file]);
    if (stored === undefined || read(mirror.storage) === stored) continue;
    try {
      localStorage.setItem(mirror.storage, stored);
      changed.push(mirror.storage);
    } catch {
      /* The page keeps its own value. */
    }
  }
  if (changed.some((key) => THEME_KEYS.has(key))) {
    // The theme on screen follows the three choices, not an older Med's key.
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      /* initializeTheme reads what storage has. */
    }
    initializeTheme();
  }
  for (const key of changed) window.dispatchEvent(new StorageEvent("storage", { key }));
}

/**
 * Keeps the page's settings and the settings file the same, while the page
 * is open. A setting the file lacks, which the page has, goes to the file
 * once, so the choices from before the file stay.
 */
export function startSettingsFile(fetcher: typeof fetch = fetch.bind(globalThis)) {
  const api = createApi(fetcher, readBrowserToken());
  const controller = new AbortController();
  const { signal } = controller;
  const write = (key: string, value: FileValue) => {
    if (current?.settings[key] === value) return;
    void api
      .json("/api/settings", snapshotSchema, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value }),
      })
      .then(publish, () => {});
  };
  const stop = onStored((key, value) => {
    const mirror = MIRRORS.find((entry) => entry.storage === key);
    const fileValue = mirror?.toFile(value);
    if (mirror && fileValue !== undefined) write(mirror.file, fileValue);
  });
  let first = true;
  void (async () => {
    let attempt = 0;
    while (!signal.aborted) {
      try {
        const response = await api.stream("/api/settings/events", signal);
        // An older host has no settings file.
        if (response.status === 404) return;
        if (!response.ok || !response.body) throw new Error("The settings stream closed.");
        attempt = 0;
        await readServerEvents(
          response.body,
          (event) => {
            if (event.event !== "state") return;
            const parsed = snapshotSchema.safeParse(JSON.parse(event.data));
            if (!parsed.success) return;
            publish(parsed.data);
            apply(parsed.data.settings);
            if (!first) return;
            first = false;
            for (const mirror of MIRRORS) {
              const stored = read(mirror.storage);
              const value = stored === null ? undefined : mirror.toFile(stored);
              if (!(mirror.file in parsed.data.settings) && value !== undefined)
                write(mirror.file, value);
            }
          },
          signal,
          256 * 1024,
        );
      } catch {
        if (signal.aborted) return;
      }
      await reconnectPause(attempt++, signal);
    }
  })();
  return () => {
    stop();
    controller.abort();
  };
}

/** A page's part of the file, as JSON. */
export function filePart(file: SettingsFile, page: keyof typeof FILE_SETTINGS) {
  const part = Object.fromEntries(
    FILE_SETTINGS[page]
      .filter((mirror) => mirror.file in file.settings)
      .map((mirror) => [mirror.file, file.settings[mirror.file]]),
  );
  return JSON.stringify(part, null, 2);
}
