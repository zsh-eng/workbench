import type { CSSProperties, HTMLAttributes } from "react";

/**
 * Shared interaction props for any visible reader chrome surface that should
 * keep the auto-hiding chrome open while hovered or focused.
 */
export type ReaderChromeSurfaceProps = Pick<
  HTMLAttributes<HTMLElement>,
  "onBlur" | "onFocus" | "onPointerEnter" | "onPointerLeave"
>;

/**
 * Props for invisible hover rails rendered outside the reading surface in
 * hover-capable environments.
 */
export type ReaderChromeRailProps = Pick<
  HTMLAttributes<HTMLDivElement>,
  "onPointerEnter" | "onPointerLeave"
> & {
  "aria-hidden": true;
  "data-reader-chrome-rail": "top" | "bottom";
  style: CSSProperties;
};
