import { MotionConfig } from "motion/react";
import { lazy, Suspense, type ComponentType, type ReactNode } from "react";
import { AppRouter } from "@/features/sync-lab/AppLocation";
import { Settings } from "@/features/settings/Settings";
import { DebugGate } from "@/features/settings/DebugGate";
import "@/App.css";
import { AppShell } from "@/components/AppShell";
import { Highlights } from "@/features/highlights/Highlights";
import { Library } from "@/features/library/Library";
import { Reader } from "@/features/reader";
import { ReadingSessions } from "@/features/reading-sessions/ReadingSessions";
import { BackgroundActivityHost } from "@/features/background-activity/BackgroundActivityHost";
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
const FeedbackIdea = lazyPage(
  () => import("@/features/elements/FeedbackIdea"),
  "FeedbackIdea",
);
const SheetMotionIdea = lazyPage(
  () => import("@/features/elements/SheetMotionIdea"),
  "SheetMotionIdea",
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

/** A page that needs Debug mode, loaded on demand. */
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
      <Suspense
        fallback={
          loading ? (
            <div className="p-8 text-sm text-muted-foreground">{loading}</div>
          ) : null
        }
      >
        {children}
      </Suspense>
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
                      <Route path="/reader/:bookId" element={<Reader />} />
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
                        <DebugGate>
                          <Suspense fallback={null}>
                            <BackgroundActivityIdea />
                          </Suspense>
                        </DebugGate>
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
