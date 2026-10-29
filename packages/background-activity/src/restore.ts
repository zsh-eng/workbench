/**
 * What a restore island says, from sync's status and the app's words for
 * what it is doing. One grammar for every app: its stage with what is
 * known of it, a wait for a connection, a sign-in or an update, and the
 * app's confirmation once at the end (docs/MODEL.md).
 */
import type { IslandContent } from "./island-timing";
import type { SyncStatusLike } from "./sync";

/** The app's words for the stage it is in. */
export interface RestoreStage {
  /** What the island shows: usually a ring, with a count or share when known. */
  progress: IslandContent;
  /** What assistive technology hears, once per stage: "Restoring your library…". */
  status: string;
}

/** Failures that stop sync until a person or a newer app acts. */
const STOPPED: Record<string, { label: string; status: string }> = {
  "account-changed": { label: "Sync stopped", status: "Sync stopped." },
  "upgrade-required": {
    label: "Update to finish restoring",
    status: "Update the app to finish.",
  },
};

/**
 * `stage` is null once the restore is over. `ended` is true once this page
 * saw a restore run, so the end says `done` ("Restored"); a restore that a
 * stopped sync ended says nothing more than the stop did.
 */
export function restoreIsland(
  sync: Pick<SyncStatusLike, "connection" | "auth" | "failure">,
  stage: RestoreStage | null,
  ended: boolean,
  done = "Restored",
): { content: IslandContent | null; status: string } {
  const stopped = sync.failure ? STOPPED[sync.failure.kind] : undefined;
  if (!stage)
    return ended && !stopped
      ? { content: { mark: "done", label: done }, status: done }
      : { content: null, status: "" };
  if (stopped)
    return {
      content: { mark: "attention", label: stopped.label },
      status: `${stage.status} ${stopped.status}`,
    };
  if (sync.connection === "offline")
    return {
      content: { mark: "waiting", label: "Waiting for a connection" },
      status: `${stage.status} Waiting for a connection.`,
    };
  if (sync.auth.status === "expired" || sync.auth.status === "signed-out")
    return {
      content: { mark: "attention", label: "Sign in to finish restoring" },
      status: `${stage.status} Sign in to finish.`,
    };
  return { content: stage.progress, status: stage.status };
}
