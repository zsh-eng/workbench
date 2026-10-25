/**
 * Sync as a tracked job: only its exceptions show (docs/MODEL.md). The
 * adapter reads any store with local-sync's `SyncStatus` fields, so this
 * package does not depend on local-sync.
 */
import type { TrackedJobSource, TrackedJobView } from "./types";

/** The fields of `@zsh-eng/local-sync`'s `SyncStatus` that the adapter reads. */
export interface SyncStatusLike {
  connection: "online" | "offline" | "unreachable";
  auth: { status: "unknown" | "signed-in" | "signed-out" | "expired" };
  running: boolean;
  restoring: boolean;
  pending: number;
  failure: { kind: string } | null;
  failures: number;
  retryAt: number | null;
}

export interface SyncStatusSourceLike {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SyncStatusLike;
}

/** Failures that wait for a person or a reload, not a retry. */
const STOPPED = new Set(["upgrade-required", "account-changed"]);

const changes = (count: number) =>
  `${count} ${count === 1 ? "change" : "changes"}`;

/**
 * - Restoring on a new device shows: you are waiting for your library.
 * - Changes held by a sign-out or an ended session need you.
 * - Changes held offline show quietly; the network brings them back.
 * - Two failures in a row show with their retry, as sync's own words do.
 * - Everything else, including each sync pass, is silent.
 */
export function syncAsJob(
  source: SyncStatusSourceLike,
  options: { title?: string; restoringTitle?: string } = {},
): TrackedJobSource {
  return {
    subscribe: source.subscribe,
    read(): TrackedJobView | null {
      const status = source.getSnapshot();
      const title = options.title ?? "Sync";
      if (status.restoring && status.running)
        return {
          kind: "sync",
          title: options.restoringTitle ?? "Restoring your library",
          state: "running",
          origin: "user",
          progress: { phase: "restoring" },
        };
      const auth = status.auth.status;
      if (status.pending > 0 && (auth === "signed-out" || auth === "expired"))
        return {
          kind: "sync",
          title,
          state: "waiting",
          waitingFor: "sign-in",
          attention: true,
          detail: `${changes(status.pending)} only on this device. Sign in to keep them.`,
        };
      if (status.pending > 0 && status.connection === "offline")
        return {
          kind: "sync",
          title,
          state: "waiting",
          waitingFor: "network",
          detail: `${changes(status.pending)} saved on this device`,
        };
      if (status.failure && status.failures >= 2)
        return {
          kind: "sync",
          title,
          state:
            status.retryAt !== null && !STOPPED.has(status.failure.kind)
              ? "retrying"
              : "failed",
          retryAt: status.retryAt,
          attention: true,
          failure: {
            reason:
              status.failure.kind === "network"
                ? "network"
                : status.failure.kind === "unauthorized"
                  ? "auth"
                  : "server",
            message: status.failure.kind,
            retryable: !STOPPED.has(status.failure.kind),
          },
          detail:
            status.connection === "unreachable"
              ? "Couldn't reach the server"
              : "Sync failed",
        };
      if (status.running)
        return { kind: "sync", title, state: "running", origin: "app" };
      return null;
    },
  };
}
