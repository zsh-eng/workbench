import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

export interface ChoiceOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  /** Hides the label and keeps it for assistive technology. */
  iconOnly?: boolean;
}

/**
 * A row of buttons that act as one choice. Choosing the current option again
 * calls `onChange` again, so a specimen can replay its state.
 */
export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: T;
  options: readonly ChoiceOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-lg bg-muted p-0.5",
        className,
      )}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          aria-label={option.iconOnly ? option.label : undefined}
          title={option.iconOnly ? option.label : undefined}
          onClick={() => onChange(option.id)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm [&_svg]:size-3.5"
        >
          {option.icon}
          {!option.iconOnly && option.label}
        </button>
      ))}
    </div>
  );
}
