/**
 * Client sync state on three independent axes (connection, account, sync
 * activity) and the words to show for it. See docs/SYNC_STATES.md.
 */
import {
  SyncHttpError,
  SyncNetworkError,
  SyncRecordError,
  SyncScopeError,
} from "./errors.js";

/**
 * `offline`: the device says it has no network. `unreachable`: the device
 * says it is online, but the last request got no answer. `online`: the last
 * request got an HTTP answer, or nothing has failed yet.
 */
export type SyncConnection = "online" | "offline" | "unreachable";

export interface SyncIdentity {
  userId: string;
  name?: string;
  email?: string;
  image?: string;
}

/**
 * Who this device believes is signed in. Only a server answer changes it; a
 * failed request never does. `confirmed: false` means the identity comes from
 * this device's cache and no server has answered since the app started.
 */
export type SyncAuth =
  | { status: "unknown" }
  | { status: "signed-in"; user: SyncIdentity; confirmed: boolean }
  | { status: "signed-out" }
  | { status: "expired"; user: SyncIdentity };

/** Why a sync attempt failed, in terms of what the client does next. */
export type SyncFailure =
  /** No answer: retry with backoff. */
  | { kind: "network"; message: string }
  /** 401: wait for a new sign-in. */
  | { kind: "unauthorized" }
  /** 503 with Retry-After: retry when the server says. */
  | { kind: "maintenance"; retryAfterMs: number }
  /** 5xx, 408 or 429: retry with backoff. */
  | { kind: "server"; status: number; retryAfterMs?: number }
  /** Another 4xx, or a change the protocol cannot send: retry with backoff, show it. */
  | { kind: "rejected"; status?: number; message: string }
  /** 410: this app version can no longer sync; wait for a reload. */
  | { kind: "upgrade-required" }
  /** Local data belongs to another account or server epoch; stop. */
  | { kind: "account-changed"; message: string }
  /** Anything else, such as a local storage error: retry with backoff. */
  | { kind: "failed"; message: string };

export interface SyncStatus {
  connection: SyncConnection;
  auth: SyncAuth;
  /** A sync attempt is in flight. */
  running: boolean;
  /** The attempt in flight is this device's first download of the account. */
  restoring: boolean;
  /** Local changes the server has not acknowledged, as the app reports them. */
  pending: number;
  lastSyncedAt: number | null;
  /** Why the last attempt failed; null after a success. */
  failure: SyncFailure | null;
  /** Consecutive failed attempts. */
  failures: number;
  /** When the next automatic attempt starts; set only while one is scheduled. */
  retryAt: number | null;
}

/** Failures that stop automatic sync until the user or the server changes something. */
export function isSyncBlocked(failure: SyncFailure | null): boolean {
  return (
    failure?.kind === "upgrade-required" || failure?.kind === "account-changed"
  );
}

/**
 * Maps an error from a sync attempt to a failure. Returns null when the
 * attempt was cancelled. Accepts this package's errors and any error with a
 * numeric HTTP `status` (and optional `response`), such as an app's own
 * transport error.
 */
export function classifySyncFailure(error: unknown): SyncFailure | null {
  if (isNamed(error, "AbortError")) return null;
  if (
    error instanceof SyncNetworkError ||
    isNamed(error, "TimeoutError") ||
    isFetchFailure(error)
  )
    return { kind: "network", message: messageOf(error) };
  if (error instanceof SyncScopeError)
    return { kind: "account-changed", message: error.message };
  if (error instanceof SyncRecordError)
    return { kind: "rejected", message: error.message };
  const status = httpStatus(error);
  if (status === undefined)
    return { kind: "failed", message: messageOf(error) };
  const retryAfterMs = retryAfter(error);
  if (status === 401) return { kind: "unauthorized" };
  if (status === 409)
    return {
      kind: "account-changed",
      message: "The server's copy of this account changed.",
    };
  if (status === 410) return { kind: "upgrade-required" };
  if (status === 503 && retryAfterMs !== undefined)
    return { kind: "maintenance", retryAfterMs };
  if (status === 408 || status === 429 || status >= 500)
    return retryAfterMs === undefined
      ? { kind: "server", status }
      : { kind: "server", status, retryAfterMs };
  return { kind: "rejected", status, message: messageOf(error) };
}

function isNamed(error: unknown, name: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { name?: unknown }).name === name
  );
}

/** Browsers reject fetch with a TypeError and these messages; other TypeErrors are bugs. */
function isFetchFailure(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /failed to fetch|fetch failed|load failed|networkerror|network request failed|network connection was lost/i.test(
      error.message,
    )
  );
}

function httpStatus(error: unknown): number | undefined {
  if (error instanceof SyncHttpError) return error.status;
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && status >= 400 && status <= 599
    ? status
    : undefined;
}

/** Retry-After as delay seconds or an HTTP date. */
function retryAfter(error: unknown): number | undefined {
  const response = (error as { response?: unknown } | null)?.response;
  const value =
    response instanceof Response
      ? response.headers.get("Retry-After")
      : undefined;
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** One of the states below; apps can word them differently by kind. */
export type SyncSummaryKind =
  | "offline"
  | "upgrade-required"
  | "account-changed"
  | "expired"
  | "restoring"
  | "syncing"
  | "signed-out"
  | "unreachable"
  | "maintenance"
  | "rejected"
  | "failed"
  | "pending"
  | "synced"
  | "idle";

export interface SyncSummary {
  kind: SyncSummaryKind;
  /** A few words, for a status line or menu item. */
  label: string;
  /** One or two sentences, for a menu, sheet or tooltip. */
  detail: string;
  /** Worth showing unasked, for example beside the account button. */
  attention: boolean;
  busy: boolean;
  /** What a button beside the summary does. */
  action: "sign-in" | "retry" | "reload" | null;
}

/** A single failed attempt is often a blip: say it, but do not raise it, until the retry fails too. */
export const SYNC_ATTENTION_FAILURES = 2;

/**
 * The one state to show, in priority order: what the device cannot change
 * (offline, blocked), then what the user must do (sign in), then work in
 * progress, then failures that retry by themselves, then the quiet states.
 */
export function describeSyncStatus(
  status: SyncStatus,
  now: number,
): SyncSummary {
  const saved = savedHere(status.pending);
  const retry =
    status.retryAt === null
      ? ""
      : ` Retrying in ${formatSyncDelay(status.retryAt - now)}.`;
  const repeated = status.failures >= SYNC_ATTENTION_FAILURES;
  const summary = (
    kind: SyncSummaryKind,
    label: string,
    detail: string,
    extra: Partial<Pick<SyncSummary, "attention" | "busy" | "action">> = {},
  ): SyncSummary => ({
    kind,
    label,
    detail: detail.trim(),
    attention: false,
    busy: false,
    action: null,
    ...extra,
  });

  if (status.connection === "offline")
    return summary(
      "offline",
      "Offline",
      status.pending
        ? `${saved} They sync when you are back online.`
        : `Showing this device's copy${status.lastSyncedAt === null ? "" : `, last synced ${formatSyncAge(now - status.lastSyncedAt)}`}.`,
      { attention: true },
    );
  if (status.failure?.kind === "upgrade-required")
    return summary(
      "upgrade-required",
      "Update to keep syncing",
      `This version of the app can no longer sync. Reload to update. ${saved}`,
      { attention: true, action: "reload" },
    );
  if (status.failure?.kind === "account-changed")
    return summary(
      "account-changed",
      "Sync stopped",
      "This device's data belongs to another account or an older copy of it. It stays on this device.",
      { attention: true },
    );
  if (status.auth.status === "expired")
    return summary(
      "expired",
      "Sign in again to sync",
      `Your session ended. ${saved}`,
      { attention: true, action: "sign-in" },
    );
  if (status.running)
    return status.restoring
      ? summary("restoring", "Restoring…", "Downloading your data.", {
          busy: true,
        })
      : summary(
          "syncing",
          "Syncing…",
          status.pending ? `Sending ${changes(status.pending)}.` : "",
          { busy: true },
        );
  if (status.auth.status === "signed-out")
    return summary(
      "signed-out",
      "Sign in to sync",
      "Changes are saved on this device only.",
      { action: "sign-in" },
    );
  switch (status.failure?.kind) {
    case "network":
      return summary(
        "unreachable",
        "Couldn't reach the server",
        `${retry} ${saved}`,
        { attention: repeated, action: "retry" },
      );
    case "maintenance":
      return summary(
        "maintenance",
        "Sync paused for maintenance",
        `${retry} ${saved}`,
        { attention: true },
      );
    case "rejected":
      return summary(
        "rejected",
        "Some changes didn't sync",
        `${status.failure.message}.${retry}`,
        { attention: true, action: "retry" },
      );
    case "server":
    case "failed":
      return summary("failed", "Sync failed", `${retry} ${saved}`, {
        attention: repeated,
        action: "retry",
      });
  }
  if (status.pending)
    return summary(
      "pending",
      "Saved on this device, will sync",
      `${capitalize(changes(status.pending))} waiting to sync.`,
    );
  if (status.lastSyncedAt !== null)
    return summary(
      "synced",
      `Synced ${formatSyncAge(now - status.lastSyncedAt)}`,
      "Everything on this device is synced.",
    );
  return summary("idle", "Not synced yet", "");
}

function changes(count: number): string {
  return count === 1 ? "1 change" : `${count} changes`;
}

function savedHere(pending: number): string {
  if (pending === 0) return "";
  return pending === 1
    ? "1 change is saved on this device."
    : `${pending} changes are saved on this device.`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** "a moment", "12 s", "3 min", "2 h", for a countdown. */
export function formatSyncDelay(ms: number): string {
  if (ms <= 500) return "a moment";
  const seconds = Math.ceil(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function formatSyncAge(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}
