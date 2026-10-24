import { cn } from "@/lib/utils";
import { useActiveSection } from "@workbench/elements/react";
import { useMediaQuery } from "@uidotdev/usehooks";
import { ArrowLeft, MoonIcon, SunIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Choice } from "./Choice";
import {
  previewTheme,
  StageContext,
  type FrameZoom,
  type InlineZoom,
  type StageSettings,
} from "./stage";

const STAGE_KEY = "spaced-elements-stage";

const THEMES = [
  { id: "light", label: "Light", icon: <SunIcon aria-hidden="true" /> },
  { id: "dark", label: "Dark", icon: <MoonIcon aria-hidden="true" /> },
] as const;

const ZOOMS = [
  { id: "1", label: "1×" },
  { id: "2", label: "2×" },
  { id: "3", label: "3×" },
] as const;

const FRAME_ZOOMS = [
  { id: "fit", label: "Fit" },
  { id: "actual", label: "100%" },
] as const;

function readStage(): StageSettings {
  const applied = document.documentElement.classList.contains("dark")
    ? "dark"
    : "light";
  try {
    const saved = JSON.parse(localStorage.getItem(STAGE_KEY) ?? "{}");
    return {
      theme:
        saved.theme === "dark" || saved.theme === "light"
          ? saved.theme
          : applied,
      zoom: ["1", "2", "3"].includes(saved.zoom) ? saved.zoom : "1",
      frameZoom: saved.frameZoom === "actual" ? "actual" : "fit",
    };
  } catch {
    return { theme: applied, zoom: "1", frameZoom: "fit" };
  }
}

/**
 * The frame of the Elements page: a bar with the theme preview and zoom,
 * section navigation that follows the scroll, and the sections. The theme
 * here is a preview on this page and in its frames; the app keeps its saved
 * theme.
 */
export function ElementsLayout({
  sections,
  children,
}: {
  sections: readonly { id: string; label: string }[];
  children: ReactNode;
}) {
  const [stage, setStage] = useState(readStage);
  const narrow = useMediaQuery("(max-width: 767px)");
  const current = useActiveSection(
    sections.map((section) => section.id),
    narrow ? 112 : 64,
  );

  useEffect(() => {
    try {
      localStorage.setItem(STAGE_KEY, JSON.stringify(stage));
    } catch {
      // A blocked store only forgets the choice.
    }
  }, [stage]);

  useLayoutEffect(() => previewTheme(document, stage.theme), [stage.theme]);

  useEffect(() => {
    document.title = "Elements · Spaced";
    // The sections render after the route loads, so follow a #section link
    // once they exist.
    const target =
      location.hash && document.getElementById(location.hash.slice(1));
    if (target) target.scrollIntoView({ block: "start" });
  }, []);

  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  const zoomChoice = (
    <Choice
      label="Zoom"
      value={stage.zoom}
      options={ZOOMS}
      onChange={(zoom: InlineZoom) => setStage((value) => ({ ...value, zoom }))}
    />
  );

  return (
    <StageContext.Provider value={stage}>
      <div className="min-h-svh bg-background text-foreground">
        <header className="sticky top-0 z-sticky border-b border-border bg-background/90 backdrop-blur">
          <div className="flex h-12 items-center gap-2 px-4">
            <a
              href="/"
              aria-label="Back to Spaced"
              title="Back to Spaced"
              className="-ml-1.5 grid size-8 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </a>
            <h1 className="text-sm font-semibold">Elements</h1>
            <span className="flex-1" />
            <Choice
              label="Theme preview"
              value={stage.theme}
              options={THEMES}
              onChange={(theme) => setStage((value) => ({ ...value, theme }))}
            />
            <div className="hidden items-center gap-2 md:flex">
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
              <span className="text-xs text-muted-foreground">Zoom</span>
              {zoomChoice}
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
              <span className="text-xs text-muted-foreground">Frames</span>
              <Choice
                label="Frame zoom"
                value={stage.frameZoom}
                options={FRAME_ZOOMS}
                onChange={(frameZoom: FrameZoom) =>
                  setStage((value) => ({ ...value, frameZoom }))
                }
              />
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-border px-4 py-2 md:hidden">
            <label htmlFor="elements-section" className="sr-only">
              Section
            </label>
            <select
              id="elements-section"
              value={current}
              onChange={(event) => jump(event.target.value)}
              className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              {sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.label}
                </option>
              ))}
            </select>
            {zoomChoice}
          </div>
        </header>
        <div className="mx-auto grid max-w-[90rem] gap-8 px-4 md:grid-cols-[11rem_minmax(0,1fr)] md:px-6">
          <nav
            aria-label="Sections"
            className="sticky top-12 hidden flex-col gap-0.5 self-start pt-8 md:flex"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                aria-current={current === section.id ? "location" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1.5 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                  current === section.id && "bg-muted text-foreground",
                )}
              >
                {section.label}
              </a>
            ))}
            <p className="mt-4 px-2.5 text-xs text-muted-foreground">
              The theme here is a preview. The app keeps its saved theme.
            </p>
          </nav>
          <main className="min-w-0 space-y-16 pt-6 pb-24 md:pt-8">
            {children}
          </main>
        </div>
      </div>
    </StageContext.Provider>
  );
}

/** A titled group of specimens with an anchor for the section navigation. */
export function ElementsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-28 md:scroll-mt-16"
    >
      <div className="mb-5 max-w-2xl">
        <h2 id={`${id}-title`} className="text-lg font-semibold">
          {title}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-12">{children}</div>
    </section>
  );
}
