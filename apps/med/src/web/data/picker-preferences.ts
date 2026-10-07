import { useSyncExternalStore } from "react";

// Whether Find file shows the selected file beside the results. Off keeps the
// picker a narrow list. Every picker and window shares the choice.
const KEY = "med:picker-preview";
const listeners = new Set<() => void>();
const read = () => {
  try {
    return localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
};
let preview = read();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    preview = read();
    listener();
  };
  addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    removeEventListener("storage", onStorage);
  };
};

export function setFilePreviewShown(on: boolean) {
  preview = on;
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* The choice lasts for this page. */
  }
  for (const listener of listeners) listener();
}

export function useFilePreviewShown() {
  return useSyncExternalStore(
    subscribe,
    () => preview,
    () => true,
  );
}
