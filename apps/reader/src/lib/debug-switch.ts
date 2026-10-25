import { getRuntimeStorage } from "@/features/sync-lab/runtime";
import {
  getDebugEnabled,
  subscribeDebugPreference,
} from "@/lib/debug-preference";
import { useSyncExternalStore } from "react";

export interface DebugSwitch {
  readonly key: string;
  get(): boolean;
  set(next: boolean): void;
  subscribe(listener: () => void): () => void;
}

/**
 * A trial that Debug tools turns on for this browser. It is on only while
 * Debug mode is on and the stored value is "true"; other tabs follow.
 */
export function createDebugSwitch(key: string): DebugSwitch {
  const read = () => {
    try {
      return getDebugEnabled() && getRuntimeStorage().getItem(key) === "true";
    } catch {
      return false;
    }
  };
  let value = read();
  const listeners = new Set<() => void>();
  const publish = (next: boolean) => {
    if (next === value) return;
    value = next;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener: () => void) => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === key || event.key === null) publish(read());
    };
    window.addEventListener("storage", onStorage);
    const stopDebug = subscribeDebugPreference(() => publish(read()));
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      stopDebug();
      window.removeEventListener("storage", onStorage);
    };
  };
  return {
    key,
    // Read each time: Debug mode can change while nothing listens.
    get: read,
    set(next) {
      try {
        getRuntimeStorage().setItem(key, String(next));
      } catch {
        // Keep the in-memory choice when storage is unavailable.
      }
      publish(read());
    },
    subscribe,
  };
}

export function useDebugSwitch(debugSwitch: DebugSwitch): boolean {
  return useSyncExternalStore(
    debugSwitch.subscribe,
    debugSwitch.get,
    debugSwitch.get,
  );
}

/** Updates wait for a safe moment instead of reloading the page at once. */
export const calmUpdates = createDebugSwitch("reader-calm-updates-v1");
