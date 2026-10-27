import { MotionConfig } from "motion/react";
import { lazy, Suspense, use, type ComponentType, type ReactNode } from "react";
import { AppRouter } from "@/features/sync-lab/AppLocation";
import { Settings } from "@/features/settings/Settings";
import { DebugGate } from "@/features/settings/DebugGate";
import "@/App.css";
import { AppShell } from "@/components/AppShell";
import { PageLoadBoundary } from "@/components/PageLoadBoundary";
import { Highlights } from "@/features/highlights/Highlights";
import { Library } from "@/features/library/Library";
import { loadReader } from "@/features/reader/load-reader";
import { ReadingSessions } from "@/features/reading-sessions/ReadingSessions";
import { BackgroundActivityHost } from "@/features/background-activity/BackgroundActivityHost";
import { InstallOfferHost } from "@/features/install/InstallOfferHost";
import { hostsInstallOffer } from "@/features/install/install-offer";
import { Devices } from "@/features/devices/Devices";
import { Toaster } from "@/components/ui/sonner";
import { EpubImportProvider } from "@/features/library/use-epub-import";
import { ReaderSettingsProvider } from "@/hooks/use-reader-settings";
import { SyncProvider } from "@/hooks/use-sync";
import { useFileUploads } from "@/hooks/use-file-uploads";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { getLabRuntime, registerLabDrain } from "@/features/sync-lab/runtime";

/** Loads a page's module only when its route renders. */
function lazyPage<Name extends string>(
  load: () => Promise<Record<Name, ComponentType>>,
  name: Name,
) {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}

/**
 * The Reader, out of the bundle the Library paints with (`load-reader.ts`).
 * `use` renders code that has already loaded at once; React.lazy would show
 * its fallback for a moment, then hold the page back by React's 300 ms reveal
 * throttle. With no Suspense boundary above, code still loading keeps the
 * Library on screen.
 */
function ReaderRoute() {
  const { Reader } = use(loadReader());
  return <Reader />;
}

// Debug pages stay out of the bundle that every visit loads.
const DebugTools = lazyPage(
  () => import("@/features/settings/DebugTools"),
  "DebugTools",
);
const ReaderDebug = lazyPage(
  () => import("@/features/reader/debug"),
  "ReaderDebug",
);
const ReaderJumpHistoryDebug = lazyPage(
  () => import("@/features/reader/debug/ReaderJumpHistoryDebug"),
  "ReaderJumpHistoryDebug",
);
const ReaderDiagnostics = lazyPage(
  () => import("@/features/reader/diagnostics/ReaderDiagnostics"),
  "ReaderDiagnostics",
);
const ReaderTraceViewer = lazyPage(
  () => import("@/features/reader/diagnostics/ReaderTraceViewer"),
  "ReaderTraceViewer",
);
const ReaderChromeDebug = lazyPage(
  () => import("@/features/reader/debug/ReaderChromeDebug"),
  "ReaderChromeDebug",
);
const SheetLab = lazyPage(
  () => import("@/features/sheet-lab/SheetLab"),
  "SheetLab",
);
const NotesLab = lazyPage(
  () => import("@/features/notes-lab/NotesLab"),
  "NotesLab",
);
const Experiments = lazyPage(
  () => import("@/features/experiments/Experiments"),
  "Experiments",
);
const SystemPage = lazyPage(
  () => import("@/features/experiments/system/SystemPage"),
  "SystemPage",
);
const BackgroundActivityIdea = lazyPage(
  () => import("@/features/background-activity/ideas/BackgroundActivityIdea"),
  "BackgroundActivityIdea",
);
const ElementsPage = lazyPage(
  () => import("@/features/elements/ElementsPage"),
  "ElementsPage",
);
const DesignIdeasPage = lazyPage(
  () => import("@/features/elements/DesignIdeasPage"),
  "DesignIdeasPage",
);
const DarkColoursIdea = lazyPage(
  () => import("@/features/elements/DarkColoursIdea"),
  "DarkColoursIdea",
);
const LivingCoversIdea = lazyPage(
  () => import("@/features/living-covers/LivingCoversIdea"),
  "LivingCoversIdea",
);
const ArrivingBooksIdea = lazyPage(
  () => import("@/features/arrivals/ArrivingBooksIdea"),
  "ArrivingBooksIdea",
);
const FeedbackIdea = lazyPage(
  () => import("@/features/elements/FeedbackIdea"),
  "FeedbackIdea",
);
const InstallIdea = lazyPage(
  () => import("@/features/install/InstallIdea"),
  "InstallIdea",
);
const SheetMotionIdea = lazyPage(
  () => import("@/features/elements/SheetMotionIdea"),
  "SheetMotionIdea",
);
const SyncHistoryIdea = lazyPage(
  () => import("@/features/sync-history/ideas/SyncHistoryIdea"),
  "SyncHistoryIdea",
);
const ElementsFrame = lazyPage(
  () => import("@/features/elements/ElementsFrame"),
  "ElementsFrame",
);

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Most queries read local data. Network queries must set their own mode.
      networkMode: "always",
    },
  },
});

// A snapshot waits for final checkpoint mutations issued during Reader unmount.
registerLabDrain(
  () =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (queryClient.isMutating() || queryClient.isFetching()) return;
        unsubscribeMutations();
        unsubscribeQueries();
        resolve();
      };
      const unsubscribeMutations = queryClient
        .getMutationCache()
        .subscribe(check);
      const unsubscribeQueries = queryClient.getQueryCache().subscribe(check);
      check();
    }),
);

/**
 * Starts durable file uploads once for the mounted application.
 */
function FileUploadInitializer({ children }: { children: React.ReactNode }) {
  useFileUploads();
  return <>{children}</>;
}

/**
 * A page that needs Debug mode, loaded on demand. The service worker keeps
 * its code after the first visit, so a first visit offline cannot open it.
 */
function DebugPage({
  children,
  loading,
}: {
  children: ReactNode;
  /** Shown while the page loads. */
  loading?: string;
}) {
  return (
    <DebugGate>
      <PageLoadBoundary>
        <Suspense
          fallback={
            loading ? (
              <div className="p-8 text-sm text-muted-foreground">{loading}</div>
            ) : null
          }
        >
          {children}
        </Suspense>
      </PageLoadBoundary>
    </DebugGate>
  );
}

function App() {
  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <ReaderSettingsProvider>
          <SyncProvider>
            <FileUploadInitializer>
              <AppRouter>
                <EpubImportProvider>
                  <Routes>
                    <Route element={<AppShell />}>
                      <Route index element={<Library />} />
                      <Route
                        path="/reader/:bookId"
                        element={
                          <PageLoadBoundary>
                            <ReaderRoute />
                          </PageLoadBoundary>
                        }
                      />
                      <Route path="/highlights" element={<Highlights />} />
                      <Route path="/devices" element={<Devices />} />
                      <Route path="/settings" element={<Settings />} />
                      <Route
                        path="/debug"
                        element={
                          <DebugPage>
                            <DebugTools />
                          </DebugPage>
                        }
                      />
                      <Route
                        path="/reading-sessions"
                        element={<ReadingSessions />}
                      />
                      <Route
                        path="/reader-traces"
                        element={
                          <DebugPage>
                            <ReaderTraceViewer />
                          </DebugPage>
                        }
                      />
                      <Route
                        path="/sessions"
                        element={<Navigate to="/devices" replace />}
                      />
                    </Route>
                    <Route
                      path="/debug/jump-history"
                      element={
                        <DebugPage>
                          <ReaderJumpHistoryDebug />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/reader/:bookId"
                      element={
                        <DebugPage>
                          <ReaderDebug />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/chrome-accessories"
                      element={
                        <DebugPage loading="Loading preview…">
                          <ReaderChromeDebug />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/notes-lab"
                      element={
                        <DebugPage loading="Loading Notes Lab…">
                          <NotesLab />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/experiments"
                      element={
                        <DebugPage loading="Loading experiments…">
                          <Experiments />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/experiments/system"
                      element={
                        <DebugPage loading="Loading prototype…">
                          <SystemPage />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/elements"
                      element={
                        <DebugPage>
                          <ElementsPage />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/elements/:topic"
                      element={
                        <DebugPage>
                          <DesignIdeasPage />
                        </DebugPage>
                      }
                    />
                    {/* Design ideas on the newest topic, from the Library. */}
                    <Route
                      path="/debug/ideas"
                      element={
                        <DebugPage>
                          <DesignIdeasPage />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/dark-colours"
                      element={
                        <DebugPage>
                          <DarkColoursIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/living-covers"
                      element={
                        <DebugPage>
                          <LivingCoversIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/arriving-books"
                      element={
                        <DebugPage>
                          <ArrivingBooksIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/feedback"
                      element={
                        <DebugPage>
                          <FeedbackIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/sheet-lab"
                      element={
                        <DebugPage>
                          <SheetLab />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/background"
                      element={
                        <DebugPage>
                          <BackgroundActivityIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/sheet-motion"
                      element={
                        <DebugPage>
                          <SheetMotionIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/installing"
                      element={
                        <DebugPage>
                          <InstallIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/ideas/sync-history"
                      element={
                        <DebugPage>
                          <SyncHistoryIdea />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/debug/elements/frame/:specimenId"
                      element={
                        <DebugPage>
                          <ElementsFrame />
                        </DebugPage>
                      }
                    />
                    <Route
                      path="/diagnostics/reader"
                      element={
                        <DebugPage>
                          <ReaderDiagnostics />
                        </DebugPage>
                      }
                    />
                  </Routes>
                  <Toaster position="top-center" />
                  {/* Specimen frames show one part; offline notices are noise there. */}
                  {!getLabRuntime() &&
                    !location.pathname.startsWith("/debug/elements/frame/") && (
                      <BackgroundActivityHost />
                    )}
                  {hostsInstallOffer() && <InstallOfferHost />}
                </EpubImportProvider>
              </AppRouter>
            </FileUploadInitializer>
          </SyncProvider>
        </ReaderSettingsProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}

export default App;
