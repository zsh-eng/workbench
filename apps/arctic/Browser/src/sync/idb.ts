/** One IndexedDB database per account: synced records, unsent edits, and article text. */
const databaseName = (userId: string) => `arctic:${userId}`;

export function openDatabase(userId: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName(userId), 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("records", { keyPath: ["ns", "key"] });
      db.createObjectStore("outbox", { keyPath: ["ns", "key"] });
      db.createObjectStore("files", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Close Arctic in your other tabs, then reload."));
  });
}

export function deleteDatabase(userId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName(userId));
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export function promised<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Every key of one namespace in a store keyed by [ns, key]. */
export const namespaceRange = (ns: string) =>
  IDBKeyRange.bound([ns, ""], [ns, []]);

/** Await only IndexedDB requests inside `body`; the transaction commits when it returns. */
export async function transact<T>(
  db: IDBDatabase,
  stores: string[],
  mode: IDBTransactionMode,
  body: (tx: IDBTransaction) => Promise<T>,
): Promise<T> {
  const tx = db.transaction(stores, mode);
  const finished = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () =>
      reject(tx.error ?? new DOMException("Transaction aborted", "AbortError"));
  });
  let result: T;
  try {
    result = await body(tx);
  } catch (error) {
    try {
      tx.abort();
    } catch {
      /* Already finished. */
    }
    await finished.catch(() => {});
    throw error;
  }
  await finished;
  return result;
}
