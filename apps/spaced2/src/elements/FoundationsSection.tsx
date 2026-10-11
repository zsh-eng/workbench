import { cn } from "@/lib/utils";
import { demoOptionsFromUrl, driveAnimations } from "@workbench/elements";
import { useDemoPlayer } from "@workbench/elements/react";
import { CircleCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { DemoControls } from "./DemoControls";
import { ElementsSection } from "./ElementsLayout";
import { Specimen } from "./Specimen";

const TOKEN_GROUPS = [
  {
    label: "Surfaces and text",
    tokens: [
      "background",
      "foreground",
      "card",
      "card-foreground",
      "popover",
      "popover-foreground",
      "muted",
      "muted-foreground",
      "secondary",
      "secondary-foreground",
      "accent",
      "accent-foreground",
      "border",
      "input",
      "ring",
    ],
  },
  {
    label: "Actions and status",
    tokens: [
      "primary",
      "primary-foreground",
      "destructive",
      "destructive-foreground",
      "success",
      "success-foreground",
      "accentblue",
      "accentblue-foreground",
    ],
  },
  {
    label: "Charts",
    tokens: ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5"],
  },
] as const;

type Theme = "light" | "dark";
type TokenValues = Record<string, string>;

/**
 * Reads each token from `index.css` for one theme. The class changes and
 * returns in one task, so nothing paints in between.
 */
function readTokens(theme: Theme): TokenValues {
  const root = document.documentElement;
  const hadDark = root.classList.contains("dark");
  root.classList.toggle("dark", theme === "dark");
  const style = getComputedStyle(root);
  const values: TokenValues = {};
  for (const group of TOKEN_GROUPS)
    for (const token of group.tokens)
      values[token] = style.getPropertyValue(`--${token}`).trim();
  values.radius = style.getPropertyValue("--radius").trim();
  root.classList.toggle("dark", hadDark);
  return values;
}

const color = (value: string | undefined) =>
  value ? `hsl(${value})` : "transparent";

function TokenPanel({ theme, values }: { theme: Theme; values: TokenValues }) {
  return (
    <div
      className="rounded-xl border p-4"
      style={{
        background: color(values.background),
        color: color(values.foreground),
        borderColor: color(values.border),
      }}
    >
      <div className="flex items-baseline justify-between">
        <h4 className="text-sm font-medium">
          {theme === "light" ? "Light" : "Dark"}
        </h4>
        <span className="text-lg font-semibold">Aa</span>
      </div>
      {TOKEN_GROUPS.map((group) => (
        <div key={group.label} className="mt-4">
          <p
            className="text-xs"
            style={{ color: color(values["muted-foreground"]) }}
          >
            {group.label}
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1.5 sm:grid-cols-2">
            {group.tokens.map((token) => (
              <li
                key={token}
                title={`--${token}`}
                className="flex min-w-0 items-center gap-2 text-xs"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-5 shrink-0 rounded-md border",
                    !values[token] && "border-dashed",
                  )}
                  style={{
                    background: color(values[token]),
                    borderColor: color(values.border),
                  }}
                />
                <span className="truncate">{token}</span>
                <span
                  className="ml-auto shrink-0 font-mono text-[11px] tabular-nums"
                  style={{ color: color(values["muted-foreground"]) }}
                >
                  {values[token] || "not set"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ColourTokens() {
  const [tokens] = useState(() => ({
    light: readTokens("light"),
    dark: readTokens("dark"),
  }));
  return (
    <Specimen
      title="Colour tokens"
      note="Read from index.css for each theme, whatever the preview. Tailwind colours such as bg-muted use these as hsl(var(--muted)). Success and accentblue exist only in dark."
      padded={false}
      zoomable={false}
      stageClassName="p-3 sm:p-4"
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <TokenPanel theme="light" values={tokens.light} />
        <TokenPanel theme="dark" values={tokens.dark} />
      </div>
    </Specimen>
  );
}

const TYPE_SCALE = [
  {
    label: "Screen title",
    className: "text-3xl font-semibold tracking-tight",
    where: "Profile",
    sample: "Profile",
  },
  {
    label: "Statistic",
    className: "text-2xl font-bold",
    where: "Stats",
    sample: "1,284",
  },
  {
    label: "Empty title",
    className: "text-xl font-bold",
    where: "Review, done",
    sample: "You're done for now!",
  },
  {
    label: "Deck title",
    className: "text-lg font-semibold leading-none tracking-tight",
    where: "Deck card",
    sample: "Japanese N4",
  },
  {
    label: "Card text",
    className: "text-base",
    where: "Flashcard (prose)",
    sample: "What does spaced repetition schedule?",
  },
  {
    label: "Body",
    className: "text-sm",
    where: "Forms, descriptions",
    sample: "Cells, genetics and the human body",
  },
  {
    label: "Caption",
    className: "text-xs",
    where: "Toasts, hints",
    sample: "Flashcard created",
  },
  {
    label: "Grade label",
    className: "text-sm font-semibold uppercase tracking-widest",
    where: "Grade buttons",
    sample: "Good",
  },
  {
    label: "Code",
    className: "font-mono text-sm",
    where: "Card code",
    sample: "scores.sort();",
  },
] as const;

function TypeScale() {
  return (
    <Specimen
      title="Type scale"
      note="Spaced uses the system sans-serif and monospace stacks with Tailwind's sizes. Each row names the classes and where the app uses them."
      surface="card"
    >
      <dl className="divide-y divide-border">
        {TYPE_SCALE.map((row) => (
          <div
            key={row.label}
            className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-4"
          >
            <dt className="text-xs text-muted-foreground">
              {row.label}
              <span className="block">{row.where}</span>
            </dt>
            <dd className="m-0 min-w-0">
              <span className={cn("block truncate", row.className)}>
                {row.sample}
              </span>
              <code className="text-[11px] text-muted-foreground">
                {row.className}
              </code>
            </dd>
          </div>
        ))}
      </dl>
    </Specimen>
  );
}

const RADII = [
  { className: "rounded-sm", value: "radius − 4px", where: "Heatmap days" },
  { className: "rounded-md", value: "radius − 2px", where: "Buttons, inputs" },
  { className: "rounded-lg", value: "radius (0.5rem)", where: "Menus, badges" },
  { className: "rounded-xl", value: "0.75rem", where: "Cards, toasts" },
  { className: "rounded-2xl", value: "1rem", where: "Review card" },
  { className: "rounded-full", value: "full", where: "Dots, return to top" },
] as const;

function Radii() {
  return (
    <Specimen
      title="Radii"
      note="--radius is 0.5rem. Small, medium and large derive from it; the larger radii come from Tailwind."
      surface="card"
    >
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {RADII.map((radius) => (
          <li key={radius.className} className="flex flex-col gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "h-16 w-full border border-border bg-muted",
                radius.className,
              )}
            />
            <span className="text-xs font-medium">{radius.className}</span>
            <span className="text-xs text-muted-foreground">
              {radius.value} · {radius.where}
            </span>
          </li>
        ))}
      </ul>
    </Specimen>
  );
}

const MOTION_BEATS = [
  { at: 0.12, label: "Check peaks" },
  { at: 0.3, label: "Card in" },
  { at: 0.4, label: "Check settles" },
] as const;

const MOTION_ROWS = [
  {
    name: "Card enter",
    classes: "animate-in fade-in duration-300",
    timing: "300 ms, ease",
    where: "Flashcard content",
  },
  {
    name: "Check",
    classes: "animate-scale",
    timing: "400 ms, cubic-bezier(0.34, 1.56, 0.64, 1)",
    where: "Deck picker",
  },
  {
    name: "Press",
    classes: "BouncyButton",
    timing: "100–150 ms; medium 150–200 ms; large 200–300 ms",
    where: "Navigation, grade buttons",
  },
  {
    name: "Phone grade",
    classes: "active:scale-95 duration-100",
    timing: "100 ms",
    where: "Phone grade buttons",
  },
  {
    name: "Loading",
    classes: "animate-pulse, animate-spin",
    timing: "2 s and 1 s, repeating",
    where: "Deck skeleton, Stats",
  },
] as const;

/** Class names in components that Tailwind does not generate. */
const MISSING_ANIMATIONS = [
  "animate-fade-in",
  "animate-fade-in-dropdown-menu",
  "group-hover:animate-wobble-icon",
  "group-hover:animate-scale-icon-size",
  "group-hover:animate-scale-arrow-icon-size",
  "group-hover:animate-bounce-trash-icon",
  "group-hover:animate-move-pencil-icon",
];

function Motion() {
  const demo = useDemoPlayer({
    duration: 0.5,
    beats: MOTION_BEATS,
    ...demoOptionsFromUrl(),
  });
  const root = useRef<HTMLDivElement>(null);
  useEffect(
    () =>
      driveAnimations(
        demo.player,
        () => root.current?.getAnimations?.({ subtree: true }) ?? [],
      ),
    [demo.player],
  );
  return (
    <Specimen
      title="Motion"
      note="The app's real CSS animations, held by the timeline. Scrub, step with the arrow keys, or play at 0.25× to study the check's overshoot."
      controls={
        <DemoControls demo={demo} label="Motion" beats={MOTION_BEATS} />
      }
      stageRef={demo.stageRef}
      stageProps={demo.stageProps()}
    >
      <div className="grid gap-6 md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <div
          ref={root}
          key={demo.state.run}
          className="flex items-center justify-center gap-6 rounded-xl bg-background p-6 dark:bg-muted/30"
        >
          <div className="animate-in fade-in transition-all duration-300 h-20 w-28 rounded-lg border bg-card p-3 text-xs shadow-sm">
            Card enter
          </div>
          <CircleCheck className="size-8 text-primary animate-scale" />
        </div>
        <div className="min-w-0 text-sm">
          <ul className="divide-y divide-border">
            {MOTION_ROWS.map((row) => (
              <li
                key={row.name}
                className="grid gap-x-4 py-2 first:pt-0 sm:grid-cols-[7rem_minmax(0,1fr)]"
              >
                <span className="font-medium">{row.name}</span>
                <span className="text-muted-foreground">
                  <code className="text-xs">{row.classes}</code> · {row.timing}{" "}
                  · {row.where}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-4 text-xs text-muted-foreground">
            Not generated: tailwind.config.js names these keyframes in
            camelCase, so these class names in components produce no CSS and do
            not animate:{" "}
            {MISSING_ANIMATIONS.map((name, index) => (
              <span key={name}>
                {index > 0 && ", "}
                <code>{name}</code>
              </span>
            ))}
            .
          </p>
        </div>
      </div>
    </Specimen>
  );
}

export function FoundationsSection() {
  return (
    <ElementsSection
      id="foundations"
      title="Foundations"
      description="Theme tokens, type, radii and motion. Every colour on this page comes from these tokens."
    >
      <ColourTokens />
      <TypeScale />
      <Radii />
      <Motion />
    </ElementsSection>
  );
}
