import { cn } from "@/lib/utils";

/**
 * The bookmark that marks a choice: a red ribbon cut into a swallowtail,
 * hanging from the top of whatever is chosen. Size and place it with
 * `className` (absolute, inside a positioned parent).
 */
export function Ribbon({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute block bg-[#b23a2b] [clip-path:polygon(0_0,100%_0,100%_100%,50%_74%,0_100%)]",
        className,
      )}
    />
  );
}
