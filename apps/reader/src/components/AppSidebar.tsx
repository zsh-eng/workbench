import {
  getLabRuntime,
  getRuntimeOnline,
  subscribeRuntimeOnline,
} from "@/features/sync-lab/runtime";
import { useDebugEnabled } from "@/lib/debug-preference";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { AppMobileNavigationSheets } from "@/components/AppMobileNavigationSheets";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { useBooksWithStatuses } from "@/hooks/use-books-with-statuses";
import { useSidebarReadingOrder } from "@/hooks/use-sidebar-reading-order";
import { useEpubImport } from "@/features/library/use-epub-import";
import { useLibraryCoverUrls } from "@/hooks/use-library-cover-urls";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { useSyncStatus } from "@/features/sync-status/use-sync-status";
import { files } from "@/lib/files";
import { SyncUnavailableError, useSync } from "@/hooks/use-sync";
import { useToast } from "@/hooks/use-toast";
import { authClient } from "@/lib/auth-client";
import type { Book } from "@/lib/db";
import { findMostRecentlyReadBook } from "@/lib/library-sort";
import { beginReaderTrace } from "@/lib/reader-performance-trace";
import {
  Activity,
  Settings,
  BookOpenText,
  Clock3,
  Cloud,
  CloudOff,
  Highlighter,
  Library,
  Loader2,
  LogIn,
  LogOut,
  MonitorSmartphone,
  Moon,
  MoreVertical,
  Sun,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

function getUserInitials(name: string | null | undefined): string {
  if (!name) return "U";
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

interface ContinueReadingCardProps {
  book: Book;
  coverUrl: string | undefined;
  isActive: boolean;
  lastRead: number;
}

function formatCompactLastRead(lastRead: number): string {
  const elapsedMinutes = Math.max(
    0,
    Math.floor((Date.now() - lastRead) / (60 * 1000)),
  );
  if (elapsedMinutes < 1) return "now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m`;

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h`;

  const elapsedDays = Math.floor(elapsedHours / 24);
  if (elapsedDays < 7) return `${elapsedDays}d`;

  const elapsedWeeks = Math.floor(elapsedDays / 7);
  if (elapsedWeeks < 5) return `${elapsedWeeks}w`;

  const elapsedMonths = Math.floor(elapsedDays / 30);
  if (elapsedMonths < 12) return `${elapsedMonths}mo`;

  return `${Math.floor(elapsedDays / 365)}y`;
}

/** A quiet resume destination for one book in the reading list. */
function ContinueReadingCard({
  book,
  coverUrl,
  isActive,
  lastRead,
}: ContinueReadingCardProps) {
  const activityLabel = isActive ? "now" : formatCompactLastRead(lastRead);

  return (
    <SidebarMenuButton
      render={
        <Link
          to={`/reader/${book.id}`}
          onClick={() =>
            beginReaderTrace({
              bookId: book.id,
              bookTitle: book.title,
              source: "sidebar-continue-reading",
            })
          }
          aria-label={`Continue reading ${book.title}`}
          aria-current={isActive ? "page" : undefined}
          title={`Continue reading ${book.title}`}
        />
      }
      isActive={isActive}
      className="min-h-10 gap-2 px-2.5 py-1.5"
    >
      <span className="flex h-8 w-6 shrink-0 items-center justify-center overflow-hidden rounded-[3px] border border-sidebar-border/80 bg-sidebar-accent">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt=""
            aria-hidden="true"
            className="image-outline size-full object-cover"
          />
        ) : (
          <BookOpenText
            className="size-3.5 text-sidebar-foreground/45"
            aria-hidden="true"
          />
        )}
      </span>

      <span className="flex min-w-0 flex-1 items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-[14px] font-normal">
          {book.title}
        </span>
        <span className="shrink-0 text-[10px] font-normal font-numeric tabular-nums text-muted-foreground">
          {activityLabel}
        </span>
      </span>
    </SidebarMenuButton>
  );
}

export function AppSidebar() {
  const debugEnabled = useDebugEnabled();
  const location = useLocation();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: isAuthLoading } = useAuth();
  const { settings, appearanceMode, setAppearanceMode } = useReaderSettings();
  const { isProcessing: isImporting, openFilePicker } = useEpubImport();
  const { isSyncing, triggerSync } = useSync();
  const syncStatus = useSyncStatus();
  const { data: booksData, refetch: refetchBooks } = useBooksWithStatuses();
  const { isMobile, open, openMobile, setOpen, setOpenMobile } = useSidebar();
  const { toast } = useToast();
  const [isOnline, setIsOnline] = useState(getRuntimeOnline);

  const recentReading = useMemo(() => {
    if (!booksData) return null;
    return findMostRecentlyReadBook(booksData.books, booksData.lastReadByBook);
  }, [booksData]);
  const orderedReadingBooks = useSidebarReadingOrder(
    booksData?.categorized.continueReading ?? [],
    !isMobile && open,
  );
  const continueReadingBooks = useMemo(() => {
    if (!booksData) return [];

    return orderedReadingBooks.map((book) => ({
      book,
      lastRead: booksData.lastReadByBook.get(book.id) ?? book.dateAdded,
    }));
  }, [booksData, orderedReadingBooks]);
  const recentBooks = useMemo(
    () =>
      [
        ...continueReadingBooks.map(({ book }) => book),
        ...(recentReading ? [recentReading.book] : []),
      ].filter(
        (book, index, books) =>
          books.findIndex((candidate) => candidate.id === book.id) === index,
      ),
    [continueReadingBooks, recentReading],
  );
  const { coverUrls } = useLibraryCoverUrls(recentBooks);
  const isSidebarOpen = isMobile ? openMobile : open;
  const recentBookCoverUrl = recentReading
    ? coverUrls.get(recentReading.book.id)
    : undefined;

  const isDarkTheme =
    settings.theme === "dark" ||
    settings.theme === "night" ||
    settings.theme === "flexoki-dark";

  useEffect(() => {
    return subscribeRuntimeOnline(() => setIsOnline(getRuntimeOnline()));
  }, []);

  useEffect(() => {
    if (!isSidebarOpen) return;
    void refetchBooks();
  }, [isSidebarOpen, refetchBooks]);

  useEffect(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, location.pathname, setOpenMobile]);

  const closeSidebar = () => {
    setOpen(false);
    setOpenMobile(false);
  };

  const handleThemeToggle = () => {
    setAppearanceMode(isDarkTheme ? "light" : "dark");
  };

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
      closeSidebar();
      navigate("/");
      toast({
        message: "Signed out.",
      });
    } catch (error) {
      console.error("Error signing out:", error);
      toast({
        message: "Could not sign out.",
        variant: "destructive",
      });
    }
  };

  if (isMobile) {
    return (
      <AppMobileNavigationSheets
        isOpen={openMobile}
        onClose={() => setOpenMobile(false)}
        activePath={location.pathname}
        recentReading={recentReading}
        recentBookCoverUrl={recentBookCoverUrl}
        appearanceMode={appearanceMode}
        onAppearanceChange={setAppearanceMode}
        isImporting={isImporting}
        onAddBook={() => {
          openFilePicker();
          closeSidebar();
        }}
        isOnline={isOnline}
        isSyncing={isSyncing}
        syncLabel={syncStatus.label}
        syncDetail={syncStatus.detail}
        syncBusyVisible={syncStatus.busyVisible}
        onSync={syncStatus.authRequired ? handleGoogleSignIn : handleSync}
        isAuthenticated={isAuthenticated}
        isAuthLoading={isAuthLoading}
        user={user ?? null}
        onSignIn={handleGoogleSignIn}
        onSignOut={handleSignOut}
      />
    );
  }

  return (
    <Sidebar>
      <SidebarHeader className="px-(--sidebar-panel-content-inset) pt-(--sidebar-panel-content-inset) pb-1">
        <div className="flex h-[38px] items-center gap-1">
          <SidebarMenu className="min-w-0 flex-1">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/"}
                className="rounded-tl-(--sidebar-panel-field-radius)"
                render={<Link to="/" />}
              >
                <Library />
                <span>Library</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <SidebarTrigger className="ml-auto size-[38px] rounded-lg rounded-tr-(--sidebar-panel-field-radius) text-sidebar-foreground/50 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground" />
        </div>
      </SidebarHeader>

      <SidebarContent className="min-h-0 overflow-hidden px-3 pt-0 pb-2">
        <SidebarGroup className="min-h-0 flex-1">
          <SidebarMenu className="shrink-0">
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/highlights"}
                render={<Link to="/highlights" />}
              >
                <Highlighter />
                <span>Highlights</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                isActive={location.pathname === "/reading-sessions"}
                render={<Link to="/reading-sessions" />}
              >
                <Clock3 />
                <span>Sessions</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            {debugEnabled && (
              <SidebarMenuItem>
                <SidebarMenuButton
                  isActive={location.pathname === "/reader-traces"}
                  render={<Link to="/reader-traces" />}
                >
                  <Activity />
                  <span>Performance</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>

          {continueReadingBooks.length > 0 && (
            <>
              <SidebarSeparator className="my-3 shrink-0" />
              <div className="flex min-h-0 flex-1 flex-col px-1">
                <p className="mb-2 shrink-0 px-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Continue reading
                </p>
                <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
                  {continueReadingBooks.map(({ book, lastRead }) => (
                    <ContinueReadingCard
                      key={book.id}
                      book={book}
                      coverUrl={coverUrls.get(book.id)}
                      lastRead={lastRead}
                      isActive={location.pathname === `/reader/${book.id}`}
                    />
                  ))}
                </div>
              </div>
            </>
          )}
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="gap-2 px-(--sidebar-panel-content-inset) pt-2 pb-(--sidebar-panel-content-inset)">
        <SidebarSeparator className="mb-1" />
        <SidebarMenu className="pt-1">
          <SidebarMenuItem>
            <SidebarMenuButton
              isActive={location.pathname === "/settings"}
              render={<Link to="/settings" />}
            >
              <Settings />
              <span>Settings</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              onClick={handleThemeToggle}
              aria-label={
                isDarkTheme ? "Switch to light theme" : "Switch to dark theme"
              }
            >
              {isDarkTheme ? <Sun /> : <Moon />}
              <span>Toggle theme</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {isAuthenticated && (
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() =>
                  void (syncStatus.authRequired
                    ? handleGoogleSignIn()
                    : handleSync())
                }
                disabled={isSyncing || !isOnline}
                aria-label={
                  syncStatus.authRequired
                    ? "Sign in again"
                    : `Sync now: ${syncStatus.label}`
                }
                title={syncStatus.detail}
              >
                {syncStatus.busyVisible ? (
                  <Loader2 className="animate-spin" />
                ) : isOnline ? (
                  <Cloud />
                ) : (
                  <CloudOff />
                )}
                <span>{syncStatus.label}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          )}
        </SidebarMenu>

        <SidebarSeparator className="my-1" />

        {isAuthLoading ? (
          <div className="flex h-13 items-center gap-2.5 px-2.5">
            <Skeleton className="size-8 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ) : isAuthenticated && user ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-2.5 rounded-xl rounded-b-(--sidebar-panel-field-radius) px-2.5 py-2 text-left outline-none transition-[background-color,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-sidebar-accent/70 data-[popup-open]:bg-sidebar-accent/70 focus-visible:bg-sidebar-accent/70 active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-sidebar-ring motion-reduce:active:scale-100"
                />
              }
            >
              <Avatar className="size-8">
                <AvatarImage
                  src={user.image || undefined}
                  alt={user.name || "User"}
                />
                <AvatarFallback className="text-xs">
                  {getUserInitials(user.name)}
                </AvatarFallback>
              </Avatar>
              <span className="min-w-0 flex-1">
                <span
                  className="block truncate text-sm font-medium leading-[18px]"
                  title={user.name}
                >
                  {user.name}
                </span>
                <span className="block truncate text-xs leading-[18px] text-muted-foreground">
                  {user.email}
                </span>
              </span>
              <MoreVertical className="size-3.5 shrink-0 text-sidebar-foreground/45" />
            </DropdownMenuTrigger>
            <DropdownMenuContent side="right" align="end" className="w-56">
              <DropdownMenuItem render={<Link to="/devices" />}>
                <MonitorSmartphone />
                Devices
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void handleSignOut()}>
                <LogOut />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                className="rounded-b-(--sidebar-panel-field-radius)"
                onClick={() => void handleGoogleSignIn()}
              >
                <LogIn />
                <span>Sign in with Google</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        )}
      </SidebarFooter>
    </Sidebar>
  );
}
