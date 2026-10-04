import { MotionConfig } from "motion/react";
import { lazy, Suspense } from "react";
import { AppRouter } from "@/features/sync-lab/AppLocation";
import { Settings } from "@/features/settings/Settings";
import { DebugGate } from "@/features/settings/DebugGate";
import "@/App.css";
import { AppShell } from "@/components/AppShell";
import { HighlightsMasonry } from "@/features/highlights/HighlightsMasonry";
import { Library } from "@/features/library/Library";
import { Reader } from "@/features/reader";
import { ReaderDebug } from "@/features/reader/debug";
import { ReaderJumpHistoryDebug } from "@/features/reader/debug/ReaderJumpHistoryDebug";
import { ReaderDiagnostics } from "@/features/reader/diagnostics/ReaderDiagnostics";
import { ReadingSessions } from "@/features/reading-sessions/ReadingSessions";
import { ReaderTraceViewer } from "@/features/reader/diagnostics/ReaderTraceViewer";
import { ReloadPrompt } from "@/components/ReloadPrompt";
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

const NotesLab = lazy(() =>
  import("@/features/notes-lab/NotesLab").then((module) => ({
    default: module.NotesLab,
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
                    <Route path="/highlights" element={<HighlightsMasonry />} />
                    <Route path="/devices" element={<Devices />} />
                    <Route path="/settings" element={<Settings />} />
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
                    path="/diagnostics/reader"
                    element={
                      <DebugGate>
                        <ReaderDiagnostics />
                      </DebugGate>
                    }
                  />
                </Routes>
                <Toaster position="top-right" />
                {!getLabRuntime() && <ReloadPrompt />}
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
