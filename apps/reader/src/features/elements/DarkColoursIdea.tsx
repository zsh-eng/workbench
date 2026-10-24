import type { AnnotationColor } from "@/lib/highlight-constants";
import { getReadingFont } from "@/lib/reading-fonts";
import { ArrowLeft } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";

/**
 * Highlight colours and the true-black Night theme, as the Reader draws them,
 * on each theme at once. `?palette=` swaps the highlight fills and
 * `?night=bright` lifts Night's text, so Design ideas can compare them with
 * what ships. Nothing here changes the app's colours.
 */

type Palette = "current" | "mixed" | "quiet";

/** The light theme's fills, which the dark palettes start from. */
const LIGHT_FILLS: Record<Exclude<AnnotationColor, "invisible">, string> = {
  yellow: "oklch(0.905 0.182 98.111)",
  green: "oklch(0.871 0.15 154.449)",
  blue: "oklch(0.809 0.105 251.813)",
  magenta: "oklch(0.81 0.117 11.638)",
};

/** Today's dark fills, shared by Dark, Night and Flexoki dark. */
const DARK_FILLS: Record<Exclude<AnnotationColor, "invisible">, string> = {
  yellow: "#664d01",
  green: "#3d4c07",
  blue: "#163b66",
  magenta: "#641f46",
};

function fillVariables(
  fill: (color: Exclude<AnnotationColor, "invisible">) => string,
): CSSProperties {
  return Object.fromEntries(
    (["yellow", "green", "blue", "magenta"] as const).map((color) => [
      `--${color}-secondary`,
      fill(color),
    ]),
  ) as CSSProperties;
}

const PALETTES: Record<Palette, CSSProperties | null> = {
  current: null,
  // The light hue mixed into whichever page it sits on.
  mixed: fillVariables(
    (color) =>
      `color-mix(in oklab, ${LIGHT_FILLS[color]} ${color === "green" ? 34 : 38}%, var(--background))`,
  ),
  // Today's fills, pulled toward the page.
  quiet: fillVariables(
    (color) =>
      `color-mix(in srgb, ${DARK_FILLS[color]} 62%, var(--background))`,
  ),
};

const BRIGHT_NIGHT_TEXT: CSSProperties = {
  ["--foreground" as string]: "oklch(0.88 0 0)",
  ["--muted-foreground" as string]: "oklch(0.7 0 0)",
};

const THEMES = [
  { className: "light", label: "Light", note: "For the hues" },
  { className: "dark", label: "Dark", note: null },
  { className: "night", label: "Night", note: "True black" },
  { className: "flexoki-dark", label: "Flexoki dark", note: null },
] as const;

function Mark({
  color,
  children,
}: {
  color: Exclude<AnnotationColor, "invisible">;
  children: ReactNode;
}) {
  return (
    <mark
      className="epub-highlight"
      data-color={color}
      data-highlight-start="true"
      data-highlight-end="true"
    >
      {children}
    </mark>
  );
}

function Passage() {
  return (
    <div
      className="space-y-4 text-[16px] leading-6"
      style={{ fontFamily: getReadingFont("lora").stack }}
    >
      <p>
        The lamps along the canal came on one by one,{" "}
        <Mark color="yellow">
          and the water took each light and stretched it
        </Mark>{" "}
        into a long, wavering line. She had meant to turn back an hour ago.{" "}
        <Mark color="green">Instead she kept walking,</Mark> counting bridges,{" "}
        <Mark color="blue">
          listening to the boats knock against the stones,
        </Mark>{" "}
        until the city felt less like a place and more like{" "}
        <Mark color="magenta">a sentence she was still reading.</Mark>
      </p>
      <p className="text-muted-foreground">
        A page number, a chapter title and other quiet text sit in this colour.
      </p>
    </div>
  );
}

export function DarkColoursIdea() {
  const [params] = useSearchParams();
  const paletteParam = params.get("palette");
  const palette: Palette =
    paletteParam === "mixed" || paletteParam === "quiet"
      ? paletteParam
      : "current";
  const brightNight = params.get("night") === "bright";
  const framed = window.parent !== window;

  return (
    <div className="min-h-svh bg-background text-foreground">
      {!framed && (
        <div className="flex h-12 items-center gap-2 border-b border-border/70 px-3">
          <Link
            to="/debug/elements/dark"
            aria-label="Back to Dark mode ideas"
            className="grid size-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <span className="text-sm font-medium">Dark mode ideas</span>
        </div>
      )}
      {THEMES.map((theme) => (
        <section
          key={theme.className}
          aria-label={theme.label}
          className={theme.className}
          style={{
            // Light keeps its fills as the reference.
            ...(theme.className === "light" ? null : PALETTES[palette]),
            ...(brightNight && theme.className === "night"
              ? BRIGHT_NIGHT_TEXT
              : null),
          }}
        >
          <div className="bg-background px-6 py-6 text-foreground">
            <h2 className="mb-3 text-[10px] font-medium tracking-[0.18em] text-muted-foreground uppercase">
              {theme.label}
              {theme.note && ` · ${theme.note}`}
            </h2>
            <Passage />
          </div>
        </section>
      ))}
    </div>
  );
}
