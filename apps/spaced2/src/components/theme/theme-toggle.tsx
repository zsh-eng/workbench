import { useTheme, type Theme } from "@/components/theme/theme-context";
import { SPRINGS, springCurve } from "@workbench/elements/spring";
import { useId } from "react";

const THEMES: { value: Theme; label: string }[] = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

/** The selection slides one segment on the shared quick spring. */
const slide = springCurve(SPRINGS.snappy, 64);

/**
 * The Theme row on the Profile page: a row like Stats and Images, with every
 * choice shown in a segmented control. The choices are radio buttons, so the
 * arrow keys move between them.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const id = useId();
  const selected = THEMES.findIndex((option) => option.value === theme);
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-xl bg-background px-6 py-3 dark:bg-muted/50">
      <span id={`${id}label`}>Theme</span>
      <div
        role="radiogroup"
        aria-labelledby={`${id}label`}
        className="relative grid grid-cols-3 rounded-lg bg-foreground/8 p-0.5 dark:bg-background/60"
      >
        <span
          aria-hidden
          className="absolute inset-y-0.5 left-0.5 w-[calc((100%-0.25rem)/3)] rounded-md bg-background shadow-sm transition-transform motion-reduce:transition-none dark:bg-muted"
          style={{
            transform: `translateX(${Math.max(selected, 0) * 100}%)`,
            transitionDuration: `${slide.duration}ms`,
            transitionTimingFunction: slide.easing,
          }}
        />
        {THEMES.map((option) => (
          <label
            key={option.value}
            className="relative flex h-7 cursor-pointer items-center justify-center rounded-md px-3 text-sm has-checked:font-medium has-focus-visible:ring-1 has-focus-visible:ring-ring"
          >
            <input
              type="radio"
              name={id}
              value={option.value}
              checked={theme === option.value}
              onChange={() => setTheme(option.value)}
              className="sr-only"
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
