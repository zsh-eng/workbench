import { cn } from "@/lib/utils";
import type { DeviceType } from "@/types/session";
import { MonitorSmartphone } from "lucide-react";

/**
 * A phone, a tablet or a laptop, drawn small enough to sit in a line of
 * text. A device Reader can't place (a Mac or an iPad) gets both.
 */
export function DeviceGlyph({
  type,
  className,
}: {
  type: DeviceType | null;
  className?: string;
}) {
  if (type === null)
    return (
      <MonitorSmartphone
        aria-hidden="true"
        className={cn("size-[13px] shrink-0", className)}
        strokeWidth={1.5}
      />
    );
  return (
    <svg
      viewBox="0 0 16 16"
      aria-hidden="true"
      className={cn(
        "size-[13px] shrink-0 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.3]",
        className,
      )}
    >
      {type === "desktop" ? (
        <>
          <rect x="3" y="3.25" width="10" height="7.25" rx="1.2" />
          <path d="M1.5 12.75h13" />
        </>
      ) : type === "mobile" ? (
        <>
          <rect x="4.75" y="1.75" width="6.5" height="12.5" rx="1.75" />
          <path d="M7.25 3.9h1.5" />
        </>
      ) : (
        <>
          <rect x="2.75" y="1.75" width="10.5" height="12.5" rx="1.75" />
          <path d="M7.5 3.7h1" />
        </>
      )}
    </svg>
  );
}
