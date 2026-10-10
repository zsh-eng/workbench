import { Card } from "@/components/ui/card";
import { MobileBackToLibrary } from "@/components/ui/mobile-back-to-library";
import { Switch } from "@/components/ui/switch";
import { setDebugEnabled, useDebugEnabled } from "@/lib/debug-preference";
import { getLabRuntime } from "@/features/sync-lab/runtime";
import { Bug } from "lucide-react";
import { Link } from "react-router-dom";

/** Application preferences use the same compact page layout as Devices. */
export function Settings() {
  const debugEnabled = useDebugEnabled();
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 pt-16 pb-6 md:px-6 md:py-10">
        <header className="mb-8">
          <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3 md:block">
            <MobileBackToLibrary />
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
              to="/debug/elements"
              className="mt-4 block rounded-2xl border border-border p-5 text-sm hover:bg-muted"
            >
              <strong>Elements →</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                See Reader parts and the Library on desktop and phone side by
                side, try their states, and compare Library ideas.
              </p>
            </Link>
          )}
          {debugEnabled && (
            <Link
              to="/debug/jump-history"
              className="mt-4 block rounded-2xl border border-border p-5 text-sm hover:bg-muted"
            >
              <strong>Jump history playground →</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Run jumps, step through examples, and inspect the history array.
              </p>
            </Link>
          )}
          {debugEnabled && (
            <Link
              to="/debug/chrome-accessories"
              className="mt-4 block rounded-2xl border border-border p-5 text-sm hover:bg-muted"
            >
              <strong>Chrome accessories playground →</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Try desktop reading and sync prompts, appearance, and dismissal.
              </p>
            </Link>
          )}
          {debugEnabled && (
            <Link
              to="/debug/notes-lab"
              className="mt-4 block rounded-2xl border border-border p-5 text-sm hover:bg-muted"
            >
              <strong>Notes Lab →</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Compare prototypes for capturing, writing, and revisiting notes.
              </p>
            </Link>
          )}
          {debugEnabled && (
            <Link
              to="/debug/experiments"
              className="mt-4 block rounded-2xl border border-border p-5 text-sm hover:bg-muted"
            >
              <strong>Design experiments →</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Browse interactive studies for the Reader, Library, Highlights,
                and Sessions.
              </p>
            </Link>
          )}
          {debugEnabled && !getLabRuntime() && (
            <a
              href="/debug/sync"
              className="mt-4 block rounded-2xl border border-border p-5 text-sm hover:bg-muted"
            >
              <strong>Sync Lab →</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                Spawn isolated clients, inspect sync, and test offline changes.
              </p>
            </a>
          )}
        </section>
      </div>
    </div>
  );
}
