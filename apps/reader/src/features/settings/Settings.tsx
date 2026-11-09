import { APP_TITLE_TYPE } from "@/components/app-header-styles";
import { PaperChoices, PaperModeTiles } from "@/components/appearance/Paper";
import {
  BookStylesRows,
  JustifyRow,
  LineSpacingRow,
  PageSwitchRows,
  ReadingFontChoices,
  TextSizeRow,
} from "@/components/appearance/ReadingControls";
import {
  SettingsGroup,
  SettingsRow,
  SettingsSection,
} from "@/components/appearance/settings-layout";
import { TypeSample } from "@/components/appearance/TypeSample";
import { BackToLibrary } from "@/components/ui/back-to-library";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  openInstallSheet,
  useInstallAvailability,
} from "@/features/install/install-offer";
import { FullscreenRow } from "@/features/reader/FullscreenRow";
import { PagesRow } from "@/features/reader/PagesRow";
import { ReadingLayoutRow } from "@/features/reader/scroll/ReadingLayoutRow";
import {
  setReadingModePreference,
  useReadingModePreference,
} from "@/features/reader/scroll/reading-mode-preference";
import { useReaderSettings } from "@/hooks/use-reader-settings";
import { setDebugEnabled, useDebugEnabled } from "@/lib/debug-preference";
import { getReadingFont } from "@/lib/reading-fonts";
import { PAPER_LABELS } from "@/lib/reader-papers";
import { cn } from "@/lib/utils";
import {
  BookMarked,
  BookOpen,
  ChevronLeft,
  ChevronRight,
  MonitorSmartphone,
  Palette,
  Type,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "appearance", label: "Paper", icon: Palette },
  { id: "type", label: "Type", icon: Type },
  { id: "page", label: "Page", icon: BookOpen },
  { id: "book-styles", label: "Book styles", icon: BookMarked },
  { id: "device", label: "This device", icon: MonitorSmartphone },
];

/**
 * The section nearest the top of the window, for the rail. A section chosen
 * in the rail stays current until the reader scrolls themselves: the last
 * sections can't reach the top, so the window's place alone can't say.
 */
function useCurrentSection(): [string, (id: string) => void] {
  const [current, setCurrent] = useState(SECTIONS[0].id);
  const chosen = useRef(false);
  useEffect(() => {
    const onScroll = () => {
      if (chosen.current) return;
      let next = SECTIONS[0].id;
      for (const section of SECTIONS) {
        const element = document.getElementById(section.id);
        if (element && element.getBoundingClientRect().top < 160) {
          next = section.id;
        }
      }
      // The last section can't reach the top; at the foot of the page it's current.
      const end =
        window.scrollY > 0 &&
        window.innerHeight + window.scrollY >=
          document.documentElement.scrollHeight - 2;
      setCurrent(end ? SECTIONS[SECTIONS.length - 1].id : next);
    };
    const release = () => {
      chosen.current = false;
    };
    const userScrolls = ["wheel", "touchstart", "keydown"] as const;
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    for (const event of userScrolls) {
      window.addEventListener(event, release, { passive: true });
    }
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      for (const event of userScrolls) {
        window.removeEventListener(event, release);
      }
    };
  }, []);
  const choose = useCallback((id: string) => {
    chosen.current = true;
    setCurrent(id);
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  }, []);
  return [current, choose];
}

const SECTION_SCROLL_MARGIN = "scroll-mt-10 max-md:scroll-mt-64";

/**
 * Settings set out as Linear's are: a rail of sections, rounded groups whose
 * headings line up with the text inside them, and a sample page set as the
 * books are, which stays in view while its settings change. It sits beside
 * the settings where there is room, and over them on a phone.
 *
 * The reading settings here are the ones Appearance changes in the Reader:
 * one set for every book in this browser.
 */
export function Settings() {
  const { settings, updateSettings } = useReaderSettings();
  const readingMode = useReadingModePreference();
  const debugEnabled = useDebugEnabled();
  const install = useInstallAvailability();
  const [current, chooseSection] = useCurrentSection();
  const face = getReadingFont(settings.fontFamily).label;

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-[84rem] px-4 pb-24 md:grid md:grid-cols-[2.75rem_minmax(0,1fr)_minmax(0,22rem)] md:gap-x-7 md:px-6 lg:grid-cols-[12rem_minmax(0,35rem)_minmax(0,30rem)] lg:justify-center lg:gap-x-12 lg:px-10">
        <nav aria-label="Settings sections" className="hidden md:block">
          <div className="sticky top-0 flex flex-col gap-0.5 pt-10">
            <Link
              to="/"
              aria-label="Back to library"
              title="Library"
              className="flex h-9 items-center gap-1.5 rounded-lg text-[13px] text-muted-foreground transition-colors hover:text-foreground max-lg:size-11 max-lg:justify-center lg:-ml-1.5 lg:px-1.5"
            >
              <ChevronLeft className="size-4" aria-hidden="true" />
              <span className="max-lg:sr-only">Library</span>
            </Link>
            <div className="h-6" />
            {SECTIONS.map((section) => {
              const active = current === section.id;
              return (
                <button
                  key={section.id}
                  type="button"
                  aria-label={section.label}
                  aria-current={active ? "true" : undefined}
                  title={section.label}
                  onClick={() => chooseSection(section.id)}
                  className={cn(
                    "flex h-9 cursor-pointer items-center gap-2.5 rounded-[10px] px-2.5 text-left text-sm transition-colors duration-150 max-lg:size-11 max-lg:justify-center max-lg:px-0",
                    active
                      ? "bg-foreground/[0.07] text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <section.icon
                    className="size-[18px] shrink-0"
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                  <span className="max-lg:sr-only">{section.label}</span>
                </button>
              );
            })}
          </div>
        </nav>

        <main className="min-w-0 pt-16 md:pt-10">
          <header>
            <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-3 md:block">
              <BackToLibrary className="md:hidden" />
              <h1
                className={cn(
                  "text-center text-foreground md:px-[17px] md:text-left",
                  APP_TITLE_TYPE,
                )}
              >
                Settings
              </h1>
              <div className="size-8 md:hidden" aria-hidden="true" />
            </div>
            <p className="mt-2 text-center text-sm text-muted-foreground md:px-[17px] md:text-left">
              Preferences for this browser.
            </p>
          </header>

          {/* On a phone the sample stays at the top while the settings pass under it. */}
          <div className="sticky top-0 z-20 -mx-4 mt-5 bg-background/95 px-4 pt-2 pb-3 backdrop-blur-md md:hidden">
            <TypeSample settings={settings} variant="panel" className="h-44" />
          </div>

          <div className="mt-5 space-y-10 md:mt-10">
            <SettingsSection
              id="appearance"
              title="Paper"
              description="A paper for the day and one for the night. Match system turns between them with this device."
              className={SECTION_SCROLL_MARGIN}
            >
              <SettingsGroup>
                <div className="py-4">
                  <PaperModeTiles />
                </div>
                <PaperChoices />
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="type"
              title="Type"
              description="The face and size every book is set in."
              className={SECTION_SCROLL_MARGIN}
            >
              <SettingsGroup>
                <ReadingFontChoices
                  value={settings.fontFamily}
                  onChange={(fontFamily) => updateSettings({ fontFamily })}
                />
                <TextSizeRow
                  settings={settings}
                  onUpdateSettings={updateSettings}
                />
                <LineSpacingRow
                  settings={settings}
                  onUpdateSettings={updateSettings}
                />
                <JustifyRow
                  settings={settings}
                  onUpdateSettings={updateSettings}
                />
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="page"
              title="Page"
              description="How every book is laid out."
              className={SECTION_SCROLL_MARGIN}
            >
              <SettingsGroup>
                <ReadingLayoutRow
                  value={readingMode}
                  onChange={setReadingModePreference}
                />
                {readingMode === "pages" && (
                  <PagesRow description="Auto shows two pages where they fit." />
                )}
                <FullscreenRow />
                <PageSwitchRows
                  settings={settings}
                  onUpdateSettings={updateSettings}
                />
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="book-styles"
              title="The book's own styles"
              description="What a book's publisher set, over Reader's choices."
              className={SECTION_SCROLL_MARGIN}
            >
              <SettingsGroup>
                <BookStylesRows
                  settings={settings}
                  onUpdateSettings={updateSettings}
                />
              </SettingsGroup>
            </SettingsSection>

            <SettingsSection
              id="device"
              title="This device"
              className={SECTION_SCROLL_MARGIN}
            >
              <SettingsGroup>
                {install.available && (
                  <SettingsRow
                    label="Install Reader"
                    description="Full screen, your library offline, and one tap to open."
                  >
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-full"
                      onClick={() => openInstallSheet("menu")}
                    >
                      Install
                    </Button>
                  </SettingsRow>
                )}
                <SettingsRow
                  label="Debug mode"
                  htmlFor="debug-mode"
                  description={
                    <span id="debug-mode-description">
                      Show diagnostic tools and allow performance recording.
                    </span>
                  }
                >
                  <Switch
                    id="debug-mode"
                    aria-describedby="debug-mode-description"
                    checked={debugEnabled}
                    onCheckedChange={setDebugEnabled}
                  />
                </SettingsRow>
                {debugEnabled && (
                  <Link
                    to="/debug"
                    className="flex min-h-[3.25rem] items-center justify-between gap-4 py-2.5"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-foreground">
                        Debug tools
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-[18px] text-muted-foreground">
                        Performance, diagnostics, Elements, design ideas,
                        experiments, and Sync Lab.
                      </span>
                    </span>
                    <ChevronRight
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  </Link>
                )}
              </SettingsGroup>
            </SettingsSection>
          </div>
        </main>

        <aside aria-label="Sample" className="hidden md:block">
          <div className="sticky top-0 pt-10">
            <TypeSample
              settings={settings}
              variant="page"
              className="max-h-[calc(100dvh-7rem)]"
            />
            <p className="mt-2.5 px-0.5 text-xs text-muted-foreground">
              {PAPER_LABELS[settings.theme]} · {face} · {settings.fontSize} px
              · {settings.lineHeight.toFixed(1)}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
