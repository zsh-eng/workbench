import {
  DAY_PAPERS,
  NIGHT_PAPERS,
  type DayPaper,
  type NightPaper,
  type ReaderTheme,
} from "@/types/reader.types";

/**
 * Reader has a paper for the day and one for the night. Light shows the day
 * paper, Dark the night paper, and Match system whichever the device asks
 * for. `theme` in the settings is the paper on screen now.
 */
export interface ReaderPapers {
  dayTheme: DayPaper;
  nightTheme: NightPaper;
}

export const PAPER_LABELS: Record<ReaderTheme, string> = {
  light: "Light",
  "flexoki-light": "Flexoki light",
  dark: "Dark",
  night: "Night",
  "flexoki-dark": "Flexoki dark",
};

export function isDayPaper(value: unknown): value is DayPaper {
  return (DAY_PAPERS as readonly unknown[]).includes(value);
}

export function isNightPaper(value: unknown): value is NightPaper {
  return (NIGHT_PAPERS as readonly unknown[]).includes(value);
}

/**
 * The papers an older build's single theme stood for: it paired Flexoki with
 * Flexoki and Night with Light, and anything else Light with Dark.
 */
export function papersForTheme(theme: unknown): ReaderPapers {
  if (typeof theme === "string" && theme.startsWith("flexoki")) {
    return { dayTheme: "flexoki-light", nightTheme: "flexoki-dark" };
  }
  if (theme === "night") return { dayTheme: "light", nightTheme: "night" };
  return { dayTheme: "light", nightTheme: "dark" };
}

/** Saved papers, or the ones a saved theme stood for. */
export function readPapers(saved: {
  theme?: unknown;
  dayTheme?: unknown;
  nightTheme?: unknown;
}): ReaderPapers {
  const implied = papersForTheme(saved.theme);
  return {
    dayTheme: isDayPaper(saved.dayTheme) ? saved.dayTheme : implied.dayTheme,
    nightTheme: isNightPaper(saved.nightTheme)
      ? saved.nightTheme
      : implied.nightTheme,
  };
}

/** The paper to show by night or by day. */
export function paperFor(papers: ReaderPapers, night: boolean): ReaderTheme {
  return night ? papers.nightTheme : papers.dayTheme;
}
