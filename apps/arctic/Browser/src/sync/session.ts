import {
  SyncClient,
  createNamespacedHttpClient,
  createSyncClientStateStore,
  createSyncController,
  getOrCreateSyncClientState,
  type SyncAttempt,
  type SyncClientStateStore,
  type SyncController,
  type SyncRecord,
} from "@zsh-eng/local-sync";
import { API_ORIGIN, type Account } from "../api";
import { normalizeLibrary } from "../articles";
import { deleteDatabase, openDatabase, promised, transact } from "./idb";
import { RecordStorage } from "./storage";
import { xxh64 } from "./xxh64";

/**
 * The phone's library, text copies, highlights and notes, and reading
 * sessions, each apart (see apps/sync-server). The phone validates every
 * `arctic` record, so new record families have their own namespaces.
 */
const NAMESPACES = {
  library: "arctic",
  content: "arctic-content",
  annotations: "arctic-annotations",
  reading: "arctic-reading",
} as const;
type Channels = Record<keyof typeof NAMESPACES, Channel>;
const MAX_COPY_BYTES = 2 * 1024 * 1024;
/** Sync on open, on reconnect, on return to the tab, and every five minutes. */
const SYNC_INTERVAL_MS = 5 * 60_000;

const stateKey = (userId: string, ns: string) => `arctic:${userId}:${ns}:sync`;
/** The account's last sync time and whether its session ended (see local-sync). */
const statusKey = (userId: string) => `arctic:${userId}:sync-status`;

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
  stateStore: SyncClientStateStore;
  storage: RecordStorage;
  client: SyncClient<readonly SyncRecord[]>;
  request: (
    path: string,
    init?: RequestInit,
    refresh?: boolean,
  ) => Promise<Response>;
};

/** One account in this browser: its synced namespaces and a file cache. */
export class Session {
  /** When sync runs, and the connection, account and sync status to show. */
  readonly controller: SyncController;
  /** Changes only when a library or text record changes. */
  records = 0;
  private listeners = new Set<() => void>();
  private files = new Map<string, Promise<string>>();

  private constructor(
    readonly account: Account,
    private readonly db: IDBDatabase,
    private readonly channels: Channels,
  ) {
    this.controller = createSyncController({
      run: async ({ signal, markRestoring }) => {
        if (!channels.library.stateStore.read()?.bootstrapped) markRestoring();
        for (const channel of Object.values(channels)) {
          signal.throwIfAborted();
          await channel.client.sync();
        }
      },
      intervalMs: SYNC_INTERVAL_MS,
      persist: { storage: localStorage, key: statusKey(account.userId) },
      user: account,
    });
    for (const channel of Object.values(channels))
      channel.storage.subscribe(() =>
        this.controller.setPending(this.pendingCount),
      );
    this.controller.setPending(this.pendingCount);
    // Highlights and reading time have their own readers (useDerived), so a
    // reading checkpoint does not render the library.
    for (const channel of [channels.library, channels.content])
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
      return {
        stateStore,
        storage,
        client,
        request: http.request,
      } satisfies Channel;
    };
    const [library, content, annotations, reading] = await Promise.all([
      channel(NAMESPACES.library, normalizeLibrary),
      channel(NAMESPACES.content),
      channel(NAMESPACES.annotations),
      channel(NAMESPACES.reading),
    ]);
    return new Session(account, db, { library, content, annotations, reading });
  }

  get arctic() {
    return this.channels.library.storage;
  }

  get copies() {
    return this.channels.content.storage;
  }

  get annotations() {
    return this.channels.annotations.storage;
  }

  get reading() {
    return this.channels.reading.storage;
  }

  get pendingCount() {
    return Object.values(this.channels).reduce(
      (sum, channel) => sum + channel.storage.pendingCount,
      0,
    );
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Pull, then upload, for each namespace, now. Resolves with the outcome; never rejects. */
  sync(): Promise<SyncAttempt> {
    return this.controller.syncNow();
  }

  /**
   * Edits upload a moment later, so quick changes share one request. A sync
   * that is already due sooner keeps its time; while failing, the retry
   * schedule applies.
   */
  syncSoon(delay = 1200) {
    this.controller.requestSync(delay);
  }

  /** The cleaned HTML of a copy, from this browser or the account. */
  readFile(id: string): Promise<string> {
    const existing = this.files.get(id);
    if (existing) {
      // Most recently read last; the oldest leave first.
      this.files.delete(id);
      this.files.set(id, existing);
      return existing;
    }
    const work = (async () => {
      const cached = await transact(this.db, ["files"], "readonly", (tx) =>
        promised<{ html: string } | undefined>(tx.objectStore("files").get(id)),
      );
      return cached ? cached.html : this.download(id);
    })();
    this.files.set(id, work);
    // The reader keeps its own cleaned copies (src/text.ts); a few raw ones
    // are enough here.
    for (const old of [...this.files.keys()].slice(0, -8))
      this.files.delete(old);
    work.catch(() => this.files.delete(id));
    return work;
  }

  /** The copies that this browser keeps. */
  async keptFiles(): Promise<Set<string>> {
    const keys = await transact(this.db, ["files"], "readonly", (tx) =>
      promised(tx.objectStore("files").getAllKeys()),
    );
    return new Set(keys as string[]);
  }

  /** Downloads a copy into this browser for offline reading, without holding it in memory. */
  async keepFile(id: string, signal?: AbortSignal) {
    await this.download(id, signal);
  }

  /** Uploads cleaned HTML; the server checks its hash, type and size. */
  async uploadFile(html: string) {
    const bytes = new TextEncoder().encode(html);
    if (bytes.byteLength > MAX_COPY_BYTES)
      throw new Error("This copy is larger than 2 MB.");
    if (/<script\b/i.test(html))
      throw new Error("This copy contains a script.");
    const id = xxh64(bytes);
    await this.channels.content.request(
      `/files/${id}`,
      {
        method: "PUT",
        body: bytes,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      },
      false,
    );
    await this.storeFile(id, html);
    this.files.set(id, Promise.resolve(html));
    return { id, bytes: bytes.byteLength };
  }

  private async download(id: string, signal?: AbortSignal) {
    const response = await this.channels.content.request(
      `/files/${id}`,
      { signal },
      false,
    );
    const html = await response.text();
    await this.storeFile(id, html);
    return html;
  }

  private storeFile(id: string, html: string) {
    return transact(this.db, ["files"], "readwrite", async (tx) => {
      tx.objectStore("files").put({ id, html, savedAt: Date.now() });
    });
  }

  close() {
    this.controller.dispose();
    this.db.close();
  }

  /** Removes this browser's copy of the account. The account is unchanged. */
  async forget() {
    this.controller.signOut();
    this.close();
    await deleteDatabase(this.account.userId);
    for (const ns of Object.values(NAMESPACES))
      localStorage.removeItem(stateKey(this.account.userId, ns));
    localStorage.removeItem(statusKey(this.account.userId));
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
