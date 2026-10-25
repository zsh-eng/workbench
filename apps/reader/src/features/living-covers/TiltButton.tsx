import { cn } from "@/lib/utils";
import { Smartphone } from "lucide-react";
import { requestTilt, useTiltPermission } from "./engine/tilt";

/**
 * The one ask for motion access. iOS only grants it from a tap, so the
 * covers light up from scroll and touch first, and this offers more.
 */
export function TiltButton({ className }: { className?: string }) {
  const { permission, live } = useTiltPermission();
  if (permission === "unsupported") return null;
  if (permission === "granted" && live) return null;
  if (permission === "granted") return null;
  if (permission === "denied") {
    return (
      <p className={cn("text-[12px] text-muted-foreground", className)}>
        Motion access is off. Drag a book to turn it.
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => void requestTilt()}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-background/80 px-3 text-[12px] font-medium text-foreground shadow-[0_1px_2px_rgb(0_0_0/0.06)] backdrop-blur transition-colors hover:bg-secondary focus-visible:outline-2 focus-visible:outline-ring",
        className,
      )}
    >
      <Smartphone className="size-3.5 -rotate-12" aria-hidden="true" />
      Tilt to catch the light
    </button>
  );
}
