import { cn } from "@/lib/utils";
import type { ReadingMode } from "./use-reader-scroll-mode";

const MODES: { value: ReadingMode; label: string }[] = [
  { value: "pages", label: "Pages" },
  { value: "scroll", label: "Scroll" },
];

/** Debug-mode Pages/Scroll switch for the scroll-mode prototype. */
export function ReadingModeSwitch({
  value,
  onChange,
  disabled = false,
}: {
  value: ReadingMode;
  onChange: (mode: ReadingMode) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Reading mode (Debug)"
      data-reading-mode-switch={value}
      className="flex items-center gap-0.5 rounded-full border border-border/70 bg-background/80 p-0.5"
    >
      {MODES.map((mode) => {
        const checked = mode.value === value;
        return (
          <button
            key={mode.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled && !checked}
            onClick={() => {
              if (!checked && !disabled) onChange(mode.value);
            }}
            className={cn(
              "relative min-w-16 rounded-full px-3 py-1 text-[11px] font-medium tracking-[0.04em] transition-[background-color,color,scale] duration-150 before:absolute before:-inset-y-2 before:inset-x-0 before:content-[''] active:scale-[0.97]",
              checked
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {mode.label}
          </button>
        );
      })}
    </div>
  );
}
