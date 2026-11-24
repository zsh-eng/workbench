import * as stylex from "@stylexjs/stylex";
import { useState } from "react";
import { tokens, ui } from "../../theme.stylex";
import { tooltip } from "../ToolButton";

// Remember the last user-initiated toggle so the newly mounted counterpart at
// the same top-left corner plays a single 200 ms morph (and never animates on
// initial page load or unrelated remounts).
let pendingMorph = false;
let clearMorphTimer: ReturnType<typeof setTimeout> | undefined;

/** Records a sidebar toggle (click or ⌘B) so the icon morphs cleanly across the
 * instant sidebar mount/unmount boundary. */
export function markSidebarToggled() {
  pendingMorph = true;
  clearTimeout(clearMorphTimer);
  clearMorphTimer = setTimeout(() => {
    pendingMorph = false;
  }, 250);
}

function consumeSidebarMorph() {
  if (!pendingMorph) return false;
  pendingMorph = false;
  return true;
}

/**
 * Sidebar toggle button with an animated SVG icon (the sidebar itself stays
 * instant). When open, the left compartment is filled and a subtle inward
 * chevron nudges left on hover; when closed, the compartment collapses and the
 * chevron flips outward to telegraph expansion.
 */
export function SidebarToggleButton({
  open,
  label,
  shortcut = "Mod+B",
  dot = false,
  onClick,
}: {
  open: boolean;
  label: string;
  shortcut?: string;
  dot?: boolean;
  onClick(): void;
}) {
  // Capture once on mount whether this mount immediately follows a toggle.
  const [animate] = useState(consumeSidebarMorph);
  return (
    <button
      type="button"
      data-med-tool-button=""
      data-sidebar-toggle={open ? "open" : "closed"}
      aria-label={label}
      aria-pressed={open}
      onClick={() => {
        markSidebarToggled();
        onClick();
      }}
      {...tooltip(label, shortcut)}
      {...stylex.props(ui.button, ui.iconButton, ui.pressable, styles.button)}
    >
      <span {...stylex.props(styles.iconWrap)}>
        <svg
          width={15}
          height={15}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.45}
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          {...stylex.props(styles.svg)}
        >
          {/* Outer frame */}
          <rect x="1.75" y="2.5" width="12.5" height="11" rx="2.25" />
          {/* Left sidebar compartment fill: collapses cleanly when closed */}
          <rect
            x="2.5"
            y="3.25"
            width="3.75"
            height="9.5"
            rx="1.1"
            fill="currentColor"
            stroke="none"
            {...stylex.props(
              styles.paneFill,
              open ? styles.paneOpen : styles.paneClosed,
              animate && (open ? styles.animPaneOpen : styles.animPaneClosed),
            )}
          />
          {/* Inner vertical rail divider */}
          <line
            x1="6.25"
            y1="2.75"
            x2="6.25"
            y2="13.25"
            {...stylex.props(
              styles.rail,
              open ? styles.railOpen : styles.railClosed,
              animate && (open ? styles.animRailOpen : styles.animRailClosed),
            )}
          />
          {/* Subtle directional chevron inside the main pane */}
          <path
            d="m10.75 6.25-1.75 1.75 1.75 1.75"
            {...stylex.props(
              styles.chevron,
              open ? styles.chevronOpen : styles.chevronClosed,
              animate && (open ? styles.animChevronOpen : styles.animChevronClosed),
            )}
          />
        </svg>
        {dot && <span data-dot="" aria-hidden="true" {...stylex.props(styles.dot)} />}
      </span>
    </button>
  );
}

const reduced = "@media (prefers-reduced-motion: reduce)";
const hoverFine = "@media (any-hover: hover) and (any-pointer: fine)";
const MORPH = "200ms";
const EASE = "cubic-bezier(0.22, 1, 0.36, 1)";

const paneToOpen = stylex.keyframes({
  from: { transform: "scaleX(0.15)", opacity: 0 },
  to: { transform: "scaleX(1)", opacity: 0.32 },
});

const paneToClosed = stylex.keyframes({
  from: { transform: "scaleX(1)", opacity: 0.32 },
  to: { transform: "scaleX(0.15)", opacity: 0 },
});

const railToOpen = stylex.keyframes({
  from: { transform: "translateX(-1.35px)" },
  to: { transform: "translateX(0px)" },
});

const railToClosed = stylex.keyframes({
  from: { transform: "translateX(0px)" },
  to: { transform: "translateX(-1.35px)" },
});

const chevronToOpen = stylex.keyframes({
  from: { transform: "translateX(0.5px) scaleX(-1)", opacity: 0.55 },
  to: { transform: "translateX(0px) scaleX(1)", opacity: 0.9 },
});

const chevronToClosed = stylex.keyframes({
  from: { transform: "translateX(0px) scaleX(1)", opacity: 0.9 },
  to: { transform: "translateX(0.5px) scaleX(-1)", opacity: 0.72 },
});

const styles = stylex.create({
  button: {
    "--med-sb-nudge": {
      default: "0px",
      [hoverFine]: {
        default: "0px",
        ":hover": "1px",
      },
    },
  },
  iconWrap: {
    position: "relative",
    display: "inline-flex",
  },
  svg: {
    flexShrink: 0,
    overflow: "visible",
  },
  paneFill: {
    transformBox: "fill-box",
    transformOrigin: "left center",
    transitionProperty: "transform, opacity",
    transitionDuration: { default: "150ms", [reduced]: "0ms" },
    transitionTimingFunction: EASE,
  },
  paneOpen: {
    opacity: 0.32,
    transform: "scaleX(1)",
  },
  paneClosed: {
    opacity: 0,
    transform: "scaleX(0.15)",
  },
  animPaneOpen: {
    animationName: { default: paneToOpen, [reduced]: "none" },
    animationDuration: MORPH,
    animationTimingFunction: EASE,
    animationFillMode: "both",
  },
  animPaneClosed: {
    animationName: { default: paneToClosed, [reduced]: "none" },
    animationDuration: MORPH,
    animationTimingFunction: EASE,
    animationFillMode: "both",
  },
  rail: {
    transitionProperty: "transform",
    transitionDuration: { default: "150ms", [reduced]: "0ms" },
    transitionTimingFunction: EASE,
  },
  railOpen: {
    transform: "translateX(calc(var(--med-sb-nudge) * -0.55))",
  },
  railClosed: {
    transform: "translateX(calc(-1.35px + var(--med-sb-nudge) * 0.65))",
  },
  animRailOpen: {
    animationName: { default: railToOpen, [reduced]: "none" },
    animationDuration: MORPH,
    animationTimingFunction: EASE,
  },
  animRailClosed: {
    animationName: { default: railToClosed, [reduced]: "none" },
    animationDuration: MORPH,
    animationTimingFunction: EASE,
  },
  chevron: {
    transformBox: "fill-box",
    transformOrigin: "center",
    transitionProperty: "transform, opacity",
    transitionDuration: { default: "150ms", [reduced]: "0ms" },
    transitionTimingFunction: EASE,
  },
  chevronOpen: {
    opacity: 0.85,
    transform: "translateX(calc(var(--med-sb-nudge) * -0.8)) scaleX(1)",
  },
  chevronClosed: {
    opacity: 0.72,
    transform: "translateX(calc(0.35px + var(--med-sb-nudge) * 0.8)) scaleX(-1)",
  },
  animChevronOpen: {
    animationName: { default: chevronToOpen, [reduced]: "none" },
    animationDuration: MORPH,
    animationTimingFunction: EASE,
  },
  animChevronClosed: {
    animationName: { default: chevronToClosed, [reduced]: "none" },
    animationDuration: MORPH,
    animationTimingFunction: EASE,
  },
  dot: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 6,
    height: 6,
    borderRadius: "50%",
    backgroundColor: tokens.accent,
    boxShadow: `0 0 0 1.5px ${tokens.panel}`,
  },
});
