import { ALL_IMAGES_JOB, imagesActivity } from "@/lib/images/images-activity";
import { reviewSession } from "@/lib/review/session";
import { spacedSync } from "@/lib/sync/engine";
import {
  updateMoment,
  updatePolicy,
  type UpdateContext,
  type UpdateMomentEvent,
} from "@/lib/update-policy";
import {
  createAppUpdate,
  type AppUpdate,
  type AppUpdateState,
} from "@workbench/background-activity/service-worker";
import { useSyncExternalStore } from "react";

const holds = new Set<() => boolean>();

/** Hold a waiting update while `check` is true, for example during an import. */
export function holdUpdatesWhile(check: () => boolean): () => void {
  holds.add(check);
  return () => {
    holds.delete(check);
  };
}

let touched = false;

function updateContext(): UpdateContext {
  const images = imagesActivity.manager.get(ALL_IMAGES_JOB);
  return {
    reviewing: reviewSession.getSnapshot() !== undefined,
    busy:
      (images !== undefined &&
        images.state !== "done" &&
        images.state !== "failed" &&
        images.state !== "cancelled") ||
      // An edit, a confirmation or the command bar.
      document.querySelector('[role="dialog"], [role="alertdialog"]') !==
        null ||
      [...holds].some((check) => check()),
    pageAgeMs: performance.now(),
    touched,
    required: spacedSync.getSnapshot().failure?.kind === "upgrade-required",
  };
}

let instance: AppUpdate | null = null;
const startListeners = new Set<() => void>();

/** Waits for the page to finish loading, as Workbox's registration does. */
function afterLoad(): Promise<void> {
  if (document.readyState === "complete") return Promise.resolve();
  return new Promise((resolve) =>
    window.addEventListener("load", () => resolve(), { once: true }),
  );
}

/**
 * Registers the worker and follows its updates, once per page. A new
 * version downloads in the background and waits; `updatePolicy` and
 * `updateMoment` (src/lib/update-policy.ts) decide when it takes over.
 * Development builds and the Elements page's frames register no worker.
 */
export function startAppUpdate(): AppUpdate | null {
  if (instance) return instance;
  if (
    !import.meta.env.PROD ||
    !("serviceWorker" in navigator) ||
    location.pathname.startsWith("/debug/elements")
  )
    return null;
  const markTouched = () => {
    touched = true;
  };
  window.addEventListener("pointerdown", markTouched, {
    capture: true,
    once: true,
  });
  window.addEventListener("keydown", markTouched, {
    capture: true,
    once: true,
  });
  const container = navigator.serviceWorker;
  instance = createAppUpdate({
    container,
    async register() {
      await afterLoad();
      return container.register("/sw.js", { scope: "/" });
    },
    policy: () => updatePolicy(updateContext()),
    reload: () => location.reload(),
    storage: sessionStorage,
    title: "Spaced",
  });
  for (const listener of startListeners) listener();
  return instance;
}

/** Applies or checks for an update if this is its moment. */
export function atUpdateMoment(event: UpdateMomentEvent): void {
  if (!instance) return;
  const next = updateMoment(instance.getSnapshot(), event, updateContext());
  if (next === "apply") instance.apply();
  else if (next === "check") void instance.check();
}

/** Switch to the waiting version now: the tap on Restart. */
export function applyUpdate(): void {
  instance?.apply();
}

const IDLE: AppUpdateState = {
  status: "idle",
  progress: null,
  takenOver: false,
  justUpdated: false,
  error: null,
};

function subscribe(listener: () => void): () => void {
  let stop = instance?.subscribe(listener) ?? null;
  const onStart = () => {
    stop?.();
    stop = instance?.subscribe(listener) ?? null;
    listener();
  };
  startListeners.add(onStart);
  return () => {
    startListeners.delete(onStart);
    stop?.();
  };
}

const getSnapshot = () => instance?.getSnapshot() ?? IDLE;

/** The update's state, idle before the worker registers. */
export function useAppUpdate(): AppUpdateState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
