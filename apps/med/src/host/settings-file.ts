import { watch, type FSWatcher } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";

// Med's settings live in one JSON file, so an agent can change one by editing
// it; Med applies a saved change at once. docs/usage/settings.md describes
// each key.

/** A setting's value: a word, a number, or a switch. */
export type SettingValue = string | number | boolean;
export type Settings = Record<string, SettingValue>;

/** `$XDG_CONFIG_HOME/med/settings.json`, or `~/.config/med/settings.json`. */
export function settingsPath(env: NodeJS.ProcessEnv = process.env) {
  return join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "med", "settings.json");
}

/** A key such as `diffs.layout`: a group and a name. */
export const SETTING_KEY = /^[a-z][A-Za-z]*\.[a-z][A-Za-z]*$/;

const isValue = (value: unknown): value is SettingValue =>
  typeof value === "string" || typeof value === "number" || typeof value === "boolean";

/**
 * The settings file: what it holds, a write of one key, and a watch that
 * tells each listener when the file changes, also when an agent saves it.
 */
export function createSettingsFile(path = settingsPath()) {
  let settings: Settings = {};
  let error: string | null = null;
  let text = "";
  const listeners = new Set<() => void>();
  async function read() {
    const next = await readFile(path, "utf8").catch((reason: NodeJS.ErrnoException) =>
      reason.code === "ENOENT" ? "" : Promise.reject(reason),
    );
    if (next === text) return false;
    text = next;
    if (!next.trim()) {
      settings = {};
      error = null;
      return true;
    }
    try {
      const parsed: unknown = JSON.parse(next);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("The file holds no object.");
      settings = Object.fromEntries(
        Object.entries(parsed).filter(
          (entry): entry is [string, SettingValue] =>
            SETTING_KEY.test(entry[0]) && isValue(entry[1]),
        ),
      );
      error = null;
    } catch (reason) {
      // A file mid-edit keeps the settings that Med read last.
      error = `Med could not read ${path}: ${reason instanceof Error ? reason.message : String(reason)}`;
    }
    return true;
  }
  const ready = read().catch((reason: unknown) => {
    error = reason instanceof Error ? reason.message : String(reason);
  });
  let watcher: FSWatcher | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const changed = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void read().then(
        (fresh) => {
          if (fresh) for (const listener of listeners) listener();
        },
        () => {},
      );
    }, 80);
  };
  async function startWatch() {
    if (watcher) return;
    await mkdir(dirname(path), { recursive: true }).catch(() => {});
    try {
      // The folder, as an editor that saves by replacing the file makes a new one.
      watcher = watch(dirname(path), (_event, name) => {
        if (!name || name === basename(path)) changed();
      });
      watcher.on("error", () => {});
    } catch {
      /* Without a watch, Med's own writes still apply. */
    }
  }
  return {
    path,
    /** The file as it is now, read again: a watch can miss a save. */
    async snapshot() {
      await ready;
      await read().catch(() => {});
      return { path, settings, error };
    },
    /** Writes one key, keeping every other key and the file's other text as JSON. */
    async set(key: string, value: SettingValue) {
      await ready;
      let current: Record<string, unknown> = {};
      try {
        const parsed: unknown = text.trim() ? JSON.parse(text) : {};
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
          current = parsed as Record<string, unknown>;
      } catch {
        throw new Error(`${path} is not valid JSON; fix it before Med writes to it.`);
      }
      const next = `${JSON.stringify({ ...current, [key]: value }, null, 2)}\n`;
      await mkdir(dirname(path), { recursive: true });
      const temporary = `${path}.${process.pid}.tmp`;
      await writeFile(temporary, next);
      await rename(temporary, path);
      await read();
      for (const listener of listeners) listener();
      return { path, settings, error };
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      void startWatch();
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          watcher?.close();
          watcher = null;
        }
      };
    },
    close() {
      clearTimeout(timer);
      watcher?.close();
      watcher = null;
      listeners.clear();
    },
  };
}
