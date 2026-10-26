import { SyncBoundary } from "@/components/sync-status";
import ImagesActivityPill from "@/components/images/images-activity-pill";
import CommandBar from "@/components/nav/command-bar";
import NavBar from "@/components/nav/nav-bar.tsx";
import { SpacedIcon } from "@/components/nav/spaced-icon";
import SessionExpiredBanner from "@/components/session-expired-banner";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner.tsx";
import UpdatePill, { UpdateHost } from "@/components/update-pill";
import SyncEngine from "@/lib/sync/engine.ts";
import { cn } from "@/lib/utils.ts";
import AllCardsRoute from "@/routes/AllCardsRoute";
import CreateFlashcardRoute from "@/routes/CreateFlashcardRoute.tsx";
import DeckRoute from "@/routes/DeckRoute.tsx";
import DecksRoute from "@/routes/DecksRoute.tsx";
import ImagesRoute from "@/routes/ImagesRoute";
import ImportRoute from "@/routes/ImportRoute";
import LoginSuccessRoute from "@/routes/LoginSuccessRoute";
import ProfileRoute from "@/routes/ProfileRoute";
import ReviewRoute from "@/routes/Review.tsx";
import SavedRoute from "@/routes/SavedRoute";
import SuspendedCardsRoute from "@/routes/SuspendedCardsRoute";
import { useMediaQuery } from "@uidotdev/usehooks";
import { CircleAlert, CircleCheck } from "lucide-react";
import { lazy, Suspense } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import "./index.css";

const ElementsRoutes = lazy(() => import("@/elements/ElementsRoutes"));
// Stats is the only screen with charts, so the charts load with it.
const StatsRoute = lazy(() => import("@/routes/StatsRoute"));

// The Elements page and its frames show sample data, so they do not sync.
if (!location.pathname.startsWith("/debug/elements")) SyncEngine.start();
export default function App() {
  const isMobile = useMediaQuery("(max-width: 640px)");

  return (
    <BrowserRouter>
      <ThemeProvider>
        <Toaster
          position={isMobile ? "top-center" : "top-right"}
          icons={{
            success: <CircleCheck className="text-primary size-5" />,
            error: <CircleAlert className="text-destructive size-5" />,
            // close: <X className='text-muted-foreground size-3' />,
          }}
          theme="light"
          // Sonner's own z-index is far above every layer; use the scale.
          style={{ zIndex: "var(--z-index-toast)" }}
          toastOptions={{
            closeButton: true,
            duration: 2000,
            unstyled: true,
            classNames: {
              toast:
                "bg-background rounded-xl w-80 py-4 pl-5 pr-4 shadow-sm flex gap-2 items-center",
              title: "text-sm",
              description: "text-xs",
              icon: "size-4",
              actionButton:
                "ml-auto shrink-0 text-xs font-semibold px-3 py-2 bg-primary text-primary-foreground rounded-md cursor-pointer active:scale-95 transition-all",
            },
          }}
        />
        <Routes>
          <Route
            path="/debug/elements/*"
            element={
              <Suspense fallback={null}>
                <ElementsRoutes />
              </Suspense>
            }
          />
          <Route path="*" element={<AppShell />} />
        </Routes>
      </ThemeProvider>
    </BrowserRouter>
  );
}

function AppShell() {
  return (
    <div className="font-sans antialiased">
      <CommandBar />
      <SpacedIcon />
      <NavBar />
      <SessionExpiredBanner />
      <ImagesActivityPill />
      <UpdateHost />
      <UpdatePill />
      {/* The content layer: nothing that a page stacks rises above the chrome. */}
      <main
        className={cn(
          "isolate grid grid-cols-12 gap-x-6 items-start",
          "px-2 md:px-0 pt-20 md:pt-8 pb-(--tabbar-space) md:pb-12",
          "min-h-screen grid-rows-[min-content_1fr]",
          "bg-muted dark:bg-background",
        )}
      >
        <SyncBoundary>
          <Routes>
            <Route path="/" element={<ReviewRoute />} />
            <Route path="/decks" element={<DecksRoute />} />
            <Route path="/decks/_all" element={<AllCardsRoute />} />
            <Route path="/decks/_suspended" element={<SuspendedCardsRoute />} />
            <Route path="/decks/:deckId" element={<DeckRoute />} />
            <Route path="/saved" element={<SavedRoute />} />
            {/* <Route path='/debug' element={<DebugRoute />} /> */}
            <Route path="/create" element={<CreateFlashcardRoute />} />
            <Route path="/profile" element={<ProfileRoute />} />
            <Route
              path="/stats"
              element={
                <Suspense fallback={null}>
                  <StatsRoute />
                </Suspense>
              }
            />
            <Route path="/login-success" element={<LoginSuccessRoute />} />
            <Route path="/import" element={<ImportRoute />} />

            <Route path="/images" element={<ImagesRoute />} />
          </Routes>
        </SyncBoundary>
      </main>
    </div>
  );
}
