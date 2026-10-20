import {
  SyncClient,
  SyncHttpError,
  createNamespacedHttpClient,
  createSyncClientStateStore,
  getOrCreateSyncClientState,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import { API_ORIGIN, type Account } from "../api";
import { normalizeLibrary } from "../articles";
import { deleteDatabase, openDatabase, promised, transact } from "./idb";
import { RecordStorage } from "./storage";
import { xxh64 } from "./xxh64";

/** The phone's library, and this app's text copies, kept apart (see apps/sync-server). */
const NAMESPACES = { library: "arctic", content: "arctic-content" } as const;
export const MAX_COPY_BYTES = 2 * 1024 * 1024;

export type SyncStatus =
  | { phase: "loading" }
  | { phase: "syncing"; lastSyncedAt?: number }
  | { phase: "synced"; lastSyncedAt: number }
  | { phase: "offline"; lastSyncedAt?: number }
  | { phase: "error"; message: string; lastSyncedAt?: number };

const stateKey = (userId: string, ns: string) => `arctic:${userId}:${ns}:sync`;

function deviceId() {
  const key = "arctic:device";
  let id = localStorage.getItem(key);
  if (!id) {
    id = `web-${crypto.randomUUID()}`;
    localStorage.setItem(key, id);
  }
  return id;
}

type Channel = {
  storage: RecordStorage;
  client: SyncClient<readonly SyncRecord[]>;
  request: (
    path: string,
    init?: RequestInit,
    refresh?: boolean,
  ) => Promise<Response>;
};

/** One signed-in account in this browser: two synced namespaces and a file cache. */
export class Session {
  status: SyncStatus = { phase: "loading" };
  /** Changes whenever a record or the status changes. */
  version = 0;
  /** Changes only when a record changes. */
  records = 0;
  private listeners = new Set<() => void>();
  private running: Promise<void> | null = null;
  private again = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private files = new Map<string, Promise<string>>();

  private constructor(
    readonly account: Account,
    private readonly db: IDBDatabase,
    private readonly library: Channel,
    private readonly content: Channel,
  ) {
    for (const channel of [library, content])
      channel.storage.subscribe(() => {
        this.records++;
        this.emit();
      });
  }

  static async open(account: Account) {
    const db = await openDatabase(account.userId);
    const channel = async (ns: string, normalize?: typeof normalizeLibrary) => {
      const stateStore = createSyncClientStateStore(
        localStorage,
        stateKey(account.userId, ns),
      );
      getOrCreateSyncClientState(deviceId(), stateStore);
      const storage = new RecordStorage(db, ns, stateStore, normalize);
      await storage.load();
      const http = createNamespacedHttpClient({
        origin: API_ORIGIN,
        namespace: ns,
        stateStore,
      });
      const client = new SyncClient({
        storage,
        remote: http.remote,
        stateStore,
      });
      return { storage, client, request: http.request } satisfies Channel;
    };
    return new Session(
      account,
      db,
      await channel(NAMESPACES.library, normalizeLibrary),
      await channel(NAMESPACES.content),
    );
  }

  get arctic() {
    return this.library.storage;
  }

  get copies() {
    return this.content.storage;
  }

  get pendingCount() {
    return (
      this.library.storage.pendingCount + this.content.storage.pendingCount
    );
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Pull, then upload, for both namespaces. Calls during a run start one more run. */
  sync(): Promise<void> {
    clearTimeout(this.timer);
    if (this.running) {
      this.again = true;
      return this.running;
    }
    const lastSyncedAt =
      "lastSyncedAt" in this.status ? this.status.lastSyncedAt : undefined;
    this.setStatus({ phase: "syncing", lastSyncedAt });
    this.running = (async () => {
      try {
        do {
          this.again = false;
          await this.library.client.sync();
          await this.content.client.sync();
        } while (this.again);
        this.setStatus({ phase: "synced", lastSyncedAt: Date.now() });
      } catch (error) {
        const offline =
          !navigator.onLine ||
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === "TimeoutError");
        this.setStatus(
          offline
            ? { phase: "offline", lastSyncedAt }
            : { phase: "error", message: message(error), lastSyncedAt },
        );
        throw error;
      } finally {
        this.running = null;
      }
    })();
    return this.running;
  }

  /** Edits upload a moment later, so quick changes share one request. */
  syncSoon(delay = 1200) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.sync().catch(() => {}), delay);
  }

  /** The cleaned HTML of a copy, from this browser or the account. */
  readFile(id: string): Promise<string> {
    const existing = this.files.get(id);
    if (existing) return existing;
    const work = (async () => {
      const cached = await transact(this.db, ["files"], "readonly", (tx) =>
        promised<{ html: string } | undefined>(tx.objectStore("files").get(id)),
      );
      if (cached) return cached.html;
      const response = await this.content.request(`/files/${id}`, {}, false);
      const html = await response.text();
      await transact(this.db, ["files"], "readwrite", async (tx) => {
        tx.objectStore("files").put({ id, html, savedAt: Date.now() });
      });
      return html;
    })();
    this.files.set(id, work);
    work.catch(() => this.files.delete(id));
    return work;
  }

  /** Uploads cleaned HTML; the server checks its hash, type and size. */
  async uploadFile(html: string) {
    const bytes = new TextEncoder().encode(html);
    if (bytes.byteLength > MAX_COPY_BYTES)
      throw new Error("This copy is larger than 2 MB.");
    if (/<script\b/i.test(html))
      throw new Error("This copy contains a script.");
    const id = xxh64(bytes);
    await this.content.request(
      `/files/${id}`,
      {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
      false,
    );
    await transact(this.db, ["files"], "readwrite", async (tx) => {
      tx.objectStore("files").put({ id, html, savedAt: Date.now() });
    });
    this.files.set(id, Promise.resolve(html));
    return { id, bytes: bytes.byteLength };
  }

  close() {
    clearTimeout(this.timer);
    this.db.close();
  }

  /** Removes this browser's copy of the account. The account is unchanged. */
  async forget() {
    this.close();
    await deleteDatabase(this.account.userId);
    for (const ns of Object.values(NAMESPACES))
      localStorage.removeItem(stateKey(this.account.userId, ns));
  }

  private setStatus(status: SyncStatus) {
    this.status = status;
    this.emit();
  }

  private emit() {
    this.version++;
    for (const listener of this.listeners) listener();
  }
}

function message(error: unknown) {
  if (error instanceof SyncHttpError)
    return error.status === 401
      ? "Your sign-in has ended. Sign in again to sync."
      : `The sync service answered ${error.status}. Arctic will try again.`;
  return error instanceof Error ? error.message : String(error);
}
