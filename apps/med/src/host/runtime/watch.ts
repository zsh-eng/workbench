import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { watch as nativeWatch, type FSWatcher as NativeWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { watch, type FSWatcher } from "chokidar";
import { gitSignature } from "../repository/cache";
import { git } from "./process";

export interface WatchHandlers {
  /** A change, after a short delay that joins a burst of file events. */
  change(): void;
  /** Each file event, at once, before the delay. */
  hint?(): void;
  /** The watchers are ready: from now on, they see each change. */
  ready?(): void;
  /** Whether a window shows the checkout. One that no window shows has its
   * safety check at a tenth of the rate. */
  shown?(): boolean;
}

export interface WatchOptions {
  /** How often a check finds a change that the file events missed (60 s). */
  safetyMs?: number;
  /** Tests turn file events off, so that only the safety check finds changes. */
  events?: boolean;
}

/** Watch filesystem hints and periodically reconcile changed-path metadata. */
export async function watchRepository(
  repo: string,
  handlers: WatchHandlers,
  live = false,
  options: WatchOptions = {},
) {
  const events = options.events ?? true;
  const abort = new AbortController();
  const [metadata, ignored] = await Promise.all([
    git(repo, ["rev-parse", "--path-format=absolute", "--git-dir", "--git-common-dir"], {
      signal: abort.signal,
      maxBytes: 8192,
    }),
    live && events
      ? git(
          repo,
          ["ls-files", "--others", "--ignored", "--exclude-standard", "--directory", "-z"],
          { signal: abort.signal, maxBytes: 1024 * 1024 },
        ).catch(() => Buffer.alloc(0))
      : Promise.resolve(Buffer.alloc(0)),
  ]);
  const gitDirectories = metadata
    .toString("utf8")
    .trim()
    .split("\n")
    .map((path) => resolve(repo, path));
  const ignoredRoots = ignored
    .toString("utf8")
    .split("\0")
    .filter((path) => path.endsWith("/"))
    .map((path) => resolve(repo, path));
  const excludes = [...ignoredRoots, ...gitDirectories.map((path) => join(path, "objects"))];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let maximum: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  let previousSignature = "";
  let checking = false;
  const flush = () => {
    if (timer) clearTimeout(timer);
    if (maximum) clearTimeout(maximum);
    timer = undefined;
    maximum = undefined;
    if (!closed) handlers.change();
  };
  const hint = () => {
    if (closed) return;
    handlers.hint?.();
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 200);
    maximum ??= setTimeout(flush, 1000);
  };
  let watcher: FSWatcher | undefined;
  let native: NativeWatcher | undefined;
  if (events) {
    watcher = watch([...new Set(gitDirectories)], {
      ignoreInitial: true,
      followSymlinks: false,
      depth: 8,
      ignored: (path) => excludes.some((root) => path === root || path.startsWith(`${root}/`)),
    });
    watcher.on("all", hint);
    if (live && (process.platform === "darwin" || process.platform === "win32")) {
      try {
        native = nativeWatch(repo, { recursive: true }, (_event, name) => {
          const path = name ? resolve(repo, name.toString()) : "";
          if (!path || !excludes.some((root) => path === root || path.startsWith(`${root}/`)))
            hint();
        });
        native.on("error", () => hint());
      } catch {
        /* Periodic reconciliation recovers unavailable native watching. */
      }
    } else if (live) {
      // Bound recursion on portable platforms; reconciliation covers deeper changed files.
      watcher.add(repo);
    }
  }
  // A missed watcher hint is recovered by a periodic check: for working files,
  // status plus file metadata; for Git metadata only, its signature, without Git.
  const commonDir = gitDirectories[1] ?? gitDirectories[0]!;
  const reconcile = async () => {
    if (closed || checking) return;
    checking = true;
    try {
      const metadata = live ? undefined : await gitSignature(commonDir, [repo]);
      const status =
        metadata !== undefined
          ? Buffer.from(metadata)
          : await git(
              repo,
              live
                ? ["status", "--porcelain=v1", "-z", "--untracked-files=all"]
                : ["show-ref", "--head"],
              {
                signal: abort.signal,
                maxBytes: 2 * 1024 * 1024,
                acceptedExitCodes: live ? [0] : [0, 1],
              },
            );
      const hash = createHash("sha256").update(status);
      const fields = live ? status.toString("utf8").split("\0") : [];
      for (let i = 0; i < fields.length; i++) {
        const entry = fields[i]!;
        if (entry.length < 4) continue;
        const path = entry.slice(3);
        if (entry[0] === "R" || entry[0] === "C") i++;
        try {
          const stat = await lstat(join(repo, path), { bigint: true });
          hash.update(`${path}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
        } catch {
          hash.update(`${path}:missing`);
        }
      }
      const signature = hash.digest("hex");
      if (previousSignature && signature !== previousSignature) hint();
      previousSignature = signature;
    } catch {
      if (!closed) hint();
    } finally {
      checking = false;
    }
  };
  const first = reconcile();
  if (watcher) {
    watcher.on("error", () => {
      void reconcile();
    });
    watcher.on("ready", () => {
      void reconcile();
      if (!closed) handlers.ready?.();
    });
  } else
    void first.then(() => {
      if (!closed) handlers.ready?.();
    });
  let unseen = 0;
  const interval = setInterval(() => {
    if ((handlers.shown?.() ?? true) || ++unseen >= 10) {
      unseen = 0;
      void reconcile();
    }
  }, options.safetyMs ?? 60_000);
  interval.unref();
  return async () => {
    closed = true;
    abort.abort();
    native?.close();
    clearInterval(interval);
    if (timer) clearTimeout(timer);
    if (maximum) clearTimeout(maximum);
    await watcher?.close();
  };
}
