import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowLeft,
  Bookmark,
  PanelLeft,
  PanelRight,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { ReadingStatusChangeMessage } from "@/components/ReadingStatusChangeMessage";
import { cn } from "@/lib/utils";
import {
  ReaderChromeAccessory,
  type ChromePromptAppearance,
  type ChromePromptKind,
} from "../ReaderChromeAccessory";
import { getReaderStatusPrompt } from "../hooks/use-reader-status-prompt";
import { ReaderDesktopToolbar } from "../ReaderDesktopToolbar";

const fieldClass =
  "h-9 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring sm:text-sm";
const iconClass =
  "grid size-9 shrink-0 place-items-center rounded-xl text-muted-foreground";
const scenarios = {
  reading: { label: "Reading status", queue: ["reading"] },
  handoff: { label: "Sync handoff", queue: ["handoff"] },
  both: { label: "Both queued", queue: ["handoff", "reading"] },
} satisfies Record<string, { label: string; queue: ChromePromptKind[] }>;
type Scenario = keyof typeof scenarios;

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs text-muted-foreground">
      {label}
      {children}
    </label>
  );
}

/** Isolated desktop chrome experiment. All decisions and reading positions live
 * in component state; nothing is written to real books, sync, or preferences. */
export function ReaderChromeDebug() {
  const [scenario, setScenario] = useState<Scenario>("reading");
  const [pending, setPending] = useState<ChromePromptKind[]>(["reading"]);
  const [appearance, setAppearance] = useState<ChromePromptAppearance>("soft");
  const [theme, setTheme] = useState("flexoki-light");
  const [width, setWidth] = useState("1280");
  const [bookTitle, setBookTitle] = useState("The Art of Paying Attention");
  const [deviceName, setDeviceName] = useState("MacBook Pro");
  const [targetPage, setTargetPage] = useState(84);
  const [previousStatus, setPreviousStatus] = useState<
    "none" | "want-to-read" | "dnf"
  >("none");
  const readingPrompt = getReaderStatusPrompt(
    previousStatus === "none" ? null : previousStatus,
  );
  const [page, setPage] = useState(42);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [showChrome, setShowChrome] = useState(false);
  const [result, setResult] = useState(
    "Move into the page. The prompt keeps the top chrome visible.",
  );
  const active = pending[0];
  const normalChrome = hovered || focused || showChrome;
  const topVisible = active === "reading" || normalChrome;

  function replay(next = scenario) {
    setScenario(next);
    setPending([...scenarios[next].queue]);
    setPage(42);
    setShowChrome(false);
    setResult("Move into the page. The prompt keeps the top chrome visible.");
  }
  function decide(confirmed: boolean) {
    if (!active) return;
    if (confirmed && active === "handoff") setPage(targetPage);
    if (confirmed && active === "reading")
      toast.success(
        <ReadingStatusChangeMessage
          previousStatus={previousStatus === "none" ? null : previousStatus}
          status="reading"
        />,
      );
    setPending((queue) => queue.slice(1));
    setFocused(false);
    setShowChrome(false);
    setResult(
      confirmed
        ? active === "handoff"
          ? `Jumped to page ${targetPage}.`
          : "Book marked as currently reading."
        : active === "handoff"
          ? "Sync prompt dismissed. Your page is unchanged."
          : "Reading status prompt dismissed. Book status is unchanged.",
    );
  }

  return (
    <main className="min-h-dvh bg-background px-4 py-6 text-foreground sm:px-8">
      <div className="mx-auto max-w-[1440px] space-y-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <Link
              to="/settings"
              className="mb-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="size-3.5" /> Settings
            </Link>
            <h1 className="text-2xl font-semibold tracking-tight">
              Chrome accessories
            </h1>
            <p className="mt-1.5 text-sm text-muted-foreground">
              A desktop preview. Choose a prompt, then act or dismiss it.
            </p>
          </div>
          <Button
            variant="secondary"
            className="rounded-xl"
            onClick={() => replay()}
          >
            <RotateCcw /> Replay prompt
          </Button>
        </header>
        <section aria-label="Preview controls" className="space-y-4">
          <div className="flex flex-wrap items-center gap-4">
            <div
              className="inline-flex flex-wrap gap-1 rounded-2xl bg-secondary/60 p-1"
              aria-label="Prompt scenario"
              role="group"
            >
              {Object.entries(scenarios).map(([key, value]) => (
                <Button
                  key={key}
                  variant="ghost"
                  size="sm"
                  aria-pressed={scenario === key}
                  onClick={() => replay(key as Scenario)}
                  className={cn(
                    "rounded-xl",
                    scenario === key && "bg-background hover:bg-background",
                  )}
                >
                  {value.label}
                </Button>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">
              Both queued shows sync first, then reading status.
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Field label="Appearance">
              <select
                className={fieldClass}
                value={appearance}
                onChange={(event) =>
                  setAppearance(event.target.value as ChromePromptAppearance)
                }
              >
                <option value="soft">Soft surface</option>
                <option value="minimal">Minimal</option>
                <option value="outline">Outline</option>
              </select>
            </Field>
            <Field label="Preview theme">
              <select
                className={fieldClass}
                value={theme}
                onChange={(event) => setTheme(event.target.value)}
              >
                <option value="flexoki-light">Paper</option>
                <option value="light">Light</option>
                <option value="night">Night</option>
              </select>
            </Field>
            <Field label="Preview width">
              <select
                className={fieldClass}
                value={width}
                onChange={(event) => setWidth(event.target.value)}
              >
                <option value="1280">Wide · 1280 px</option>
                <option value="960">Compact · 960 px</option>
                <option value="768">Small · 768 px</option>
              </select>
            </Field>
            <Field label="Book title">
              <input
                className={fieldClass}
                value={bookTitle}
                onChange={(event) => setBookTitle(event.target.value)}
              />
            </Field>
            <Field label="Source device">
              <input
                className={fieldClass}
                value={deviceName}
                onChange={(event) => setDeviceName(event.target.value)}
              />
            </Field>
            <Field label="Sync target page">
              <input
                className={fieldClass}
                type="number"
                min={1}
                max={240}
                value={targetPage}
                onChange={(event) =>
                  setTargetPage(
                    Math.max(1, Math.min(240, Number(event.target.value))),
                  )
                }
              />
            </Field>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
            <label className="flex items-center gap-2 whitespace-nowrap text-muted-foreground">
              Previous status
              <select
                className={fieldClass}
                value={previousStatus}
                onChange={(event) =>
                  setPreviousStatus(event.target.value as typeof previousStatus)
                }
              >
                <option value="none">No status</option>
                <option value="want-to-read">Want to read</option>
                <option value="dnf">Did not finish</option>
              </select>
            </label>
            <div className="flex items-center gap-3">
              <span
                data-testid="chrome-preview-state"
                className="text-muted-foreground"
              >
                {active
                  ? "Top chrome stays visible until you decide"
                  : "No pending prompts · normal chrome behavior"}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="rounded-xl"
                onClick={() => setShowChrome((shown) => !shown)}
              >
                {showChrome ? "Hide chrome" : "Reveal chrome"}
              </Button>
            </div>
          </div>
        </section>
        <div className="overflow-x-auto pb-1">
          <div
            data-testid="chrome-preview"
            className={cn(
              theme,
              "relative mx-auto h-[540px] min-w-[768px] overflow-hidden rounded-(--sidebar-panel-radius) border border-border bg-background text-foreground",
            )}
            style={{
              width: "100%",
              maxWidth: Number(width),
              colorScheme: theme === "night" ? "dark" : "light",
            }}
          >
            <div
              className="absolute inset-x-0 top-0 z-10 h-3"
              aria-hidden="true"
              onPointerEnter={() => setHovered(true)}
            />
            <header
              data-testid="chrome-preview-header"
              className="absolute inset-x-0 top-0 z-20 bg-background/90 backdrop-blur-xl transition-opacity duration-150 motion-reduce:transition-none"
              style={{
                opacity: topVisible ? 1 : 0,
                pointerEvents: topVisible ? "auto" : "none",
              }}
              inert={!topVisible}
              aria-hidden={!topVisible}
              onPointerEnter={() => setHovered(true)}
              onPointerLeave={() => setHovered(false)}
              onFocus={() => setFocused(true)}
              onBlur={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget))
                  setFocused(false);
              }}
            >
              <ReaderDesktopToolbar
                bookTitle={bookTitle}
                navigation={
                  <span className={iconClass} aria-hidden="true">
                    <PanelLeft className="size-[1.15rem]" />
                  </span>
                }
                accessory={
                  active === "reading" &&
                  readingPrompt && (
                    <ReaderChromeAccessory
                      kind="reading"
                      appearance={appearance}
                      prompt={{
                        ...readingPrompt,
                        isPending: false,
                        error: "",
                        onConfirm: () => decide(true),
                        onDismiss: () => decide(false),
                      }}
                    />
                  )
                }
                actions={
                  <>
                    <span
                      data-testid="chrome-preview-bookmark"
                      className={iconClass}
                      aria-hidden="true"
                    >
                      <Bookmark className="size-[1.15rem]" />
                    </span>
                    <span className={iconClass} aria-hidden="true">
                      <PanelRight className="size-[1.15rem]" />
                    </span>
                  </>
                }
              />
            </header>
            <section
              aria-label="Reading preview"
              tabIndex={0}
              onPointerEnter={() => setHovered(false)}
              onPointerDown={() => setShowChrome(false)}
              className="h-full overflow-y-auto px-14 pt-24 pb-20 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            >
              <div className="mx-auto grid max-w-5xl grid-cols-2 gap-16 font-serif text-[19px] leading-relaxed">
                <div>
                  <p className="mb-5 text-xs font-sans uppercase tracking-[0.16em] text-muted-foreground">
                    Chapter four
                  </p>
                  <h2 className="mb-5 text-3xl font-medium">
                    A little room for attention
                  </h2>
                  <p>
                    Some books ask you to hurry. Others seem to slow the room
                    around you. A sentence catches your eye, and for a moment
                    the next page can wait.
                  </p>
                  <p className="mt-5">
                    Outside the window, the afternoon carries on. You turn back
                    a few lines to find the thought that made you pause. This
                    time, you read it differently.
                  </p>
                </div>
                <div>
                  <p>
                    The useful details are often the quiet ones. A mark left
                    beside a paragraph. The place where you stopped last night.
                    A thought you would like to keep before it disappears.
                  </p>
                  <p className="mt-5">
                    They should be there when you need them, with enough space
                    to make a choice. Once that choice is made, the page belongs
                    to the book again.
                  </p>
                  <p className="mt-5">
                    You settle into the chair and continue. There is no need to
                    remember the page number. There is only the next sentence,
                    and the time to notice it.
                  </p>
                </div>
              </div>
            </section>
            {active === "handoff" && (
              // The handoff sits above the footer, as in the Reader.
              <div
                className="absolute inset-x-0 z-30 flex justify-center transition-[bottom] duration-150 motion-reduce:transition-none"
                style={{ bottom: normalChrome ? 64 : 12 }}
              >
                <ReaderChromeAccessory
                  kind="handoff"
                  placement="foot"
                  currentPage={page}
                  prompt={{
                    source: { words: deviceName, type: "desktop" },
                    targetPage,
                    onJump: () => decide(true),
                    onDismiss: () => decide(false),
                  }}
                />
              </div>
            )}
            <footer
              data-testid="chrome-preview-footer"
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 bottom-0 flex h-14 items-center justify-between bg-background/90 px-6 text-xs text-muted-foreground backdrop-blur-xl transition-opacity duration-150 motion-reduce:transition-none"
              style={{ opacity: normalChrome ? 1 : 0 }}
            >
              <span>Chapter four</span>
              <span className="tabular-nums">p. {page} of 240</span>
              <span>9 pages left</span>
            </footer>
          </div>
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3 text-xs text-muted-foreground">
          <p role="status" aria-live="polite">
            {result}{" "}
            {pending.length > 0
              ? `${pending.length} prompt${pending.length > 1 ? "s" : ""} remaining.`
              : "Move into the page to let the chrome hide."}
          </p>
          <span
            data-testid="chrome-preview-page"
            className="shrink-0 tabular-nums"
          >
            Preview page {page} / 240
          </span>
        </div>
        <p className="text-xs text-muted-foreground/80">
          Preview only. These controls do not change a book, reading status,
          sync position, or saved theme.
        </p>
      </div>
    </main>
  );
}
