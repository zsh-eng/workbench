import { useSyncExternalStore } from "react";
import type { Library } from "./model";
type Snapshot = { library: Library | null; error: string | null };
let snapshot: Snapshot = { library: null, error: null };
const listeners = new Set<() => void>();
const publish = (library: Library) => {
  snapshot = { library, error: null };
  listeners.forEach((fn) => fn());
};
const empty: Library = { version: 1, articles: [], annotations: [] };
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("arctic-browser", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("library");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
const channel =
  typeof BroadcastChannel !== "undefined"
    ? new BroadcastChannel("arctic-browser")
    : null;
async function read() {
  const db = await dbPromise;
  return new Promise<Library | undefined>((resolve, reject) => {
    const request = db
      .transaction("library")
      .objectStore("library")
      .get("current");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
// Each mutation reads the latest state inside the same write transaction. Other
// tabs cannot overwrite a bookmark or annotation with an older snapshot.
export async function changeLibrary(change: (library: Library) => Library) {
  const db = await dbPromise;
  const library = await new Promise<Library>((resolve, reject) => {
    const transaction = db.transaction("library", "readwrite");
    const store = transaction.objectStore("library");
    const request = store.get("current");
    let next: Library;
    request.onsuccess = () => {
      try {
        next = change(request.result ?? empty);
        store.put(next, "current");
      } catch (error) {
        transaction.abort();
        reject(error);
      }
    };
    transaction.oncomplete = () => resolve(next);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("Storage write was cancelled."));
  });
  publish(library);
  channel?.postMessage("changed");
}
channel?.addEventListener("message", () => {
  void read().then((value) => value && publish(value));
});
export async function initialize() {
  try {
    const current = await read();
    if (current) {
      publish(current);
      return;
    }
    const response = await fetch("/seed/index.json");
    if (!response.ok || !response.headers.get("content-type")?.includes("json"))
      throw new Error(
        "The reading list has not been seeded. Run bun run seed:arctic-browser, then reload.",
      );
    const seed = (await response.json()) as Library;
    if (
      seed.version !== 1 ||
      !Array.isArray(seed.articles) ||
      !Array.isArray(seed.annotations)
    )
      throw new Error("The reading-list seed is invalid.");
    await changeLibrary((existing) =>
      existing.articles.length ? existing : seed,
    );
  } catch (error) {
    snapshot = {
      library: null,
      error:
        error instanceof Error ? error.message : "Cannot open local storage.",
    };
    listeners.forEach((fn) => fn());
  }
}
export const useLibrary = () =>
  useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
    () => snapshot,
  );
