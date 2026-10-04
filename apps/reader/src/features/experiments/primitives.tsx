import { useReaderSettings } from "@/hooks/use-reader-settings";
import { cn } from "@/lib/utils";
import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import type { StudioBook, StudioInk, StudioTone } from "./data/sample-library";

export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const SOFT_SPRING = { type: "spring", stiffness: 260, damping: 30, mass: 0.9 } as const;
export const SNAPPY_SPRING = { type: "spring", stiffness: 520, damping: 38, mass: 0.7 } as const;

/** Strong ink for marks, text and strokes. Falls back to the wash in plain themes. */
export function inkColor(color: StudioInk): string {
  return `var(--${color}-primary, color-mix(in oklab, var(--${color}-secondary) 70%, var(--foreground)))`;
}

/** Translucent highlighter wash used behind text. */
export function inkWash(color: StudioInk): string {
  return `var(--${color}-secondary)`;
}

const TONE_WASH: Record<StudioTone, string> = {
  yellow: "var(--yellow-secondary)",
  green: "var(--green-secondary)",
  cyan: "var(--cyan-secondary, var(--green-secondary))",
  blue: "var(--blue-secondary)",
  purple: "var(--purple-secondary, var(--magenta-secondary))",
  magenta: "var(--magenta-secondary)",
  ink: "var(--foreground)",
};

/** Deep cover cloth: the tone's wash pulled toward the text colour. */
export function toneSurface(tone: StudioTone): string {
  if (tone === "ink") return "var(--foreground)";
  return `color-mix(in oklab, ${TONE_WASH[tone]} 58%, var(--foreground))`;
}

export function toneText(): string {
  return "var(--background)";
}

/** Light tint of a tone, for spines and fills that sit behind text. */
export function toneWash(tone: StudioTone): string {
  return TONE_WASH[tone];
}

export function useIsDarkAppearance(): boolean {
  const { settings } = useReaderSettings();
  return (
    settings.theme === "dark" ||
    settings.theme === "night" ||
    settings.theme === "flexoki-dark"
  );
}

export type StageTone = "paper" | "night" | "inherit";

/**
 * Scopes a prototype to a theme palette. Theme classes only redefine CSS
 * variables, so a stage can use a warm paper or night palette without new
 * colours.
 */
export function StageSurface({
  tone,
  className,
  children,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone: StageTone; children: ReactNode }) {
  const isDark = useIsDarkAppearance();
  const themeClass =
    tone === "night"
      ? "flexoki-dark"
      : tone === "paper"
        ? isDark
          ? "flexoki-dark"
          : "flexoki-light"
        : undefined;

  return (
    <div
      {...props}
      className={cn(themeClass, "bg-background text-foreground", className)}
      style={{
        colorScheme:
          tone === "night" || (tone === "paper" && isDark) ? "dark" : undefined,
        ...props.style,
      }}
    >
      {children}
    </div>
  );
}

export interface ElementSize {
  width: number;
  height: number;
}

/** Observes an element's content box. Returns zero until the first measure. */
export function useElementSize<T extends HTMLElement>(): [
  (node: T | null) => void,
  ElementSize,
] {
  const [size, setSize] = useState<ElementSize>({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setSize((current) =>
        current.width === width && current.height === height
          ? current
          : { width, height },
      );
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useLayoutEffect(() => () => observerRef.current?.disconnect(), []);

  return [ref, size];
}

/** A cover set in type when a book has no cover image. */
export function TypographicCover({
  book,
  className,
  compact = false,
}: {
  book: StudioBook;
  className?: string;
  compact?: boolean;
}) {
  if (book.coverUrl) {
    return (
      <span className={cn("block overflow-hidden", className)}>
        <img
          src={book.coverUrl}
          alt=""
          className="image-outline size-full object-cover"
          draggable={false}
        />
      </span>
    );
  }

  return (
    <span
      className={cn(
        "relative flex flex-col justify-between overflow-hidden text-left",
        compact ? "p-1.5" : "p-[9%]",
        className,
      )}
      style={{
        background: toneSurface(book.tone),
        color: toneText(),
        containerType: "inline-size",
      }}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[5%] bg-black/10"
      />
      <span
        className="xp-serif block font-medium leading-[0.95] tracking-tight text-balance"
        style={{ fontSize: compact ? "7px" : "clamp(9px, 15cqi, 34px)" }}
      >
        {book.title}
      </span>
      {!compact && (
        <span
          className="xp-smcp block opacity-75"
          style={{ fontSize: "clamp(6px, 7.5cqi, 13px)" }}
        >
          {book.author}
        </span>
      )}
    </span>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-b-2 bg-background px-1.5 font-sans text-[10px] font-medium text-foreground/80">
      {children}
    </kbd>
  );
}

export function formatMinutes(ms: number): string {
  const totalMinutes = Math.round(ms / 60000);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

export function getStableNumber(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
