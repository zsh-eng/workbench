import { APP_HEADER_BUTTON } from "@/components/app-header-styles";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { getLabRuntime } from "@/features/sync-lab/runtime";
import { useSyncStatus } from "@/features/sync-status/use-sync-status";
import { useAuth } from "@/hooks/use-auth";
import {
  useReaderSettings,
  type AppearanceMode,
} from "@/hooks/use-reader-settings";
import { SyncUnavailableError, useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth-client";
import { useDebugEnabled } from "@/lib/debug-preference";
import { files } from "@/lib/files";
import { cn } from "@/lib/utils";
import {
  Bug,
  CircleUser,
  Cloud,
  CloudOff,
  Loader2,
  LogIn,
  LogOut,
  MonitorSmartphone,
  Settings,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";

const APPEARANCE_OPTIONS: { value: AppearanceMode; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

function getUserInitials(name: string | null | undefined): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

/**
 * Sign-in, sync, appearance and the secondary pages, behind one button at the
 * end of each header. Sync stays quiet while it works; when it needs you
 * (offline, signed out, or failing) its state shows beside the button.
 */
export function AccountMenu() {
  const navigate = useNavigate();
  const debugEnabled = useDebugEnabled();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { appearanceMode, setAppearanceMode } = useReaderSettings();
  const { isSyncing, triggerSync } = useSync();
  const syncStatus = useSyncStatus();
  const { toast } = useToast();
  const showSyncAttention = isAuthenticated && syncStatus.attention;

  const handleSync = async () => {
    try {
      files.retryUploads();
      await triggerSync();
    } catch (error) {
      console.error("Error syncing:", error);
      toast({
        message:
          error instanceof SyncUnavailableError
            ? error.message
            : "Could not sync your library.",
        variant: "destructive",
      });
    }
  };

  const handleGoogleSignIn = async () => {
    try {
      if (getLabRuntime()) return;
      const { error } = await authClient.signIn.social({
        provider: "google",
        callbackURL: window.location.origin,
      });
      if (error) throw new Error(error.message || "Google sign-in failed");
    } catch (error) {
      console.error("Error signing in:", error);
      toast({
        message: "Could not sign in with Google.",
        variant: "destructive",
      });
    }
  };

  const handleSignOut = async () => {
    try {
      if (getLabRuntime()) return;
      await authClient.signOut();
      navigate("/");
      toast({ message: "Signed out." });
    } catch (error) {
      console.error("Error signing out:", error);
      toast({ message: "Could not sign out.", variant: "destructive" });
    }
  };

  if (isAuthLoading) {
    return (
      <span className="grid size-10 place-items-center md:size-9">
        <Skeleton className="size-7 rounded-full" />
      </span>
    );
  }

  return (
    <DropdownMenu>
      <div className="flex items-center gap-1.5">
        {showSyncAttention && (
          <span className="text-[12px] text-muted-foreground max-md:hidden">
            {syncStatus.label}
          </span>
        )}
        <DropdownMenuTrigger
          aria-label={
            showSyncAttention ? `Account: ${syncStatus.label}` : "Account"
          }
          title={showSyncAttention ? syncStatus.label : "Account"}
          className={cn(APP_HEADER_BUTTON, "relative")}
        >
          {isAuthenticated && user ? (
            <Avatar className="size-7">
              <AvatarImage src={user.image || undefined} alt="" />
              <AvatarFallback className="text-[11px]">
                {getUserInitials(user.name)}
              </AvatarFallback>
            </Avatar>
          ) : (
            <CircleUser className="size-[18px]" strokeWidth={1.7} />
          )}
          {showSyncAttention && (
            <span
              aria-hidden="true"
              className="absolute top-1.5 right-1.5 size-2 rounded-full bg-destructive ring-2 ring-background md:hidden"
            />
          )}
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent align="end" className="w-64">
        {isAuthenticated && user && (
          <DropdownMenuGroup>
            <DropdownMenuLabel className="pb-2">
              <span className="block truncate">{user.name}</span>
              <span className="block truncate text-xs font-normal text-muted-foreground">
                {user.email}
              </span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
        )}
        {isAuthenticated && (
          <DropdownMenuItem
            disabled={isSyncing || !syncStatus.online}
            aria-label={
              syncStatus.authRequired
                ? "Sign in again"
                : `Sync now: ${syncStatus.label}`
            }
            title={syncStatus.detail}
            onClick={() =>
              void (syncStatus.authRequired
                ? handleGoogleSignIn()
                : handleSync())
            }
          >
            {syncStatus.busyVisible ? (
              <Loader2 className="animate-spin" />
            ) : syncStatus.online ? (
              <Cloud />
            ) : (
              <CloudOff />
            )}
            {syncStatus.label}
          </DropdownMenuItem>
        )}
        {isAuthenticated && <DropdownMenuSeparator />}
        {isAuthenticated && (
          <DropdownMenuItem render={<Link to="/devices" />}>
            <MonitorSmartphone />
            Devices
          </DropdownMenuItem>
        )}
        <DropdownMenuItem render={<Link to="/settings" />}>
          <Settings />
          Settings
        </DropdownMenuItem>
        {debugEnabled && (
          <DropdownMenuItem render={<Link to="/debug" />}>
            <Bug />
            Debug tools
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuLabel className="pt-2 pb-1 text-xs font-normal text-muted-foreground">
            Appearance
          </DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={appearanceMode}
            onValueChange={(value) =>
              setAppearanceMode(value as AppearanceMode)
            }
          >
            {APPEARANCE_OPTIONS.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        {isAuthenticated ? (
          <DropdownMenuItem onClick={() => void handleSignOut()}>
            <LogOut />
            Sign out
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => void handleGoogleSignIn()}>
            <LogIn />
            Sign in with Google
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
