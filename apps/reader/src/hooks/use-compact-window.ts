import { useWidthClass } from "@workbench/elements/size-class";

/**
 * The Reader's phone layout: a compact window, below 600 px, in the size
 * classes every app shares (@workbench/elements/size-class). From medium
 * width, a tablet in portrait included, the Reader's tools are a sidebar
 * and popovers.
 */
export function useCompactWindow(): boolean {
  return useWidthClass() === "compact";
}
