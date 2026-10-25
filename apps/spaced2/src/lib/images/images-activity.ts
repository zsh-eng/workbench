import { memoryReady } from "@/lib/db/memory";
import { downloadImageLocally } from "@/lib/images/db";
import { searchForLinks } from "@/lib/images/download-all";
import { PromiseRateLimiterQueue } from "@/lib/images/promise-limiter";
import {
  createActivityManager,
  type ActivityManager,
  type ActivityStorage,
} from "@workbench/background-activity";

/** Images that download at once. */
const IMAGES_AT_ONCE = 5;

export const ALL_IMAGES_JOB = "images:all";

/** How the last "Download all images" ended, for its row on the Images page. */
export interface ImagesOutcome {
  state: "finished" | "cancelled";
  done: number;
  total: number;
  downloaded: number;
  failed: number;
}

export interface ImagesActivity {
  manager: ActivityManager;
  /** Start, or join, the download of every image in your cards. */
  start(): void;
  cancel(): void;
  subscribe(listener: () => void): () => void;
  outcome(): ImagesOutcome | null;
}

/**
 * "Download all images" as a background job: it runs from anywhere and
 * keeps going when you leave the Images page. Five images download at once;
 * one that fails is counted and the rest carry on. Offline, the job waits
 * and starts again when the network returns, skipping images already here.
 */
export function createImagesActivity({
  download = downloadImageLocally,
  findLinks = searchForLinks,
  storage,
  ready,
}: {
  download?: typeof downloadImageLocally;
  findLinks?: typeof searchForLinks;
  /** Keeps the job across a reload. */
  storage?: ActivityStorage;
  /** The cards are loaded: a job restored after a reload waits for them. */
  ready?: Promise<unknown>;
} = {}): ImagesActivity {
  let outcome: ImagesOutcome | null = null;
  const listeners = new Set<() => void>();
  const settle = (next: ImagesOutcome | null) => {
    outcome = next;
    for (const listener of [...listeners]) listener();
  };
  let current = { done: 0, total: 0, downloaded: 0, failed: 0 };

  const manager = createActivityManager({
    kinds: {
      images: {
        lane: "images",
        persist: storage !== undefined,
        title: () => "All images",
        async run(_input: Record<string, never>, { signal, progress }) {
          const links = [...findLinks().entries()];
          current = { done: 0, total: links.length, downloaded: 0, failed: 0 };
          progress({ phase: "downloading", done: 0, total: links.length });
          const limiter = new PromiseRateLimiterQueue(IMAGES_AT_ONCE);
          await Promise.allSettled(
            links.map(([url, altText]) =>
              limiter.add(async () => {
                // A cancel stops the images still queued; those already
                // downloading finish and count.
                if (signal.aborted) return;
                try {
                  const { newlyDownloaded } = await download(url, altText);
                  if (newlyDownloaded) current.downloaded += 1;
                } catch (error) {
                  console.error(error);
                  current.failed += 1;
                } finally {
                  current.done += 1;
                  progress({ done: current.done });
                  // After a cancel, the images already downloading still
                  // finish, and the row counts them.
                  if (outcome?.state === "cancelled")
                    settle({ ...outcome, done: current.done });
                }
              }),
            ),
          );
          signal.throwIfAborted();
          settle({ state: "finished", ...current });
        },
      },
    },
    lanes: { images: 1 },
    persist: storage ? { storage, key: "spaced-activity-v1" } : undefined,
    paused: ready !== undefined,
  });
  void ready?.then(() => manager.resume());

  return {
    manager,
    start() {
      settle(null);
      manager.start("images", {}, { id: ALL_IMAGES_JOB, origin: "user" });
    },
    cancel() {
      if (!manager.get(ALL_IMAGES_JOB)) return;
      manager.cancel(ALL_IMAGES_JOB);
      settle({ state: "cancelled", ...current });
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    outcome: () => outcome,
  };
}

function localStorageOrNone(): ActivityStorage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** The app's one images job, shared by the Images page and the pill. */
export const imagesActivity = createImagesActivity({
  storage: localStorageOrNone(),
  ready: memoryReady,
});
