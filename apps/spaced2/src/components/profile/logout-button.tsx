import BouncyButton from "@/components/bouncy-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  logoutAndClearLocalData,
  needsLocalAccountCleanup,
} from "@/lib/auth/privacy";
import { spacedSync } from "@/lib/sync/engine";
import { cn } from "@/lib/utils";
import { useSyncStatus } from "@zsh-eng/local-sync/react";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

/** Signing out needs the server, so the button is disabled offline, never hidden. */
export function LogoutButton() {
  const online = useSyncStatus(
    spacedSync,
    (status) => status.connection !== "offline",
  );
  const [retryCleanup, setRetryCleanup] = useState(needsLocalAccountCleanup);
  const disabled = !online && !retryCleanup;
  const handleLogout = async () => {
    try {
      await logoutAndClearLocalData();
      location.reload();
    } catch (error) {
      setRetryCleanup(needsLocalAccountCleanup());
      throw error;
    }
  };

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <button type="button" disabled={disabled}>
          <BouncyButton
            variant="large"
            className={cn(
              "bg-background dark:bg-muted/50 w-full rounded-xl py-4 px-6  cursor-pointer transition-all duration-100 ease-out",
              disabled && "cursor-not-allowed text-muted-foreground",
            )}
          >
            <div className="flex justify-between">
              <span>{retryCleanup ? "Retry local cleanup" : "Sign out"}</span>
              <LogOut className="w-6 h-6 text-muted-foreground" />
            </div>
          </BouncyButton>
        </button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {retryCleanup
              ? "Clear local account data?"
              : "Sign out of your account?"}
          </AlertDialogTitle>
          <AlertDialogDescription>
            Your local cards, review history, saved card draft, and cached
            images will be cleared from this browser for privacy.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              toast.promise(handleLogout, {
                loading: "Signing out...",
                success: "Signed out successfully",
                error: () =>
                  needsLocalAccountCleanup()
                    ? "Signed out. Local cleanup failed. Use Retry local cleanup."
                    : "Failed to sign out",
              });
            }}
          >
            {retryCleanup ? "Retry cleanup" : "Sign out"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
