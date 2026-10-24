import { cn } from "@/lib/utils";
import { getReadingFont } from "@/lib/reading-fonts";
import type { ReaderSettings, ReaderTheme } from "@/types/reader.types";
import { Check } from "lucide-react";

interface ThemePanelProps {
  settings: ReaderSettings;
  onUpdateSettings: (settings: Partial<ReaderSettings>) => void;
}

const SAMPLE_TEXT = "In a hole in the ground there lived a hobbit.";

interface ThemeConfig {
  value: ReaderTheme;
  label: string;
  themeClass: string;
}

const themes: ThemeConfig[] = [
  {
    value: "light",
    label: "Light",
    themeClass: "light",
  },
  {
    value: "dark",
    label: "Dark",
    themeClass: "dark",
  },
  {
    value: "night",
    label: "Night",
    themeClass: "night",
  },
  {
    value: "flexoki-light",
    label: "Flexoki light",
    themeClass: "flexoki-light",
  },
  {
    value: "flexoki-dark",
    label: "Flexoki dark",
    themeClass: "flexoki-dark",
  },
];

export function ThemePanel({ settings, onUpdateSettings }: ThemePanelProps) {
  const previewFontFamily = getReadingFont(settings.fontFamily).stack;

  return (
    <div className="space-y-4">
      <h4 className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        Theme
      </h4>
      <div className="grid grid-cols-2 gap-3">
        {themes.map((theme) => {
          const isSelected = settings.theme === theme.value;
          return (
            <button
              key={theme.value}
              aria-label={theme.label}
              aria-pressed={isSelected}
              onClick={() => onUpdateSettings({ theme: theme.value })}
              className={cn(
                "relative h-36 overflow-hidden rounded-[1.25rem] border text-left transition-[background-color,border-color,opacity,transform,scale] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:active:scale-100 motion-reduce:active:opacity-80",
                "focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                "active:scale-[0.98]",
                isSelected
                  ? "border-border bg-background ring-1 ring-border/70"
                  : "border-border/50 bg-secondary/15 hover:bg-secondary/25",
              )}
            >
              {/* Theme preview wrapper - applies the theme class */}
              <div className={cn("flex flex-col h-full", theme.themeClass)}>
                <div className="border-b border-border/60 bg-background/90 px-3 py-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    {theme.label}
                  </span>
                </div>

                <div
                  className="flex flex-1 flex-col justify-between bg-background px-3 py-3 text-left text-foreground"
                  style={{ fontFamily: previewFontFamily }}
                >
                  <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                    Preview
                  </p>
                  <p className="text-sm leading-relaxed line-clamp-3">
                    {SAMPLE_TEXT}
                  </p>
                </div>
              </div>

              {isSelected && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" strokeWidth={3} />
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
