import { Card } from "@/components/ui/card";
import { BackToLibrary } from "@/components/ui/back-to-library";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  openInstallSheet,
  useInstallAvailability,
} from "@/features/install/install-offer";
import { setDebugEnabled, useDebugEnabled } from "@/lib/debug-preference";
import { Bug, SquarePlus } from "lucide-react";
import { Link } from "react-router-dom";

/** Application preferences use the same compact page layout as Devices. */
export function Settings() {
  const debugEnabled = useDebugEnabled();
  const install = useInstallAvailability();
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-16 pb-6 md:px-6 md:py-10">
        <header className="mb-8">
          <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3 md:block">
            <BackToLibrary />
            <h1 className="text-center text-2xl font-bold tracking-tight text-foreground md:text-left">
              Settings
            </h1>
            <div className="size-8 md:hidden" aria-hidden="true" />
          </div>
          <p className="mt-1 text-center text-sm text-muted-foreground md:text-left">
            Preferences for this browser.
          </p>
        </header>
        <section aria-labelledby="device-settings-title">
          <h2
            id="device-settings-title"
            className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 ml-1"
          >
            This device
          </h2>
          <Card className="overflow-hidden px-2 py-2 bg-muted rounded-3xl shadow-none">
            {install.available && (
              <div className="flex items-center gap-4 border-b border-border/70 p-4">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                  <SquarePlus className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground text-sm">
                    Install Reader
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Full screen, your library offline, and one tap to open.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full"
                  onClick={() => openInstallSheet("menu")}
                >
                  Install
                </Button>
              </div>
            )}
            <div className="flex items-center gap-4 p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
                <Bug className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="debug-mode"
                  className="font-medium text-foreground text-sm"
                >
                  Debug mode
                </label>
                <p
                  id="debug-mode-description"
                  className="text-xs text-muted-foreground mt-0.5"
                >
                  Show diagnostic tools and allow performance recording.
                </p>
              </div>
              <Switch
                id="debug-mode"
                aria-describedby="debug-mode-description"
                checked={debugEnabled}
                onCheckedChange={setDebugEnabled}
              />
            </div>
          </Card>
          {debugEnabled && (
            <Link
              to="/debug"
              className="mt-4 block rounded-2xl border border-border p-5 text-sm hover:bg-muted"
            >
              <strong>Debug tools →</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Performance, diagnostics, Elements, design ideas, experiments,
                and Sync Lab.
              </p>
            </Link>
          )}
        </section>
      </div>
    </div>
  );
}
