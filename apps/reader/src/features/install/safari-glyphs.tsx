import { cn } from "@/lib/utils";
import type { ReactNode } from "react";

/**
 * Safari's own controls, drawn small, so a step shows the thing to look
 * for. Shapes follow iOS 26 and 27 Safari in the Compact tab layout; the
 * colours are Reader's, so they sit quietly in its sheet.
 */

const STROKE = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

function Glyph({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={cn("size-[18px] shrink-0", className)}
    >
      {children}
    </svg>
  );
}

/** The Page Menu at the left end of the address bar (iOS 27). */
export function PageMenuGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M4 7h16M4 12h14M4 17h9" {...STROKE} />
    </Glyph>
  );
}

/** ⋯ beside the address bar (iOS 26). */
export function MoreGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <circle cx="5.5" cy="12" r="1.6" fill="currentColor" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" />
      <circle cx="18.5" cy="12" r="1.6" fill="currentColor" />
    </Glyph>
  );
}

/** Share: a box with an arrow out of its top. */
export function ShareGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M12 3.5v11M8.5 7 12 3.5 15.5 7" {...STROKE} />
      <path
        d="M8.5 10.5H7a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1.5"
        {...STROKE}
      />
    </Glyph>
  );
}

/** View More, at the end of the share sheet's round actions. */
export function ViewMoreGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" {...STROKE} />
    </Glyph>
  );
}

/** Add to Home Screen: a plus in a rounded square. */
export function AddToHomeGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" {...STROKE} />
      <path d="M12 8.5v7M8.5 12h7" {...STROKE} />
    </Glyph>
  );
}

/** The arrow Safari draws on its reload button, for the address bar. */
export function ReloadGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <path d="M18.5 12.5a6.5 6.5 0 1 1-2.2-4.9" {...STROKE} />
      <path d="M17 4.5v3.6h-3.6" {...STROKE} />
    </Glyph>
  );
}

/** Safari's Tabs button: two overlapping squares. */
export function TabsGlyph({ className }: { className?: string }) {
  return (
    <Glyph className={className}>
      <rect x="8" y="8" width="12" height="12" rx="3" {...STROKE} />
      <path
        d="M16 8V7a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v6a3 3 0 0 0 3 3h1"
        {...STROKE}
      />
    </Glyph>
  );
}

/** A switch in its on position, like Open as Web App. */
export function SwitchOn({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-block h-[14px] w-[24px] shrink-0 rounded-full bg-foreground",
        className,
      )}
    >
      <span className="absolute top-[2px] right-[2px] size-[10px] rounded-full bg-background" />
    </span>
  );
}

/**
 * Where the step's control sits, small: in the address bar, a round
 * button, a menu row's icon, or the Add button.
 */
export type ChipShape = "bar" | "round" | "row" | "pill";

/** One control, drawn in the shape Safari gives it. */
export function SafariChip({
  shape,
  children,
  className,
}: {
  shape: ChipShape;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex shrink-0 items-center justify-center text-foreground",
        // The bar runs on past the chip, so its right end fades out.
        shape === "bar" &&
          "h-7 w-12 justify-start gap-1 rounded-l-full border border-r-0 border-border bg-background pl-1.5 [mask-image:linear-gradient(to_right,black_55%,transparent)]",
        shape === "round" &&
          "size-7 rounded-full bg-secondary dark:bg-foreground/10",
        shape === "row" && "size-7",
        shape === "pill" &&
          "h-6 rounded-full bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
