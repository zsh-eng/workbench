import type { CSSProperties } from "react";
import { tokens } from "../theme.stylex";

/** Selection and diff colors from the theme's code palette (code-colors.ts).
 * Every Pierre view uses them: Changes, brief excerpts, and the file view. */
export const codeSurfaceStyle = {
  "--diffs-bg-selection-override": "var(--med-code-selection-line)",
  "--diffs-bg-selection-number-override": "var(--med-code-selection-number)",
  "--diffs-bg-addition-override": "var(--med-code-inserted-line)",
  "--diffs-bg-addition-number-override": "var(--med-code-inserted-number)",
  "--diffs-bg-addition-emphasis-override": "var(--med-code-inserted-text)",
  "--diffs-bg-deletion-override": "var(--med-code-removed-line)",
  "--diffs-bg-deletion-number-override": "var(--med-code-removed-number)",
  "--diffs-bg-deletion-emphasis-override": "var(--med-code-removed-text)",
} as CSSProperties;

/** Lines that one "expand" click on a hunk separator shows. Pierre's default
 * of 100 is taller than the window, so the changed lines scroll out of view;
 * 20 lines (400 px) keep them on screen, as on GitHub. */
export const EXPANSION_LINES = 20;

/** Pierre diff variables that match Med's type and theme; Changes and brief
 * excerpts share them so code looks the same in both. */
export const diffSurfaceStyle = {
  ...codeSurfaceStyle,
  "--diffs-font-family": tokens.code,
  "--diffs-font-size": "12px",
  "--diffs-line-height": "20px",
  "--diffs-header-font-family": tokens.ui,
  "--diffs-bg-context-override": tokens.canvas,
  "--diffs-bg-context-gutter-override": tokens.canvas,
  "--diffs-bg-separator-override": `color-mix(in srgb, ${tokens.canvas} 96.5%, ${tokens.text})`,
  "--diffs-bg-buffer-override": `color-mix(in srgb, ${tokens.canvas} 98%, ${tokens.text})`,
  "--diffs-fg-number-override": tokens.faint,
  "--diffs-addition-color-override": tokens.green,
  "--diffs-deletion-color-override": tokens.red,
} as CSSProperties;
