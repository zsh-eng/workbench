import { CloudOff } from "lucide-react";

/** Whether this device can reach the sync server. */
export type ConnectionStatus = "online" | "offline";

/**
 * The connection state at the top of the Profile page. It shows only while
 * offline: it says what still works and why signing in or out cannot.
 */
export function ConnectionNotice({ status }: { status: ConnectionStatus }) {
  if (status === "online") return null;
  return (
    <div
      role="status"
      className="flex items-start gap-4 rounded-xl bg-background px-6 py-4 dark:bg-muted/50"
    >
      <CloudOff
        aria-hidden
        className="mt-0.5 size-6 shrink-0 text-muted-foreground"
      />
      <div className="flex flex-col gap-1">
        <p className="font-medium">You're offline</p>
        <p className="text-sm text-muted-foreground">
          Reviews and edits are saved on this device and sync when you're back
          online. Signing in or out needs a connection.
        </p>
      </div>
    </div>
  );
}
