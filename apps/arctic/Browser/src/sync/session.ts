import { downloadFiles } from "@workbench/file-batch";
import {
  SyncClient,
  SyncHttpError,
  createNamespacedHttpClient,
  createSyncClientStateStore,
  createSyncController,
  getOrCreateSyncClientState,
  type SyncAttempt,
  type SyncClientStateStore,
  type SyncController,
  type SyncRecord,
  type SyncScope,
} from "@zsh-eng/local-sync";
import { API_ORIGIN, type Account } from "../api";
import { normalizeLibrary } from "../articles";
import { MAX_COPY_BYTES } from "../copy";
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
/** An upload stores its copy before the record that names it. */
const UNNAMED_COPY_GRACE_MS = 24 * 60 * 60_000;
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
  /**
   * The links' first pull on this device is under way in this page's first
   * sync. Pages of a first pull arrive in the phone's upload order, not the
   * library's, so the library waits for the last one (docs/FIRST_SYNC.md).
   */
  restoring: boolean;
  private listeners = new Set<() => void>();
  private files = new Map<string, Promise<string>>();

  private constructor(
    readonly account: Account,
    private readonly db: IDBDatabase,
    private readonly channels: Channels,
  ) {
    // The first sync of a page load is timed: arctic:sync:<namespace> for
    // each pull and push, and arctic:commit for each page that IndexedDB
    // commits (see the first-sync lab, docs/FIRST_SYNC.md).
    let timed = true;
    for (const channel of Object.values(channels))
      channel.storage.timeCommits = true;
    this.restoring = !channels.library.stateStore.read()?.bootstrapped;
    this.controller = createSyncController({
      run: async ({ signal, markRestoring }) => {
        if (!channels.library.stateStore.read()?.bootstrapped) markRestoring();
        // On a new device the links go first: every client commits to one
        // IndexedDB store, and the library waits for the links. The others
        // start at once, so their requests overlap the links' pull, and
        // commit their pages once it ends, or after five seconds
        // (docs/FIRST_SYNC.md). Their streams stay open while they wait,
        // so the wait is short beside a request's 30-second limit.
        let release = () => {};
        if (this.restoring) {
          const linksFirst = new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 5_000);
            release = () => {
              clearTimeout(timer);
              resolve();
            };
          });
          for (const channel of Object.values(channels))
            if (channel !== channels.library) channel.storage.hold = linksFirst;
        }
        const sync = async ([name, channel]: [string, Channel]) => {
          signal.throwIfAborted();
          const start = performance.now();
          try {
            await channel.client.pull();
          } finally {
            if (channel === channels.library) {
              this.restored();
              release();
            }
          }
          // A push asks for the scope first; with nothing to send it is a
          // wasted request. An edit made from here on asks for another sync.
          if (channel.storage.pendingCount > 0) await channel.client.push();
          if (timed) performance.measure(`arctic:sync:${name}`, { start });
        };
        try {
          // Each client has its own state, records and cursor, so they sync
          // at once. The attempt fails with the first error once all have
          // ended.
          const ended = await Promise.allSettled(
            Object.entries(channels).map(sync),
          );
          for (const result of ended)
            if (result.status === "rejected") throw result.reason;
        } finally {
          release();
          for (const channel of Object.values(channels))
            channel.storage.hold = undefined;
          // A failed first pull shows what arrived.
          this.restored();
          if (timed) performance.mark("arctic:synced");
          timed = false;
          for (const channel of Object.values(channels))
            channel.storage.timeCommits = false;
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

  /**
   * `linksScope` is the `arctic` scope that the account check brought
   * (`checkAccount`). A new device's first pull uses it instead of asking
   * `/sync/v3/state`; the server checks it on the pull.
   */
  static async open(account: Account, linksScope?: SyncScope) {
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
      let known =
        ns === NAMESPACES.library &&
        linksScope?.userId === account.userId &&
        !stateStore.read()?.scope
          ? linksScope
          : undefined;
      const client = new SyncClient({
        storage,
        remote: {
          ...http.remote,
          getScope: () => {
            const scope = known;
            known = undefined;
            return scope ? Promise.resolve(scope) : http.remote.getScope!();
          },
        },
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

  /**
   * Deletes the copies that no text record names: one that a longer copy
   * replaced, or the text of an article that was removed. Copies that a
   * record names stay, saved or not, and so does any copy from the last day.
   */
  async pruneFiles(now = Date.now()) {
    const named = new Set<string>();
    for (const key of this.copies.keys()) {
      const view = this.copies.view(key);
      if (!view || view.isDeleted) continue;
      try {
        const { file } = JSON.parse(view.value) as { file?: unknown };
        if (typeof file === "string") named.add(file);
      } catch {
        // Not a copy's record: it names nothing.
      }
    }
    const removed = await transact(
      this.db,
      ["files"],
      "readwrite",
      async (tx) => {
        const store = tx.objectStore("files");
        const ids = (await promised(store.getAllKeys())) as string[];
        const removed: string[] = [];
        for (const id of ids) {
          if (named.has(id)) continue;
          const row = await promised<{ savedAt?: number } | undefined>(
            store.get(id),
          );
          if (now - (row?.savedAt ?? 0) < UNNAMED_COPY_GRACE_MS) continue;
          store.delete(id);
          removed.push(id);
        }
        return removed;
      },
    );
    for (const id of removed) this.files.delete(id);
    return removed.length;
  }

  /**
   * Downloads copies into this browser for offline reading, many in each
   * request (packages/file-batch), and keeps each as it arrives.
   */
  keepFiles(
    ids: string[],
    options: {
      signal?: AbortSignal;
      onKept?(id: string): void;
      onFailed?(id: string): void;
    } = {},
  ) {
    // Pass every answer on; the downloader reads its status.
    const answer = (error: unknown) =>
      error instanceof SyncHttpError && error.response
        ? error.response
        : Promise.reject(error);
    const { request } = this.channels.content;
    const decoder = new TextDecoder();
    return downloadFiles({
      ids,
      signal: options.signal,
      fetchBatch: (batch, signal) =>
        request(
          "/files/batch",
          {
            method: "POST",
            body: JSON.stringify({ ids: batch }),
            headers: { "Content-Type": "application/json" },
            signal,
          },
          false,
        ).catch(answer),
      fetchOne: (id, signal) =>
        request(`/files/${id}`, { signal }, false).catch(answer),
      store: async (id, bytes) => {
        await this.storeFile(id, decoder.decode(bytes));
        options.onKept?.(id);
      },
      onFailed: options.onFailed,
    });
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

  private async download(id: string) {
    const response = await this.channels.content.request(
      `/files/${id}`,
      {},
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

  private restored() {
    if (!this.restoring) return;
    this.restoring = false;
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) listener();
  }
}
