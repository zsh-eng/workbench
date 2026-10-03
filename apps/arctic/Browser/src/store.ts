import { useSyncExternalStore } from "react";
import type { Library, DownloadedBody } from "./model";
type Snapshot = { library: Library | null; error: string | null };
let snapshot: Snapshot = { library: null, error: null };
const listeners = new Set<() => void>();
const publish = (library: Library) => {
  snapshot = { library, error: null };
  listeners.forEach((fn) => fn());
};
const empty: Library = { version: 1, articles: [], annotations: [] };
const dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("arctic-browser", 2);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains("library"))
      request.result.createObjectStore("library");
    if (!request.result.objectStoreNames.contains("bodies"))
      request.result.createObjectStore("bodies");
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () =>
    reject(
      new Error(
        "Close other Arctic tabs and reload to finish updating local storage.",
      ),
    );
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
export async function changeLibrary(
  change: (library: Library) => Library,
  restoreBody?: { id: string; body: DownloadedBody },
) {
  const db = await dbPromise;
  const library = await new Promise<Library>((resolve, reject) => {
    const transaction = db.transaction(["library", "bodies"], "readwrite");
    const store = transaction.objectStore("library");
    const request = store.get("current");
    let next: Library;
    request.onsuccess = () => {
      try {
        const previous: Library = request.result ?? empty;
        next = change(previous);
        const bodies = transaction.objectStore("bodies");
        const ids = new Set(next.articles.map((article) => article.id));
        for (const article of previous.articles)
          if (!ids.has(article.id)) bodies.delete(article.id);
        if (
          restoreBody &&
          next.articles.some((item) => item.id === restoreBody.id)
        )
          bodies.put(restoreBody.body, restoreBody.id);
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

export async function readDownloadedBody(
  id: string,
): Promise<DownloadedBody | undefined> {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const request = db.transaction("bodies").objectStore("bodies").get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
export async function saveDownloadedBody(id: string, body: DownloadedBody) {
  // Recheck article identity in the same transaction: a late download must not
  // resurrect a deleted record or overwrite its save, archive, or tag changes.
  await changeLibrary(
    (library) => ({
      ...library,
      articles: library.articles.map((article) =>
        article.id === id
          ? {
              ...article,
              downloadedAt: body.downloadedAt,
              title: body.title || article.title,
              description: body.description || article.description,
              author: body.author || article.author,
              image: body.image || article.image,
              minutes: Math.max(1, Math.ceil(body.wordCount / 220)),
            }
          : article,
      ),
    }),
    { id, body },
  );
}
