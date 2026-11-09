import { APP_TITLE_TYPE } from "@/components/app-header-styles";
import {
  SettingsGroup,
  SettingsSection,
} from "@/components/appearance/settings-layout";
import { BackToLibrary } from "@/components/ui/back-to-library";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useSessions } from "./use-sessions";
import type { DeviceType, SessionInfo } from "@/types/session";
import { useDebugEnabled } from "@/lib/debug-preference";
import { formatDistanceToNow } from "date-fns";
import { Globe, Monitor, Smartphone, Tablet } from "lucide-react";
import { lazy, Suspense } from "react";
import { Navigate } from "react-router-dom";
import { cn } from "@/lib/utils";

const SyncDevices = lazy(() =>
  import("@/features/sync-history/SyncDevices").then((module) => ({
    default: module.SyncDevices,
  })),
);

function SessionDeviceIcon({
  deviceType,
  className,
}: {
  deviceType: DeviceType;
  className?: string;
}) {
  switch (deviceType) {
    case "mobile":
      return <Smartphone className={className} />;
    case "tablet":
      return <Tablet className={className} />;
    case "desktop":
      return <Monitor className={className} />;
    default:
      return <Globe className={className} />;
  }
}

function formatSessionTime(dateString: string) {
  const date = new Date(dateString);
  return formatDistanceToNow(date, { addSuffix: true });
}

function SessionItem({ session }: { session: SessionInfo }) {
  const title = `${session.browser.name} ${session.browser.version}`;
  const subtitle = `${session.os.name} ${session.os.version}`;

  return (
    <div className="flex items-center gap-3.5 py-3">
      <div
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full",
          session.isCurrent
            ? "bg-foreground text-background"
            : "bg-foreground/[0.06] text-foreground/70",
        )}
      >
        <SessionDeviceIcon
          deviceType={session.deviceType}
          className="size-[18px]"
        />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-[15px] break-words text-foreground">{title}</h3>
        <div className="flex flex-wrap items-start justify-between gap-x-2">
          <p className="text-[13px] break-words text-muted-foreground">
            {subtitle}
          </p>
          <p className="text-[13px] whitespace-nowrap text-muted-foreground">
            {session.isCurrent
              ? "Online"
              : formatSessionTime(session.updatedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="flex items-center gap-3.5 py-3">
      <Skeleton className="size-9 shrink-0 rounded-full bg-foreground/[0.06]" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32 bg-foreground/[0.06]" />
        <Skeleton className="h-3 w-24 bg-foreground/[0.06]" />
      </div>
    </div>
  );
}

export function Devices() {
  const { isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { data: sessions, isLoading: isSessionsLoading, error } = useSessions();
  const debugEnabled = useDebugEnabled();

  // Redirect to home if not authenticated
  if (!isAuthLoading && !isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const currentSession = sessions?.find((s) => s.isCurrent);
  const otherSessions = sessions?.filter((s) => !s.isCurrent) ?? [];
  const loading = isAuthLoading || isSessionsLoading;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-2xl px-4 pt-16 pb-6 md:px-6 md:py-10">
        <header className="mb-10">
          <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3 md:block">
            <BackToLibrary />
            <h1
              className={cn(
                "text-center text-balance text-foreground md:px-[17px] md:text-left",
                APP_TITLE_TYPE,
              )}
            >
              Devices
            </h1>
            <div className="size-8 md:hidden" aria-hidden="true" />
          </div>
          <p className="mt-2 text-center text-sm text-muted-foreground md:px-[17px] md:text-left">
            Browsers that are signed in to your account.
          </p>
        </header>

        {error && (
          <SettingsGroup>
            <p
              role="alert"
              className="py-5 text-center text-sm text-foreground"
            >
              Couldn’t load your devices. Check your connection, then try again.
            </p>
          </SettingsGroup>
        )}

        {loading && (
          <div role="status">
            <span className="sr-only">Loading devices…</span>
            <SettingsSection title="This device">
              <SettingsGroup>
                <SessionSkeleton />
              </SettingsGroup>
            </SettingsSection>
          </div>
        )}

        {!loading && !error && sessions && (
          <div className="space-y-10">
            {currentSession && (
              <SettingsSection title="This device">
                <SettingsGroup>
                  <SessionItem session={currentSession} />
                </SettingsGroup>
              </SettingsSection>
            )}

            <SettingsSection title="Other devices">
              {otherSessions.length > 0 ? (
                <SettingsGroup>
                  {otherSessions.map((session) => (
                    <SessionItem key={session.id} session={session} />
                  ))}
                </SettingsGroup>
              ) : (
                <p className="px-[17px] text-[13px] text-muted-foreground">
                  You’re not signed in on any other devices.
                </p>
              )}
            </SettingsSection>

            {debugEnabled && (
              <Suspense>
                <SyncDevices />
              </Suspense>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
