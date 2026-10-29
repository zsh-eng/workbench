import type { IslandContent } from "@workbench/background-activity";
import type { Status } from "./engine";

/**
 * What the island needs from sync's own status: can it go on. `stopped`
 * and `update` are sync's blocked failures: another account's session, or
 * a server that needs a newer app.
 */
export type RestoreConnection =
  | "online"
  | "offline"
  | "signed-out"
  | "stopped"
  | "update";

const STATUS_WORDS = {
  cards: "Restoring your cards…",
  history: "Restoring your review history…",
};

/**
 * What the restore island says: its stage with what is known of it, a
 * wait for a connection or a sign-in, and "Restored" once at the end.
 * `ended` is true once this page saw a restore finish.
 */
export function restoreIslandContent(
  status: Pick<Status, "restoring" | "fraction">,
  connection: RestoreConnection,
  ended: boolean,
): { content: IslandContent | null; status: string } {
  const { restoring, fraction } = status;
  if (!restoring)
    return ended && connection !== "stopped" && connection !== "update"
      ? { content: { mark: "done", label: "Restored" }, status: "Restored" }
      : { content: null, status: "" };
  const words = STATUS_WORDS[restoring];
  if (connection === "offline")
    return {
      content: { mark: "waiting", label: "Waiting for a connection" },
      status: `${words} Waiting for a connection.`,
    };
  if (connection === "update")
    return {
      content: { mark: "attention", label: "Update to finish restoring" },
      status: `${words} Update the app to finish.`,
    };
  if (connection === "stopped")
    return {
      content: { mark: "attention", label: "Sync stopped" },
      status: `${words} Sync stopped.`,
    };
  if (connection === "signed-out")
    return {
      content: { mark: "attention", label: "Sign in to finish restoring" },
      status: `${words} Sign in to finish.`,
    };
  if (restoring === "cards")
    return {
      content: {
        mark: "progress",
        fraction,
        label: "Restoring cards",
      },
      status: words,
    };
  return {
    content: {
      mark: "progress",
      fraction,
      label: "Restoring history",
      detail: fraction === null ? undefined : `${Math.floor(fraction * 100)}%`,
    },
    status: words,
  };
}
