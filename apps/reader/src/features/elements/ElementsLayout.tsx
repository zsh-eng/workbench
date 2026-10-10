import { cn } from "@/lib/utils";
import { THEME_CLASSES, type ReaderTheme } from "@/types/reader.types";
import { ArrowLeft } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { StageContext, type StageSettings } from "./DeviceFrame";

const STAGE_KEY = "reader-elements-stage";

function readStage(): StageSettings {
  const appTheme =
    THEME_CLASSES.find((theme) =>
      document.documentElement.classList.contains(theme),
    ) ?? "light";
  try {
    const saved = JSON.parse(localStorage.getItem(STAGE_KEY) ?? "{}");
    return {
      theme: THEME_CLASSES.includes(saved.theme) ? saved.theme : appTheme,
      zoom: saved.zoom === "actual" ? "actual" : "fit",
    };
  } catch {
    return { theme: appTheme, zoom: "fit" };
  }
}

/** A row of buttons that act as one choice. */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex flex-wrap items-center gap-1"
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className="h-8 rounded-full px-3 text-xs text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-secondary aria-pressed:font-medium aria-pressed:text-foreground"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const THEME_LABELS: Record<ReaderTheme, string> = {
  light: "Light",
  dark: "Dark",
  night: "Night",
  "flexoki-light": "Flexoki light",
  "flexoki-dark": "Flexoki dark",
};

/**
 * The frame for the Elements and Library ideas pages: a bar with the frame
 * theme and zoom, section navigation, and the content. Built for desktop.
 * The theme here previews frames only; the app keeps its saved theme.
 */
export function ElementsLayout({
  page,
  sections,
  children,
}: {
  page: "elements" | "library";
  sections: readonly { id: string; label: string }[];
  children: ReactNode;
}) {
  const [stage, setStage] = useState(readStage);
  const [current, setCurrent] = useState(sections[0]?.id);
  useEffect(() => {
    try {
      localStorage.setItem(STAGE_KEY, JSON.stringify(stage));
    } catch {
      // A blocked store only forgets the choice.
    }
  }, [stage]);
  useEffect(() => {
    document.title =
      page === "elements" ? "Elements · Reader" : "Library ideas · Reader";
  }, [page]);
  // The navigation follows the section at the top of the page.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.find((entry) => entry.isIntersecting);
        if (visible) setCurrent(visible.target.id);
      },
      { rootMargin: "-64px 0px -70% 0px" },
    );
    for (const section of sections) {
      const node = document.getElementById(section.id);
      if (node) observer.observe(node);
    }
    return () => observer.disconnect();
  }, [sections]);

  return (
    <StageContext.Provider value={stage}>
      <div className="min-h-svh bg-background text-foreground">
        <header className="sticky top-0 z-20 flex h-12 items-center gap-2 border-b border-border/70 bg-background/90 px-3 backdrop-blur-xl">
          <Link
            to="/settings"
            aria-label="Back to Settings"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <nav aria-label="Design pages" className="flex items-center gap-1">
            {(
              [
                { id: "elements", label: "Elements", to: "/debug/elements" },
                {
                  id: "library",
                  label: "Library ideas",
                  to: "/debug/elements/library",
                },
              ] as const
            ).map((link) => (
              <Link
                key={link.id}
                to={link.to}
                aria-current={page === link.id ? "page" : undefined}
                className="h-8 rounded-full px-3 text-sm leading-8 text-muted-foreground hover:text-foreground aria-[current=page]:bg-secondary aria-[current=page]:font-medium aria-[current=page]:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <span className="flex-1" />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Frame theme
            <select
              value={stage.theme}
              onChange={(event) =>
                setStage((value) => ({
                  ...value,
                  theme: event.target.value as ReaderTheme,
                }))
              }
              className="h-8 rounded-full border border-border bg-background px-3 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              {THEME_CLASSES.map((theme) => (
                <option key={theme} value={theme}>
                  {THEME_LABELS[theme]}
                </option>
              ))}
            </select>
          </label>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-border" />
          <Choice
            label="Zoom"
            value={stage.zoom}
            options={[
              { id: "fit", label: "Fit" },
              { id: "actual", label: "100%" },
            ]}
            onChange={(zoom) => setStage((value) => ({ ...value, zoom }))}
          />
        </header>
        <div className="mx-auto grid max-w-[110rem] grid-cols-[11rem_minmax(0,1fr)] gap-8 px-6">
          <nav
            aria-label="Sections"
            className="sticky top-12 flex flex-col gap-0.5 self-start pt-8"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                aria-current={current === section.id ? "location" : undefined}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-[13px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring",
                  current === section.id && "bg-secondary text-foreground",
                )}
              >
                {section.label}
              </a>
            ))}
          </nav>
          <main className="min-w-0 space-y-16 pt-8 pb-24">{children}</main>
        </div>
      </div>
    </StageContext.Provider>
  );
}

/** A titled section of an Elements page. */
export function ElementsSection({
  id,
  title,
  description,
  actions,
  children,
}: {
  id: string;
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-16">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="max-w-2xl">
          <h2 id={`${id}-title`} className="text-lg font-medium">
            {title}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}
