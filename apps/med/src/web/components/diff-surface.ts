import type { CSSProperties } from "react";
import { tokens } from "../theme.stylex";

/** Pierre diff variables that match Med's type and theme; Changes and brief
 * excerpts share them so code looks the same in both. */
export const diffSurfaceStyle = {
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
