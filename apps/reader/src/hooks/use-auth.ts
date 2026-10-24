import { getLabRuntime } from "@/features/sync-lab/runtime";
import { authClient, useSession } from "@/lib/auth-client";
import { syncService } from "@/lib/sync-service";
import type { SyncAuth } from "@zsh-eng/local-sync";
import { useSyncStatus } from "@zsh-eng/local-sync/react";

interface SessionAnswer {
  data: {
    user: { id: string; name?: string; email?: string; image?: string | null };
    session: { id: string };
  } | null;
  error: { status?: number } | null;
  isPending: boolean;
}

/**
 * Passes Better Auth's session answers to the sync controller, which
 * remembers the account on this device. A failed session request (offline,
 * timeout, 5xx) is not an answer, so a remembered user stays signed in.
 * Returns the unsubscribe function; SyncProvider owns the subscription.
 */
export function observeAuthSession(): () => void {
  if (getLabRuntime()) return () => {};
  return authClient.$store.atoms.session.subscribe((value) => {
    const { data, error, isPending } = value as SessionAnswer;
    if (isPending) return;
    if (data?.user)
      syncService.controller.confirmSignedIn(
        {
          userId: data.user.id,
          name: data.user.name,
          email: data.user.email,
          image: data.user.image ?? undefined,
        },
        data.session.id,
      );
    else if (!error || error.status === 401)
      syncService.controller.confirmSignedOut();
  });
}

function toUser(auth: SyncAuth) {
  if (auth.status !== "signed-in" && auth.status !== "expired") return;
  return {
    id: auth.user.userId,
    name: auth.user.name ?? "",
    email: auth.user.email ?? "",
    image: auth.user.image ?? null,
  };
}

/**
 * The account as this device knows it. `status` separates a user whose
 * session ended ("expired") from one who never signed in ("signed-out") and
 * from a first launch with no answer yet ("unknown").
 */
function useRealAuth() {
  const { data, isPending, error } = useSession();
  const auth = useSyncStatus(syncService.controller, (status) => status.auth);
  return {
    status: auth.status,
    user: toUser(auth),
    session: auth.status === "signed-in" ? data?.session : undefined,
    isLoading: auth.status === "unknown" && isPending,
    isAuthenticated: auth.status === "signed-in",
    error,
  };
}

/** Lab sessions are synthetic. Do not subscribe to the real auth client. */
function useLabAuth(): ReturnType<typeof useRealAuth> {
  return {
    status: "signed-in",
    user: {
      id: "sync-lab-user",
      name: "Sync Lab",
      email: "lab@example.invalid",
      image: null,
    },
    session: undefined,
    isLoading: false,
    isAuthenticated: true,
    error: null,
  };
}

// Runtime selection is fixed before React mounts this application.
export const useAuth = getLabRuntime() ? useLabAuth : useRealAuth;
