/**
 * Shared parts for the System prototype.
 *
 * Motion: only opacity and transform animate. Surfaces that are part of a
 * screen change instantly; surfaces that float fade in quickly and leave
 * faster. One ease-out curve to arrive, one ease-in curve to leave.
 *
 * Type: book text in the serif, app text in the sans, figures tabular.
 */
import { cn } from "@/lib/utils";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

export const EASE_OUT = [0.2, 0, 0, 1] as const;
export const EASE_IN = [0.4, 0, 1, 1] as const;

export const MOTION = {
  /** Hover, press and small state changes. */
  fast: { duration: 0.12, ease: EASE_OUT },
  /** Floating surfaces arriving. */
  enter: { duration: 0.18, ease: EASE_OUT },
  /** Floating surfaces leaving: quicker than they came. */
  exit: { duration: 0.12, ease: EASE_IN },
  /** One screen replacing another. */
  screen: { duration: 0.22, ease: EASE_OUT },
} as const;

/** The elevation for anything that floats over a screen. */
export const FLOATING_SURFACE =
  "rounded-[14px] border border-foreground/[0.07] bg-background shadow-[0_24px_64px_-28px_rgb(0_0_0/0.32),0_2px_8px_-4px_rgb(0_0_0/0.08)] dark:border-foreground/[0.1]";

export function IconButton({
  label,
  active = false,
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        active && "text-foreground",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function TextButton({
  className,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      className={cn(
        "flex h-7 cursor-pointer items-center gap-1.5 rounded-md px-2 text-[13px] text-muted-foreground outline-none transition-colors duration-150 hover:bg-foreground/[0.05] hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-[4px] px-1 font-sans text-[11px] text-muted-foreground/80",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

export interface TabOption<T extends string> {
  value: T;
  label: ReactNode;
}

/** Words, not pills: the chosen one is darker. */
export function TextTabs<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  className,
}: {
  options: TabOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cn("flex min-w-0 items-center", size === "sm" ? "gap-3" : "gap-4", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "shrink-0 cursor-pointer rounded-sm whitespace-nowrap outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring",
              size === "sm" ? "text-[12.5px]" : "text-[13px]",
              active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground/80",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

export function Hairline({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("relative block h-[2px] overflow-hidden rounded-full bg-foreground/[0.08]", className)}>
      <span
        className="absolute inset-y-0 left-0 rounded-full bg-foreground/55"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%` }}
      />
    </span>
  );
}

/**
 * A popover rendered in place, so it inherits the prototype's theme.
 * Closes on Escape and on a press outside.
 */
export function Popover({
  open,
  onClose,
  align = "end",
  side = "bottom",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  align?: "start" | "end";
  side?: "bottom" | "top";
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: PointerEvent) => {
      // The trigger lives beside the popover; let it toggle the popover itself.
      if (ref.current?.parentElement?.contains(event.target as Node)) return;
      onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("pointerdown", handlePointer, true);
    document.addEventListener("keydown", handleKey, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointer, true);
      document.removeEventListener("keydown", handleKey, true);
    };
  }, [onClose, open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          role="menu"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1, transition: MOTION.enter }}
          exit={{ opacity: 0, transition: MOTION.exit }}
          className={cn(
            "absolute z-50 min-w-44 p-1",
            FLOATING_SURFACE,
            "rounded-[10px]",
            side === "bottom" ? "top-full mt-1.5" : "bottom-full mb-1.5",
            align === "end" ? "right-0 origin-top-right" : "left-0 origin-top-left",
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] text-muted-foreground">{children}</p>;
}

export function MenuItem({
  children,
  onSelect,
  checked,
  destructive = false,
}: {
  children: ReactNode;
  onSelect: () => void;
  checked?: boolean;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role={checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={checked}
      onClick={onSelect}
      className={cn(
        "flex h-8 w-full cursor-pointer items-center gap-2 rounded-md px-2.5 text-left text-[13px] outline-none transition-colors hover:bg-foreground/[0.05] focus-visible:bg-foreground/[0.06]",
        destructive && "text-destructive",
      )}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {checked && <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground" />}
    </button>
  );
}

export function MenuSeparator() {
  return <div role="separator" className="mx-2.5 my-1 h-px bg-foreground/[0.06]" />;
}

export function relativeDays(daysAgo: number): string {
  if (daysAgo <= 0) return "Today";
  if (daysAgo === 1) return "Yesterday";
  if (daysAgo < 7) return `${daysAgo} days ago`;
  if (daysAgo < 30) {
    const weeks = Math.round(daysAgo / 7);
    return weeks === 1 ? "Last week" : `${weeks} weeks ago`;
  }
  if (daysAgo < 365) {
    const months = Math.round(daysAgo / 30);
    return months === 1 ? "Last month" : `${months} months ago`;
  }
  const years = Math.round(daysAgo / 365);
  return years === 1 ? "Last year" : `${years} years ago`;
}

export function formatMinutesLeft(minutes: number): string {
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}
