import { THEME_CLASSES } from "@/types/reader.types";
import { cn } from "@/lib/utils";

const THEME_LABELS: Record<(typeof THEME_CLASSES)[number], string> = {
  light: "Light",
  dark: "Dark",
  night: "Night",
  "flexoki-light": "Flexoki light",
  "flexoki-dark": "Flexoki dark",
};

const SURFACE_TOKENS = [
  "background",
  "card",
  "secondary",
  "muted",
  "border",
  "primary",
  "foreground",
  "muted-foreground",
  "ring",
  "destructive",
] as const;

const HIGHLIGHT_TOKENS = ["yellow", "green", "blue", "magenta"] as const;

const TYPE_SCALE = [
  {
    label: "Book title",
    className:
      "text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground",
    sample: "Alice’s Adventures in Wonderland",
  },
  {
    label: "Meta",
    className: "text-[11px] text-muted-foreground",
    sample: "p. 17 · 7:59 PM",
  },
  { label: "Control", className: "text-xs", sample: "Mark as reading" },
  {
    label: "Island",
    className: "text-[13px] font-medium",
    sample: "Note deleted",
  },
  {
    label: "Notebook",
    className: "text-[15px] leading-relaxed",
    sample: "digging in the sand with wooden spades",
  },
  {
    label: "Reading",
    className: "font-serif text-[17px] leading-[1.6]",
    sample: "“Curiouser and curiouser!” cried Alice.",
  },
];

/** Every theme's tokens side by side, each on its own themed surface. */
export function Foundations() {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-3">
        {THEME_CLASSES.map((theme) => (
          <div
            key={theme}
            className={cn(
              theme,
              "rounded-xl border border-border bg-background p-4 text-foreground",
            )}
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-medium">{THEME_LABELS[theme]}</h3>
              <span className="font-serif text-lg">Aa</span>
            </div>
            <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5">
              {SURFACE_TOKENS.map((token) => (
                <li
                  key={token}
                  title={`--${token}`}
                  className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground"
                >
                  <span
                    aria-hidden="true"
                    className="size-4 shrink-0 rounded-[5px] border border-border"
                    style={{ background: `var(--${token})` }}
                  />
                  <span className="truncate">
                    {token.replace("-foreground", " text")}
                  </span>
                </li>
              ))}
            </ul>
            <ul className="mt-3 flex gap-1.5">
              {HIGHLIGHT_TOKENS.map((color) => (
                <li
                  key={color}
                  title={`--${color}-secondary`}
                  className="h-5 flex-1 rounded-md"
                  style={{ background: `var(--${color}-secondary)` }}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
      <dl className="divide-y divide-border rounded-xl border border-border">
        {TYPE_SCALE.map((row) => (
          <div
            key={row.label}
            className="grid grid-cols-[8rem_1fr] items-baseline gap-4 px-4 py-3"
          >
            <dt className="text-xs text-muted-foreground">{row.label}</dt>
            <dd className={cn("m-0 truncate", row.className)}>{row.sample}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
