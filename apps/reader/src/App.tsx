import { MotionConfig } from "motion/react";
import { lazy, Suspense } from "react";
import { AppRouter } from "@/features/sync-lab/AppLocation";
import { Settings } from "@/features/settings/Settings";
import { DebugGate } from "@/features/settings/DebugGate";
import { DebugTools } from "@/features/settings/DebugTools";
import "@/App.css";
import { AppShell } from "@/components/AppShell";
import { Highlights } from "@/features/highlights/Highlights";
import { Library } from "@/features/library/Library";
import { Reader } from "@/features/reader";
import { ReaderDebug } from "@/features/reader/debug";
import { ReaderJumpHistoryDebug } from "@/features/reader/debug/ReaderJumpHistoryDebug";
import { ReaderDiagnostics } from "@/features/reader/diagnostics/ReaderDiagnostics";
import { ReadingSessions } from "@/features/reading-sessions/ReadingSessions";
import { ReaderTraceViewer } from "@/features/reader/diagnostics/ReaderTraceViewer";
import { AppUpdateHost } from "@/features/background-activity/AppUpdateHost";
import { Devices } from "@/features/devices/Devices";
import { Toaster } from "@/components/ui/sonner";
import { EpubImportProvider } from "@/features/library/use-epub-import";
import { ReaderSettingsProvider } from "@/hooks/use-reader-settings";
import { SyncProvider } from "@/hooks/use-sync";
import { useFileUploads } from "@/hooks/use-file-uploads";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigate, Route, Routes } from "react-router-dom";

import { getLabRuntime, registerLabDrain } from "@/features/sync-lab/runtime";

const ReaderChromeDebug = lazy(() =>
  import("@/features/reader/debug/ReaderChromeDebug").then((module) => ({
    default: module.ReaderChromeDebug,
  })),
);

const SheetLab = lazy(() =>
  import("@/features/sheet-lab/SheetLab").then((module) => ({
    default: module.SheetLab,
  })),
);

const NotesLab = lazy(() =>
  import("@/features/notes-lab/NotesLab").then((module) => ({
    default: module.NotesLab,
  })),
);

const Experiments = lazy(() =>
  import("@/features/experiments/Experiments").then((module) => ({
    default: module.Experiments,
  })),
);

const SystemPage = lazy(() =>
  import("@/features/experiments/system/SystemPage").then((module) => ({
    default: module.SystemPage,
  })),
);

const ElementsPage = lazy(() =>
  import("@/features/elements/ElementsPage").then((module) => ({
    default: module.ElementsPage,
  })),
);

const DesignIdeasPage = lazy(() =>
  import("@/features/elements/DesignIdeasPage").then((module) => ({
    default: module.DesignIdeasPage,
  })),
);

const DarkColoursIdea = lazy(() =>
  import("@/features/elements/DarkColoursIdea").then((module) => ({
    default: module.DarkColoursIdea,
  })),
);

const LivingCoversIdea = lazy(() =>
  import("@/features/living-covers/LivingCoversIdea").then((module) => ({
    default: module.LivingCoversIdea,
  })),
);

const FeedbackIdea = lazy(() =>
  import("@/features/elements/FeedbackIdea").then((module) => ({
    default: module.FeedbackIdea,
  })),
);

const SheetMotionIdea = lazy(() =>
  import("@/features/elements/SheetMotionIdea").then((module) => ({
    default: module.SheetMotionIdea,
  })),
);

const ElementsFrame = lazy(() =>
  import("@/features/elements/ElementsFrame").then((module) => ({
    default: module.ElementsFrame,
  })),
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
                          <DebugGate>
                            <DebugTools />
                          </DebugGate>
                        }
                      />
                      <Route
                        path="/reading-sessions"
                        element={<ReadingSessions />}
                      />
                      <Route
                        path="/reader-traces"
                        element={
                          <DebugGate>
                            <ReaderTraceViewer />
                          </DebugGate>
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
                        <DebugGate>
                          <ReaderJumpHistoryDebug />
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/reader/:bookId"
                      element={
                        <DebugGate>
                          <ReaderDebug />
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/chrome-accessories"
                      element={
                        <DebugGate>
                          <Suspense
                            fallback={
                              <div className="p-8 text-sm text-muted-foreground">
                                Loading preview…
                              </div>
                            }
                          >
                            <ReaderChromeDebug />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/notes-lab"
                      element={
                        <DebugGate>
                          <Suspense
                            fallback={
                              <div className="p-8 text-sm text-muted-foreground">
                                Loading Notes Lab…
                              </div>
                            }
                          >
                            <NotesLab />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/experiments"
                      element={
                        <DebugGate>
                          <Suspense
                            fallback={
                              <div className="p-8 text-sm text-muted-foreground">
                                Loading experiments…
                              </div>
                            }
                          >
                            <Experiments />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/experiments/system"
                      element={
                        <DebugGate>
                          <Suspense
                            fallback={
                              <div className="p-8 text-sm text-muted-foreground">
                                Loading prototype…
                              </div>
                            }
                          >
                            <SystemPage />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/elements"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <ElementsPage />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/elements/:topic"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <DesignIdeasPage />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/ideas/dark-colours"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <DarkColoursIdea />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/ideas/living-covers"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <LivingCoversIdea />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/ideas/feedback"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <FeedbackIdea />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/sheet-lab"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <SheetLab />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/ideas/sheet-motion"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <SheetMotionIdea />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/debug/elements/frame/:specimenId"
                      element={
                        <DebugGate>
                          <Suspense fallback={null}>
                            <ElementsFrame />
                          </Suspense>
                        </DebugGate>
                      }
                    />
                    <Route
                      path="/diagnostics/reader"
                      element={
                        <DebugGate>
                          <ReaderDiagnostics />
                        </DebugGate>
                      }
                    />
                  </Routes>
                  <Toaster position="top-center" />
                  {/* Specimen frames show one part; offline notices are noise there. */}
                  {!getLabRuntime() &&
                    !location.pathname.startsWith("/debug/elements/frame/") && (
                      <AppUpdateHost />
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
