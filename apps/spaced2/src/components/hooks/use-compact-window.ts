import { useWidthClass } from "@workbench/elements/size-class";

/**
 * A phone-sized window: compact width, below 600 px, in the size classes
 * every app shares (@workbench/elements/size-class). It gets the phone's
 * review, drawers and toasts; from medium width, a tablet in portrait
 * included, the desktop's. The `medium:` variant (index.css) is the same
 * line for styles.
 */
export function useCompactWindow(): boolean {
  return useWidthClass() === "compact";
}
