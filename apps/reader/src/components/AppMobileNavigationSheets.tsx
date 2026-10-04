import { SheetUtilityButton } from "./SheetUtilityButton";
import { useDebugEnabled } from "@/lib/debug-preference";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { SlidingSheet } from "./SlidingSheet";
import { ContinueReadingCard } from "@/components/ContinueReadingCard";
import { useSpringPressAnimation } from "@/components/ui/spring-press";
import type { AppearanceMode } from "@/hooks/use-reader-settings";
import type { RecentlyReadBook } from "@/lib/library-sort";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  Activity,
  Settings,
  BookPlus,
  Clock3,
  Cloud,
  CloudOff,
  Highlighter,
  Library,
  Loader2,
  LogIn,
  LogOut,
  Monitor,
  MonitorSmartphone,
  Moon,
  Sun,
  type LucideIcon,
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";

const MotionLink = motion.create(Link);

type MobileNavigationSheet = "navigation" | "account";

interface AppNavigationUser {
  name?: string | null;
  email: string;
  image?: string | null;
}

interface AppMobileNavigationSheetsProps {
  isOpen: boolean;
  onClose: () => void;
  activePath: string;
  recentReading: RecentlyReadBook | null;
  recentBookCoverUrl: string | undefined;
  appearanceMode: AppearanceMode;
  onAppearanceChange: (appearanceMode: AppearanceMode) => void;
  isImporting: boolean;
  onAddBook: () => void;
  isOnline: boolean;
  isSyncing: boolean;
  syncLabel?: string;
  syncDetail?: string;
  syncBusyVisible?: boolean;
  onSync: () => Promise<void>;
  isAuthenticated: boolean;
  isAuthLoading: boolean;
  user: AppNavigationUser | null;
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
}

interface MobileSheetRowProps {
  index: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
  trailing?: ReactNode;
  to?: string;
  onClick?: () => void;
  isActive?: boolean;
  disabled?: boolean;
  destructive?: boolean;
}

function getUserInitials(name: string | null | undefined): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function MobileSheetRow({
  index,
  label,
  description,
  icon: Icon,
  trailing,
  to,
  onClick,
  isActive = false,
  disabled = false,
  destructive = false,
}: MobileSheetRowProps) {
  const springPress = useSpringPressAnimation();
  const className = cn(
    "flex w-full items-center justify-between rounded-[1.25rem] border border-border/60 bg-secondary/35 px-4 py-3 text-left outline-none transition-[background-color,border-color] focus-visible:ring-2 focus-visible:ring-ring/60",
    isActive && "border-border bg-secondary/65",
    disabled ? "cursor-not-allowed opacity-55" : "hover:bg-secondary/55",
  );
  const content = (
    <>
      <span className="min-w-0">
        <span className="block text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {index}
        </span>
        <span
          className={cn(
            "mt-1 block truncate text-sm font-medium",
            destructive ? "text-destructive" : "text-foreground",
          )}
        >
          {label}
        </span>
        {description && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {description}
          </span>
        )}
      </span>

      {trailing ??
        (Icon ? (
          <Icon
            className={cn(
              "size-4 shrink-0",
              destructive ? "text-destructive" : "text-muted-foreground",
            )}
          />
        ) : null)}
    </>
  );

  return (
    <div>
      {to ? (
        <MotionLink
          to={to}
          aria-current={isActive ? "page" : undefined}
          className={className}
          onClick={onClick}
          {...springPress}
        >
          {content}
        </MotionLink>
      ) : (
        <motion.button
          type="button"
          className={className}
          onClick={onClick}
          disabled={disabled}
          {...springPress}
        >
          {content}
        </motion.button>
      )}
    </div>
  );
}

function getNextAppearanceMode(appearanceMode: AppearanceMode): AppearanceMode {
  if (appearanceMode === "light") return "dark";
  if (appearanceMode === "dark") return "system";
  return "light";
}

interface ContinueReadingOrbProps {
  recentReading: RecentlyReadBook;
  coverUrl: string | undefined;
  isActive: boolean;
}

/**
 * A circular continuation target inspired by Libby's resume surface. The
 * cover remains the focus while the surrounding card uses the same command
 * typography and restrained press response as the reader tools menu.
 */
function ContinueReadingOrb({
  recentReading,
  coverUrl,
  isActive,
}: ContinueReadingOrbProps) {
  const activityLabel = isActive
    ? "Reading now"
    : `Last read ${formatDistanceToNow(new Date(recentReading.lastRead), {
        addSuffix: true,
      })}`;

  return (
    <motion.div className="px-4 pt-3">
      <ContinueReadingCard
        bookId={recentReading.book.id}
        bookTitle={recentReading.book.title}
        coverUrl={coverUrl}
        activityLabel={activityLabel}
        isActive={isActive}
      />
    </motion.div>
  );
}

export function AppMobileNavigationSheets({
  isOpen,
  onClose,
  activePath,
  recentReading,
  recentBookCoverUrl,
  appearanceMode,
  onAppearanceChange,
  isImporting,
  onAddBook,
  isOnline,
  isSyncing,
  syncLabel,
  syncDetail,
  syncBusyVisible = isSyncing,
  onSync,
  isAuthenticated,
  isAuthLoading,
  user,
  onSignIn,
  onSignOut,
}: AppMobileNavigationSheetsProps) {
  const debugEnabled = useDebugEnabled();
  const [activeSheet, setActiveSheet] =
    useState<MobileNavigationSheet>("navigation");
  const AppearanceIcon =
    appearanceMode === "light"
      ? Sun
      : appearanceMode === "dark"
        ? Moon
        : Monitor;
  const appearanceLabel =
    appearanceMode === "light"
      ? "Light"
      : appearanceMode === "dark"
        ? "Dark"
        : "System";

  useEffect(() => {
    if (!isOpen) setActiveSheet("navigation");
  }, [isOpen]);

  return (
    <SlidingSheet
      open={isOpen}
      onClose={onClose}
      page={activeSheet}
      rootPage="navigation"
      title={activeSheet === "account" ? "Account" : "Reader"}
      onBack={() => setActiveSheet("navigation")}
    >
      {activeSheet === "navigation" && (
        <>
          {recentReading && (
            <ContinueReadingOrb
              recentReading={recentReading}
              coverUrl={recentBookCoverUrl}
              isActive={activePath === `/reader/${recentReading.book.id}`}
            />
          )}

          <div
            className="px-4 py-3"
            style={{
              paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
            }}
          >
            <div className="flex flex-col gap-2">
              {activePath !== "/" && (
                <MobileSheetRow
                  index="01"
                  label="Library"
                  icon={Library}
                  to="/"
                  isActive={activePath === "/"}
                  onClick={onClose}
                />
              )}
              <MobileSheetRow
                index={String(2 - (activePath === "/" ? 1 : 0)).padStart(
                  2,
                  "0",
                )}
                label="Highlights"
                icon={Highlighter}
                to="/highlights"
                isActive={activePath === "/highlights"}
                onClick={onClose}
              />
              <MobileSheetRow
                index={String(3 - (activePath === "/" ? 1 : 0)).padStart(
                  2,
                  "0",
                )}
                label="Sessions"
                icon={Clock3}
                to="/reading-sessions"
                isActive={activePath === "/reading-sessions"}
                onClick={onClose}
              />
              <MobileSheetRow
                index={String(4 - (activePath === "/" ? 1 : 0)).padStart(
                  2,
                  "0",
                )}
                label="Settings"
                icon={Settings}
                to="/settings"
                isActive={activePath === "/settings"}
                onClick={onClose}
              />
              {debugEnabled && (
                <MobileSheetRow
                  index={String(5 - (activePath === "/" ? 1 : 0)).padStart(
                    2,
                    "0",
                  )}
                  label="Performance"
                  icon={Activity}
                  to="/reader-traces"
                  isActive={activePath === "/reader-traces"}
                  onClick={onClose}
                />
              )}
            </div>

            <motion.div className="mt-3 grid w-full grid-cols-3 overflow-hidden rounded-[1.25rem] border border-border/60 bg-secondary/20">
              <SheetUtilityButton
                label="Theme"
                accessibleLabel={`Switch appearance. Current setting: ${appearanceLabel}`}
                onClick={() =>
                  onAppearanceChange(getNextAppearanceMode(appearanceMode))
                }
              >
                <AppearanceIcon className="size-5" aria-hidden="true" />
              </SheetUtilityButton>

              <SheetUtilityButton
                label={isImporting ? "Adding…" : "Add book"}
                accessibleLabel={isImporting ? "Adding book" : "Add book"}
                onClick={onAddBook}
                disabled={isImporting}
                className="border-l border-border/60"
              >
                {isImporting ? (
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                ) : (
                  <BookPlus className="size-5" aria-hidden="true" />
                )}
              </SheetUtilityButton>

              {isAuthLoading ? (
                <SheetUtilityButton
                  label="Account"
                  accessibleLabel="Loading account"
                  disabled
                  className="border-l border-border/60"
                >
                  <Loader2 className="size-5 animate-spin" aria-hidden="true" />
                </SheetUtilityButton>
              ) : isAuthenticated && user ? (
                <SheetUtilityButton
                  label="Account"
                  accessibleLabel={`${user.name || "Account"}, ${user.email}`}
                  onClick={() => setActiveSheet("account")}
                  className="border-l border-border/60"
                >
                  <Avatar className="size-7">
                    <AvatarImage
                      src={user.image || undefined}
                      alt={user.name || "User"}
                    />
                    <AvatarFallback className="text-[10px]">
                      {getUserInitials(user.name)}
                    </AvatarFallback>
                  </Avatar>
                </SheetUtilityButton>
              ) : (
                <SheetUtilityButton
                  label="Sign in"
                  accessibleLabel="Sign in with Google"
                  onClick={() => void onSignIn()}
                  className="border-l border-border/60"
                >
                  <LogIn className="size-5" aria-hidden="true" />
                </SheetUtilityButton>
              )}
            </motion.div>
          </div>
        </>
      )}
      {activeSheet === "account" && user && (
        <div
          className="px-4 pb-4 pt-3"
          style={{
            paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
          }}
        >
          <motion.div className="mb-3 flex items-center gap-3 rounded-[1.25rem] border border-border/60 bg-secondary/20 px-4 py-3">
            <Avatar className="size-11">
              <AvatarImage
                src={user.image || undefined}
                alt={user.name || "User"}
              />
              <AvatarFallback className="text-xs">
                {getUserInitials(user.name)}
              </AvatarFallback>
            </Avatar>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">
                {user.name || "Account"}
              </span>
              <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                {user.email}
              </span>
            </span>
          </motion.div>

          <div className="flex flex-col gap-2">
            <MobileSheetRow
              index="01"
              label="Devices"
              icon={MonitorSmartphone}
              to="/devices"
              isActive={activePath === "/devices"}
              onClick={onClose}
            />
            <MobileSheetRow
              index="02"
              label={
                syncLabel ??
                (isSyncing ? "Syncing…" : isOnline ? "Sync now" : "Offline")
              }
              description={syncDetail}
              icon={syncBusyVisible ? Loader2 : isOnline ? Cloud : CloudOff}
              trailing={
                syncBusyVisible ? (
                  <Loader2 className="size-4 animate-spin text-muted-foreground" />
                ) : undefined
              }
              onClick={() => void onSync()}
              disabled={isSyncing || !isOnline}
            />
            <MobileSheetRow
              index="03"
              label="Sign out"
              icon={LogOut}
              onClick={() => void onSignOut()}
              destructive
            />
          </div>
        </div>
      )}
    </SlidingSheet>
  );
}
