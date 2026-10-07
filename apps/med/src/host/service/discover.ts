import { readFile, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join } from "node:path";

/** The home folder that setup searches and where the login item goes. Tests
 * point `MED_HOME_DIR` at a fixture. */
export const userHome = () => process.env.MED_HOME_DIR || homedir();

export interface FoundSource {
  path: string;
  name: string;
  /** Last use in milliseconds since the epoch, or 0 when unknown. */
  activity: number;
  /** The checked-out branch of a repository. */
  branch?: string;
}
export interface Discovery {
  /** The searched home folder, for showing paths as ~/… */
  home: string;
  repositories: FoundSource[];
  vaults: FoundSource[];
  /** Home folders that macOS guards with a permission prompt, left out unless asked. */
  skipped: string[];
  /** The search stopped at its time or folder limit. */
  truncated: boolean;
}

// Reading these makes macOS ask for permission, so setup asks the user first.
const PROTECTED = ["Desktop", "Documents", "Downloads"];
const HOME_SKIP = new Set([
  "Library",
  "Applications",
  "Pictures",
  "Movies",
  "Music",
  "Public",
  "Sites",
]);
// Dependency, build, and cache folders hold checkouts that nobody edits.
const SKIP = new Set([
  "node_modules",
  "bower_components",
  "vendor",
  "Pods",
  "Carthage",
  "DerivedData",
  "target",
  "build",
  "dist",
  "out",
  "venv",
  "site-packages",
  "__pycache__",
]);
const DEPTH = 4;
const FOLDERS = 40_000;
const LIMIT = 300;

const modified = (path: string) =>
  stat(path).then(
    (info) => info.mtimeMs,
    () => 0,
  );

async function repository(path: string): Promise<FoundSource> {
  const git = join(path, ".git");
  // The index changes on status and staging, the HEAD log on commits and checkouts.
  const times = await Promise.all(
    ["index", "HEAD", "logs/HEAD", "FETCH_HEAD"].map((name) => modified(join(git, name))),
  );
  const head = await readFile(join(git, "HEAD"), "utf8").catch(() => "");
  const branch = /^ref: refs\/heads\/(.+)$/m.exec(head)?.[1];
  return {
    path,
    name: basename(path),
    activity: Math.max(...times),
    ...(branch ? { branch } : {}),
  };
}

async function vault(path: string, opened = 0): Promise<FoundSource> {
  // Obsidian rewrites its workspace file while a vault is open.
  const used = Math.max(opened, await modified(join(path, ".obsidian", "workspace.json")));
  return { path, name: basename(path), activity: used };
}

/** Vaults that Obsidian itself lists, with the time each was last opened. */
async function obsidianVaults(home: string) {
  const config = join(home, "Library", "Application Support", "obsidian", "obsidian.json");
  try {
    const data = JSON.parse(await readFile(config, "utf8")) as {
      vaults?: Record<string, { path?: unknown; ts?: unknown }>;
    };
    return Object.values(data.vaults ?? {}).flatMap((entry) =>
      typeof entry.path === "string"
        ? [{ path: entry.path, opened: typeof entry.ts === "number" ? entry.ts : 0 }]
        : [],
    );
  } catch {
    return [];
  }
}

/**
 * Finds Git repositories and Obsidian vaults under the home folder, most
 * recently used first. It reads folder names only, never file contents, and
 * stops at a depth, folder, and time limit. Linked worktrees and submodules
 * belong to their main repository, so they are left out.
 */
export async function discoverSources(
  options: { home?: string; deep?: boolean; signal?: AbortSignal; budgetMs?: number } = {},
): Promise<Discovery> {
  // Registered sources keep real paths; children of a real path stay real,
  // because the search does not follow symbolic links.
  const home = await realpath(options.home ?? userHome());
  const deadline = Date.now() + (options.budgetMs ?? 6000);
  const repositories = new Map<string, Promise<FoundSource>>();
  const vaults = new Map<string, Promise<FoundSource>>();
  const skipped = options.deep ? [] : PROTECTED;
  let folders = 0;
  let truncated = false;

  const visit = async (directory: string, depth: number): Promise<string[]> => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return [];
    }
    const names = new Set(entries.map((entry) => entry.name));
    const git = entries.find((entry) => entry.name === ".git");
    if (names.has(".obsidian")) {
      vaults.set(directory, vault(directory));
      return [];
    }
    if (git?.isDirectory()) {
      repositories.set(directory, repository(directory));
      return [];
    }
    // A .git file marks a linked worktree or a submodule.
    if (git || depth >= DEPTH) return [];
    return entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.name.startsWith(".") &&
          !SKIP.has(entry.name) &&
          !(depth === 0 && (HOME_SKIP.has(entry.name) || skipped.includes(entry.name))),
      )
      .map((entry) => join(directory, entry.name));
  };

  let level = [home];
  for (let depth = 0; level.length && !options.signal?.aborted; depth++) {
    const next: string[] = [];
    // Read a few folders at a time: enough to hide latency, gentle on the disk.
    for (let index = 0; index < level.length; index += 16) {
      if (Date.now() > deadline || folders >= FOLDERS) {
        truncated = true;
        break;
      }
      const batch = level.slice(index, index + 16);
      folders += batch.length;
      for (const children of await Promise.all(batch.map((path) => visit(path, depth))))
        next.push(...children);
    }
    if (truncated) break;
    level = next;
  }

  for (const entry of await obsidianVaults(home)) {
    const path = await realpath(entry.path).catch(() => "");
    if (!path) continue;
    const exists = await stat(join(path, ".obsidian")).then(
      (info) => info.isDirectory(),
      () => false,
    );
    if (exists) vaults.set(path, vault(path, entry.opened));
  }
  const ranked = async (found: Map<string, Promise<FoundSource>>) =>
    (await Promise.all(found.values()))
      .sort((a, b) => b.activity - a.activity || a.name.localeCompare(b.name))
      .slice(0, LIMIT);
  return {
    home,
    repositories: await ranked(repositories),
    vaults: await ranked(vaults),
    skipped,
    truncated,
  };
}
