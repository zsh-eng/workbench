import {
  HIGHLIGHT_COLORS,
  type AnnotationColor,
} from "@/lib/highlight-constants";
import { cn } from "@/lib/utils";

/** Colour swatches for the Notes Island. Choosing the current colour removes
 * the highlight, as on desktop. The island owns placement and keyboard tracking.
 */
export function MobileHighlightBar({
  onColorSelect,
  currentColor,
  onDelete,
}: {
  onColorSelect: (color: AnnotationColor) => void;
  currentColor?: AnnotationColor;
  onDelete?: () => void;
}) {
  return (
    <div
      role="group"
      aria-label="Highlight colors"
      className="flex items-center gap-3"
    >
      {HIGHLIGHT_COLORS.map((color) => {
        const isCurrentColor = color.name === currentColor;
        return (
          <button
            key={color.name}
            type="button"
            onPointerDown={(event) => {
              // Keep the native text selection until click commits the action.
              event.preventDefault();
              event.stopPropagation();
            }}
            onClick={() => {
              if (isCurrentColor) onDelete?.();
              else onColorSelect(color.name);
            }}
            aria-pressed={isCurrentColor}
            aria-label={
              isCurrentColor && onDelete
                ? "Remove highlight"
                : `Highlight with ${color.name}`
            }
            className={cn(
              "relative size-7 shrink-0 cursor-pointer rounded-full before:absolute before:content-[''] before:-inset-1.5 shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--foreground)_10%,transparent)] transition-transform duration-150 active:scale-90 motion-reduce:active:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              "after:pointer-events-none after:absolute after:-inset-1 after:rounded-full after:border-[1.5px] after:border-foreground/70 after:opacity-0 after:transition-opacity after:duration-150",
              isCurrentColor && "after:opacity-100",
            )}
            style={{ backgroundColor: `var(--${color.name}-secondary)` }}
          />
        );
      })}
    </div>
  );
}
