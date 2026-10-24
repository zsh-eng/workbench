import { LoginButton } from "@/components/profile/login-button";
import { LogoutButton } from "@/components/profile/logout-button";
import { spacedSync } from "@/lib/sync/engine";
import type { SyncIdentity, SyncSummary } from "@zsh-eng/local-sync";
import { useSyncStatus, useSyncSummary } from "@zsh-eng/local-sync/react";

/**
 * The account on the Profile page, as this device knows it (the shared sync
 * status, `spacedSync`). Only the server's answer ends a session, so a
 * remembered account shows offline too, with Sign out disabled until the
 * connection returns. Before anyone has answered, the account is neutral:
 * neither the user nor Sign in.
 */
export function AccountSection() {
  const auth = useSyncStatus(spacedSync, (status) => status.auth);
  const summary = useSyncSummary(spacedSync);
  switch (auth.status) {
    case "signed-in":
      return (
        <>
          <AccountCard user={auth.user} summary={summary} />
          <LogoutButton />
        </>
      );
    case "expired":
      return (
        <>
          <AccountCard user={auth.user} summary={summary} />
          <LoginButton label="Sign in again" />
          <LogoutButton />
        </>
      );
    case "signed-out":
      return <LoginButton />;
    case "unknown":
      return (
        <div
          role="status"
          className="flex flex-col gap-1 rounded-xl bg-background px-6 py-4 dark:bg-muted/50"
        >
          <span>Account</span>
          <span className="text-sm text-muted-foreground">
            {summary.kind === "offline"
              ? "Connect to check your account."
              : "Checking your account…"}
          </span>
        </div>
      );
  }
}

/** Who is signed in, and the sync status in the shared words. */
function AccountCard({
  user,
  summary,
}: {
  user: SyncIdentity;
  summary: SyncSummary;
}) {
  const name = user.name || user.email || "Your account";
  // Offline, the notice at the top says so; the detail says what is kept.
  const status = summary.kind === "offline" ? summary.detail : summary.label;
  return (
    <div
      aria-label="Account"
      className="flex items-center gap-4 rounded-xl bg-background px-6 py-4 dark:bg-muted/50"
    >
      {user.image ? (
        <img src={user.image} alt="" className="size-10 rounded-full" />
      ) : (
        <span
          aria-hidden
          className="flex size-10 shrink-0 items-center justify-center rounded-full bg-muted font-medium text-muted-foreground dark:bg-background"
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-medium">{name}</span>
        {user.name && user.email && (
          <span className="truncate text-sm text-muted-foreground">
            {user.email}
          </span>
        )}
        <span
          className="text-sm text-muted-foreground"
          title={summary.detail || undefined}
        >
          {status}
        </span>
      </div>
    </div>
  );
}
