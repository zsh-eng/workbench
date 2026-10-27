import { Card } from "@/components/ui/card";
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

function SessionItem({
  session,
  isLast,
}: {
  session: SessionInfo;
  isLast?: boolean;
}) {
  const browserName = session.browser.name;
  const browserVersion = session.browser.version;
  const osName = session.os.name;
  const osVersion = session.os.version;

  // Construct descriptive strings
  const title = `${browserName} ${browserVersion}`;
  const subtitle = `${osName} ${osVersion}`;

  return (
    <div
      className={`flex items-center gap-4 p-4 ${
        !isLast ? "border-b border-border" : ""
      }`}
    >
      <div
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
          session.isCurrent
            ? "bg-primary text-primary-foreground"
            : "bg-secondary text-secondary-foreground"
        }`}
      >
        <SessionDeviceIcon
          deviceType={session.deviceType}
          className="h-5 w-5"
        />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-balance font-medium text-foreground break-words text-sm text-left">
          {title}
        </h3>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <p className="text-xs text-muted-foreground break-words mt-0.5 text-left">
            {subtitle}
          </p>
          <p
            className={`text-xs whitespace-nowrap ${
              session.isCurrent
                ? "text-primary font-medium"
                : "text-muted-foreground"
            }`}
          >
            {session.isCurrent
              ? "online"
              : formatSessionTime(session.updatedAt)}
          </p>
        </div>
      </div>
    </div>
  );
}

function SessionSkeleton() {
  return (
    <div className="flex items-center gap-4 p-4 border-b border-border last:border-0">
      <Skeleton className="h-10 w-10 rounded-full shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="h-3 w-24" />
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

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-16 pb-6 md:px-6 md:py-10">
        {/* Header */}
        <header className="mb-8">
          <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3 md:block">
            <BackToLibrary />
            <h1 className="text-balance text-center text-2xl font-bold tracking-tight text-foreground md:text-left">
              Devices
            </h1>
            <div className="size-8 md:hidden" aria-hidden="true" />
          </div>
          <p className="mt-1 text-center text-sm text-muted-foreground md:text-left">
            Browsers that are signed in to your account.
          </p>
        </header>

        {/* Error State */}
        {error && (
          <Card className="overflow-hidden px-2 py-2 hover:bg-muted bg-muted rounded-3xl shadow-none">
            <div className="p-6 text-center">
              <p role="alert" className="text-destructive">
                Failed to load devices. Please try again.
              </p>
            </div>
          </Card>
        )}

        {/* Loading State */}
        {(isAuthLoading || isSessionsLoading) && (
          <div role="status" className="space-y-8">
            <span className="sr-only">Loading devices…</span>
            <div>
              <h2 className="text-balance text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1">
                This device
              </h2>
              <Card className="overflow-hidden px-2 py-2 hover:bg-muted bg-muted rounded-3xl shadow-none">
                <SessionSkeleton />
              </Card>
            </div>
          </div>
        )}

        {/* Sessions List */}
        {!isAuthLoading && !isSessionsLoading && !error && sessions && (
          <div className="space-y-8">
            {/* Current Session */}
            {currentSession && (
              <section>
                <h2 className="text-balance text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1">
                  This device
                </h2>
                <Card className="overflow-hidden px-2 py-2 hover:bg-muted bg-muted rounded-3xl shadow-none">
                  <SessionItem session={currentSession} isLast />
                </Card>
              </section>
            )}

            {/* Other Active Sessions */}
            {otherSessions.length > 0 && (
              <section>
                <h2 className="text-balance text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1">
                  Other devices
                </h2>
                <Card className="overflow-hidden px-2 py-2 bg-background rounded-3xl shadow-none gap-0">
                  {otherSessions.map((session, index) => (
                    <SessionItem
                      key={session.id}
                      session={session}
                      isLast={index === otherSessions.length - 1}
                    />
                  ))}
                </Card>
              </section>
            )}

            {/* Empty State for other sessions */}
            {otherSessions.length === 0 && currentSession && (
              <div className="text-center py-4">
                <p className="text-muted-foreground text-sm">
                  You are not logged in on any other devices.
                </p>
              </div>
            )}

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
