/**
 * Decides when sync runs and records what happened, as a `SyncStatus` store
 * (subscribe/getSnapshot). The app supplies one sync attempt (`run`) and tells
 * the controller what its auth client learns; it keeps its own transport,
 * storage and UI. See docs/SYNC_STATES.md for the states and rules.
 */
import { z } from "zod";
import type { SyncKeyValueStorage } from "./client-state.js";
import {
  classifySyncFailure,
  isSyncBlocked,
  type SyncAuth,
  type SyncFailure,
  type SyncIdentity,
  type SyncStatus,
} from "./status.js";

export const DEFAULT_SYNC_INTERVAL_MS = 30_000;
export const DEFAULT_SYNC_RETRY = { initialMs: 2_000, maxMs: 5 * 60_000 };
/** A tab that becomes visible again syncs, unless an attempt started this recently. */
const WAKE_GAP_MS = 5_000;

export type SyncNetworkEvent = "online" | "offline" | "visible";

/** What the device says about its network. Trust `false`; `true` is only a hint. */
export interface SyncNetworkSource {
  isOnline(): boolean;
  subscribe(listener: (event: SyncNetworkEvent) => void): () => void;
}

/** `navigator.onLine`, the online and offline events, and the page becoming visible. */
export function browserSyncNetwork(): SyncNetworkSource {
  return {
    isOnline: () =>
      typeof navigator === "undefined" || navigator.onLine !== false,
    subscribe(listener) {
      if (typeof window === "undefined") return () => {};
      const online = () => listener("online");
      const offline = () => listener("offline");
      const visible = () => {
        if (document.visibilityState === "visible") listener("visible");
      };
      window.addEventListener("online", online);
      window.addEventListener("offline", offline);
      document.addEventListener("visibilitychange", visible);
      return () => {
        window.removeEventListener("online", online);
        window.removeEventListener("offline", offline);
        document.removeEventListener("visibilitychange", visible);
      };
    },
  };
}

export interface SyncRunContext {
  /** Aborted by stop() and signOut(). */
  signal: AbortSignal;
  /** Marks this attempt as the device's first download, shown as "Restoring…". */
  markRestoring(): void;
}

export interface SyncControllerOptions {
  /** One full sync, such as pull then push. Throw on failure; the controller classifies it. */
  run(context: SyncRunContext): Promise<void>;
  network?: SyncNetworkSource;
  /** Automatic sync while healthy. 0 turns periodic sync off. */
  intervalMs?: number;
  /** Backoff after failures: doubles from the initial delay to the maximum, with jitter. */
  retry?: { initialMs?: number; maxMs?: number };
  /** Keeps the identity and the last sync time across restarts. */
  persist?: { storage: SyncKeyValueStorage; key: string };
  /** An identity the app already remembers. A persisted state takes precedence. */
  user?: SyncIdentity;
  now?: () => number;
  random?: () => number;
}

export type SyncAttempt =
  | { outcome: "synced" }
  | { outcome: "offline" }
  | { outcome: "failed"; failure: SyncFailure }
  | { outcome: "cancelled" };

export interface SyncController {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SyncStatus;
  /** Sync now and then automatically: periodically, on reconnect, and on return to the page. */
  start(): void;
  /** Stop automatic sync and cancel the attempt in flight. */
  stop(): void;
  /** A user's request: runs even while signed out or blocked, unless the device is offline. */
  syncNow(): Promise<SyncAttempt>;
  /** Sync within `delayMs`, for example after a local change. Backoff still applies. */
  requestSync(delayMs?: number): void;
  setPending(count: number): void;
  /** The server answered with this signed-in user (and session, when known). */
  confirmSignedIn(user: SyncIdentity, sessionId?: string): void;
  /** A reachable server answered that there is no session. */
  confirmSignedOut(): void;
  /** The user signed out on this device: forget the identity and last sync time. */
  signOut(): void;
  /**
   * The user is leaving to sign in (a redirect). When the page loads again
   * within ten minutes with an ended session, the account reads `unknown`
   * instead of "Sign in again" until the server answers. The ended session's
   * user stays remembered for a "no session" answer.
   */
  beginSignIn(): void;
  /** Resolves when no attempt is in flight. */
  drain(): Promise<void>;
  dispose(): void;
}

const savedSchema = z.object({
  user: z
    .object({
      userId: z.string().min(1),
      name: z.string().optional(),
      email: z.string().optional(),
      image: z.string().optional(),
    })
    .optional(),
  expired: z.boolean().optional(),
  lastSyncedAt: z.number().optional(),
  /** When beginSignIn() last ran, until the server answers. */
  signInAt: z.number().optional(),
});
type Saved = z.infer<typeof savedSchema>;

/** A page that loads this long after beginSignIn() is not a return from it. */
export const SIGN_IN_RETURN_MS = 10 * 60_000;

const CANCELLED: SyncAttempt = { outcome: "cancelled" };

export function createSyncController(
  options: SyncControllerOptions,
): SyncController {
  const now = options.now ?? (() => Date.now());
  const random = options.random ?? Math.random;
  const network = options.network ?? browserSyncNetwork();
  const intervalMs = options.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS;
  const initialRetryMs =
    options.retry?.initialMs ?? DEFAULT_SYNC_RETRY.initialMs;
  const maxRetryMs = options.retry?.maxMs ?? DEFAULT_SYNC_RETRY.maxMs;
  const saved = load(options.persist);
  const listeners = new Set<() => void>();
  /** beginSignIn()'s time, kept until the server answers. */
  let signInAt = saved.signInAt;
  /**
   * Back from a sign-in redirect to an ended session: its user, while the
   * account reads `unknown` and no server has answered.
   */
  let returning =
    saved.user &&
    saved.expired &&
    signInAt !== undefined &&
    now() - signInAt < SIGN_IN_RETURN_MS
      ? saved.user
      : undefined;
  let status: SyncStatus = {
    connection: network.isOnline() ? "online" : "offline",
    auth: returning ? { status: "unknown" } : initialAuth(saved, options.user),
    running: false,
    restoring: false,
    pending: 0,
    lastSyncedAt: saved.lastSyncedAt ?? null,
    failure: null,
    failures: 0,
    retryAt: null,
  };
  let started = false;
  let disposed = false;
  let detachNetwork: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let active: Promise<SyncAttempt> | null = null;
  let attempt: AbortController | null = null;
  /** The earliest requested sync that no attempt has started to serve. */
  let requestedAt = Infinity;
  /** The next periodic attempt, or the next retry while failing. */
  let nextAt = Infinity;
  let lastAttemptAt = -Infinity;
  /** Changes with the credentials. An answer to older credentials does not change auth. */
  let authEpoch = 0;
  /**
   * Counts confirmSignedIn calls. A 401 to an attempt that began before the
   * server last confirmed a session may refuse an older cookie, so the
   * attempt runs again instead of ending the session.
   */
  let confirmations = 0;
  let sessionId: string | undefined;
  let refusedSessionId: string | undefined;

  function publish(next: Partial<SyncStatus>) {
    const keys = Object.keys(next) as (keyof SyncStatus)[];
    if (keys.every((key) => status[key] === next[key])) return;
    status = { ...status, ...next };
    for (const listener of [...listeners]) listener();
  }

  /** Waiting for something that only the user or the server can change. */
  function paused() {
    return (
      status.auth.status === "signed-out" ||
      status.auth.status === "expired" ||
      isSyncBlocked(status.failure)
    );
  }

  function automatic() {
    return started && !paused() && network.isOnline();
  }

  /** One timer: the retry while failing, otherwise the earlier of periodic and requested. */
  function schedule() {
    clearTimeout(timer);
    timer = undefined;
    let retryAt: number | null = null;
    if (automatic() && !active) {
      const due = status.failures > 0 ? nextAt : Math.min(nextAt, requestedAt);
      if (status.failures > 0) retryAt = nextAt;
      if (Number.isFinite(due))
        timer = setTimeout(
          () => {
            timer = undefined;
            if (automatic() && !active) void begin();
          },
          Math.max(0, due - now()),
        );
    }
    publish({ retryAt });
  }

  function begin(): Promise<SyncAttempt> {
    clearTimeout(timer);
    timer = undefined;
    const controller = new AbortController();
    const epoch = authEpoch;
    const confirmed = confirmations;
    attempt = controller;
    requestedAt = Infinity;
    lastAttemptAt = now();
    publish({
      running: true,
      restoring: false,
      retryAt: null,
      connection:
        status.connection === "offline" ? "online" : status.connection,
    });
    const run = execute(controller, epoch, confirmed).then((result) => {
      if (active === run) active = null;
      if (attempt === controller) attempt = null;
      publish({ running: false, restoring: false });
      // Credentials changed during the attempt, or its 401 may refuse an
      // older cookie: try again with the current ones.
      const again =
        epoch !== authEpoch ||
        (result.outcome === "failed" &&
          result.failure.kind === "unauthorized" &&
          confirmed !== confirmations);
      if (again && automatic()) void begin();
      else schedule();
      return result;
    });
    active = run;
    return run;
  }

  async function execute(
    controller: AbortController,
    epoch: number,
    confirmed: number,
  ): Promise<SyncAttempt> {
    try {
      await options.run({
        signal: controller.signal,
        markRestoring: () => {
          if (attempt === controller) publish({ restoring: true });
        },
      });
      return controller.signal.aborted ? CANCELLED : succeed(epoch);
    } catch (error) {
      return controller.signal.aborted
        ? CANCELLED
        : fail(error, epoch, confirmed);
    }
  }

  function succeed(epoch: number): SyncAttempt {
    const auth = status.auth;
    const next: Partial<SyncStatus> = {
      connection: "online",
      failure: null,
      failures: 0,
      retryAt: null,
      lastSyncedAt: now(),
    };
    // The server accepted this device's session, so the remembered user is signed in.
    const remembered = rememberedUser();
    if (
      epoch === authEpoch &&
      remembered &&
      !(auth.status === "signed-in" && auth.confirmed)
    ) {
      next.auth = { status: "signed-in", user: remembered, confirmed: true };
      refusedSessionId = undefined;
      answered();
    }
    nextAt = intervalMs > 0 ? now() + intervalMs : Infinity;
    publish(next);
    save();
    return { outcome: "synced" };
  }

  function fail(error: unknown, epoch: number, confirmed: number): SyncAttempt {
    const failure = classifySyncFailure(error);
    if (!failure) return CANCELLED;
    const connection =
      failure.kind !== "network"
        ? "online"
        : network.isOnline()
          ? "unreachable"
          : "offline";
    // A 401 for credentials that have since changed, or sent before the
    // server last confirmed a session, says nothing about the current ones.
    if (
      failure.kind === "unauthorized" &&
      (epoch !== authEpoch || confirmed !== confirmations)
    ) {
      publish({ connection });
      return { outcome: "failed", failure };
    }
    const failures = status.failures + 1;
    nextAt = now() + retryDelay(failures, failure);
    const next: Partial<SyncStatus> = { connection, failure, failures };
    if (failure.kind === "unauthorized") {
      next.auth = refusedAuth();
      refusedSessionId = sessionId;
      answered();
    }
    publish(next);
    if (next.auth) save();
    return { outcome: "failed", failure };
  }

  function retryDelay(failures: number, failure: SyncFailure): number {
    const base = Math.min(
      maxRetryMs,
      initialRetryMs * 2 ** Math.min(failures - 1, 20),
    );
    const jittered = Math.round(base * (0.75 + 0.25 * random()));
    const server =
      failure.kind === "maintenance"
        ? failure.retryAfterMs
        : failure.kind === "server"
          ? (failure.retryAfterMs ?? 0)
          : 0;
    return Math.max(jittered, server);
  }

  function onNetwork(event: "online" | "offline" | "visible") {
    if (event === "offline") {
      publish({ connection: "offline" });
      schedule();
      return;
    }
    if (event === "online") {
      if (status.connection === "offline") publish({ connection: "online" });
      // A changed network is worth one attempt now, even during backoff.
      if (automatic() && !active) void begin();
      else {
        requestedAt = now();
        schedule();
      }
      return;
    }
    if (
      automatic() &&
      !active &&
      status.failures === 0 &&
      now() - lastAttemptAt >= WAKE_GAP_MS
    )
      void begin();
  }

  function attach() {
    if (disposed) return;
    detachNetwork ??= network.subscribe(onNetwork);
    const online = network.isOnline();
    if (!online) publish({ connection: "offline" });
    else if (status.connection === "offline") publish({ connection: "online" });
  }

  /** The user this device remembers: signed in, ended, or back from signing in. */
  function rememberedUser(): SyncIdentity | undefined {
    const auth = status.auth;
    return auth.status === "signed-in" || auth.status === "expired"
      ? auth.user
      : returning;
  }

  /** A refused session: a remembered user's session has ended; otherwise nobody is signed in. */
  function refusedAuth(): SyncAuth {
    const user = rememberedUser();
    return user ? { status: "expired", user } : { status: "signed-out" };
  }

  /** The server answered about the session, so a sign-in return is over. */
  function answered() {
    returning = undefined;
    signInAt = undefined;
  }

  function save() {
    if (!options.persist) return;
    const value: Saved = {};
    const user = rememberedUser();
    if (user) value.user = user;
    if (status.auth.status === "expired" || returning) value.expired = true;
    if (status.lastSyncedAt !== null) value.lastSyncedAt = status.lastSyncedAt;
    if (signInAt !== undefined) value.signInAt = signInAt;
    try {
      options.persist.storage.setItem(
        options.persist.key,
        JSON.stringify(value),
      );
    } catch {
      // Full or blocked storage: the in-memory state stays correct.
    }
  }

  function start() {
    attach();
    if (started || disposed) return;
    started = true;
    if (automatic() && !active && status.failures === 0) void begin();
    else {
      if (active) requestedAt = now();
      schedule();
    }
  }

  function stop() {
    started = false;
    attempt?.abort();
    schedule();
  }

  function syncNow(): Promise<SyncAttempt> {
    attach();
    if (!network.isOnline()) {
      publish({ connection: "offline" });
      return Promise.resolve({ outcome: "offline" });
    }
    if (!active) return begin();
    // A cancelled attempt is still settling: run a new one after it.
    if (attempt === null || attempt.signal.aborted)
      return active.then(() => syncNow());
    return active;
  }

  function confirmSignedIn(user: SyncIdentity, session?: string) {
    // Better Auth and similar clients can repeat an answer from before a 401.
    if (session !== undefined && session === refusedSessionId) return;
    confirmations++;
    const auth = status.auth;
    const identity = pickIdentity(user);
    const known =
      auth.status === "signed-in" || auth.status === "expired"
        ? auth.user
        : undefined;
    // Back from signing in, the cookie is new too.
    const credentialsChanged =
      auth.status === "signed-out" ||
      auth.status === "expired" ||
      returning !== undefined ||
      (known !== undefined &&
        (known.userId !== identity.userId ||
          (sessionId !== undefined &&
            session !== undefined &&
            session !== sessionId)));
    if (session !== undefined) sessionId = session;
    if (credentialsChanged) authEpoch++;
    const marked = signInAt !== undefined;
    answered();
    const next: Partial<SyncStatus> = {};
    if (
      auth.status !== "signed-in" ||
      !auth.confirmed ||
      !sameIdentity(auth.user, identity)
    )
      next.auth = { status: "signed-in", user: identity, confirmed: true };
    if (status.failure?.kind === "unauthorized") {
      next.failure = null;
      next.failures = 0;
    }
    publish(next);
    if (next.auth || marked) save();
    if (credentialsChanged && automatic() && !active) void begin();
    else schedule();
  }

  function confirmSignedOut() {
    const auth = status.auth;
    if (auth.status === "signed-out" || auth.status === "expired") return;
    refusedSessionId = sessionId;
    authEpoch++;
    const next = refusedAuth();
    answered();
    publish({ auth: next });
    save();
    schedule();
  }

  function signOut() {
    answered();
    authEpoch++;
    sessionId = undefined;
    refusedSessionId = undefined;
    requestedAt = Infinity;
    nextAt = Infinity;
    attempt?.abort();
    publish({
      auth: { status: "signed-out" },
      failure: null,
      failures: 0,
      lastSyncedAt: null,
    });
    save();
    schedule();
  }

  return {
    subscribe(listener) {
      attach();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => status,
    start,
    stop,
    syncNow,
    requestSync(delayMs = 0) {
      requestedAt = Math.min(requestedAt, now() + delayMs);
      if (!active) schedule();
    },
    setPending(count) {
      publish({ pending: count });
    },
    confirmSignedIn,
    confirmSignedOut,
    signOut,
    beginSignIn() {
      signInAt = now();
      save();
    },
    async drain() {
      while (active) await active;
    },
    dispose() {
      stop();
      disposed = true;
      detachNetwork?.();
      detachNetwork = undefined;
    },
  };
}

function initialAuth(saved: Saved, user: SyncIdentity | undefined): SyncAuth {
  if (saved.user)
    return saved.expired
      ? { status: "expired", user: saved.user }
      : { status: "signed-in", user: saved.user, confirmed: false };
  if (user)
    return { status: "signed-in", user: pickIdentity(user), confirmed: false };
  return { status: "unknown" };
}

function load(persist: SyncControllerOptions["persist"]): Saved {
  if (!persist) return {};
  try {
    const parsed = savedSchema.safeParse(
      JSON.parse(persist.storage.getItem(persist.key) ?? "{}"),
    );
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

/** Keep only the fields this package stores, whatever object the auth client returned. */
function pickIdentity(user: SyncIdentity): SyncIdentity {
  const identity: SyncIdentity = { userId: user.userId };
  if (user.name) identity.name = user.name;
  if (user.email) identity.email = user.email;
  if (user.image) identity.image = user.image;
  return identity;
}

function sameIdentity(a: SyncIdentity, b: SyncIdentity): boolean {
  return (
    a.userId === b.userId &&
    a.name === b.name &&
    a.email === b.email &&
    a.image === b.image
  );
}
