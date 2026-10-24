import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  SyncHttpError,
  SyncNetworkError,
  SyncScopeError,
  classifySyncFailure,
  createSyncController,
  describeSyncStatus,
  type SyncControllerOptions,
  type SyncNetworkEvent,
} from "@zsh-eng/local-sync";

/** The device's network as the browser reports it. */
function fakeNetwork(online = true) {
  const listeners = new Set<(event: SyncNetworkEvent) => void>();
  const network = {
    online,
    isOnline: () => network.online,
    subscribe(listener: (event: SyncNetworkEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next: boolean) {
      network.online = next;
      for (const listener of listeners) listener(next ? "online" : "offline");
    },
    visible() {
      for (const listener of listeners) listener("visible");
    },
  };
  return network;
}

/** A server whose answers the test chooses, one attempt at a time. */
function fakeServer() {
  const attempts: {
    resolve: () => void;
    reject: (error: unknown) => void;
    signal: AbortSignal;
  }[] = [];
  let answer: (() => Promise<void>) | undefined;
  const run: SyncControllerOptions["run"] = ({ signal }) => {
    if (answer) return answer();
    return new Promise<void>((resolve, reject) =>
      attempts.push({ resolve, reject, signal }),
    );
  };
  return {
    run,
    attempts,
    /** Answer every later attempt at once, instead of holding it. */
    answerWith(next: () => Promise<void>) {
      answer = next;
    },
    last() {
      return attempts.at(-1)!;
    },
  };
}

function memoryStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
}

const offlineFetch = () => new TypeError("Failed to fetch");
const unauthorized = () => new SyncHttpError(401);
const ada = { userId: "ada", name: "Ada", email: "ada@example.test" };
const summary = (controller: ReturnType<typeof createSyncController>) =>
  describeSyncStatus(controller.getSnapshot(), Date.now());

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("sync status", () => {
  it("a signed-in device that starts offline says Offline, never Sign in, and syncs when the network returns", async () => {
    const storage = memoryStorage();
    const network = fakeNetwork();
    const server = fakeServer();
    server.answerWith(async () => {});
    const persist = { storage, key: "app/sync-status" };
    const first = createSyncController({ run: server.run, network, persist });
    first.confirmSignedIn(ada, "session-1");
    first.start();
    await first.drain();
    first.dispose();

    // Restart without a network: the identity and last sync come from this device.
    network.online = false;
    const restarted = createSyncController({
      run: server.run,
      network,
      persist,
    });
    restarted.start();
    restarted.setPending(2);
    expect(restarted.getSnapshot().auth).toEqual({
      status: "signed-in",
      user: ada,
      confirmed: false,
    });
    expect(summary(restarted)).toMatchObject({
      kind: "offline",
      label: "Offline",
      detail:
        "2 changes are saved on this device. They sync when you are back online.",
    });

    network.set(true);
    expect(restarted.getSnapshot().running).toBe(true);
    await restarted.drain();
    restarted.setPending(0);
    expect(restarted.getSnapshot()).toMatchObject({
      connection: "online",
      auth: { status: "signed-in", confirmed: true },
    });
    expect(summary(restarted).label).toBe("Synced just now");
  });

  it("a device with no remembered identity cannot tell, so it stays unknown offline", () => {
    const controller = createSyncController({
      run: fakeServer().run,
      network: fakeNetwork(false),
    });
    controller.start();
    expect(controller.getSnapshot().auth.status).toBe("unknown");
    expect(summary(controller).kind).toBe("offline");
  });

  it("an unreachable server never signs the user out: it backs off, says so after the retry fails, and recovers", async () => {
    const server = fakeServer();
    const network = fakeNetwork();
    const controller = createSyncController({
      run: server.run,
      network,
      user: ada,
      random: () => 1,
    });
    controller.start();
    server.last().reject(offlineFetch());
    await controller.drain();
    expect(controller.getSnapshot()).toMatchObject({
      connection: "unreachable",
      auth: { status: "signed-in" },
      failures: 1,
      retryAt: Date.now() + 2_000,
    });
    // One failure can be a blip: named, but not raised.
    expect(summary(controller)).toMatchObject({
      label: "Couldn't reach the server",
      detail: "Retrying in 2 s.",
      attention: false,
    });

    await vi.advanceTimersByTimeAsync(1_999);
    expect(server.attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.attempts).toHaveLength(2);
    server.last().reject(new DOMException("Timed out", "TimeoutError"));
    await controller.drain();
    expect(controller.getSnapshot().retryAt).toBe(Date.now() + 4_000);
    expect(summary(controller).attention).toBe(true);

    // Returning to the tab does not bypass the backoff.
    network.visible();
    expect(server.attempts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(4_000);
    server.last().resolve();
    await controller.drain();
    expect(controller.getSnapshot()).toMatchObject({
      connection: "online",
      failures: 0,
      failure: null,
      retryAt: null,
    });
  });

  it("a 401 ends the session and pauses automatic sync until a new session is confirmed", async () => {
    const network = fakeNetwork();
    const server = fakeServer();
    const controller = createSyncController({ run: server.run, network });
    controller.confirmSignedIn(ada, "old");
    controller.start();
    controller.setPending(1);
    server.last().reject(unauthorized());
    await controller.drain();
    expect(controller.getSnapshot().auth).toEqual({
      status: "expired",
      user: ada,
    });
    expect(summary(controller)).toMatchObject({
      label: "Sign in again to sync",
      detail: "Your session ended. 1 change is saved on this device.",
      action: "sign-in",
    });

    // Reconnecting, waiting and repeating the refused session do not retry.
    network.set(false);
    network.set(true);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    controller.confirmSignedIn(ada, "old");
    expect(server.attempts).toHaveLength(1);
    expect(controller.getSnapshot().auth.status).toBe("expired");

    controller.confirmSignedIn(ada, "new");
    expect(server.attempts).toHaveLength(2);
    server.last().resolve();
    await controller.drain();
    expect(controller.getSnapshot().auth.status).toBe("signed-in");
  });

  it("a 401 for credentials replaced during the attempt keeps the new session and retries with it", async () => {
    const server = fakeServer();
    const controller = createSyncController({
      run: server.run,
      network: fakeNetwork(),
    });
    controller.confirmSignedIn(ada, "old");
    controller.start();
    controller.confirmSignedIn(ada, "new");
    server.attempts[0]!.reject(unauthorized());
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.getSnapshot().auth.status).toBe("signed-in");
    expect(server.attempts).toHaveLength(2);
    server.last().resolve();
    await controller.drain();
    expect(controller.getSnapshot().failure).toBeNull();
  });

  it("a session ended elsewhere recovers with a manual sync after signing in in another tab", async () => {
    const server = fakeServer();
    const controller = createSyncController({
      run: server.run,
      network: fakeNetwork(),
      user: ada,
    });
    controller.start();
    server.last().reject(unauthorized());
    await controller.drain();
    const manual = controller.syncNow();
    server.last().resolve();
    expect(await manual).toEqual({ outcome: "synced" });
    expect(controller.getSnapshot().auth).toEqual({
      status: "signed-in",
      user: ada,
      confirmed: true,
    });
  });

  it("maintenance waits for Retry-After, and an upgrade or account change stops automatic sync", async () => {
    const server = fakeServer();
    const controller = createSyncController({
      run: server.run,
      network: fakeNetwork(),
      user: ada,
    });
    controller.start();
    server
      .last()
      .reject(
        new SyncHttpError(
          503,
          new Response(null, {
            status: 503,
            headers: { "Retry-After": "120" },
          }),
        ),
      );
    await controller.drain();
    expect(controller.getSnapshot().retryAt).toBe(Date.now() + 120_000);
    expect(summary(controller)).toMatchObject({
      label: "Sync paused for maintenance",
      detail: "Retrying in 2 min.",
    });

    await vi.advanceTimersByTimeAsync(120_000);
    server.last().reject(new SyncHttpError(410));
    await controller.drain();
    expect(summary(controller)).toMatchObject({
      kind: "upgrade-required",
      action: "reload",
    });
    expect(controller.getSnapshot().retryAt).toBeNull();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(server.attempts).toHaveLength(2);

    void controller.syncNow();
    server.last().reject(new SyncScopeError("Sync account changed"));
    await controller.drain();
    expect(summary(controller).kind).toBe("account-changed");
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(server.attempts).toHaveLength(3);
  });

  it("local changes sync soon while healthy, wait for the backoff while failing, and a stop cancels without failing", async () => {
    const server = fakeServer();
    const controller = createSyncController({
      run: server.run,
      network: fakeNetwork(),
      user: ada,
      intervalMs: 0,
    });
    controller.start();
    server.last().resolve();
    await controller.drain();

    controller.requestSync(1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(server.attempts).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(server.attempts).toHaveLength(2);
    // A change during the attempt runs one more after it.
    controller.requestSync(0);
    server.last().reject(new SyncNetworkError("Truncated sync stream"));
    await controller.drain();
    controller.requestSync(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(server.attempts).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(2_000);
    expect(server.attempts).toHaveLength(3);
    controller.stop();
    expect(server.last().signal.aborted).toBe(true);
    server.last().reject(new DOMException("Aborted", "AbortError"));
    await controller.drain();
    expect(controller.getSnapshot()).toMatchObject({
      running: false,
      failures: 1,
      retryAt: null,
    });
  });

  it("signing out forgets the identity and the last sync on this device", async () => {
    const storage = memoryStorage();
    const persist = { storage, key: "app/sync-status" };
    const server = fakeServer();
    server.answerWith(async () => {});
    const controller = createSyncController({
      run: server.run,
      network: fakeNetwork(),
      persist,
    });
    controller.confirmSignedIn(ada);
    await controller.syncNow();
    controller.signOut();
    const restarted = createSyncController({
      run: server.run,
      network: fakeNetwork(),
      persist,
    });
    expect(restarted.getSnapshot()).toMatchObject({
      auth: { status: "unknown" },
      lastSyncedAt: null,
    });
  });
});

describe("failure classification", () => {
  it("names what the client does next, and never calls a bug a network failure", () => {
    const kinds = [
      new TypeError("Failed to fetch"),
      new TypeError("Load failed"),
      new TypeError("Cannot read properties of undefined (reading 'id')"),
      new SyncHttpError(401),
      { status: 401 },
      new SyncHttpError(409),
      new SyncHttpError(413),
      new SyncHttpError(429),
      new SyncHttpError(503),
      new SyncHttpError(502),
      new Error("QuotaExceededError"),
    ].map((error) => classifySyncFailure(error)?.kind);
    expect(kinds).toEqual([
      "network",
      "network",
      "failed",
      "unauthorized",
      "unauthorized",
      "account-changed",
      "rejected",
      "server",
      "server",
      "server",
      "failed",
    ]);
    expect(
      classifySyncFailure(new DOMException("Stopped", "AbortError")),
    ).toBeNull();
  });
});
