import { cn } from "@/lib/utils";

/** A cover image, or the title set in type on the book's own tone. */
export function SimCover({
  title,
  author,
  coverUrl,
  tone,
  compact = false,
  className,
}: {
  title: string;
  author: string;
  coverUrl?: string;
  tone?: string;
  compact?: boolean;
  className?: string;
}) {
  if (coverUrl)
    return (
      <span className={cn("block overflow-hidden bg-secondary", className)}>
        <img
          src={coverUrl}
          alt=""
          draggable={false}
          className="pointer-events-none size-full object-cover select-none"
        />
      </span>
    );
  return (
    <span
      className={cn(
        "flex flex-col justify-between overflow-hidden text-left text-[oklch(0.2_0.02_60)]",
        compact ? "p-[3px]" : "p-[9%]",
        className,
      )}
      style={{
        background: tone ?? "var(--secondary)",
        containerType: "inline-size",
      }}
    >
      <span
        className="line-clamp-4 font-serif leading-[0.95] font-medium tracking-tight text-balance"
        style={{ fontSize: compact ? "5px" : "clamp(9px, 15cqi, 28px)" }}
      >
        {title}
      </span>
      {!compact && (
        <span
          className="line-clamp-2 opacity-70"
          style={{ fontSize: "clamp(6px, 7cqi, 12px)" }}
        >
          {author}
        </span>
      )}
    </span>
  );
}

/**
 * Telegram's ticks for work that is only here: one tick while a change waits
 * on this device, a second that draws when it syncs.
 */
export function Ticks({ synced }: { synced: boolean }) {
  return (
    <span
      aria-label={synced ? "Synced" : "Saved on this device"}
      role="img"
      className="grid h-[18px] w-[24px] place-items-center rounded-full bg-background/92 text-foreground shadow-[0_1px_3px_rgb(0_0_0/0.16)] backdrop-blur"
    >
      <svg viewBox="0 0 24 16" className="h-[11px] w-[17px]" aria-hidden="true">
        <path
          d="M2.5 8.5 6 12 12.5 4.5"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.9}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {synced && (
          <path
            className="ba-tick-second"
            d="M9.5 11 10.5 12 17 4.5"
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={1.9}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>
    </span>
  );
}
