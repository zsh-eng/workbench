import { Ribbon } from "@/components/appearance/Ribbon";
import {
  useReaderSettings,
  type AppearanceMode,
} from "@/hooks/use-reader-settings";
import { getReadingFont } from "@/lib/reading-fonts";
import { isNightPaper, PAPER_LABELS } from "@/lib/reader-papers";
import { cn } from "@/lib/utils";
import {
  DAY_PAPERS,
  NIGHT_PAPERS,
  type DayPaper,
  type NightPaper,
  type ReaderTheme,
} from "@/types/reader.types";

export const APPEARANCE_MODES: {
  value: AppearanceMode;
  label: string;
  /** For a narrow choice, such as the account menu's. */
  short: string;
}[] = [
  { value: "light", label: "Light", short: "Light" },
  { value: "dark", label: "Dark", short: "Dark" },
  { value: "system", label: "Match system", short: "System" },
];

/** Match system's tile: the day paper, the night paper laid over it on a slant. */
const NIGHT_SLANT = "polygon(62% 0, 100% 0, 100% 100%, 38% 100%)";

const LINE_WIDTHS = [36, 100, 100, 100, 58, 100, 100, 80];

/** A page's lines in its own ink: a short heading, then text. */
function PaperLines({ compact }: { compact: boolean }) {
  return (
    <span
      className={cn(
        "absolute inset-x-[17%] top-[15%] flex flex-col",
        compact ? "gap-1" : "gap-1.5",
      )}
    >
      {LINE_WIDTHS.slice(0, compact ? 7 : 8).map((width, index) => (
        <span
          key={index}
          className={cn(
            "block shrink-0 rounded-full bg-foreground",
            compact ? "h-[2.5px]" : "h-[3px]",
            index === 0 ? "self-center opacity-40" : "opacity-55",
          )}
          style={{ width: `${width}%` }}
        />
      ))}
    </span>
  );
}

/**
 * A mode drawn in the papers it shows: Light in the day paper, Dark in the
 * night paper, Match system in both. Each layer takes its paper's theme
 * class, so the colours are the themes' own.
 */
export function PaperTile({
  mode,
  dayPaper,
  nightPaper,
  selected,
  compact = false,
}: {
  mode: AppearanceMode;
  dayPaper: DayPaper;
  nightPaper: NightPaper;
  selected: boolean;
  compact?: boolean;
}) {
  return (
    <span
      className={cn(
        "relative block overflow-hidden transition-shadow duration-150",
        compact ? "h-[4.25rem] rounded-lg" : "h-[6.5rem] rounded-[10px]",
        selected && "ring-1 ring-foreground/50",
      )}
    >
      <span className={cn(dayPaper, "absolute inset-0 bg-background")}>
        <PaperLines compact={compact} />
      </span>
      {mode !== "light" && (
        <span
          className={cn(nightPaper, "absolute inset-0 bg-background")}
          style={mode === "system" ? { clipPath: NIGHT_SLANT } : undefined}
        >
          <PaperLines compact={compact} />
        </span>
      )}
      <span
        className={cn(
          mode === "dark" ? nightPaper : dayPaper,
          "pointer-events-none absolute inset-0 rounded-[inherit] border border-border",
        )}
      />
      {selected && (
        <Ribbon
          className={
            compact
              ? "-top-px right-2.5 h-[1.375rem] w-[11px]"
              : "-top-px right-3 h-7 w-[13px]"
          }
        />
      )}
    </span>
  );
}

/** Light, Dark and Match system, three tiles across the row. */
export function PaperModeTiles({ compact = false }: { compact?: boolean }) {
  const { settings, appearanceMode, setAppearanceMode } = useReaderSettings();
  const day = PAPER_LABELS[settings.dayTheme];
  const night = PAPER_LABELS[settings.nightTheme];
  const papers: Record<AppearanceMode, string> = {
    light: `${day} paper`,
    dark: `${night} paper`,
    system: `${day} and ${night}`,
  };
  return (
    <div
      role="group"
      aria-label="Appearance"
      className={cn("grid grid-cols-3", compact ? "gap-2.5" : "gap-3")}
    >
      {APPEARANCE_MODES.map((mode) => {
        const selected = appearanceMode === mode.value;
        return (
          <button
            key={mode.value}
            type="button"
            aria-label={mode.label}
            aria-pressed={selected}
            title={papers[mode.value]}
            onClick={() => setAppearanceMode(mode.value)}
            className="flex min-w-0 cursor-pointer flex-col gap-2 rounded-[10px] text-left outline-none transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] focus-visible:ring-2 focus-visible:ring-ring/50 active:scale-[0.98] motion-reduce:active:scale-100"
          >
            <PaperTile
              mode={mode.value}
              dayPaper={settings.dayTheme}
              nightPaper={settings.nightTheme}
              selected={selected}
              compact={compact}
            />
            <span className="flex min-w-0 flex-col pl-px">
              <span
                className={cn(
                  "truncate",
                  compact ? "text-xs" : "text-[13px]",
                  selected
                    ? "font-medium text-foreground"
                    : "text-muted-foreground",
                )}
              >
                {mode.label}
              </span>
              {!compact && (
                <span className="truncate text-xs text-muted-foreground/80">
                  {papers[mode.value]}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function describeRow(side: "day" | "night", mode: AppearanceMode): string {
  if (side === "day") {
    if (mode === "dark") return "Not used while Dark is on.";
    return mode === "light"
      ? "The paper Light uses."
      : "The paper Match system uses by day.";
  }
  if (mode === "light") return "Not used while Light is on.";
  return mode === "dark"
    ? "The paper Dark uses."
    : "The paper Match system uses by night.";
}

/**
 * By day and By night, each a row of papers. The row the mode doesn't use
 * fades back; the one on screen now is marked. Choosing a paper there turns
 * Light or Dark to its side, so it shows.
 */
export function PaperChoices({ compact = false }: { compact?: boolean }) {
  const { settings, appearanceMode, choosePaper } = useReaderSettings();
  const nightNow = isNightPaper(settings.theme);
  const face = getReadingFont(settings.fontFamily).stack;
  const rows: {
    side: "day" | "night";
    label: string;
    papers: readonly ReaderTheme[];
    chosen: ReaderTheme;
    used: boolean;
    now: boolean;
  }[] = [
    {
      side: "day",
      label: "By day",
      papers: DAY_PAPERS,
      chosen: settings.dayTheme,
      used: appearanceMode !== "dark",
      now: !nightNow,
    },
    {
      side: "night",
      label: "By night",
      papers: NIGHT_PAPERS,
      chosen: settings.nightTheme,
      used: appearanceMode !== "light",
      now: nightNow,
    },
  ];
  return (
    <>
      {rows.map((row) => (
        <div
          key={row.side}
          data-paper-side={row.side}
          className={cn(
            "flex items-center justify-between gap-4 transition-opacity duration-150",
            compact ? "min-h-[3.25rem] py-2" : "min-h-[4.25rem] py-3",
            !row.used &&
              "opacity-45 focus-within:opacity-100 hover:opacity-100",
          )}
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              {row.label}
              {row.now && (
                <span className="rounded-full bg-foreground/[0.08] px-1.5 py-px text-[11px] font-medium text-muted-foreground">
                  Now
                </span>
              )}
            </div>
            {!compact && (
              <p className="mt-0.5 text-[13px] leading-[18px] text-muted-foreground">
                {describeRow(row.side, appearanceMode)}
              </p>
            )}
          </div>
          <div
            role="group"
            aria-label={row.label}
            className={cn("flex shrink-0", compact ? "gap-1.5" : "gap-2")}
          >
            {row.papers.map((paper) => {
              const chosen = row.chosen === paper;
              return (
                <button
                  key={paper}
                  type="button"
                  aria-label={`${PAPER_LABELS[paper]} paper`}
                  aria-pressed={chosen}
                  title={PAPER_LABELS[paper]}
                  onClick={() => choosePaper(paper)}
                  className={cn(
                    "cursor-pointer rounded-full p-[3px] outline-none transition-shadow duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                    chosen && "ring-2 ring-foreground/85",
                  )}
                >
                  <span
                    className={cn(
                      paper,
                      "grid place-items-center rounded-full border border-border bg-background text-foreground",
                      compact ? "size-8 text-xs" : "size-9 text-sm",
                    )}
                    style={{ fontFamily: face }}
                  >
                    Aa
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/** The red of Reader's bookmark ribbon: on the chosen paper, and on the device you're holding. */
export const RIBBON_RED = "#b23a2b";

/**
 * A small open book for the account menu: the day paper on both pages for
 * Light, the night paper for Dark, one of each for Match system. The ribbon
 * hangs from the chosen one's spine.
 */
export function OpenBookSwatch({
  mode,
  dayPaper,
  nightPaper,
  selected,
  className,
}: {
  mode: AppearanceMode;
  dayPaper: DayPaper;
  nightPaper: NightPaper;
  selected: boolean;
  className?: string;
}) {
  const left = mode === "dark" ? nightPaper : dayPaper;
  const right = mode === "light" ? dayPaper : nightPaper;
  const lines = (x: number, widths: number[], indent: number) =>
    widths.map((width, index) => (
      <rect
        key={index}
        x={x + (index === indent ? 4 : 0)}
        y={20 + index * 7}
        width={width - (index === indent ? 4 : 0)}
        height="2.2"
        rx="1.1"
        className="fill-foreground"
        opacity="0.55"
      />
    ));
  return (
    <svg
      viewBox="0 0 120 96"
      aria-hidden="true"
      className={cn("block h-auto w-full overflow-visible", className)}
    >
      <ellipse
        cx="60"
        cy="84"
        rx="54"
        ry="3"
        className="fill-black"
        opacity="0.3"
      />
      <g className={left}>
        <path
          d="M4 10 Q 32 5 60 12 V 80 Q 32 74 4 80 Z"
          className="fill-background stroke-border"
        />
        {lines(12, [38, 38, 38, 24, 38, 38, 30], 4)}
      </g>
      <g className={right}>
        <path
          d="M60 12 Q 88 5 116 10 V 80 Q 88 74 60 80 Z"
          className="fill-background stroke-border"
        />
        {lines(70, [38, 38, 20, 38, 38, 38, 28], 3)}
      </g>
      <rect
        x="54"
        y="12"
        width="12"
        height="68"
        className="fill-black"
        opacity="0.12"
      />
      {selected && (
        <path d="M56 72 H64 V95 L60 90.5 L56 95 Z" fill={RIBBON_RED} />
      )}
    </svg>
  );
}
