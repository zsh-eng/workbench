import * as stylex from "@stylexjs/stylex";
import { useId } from "react";
import { tokens } from "../theme.stylex";
import "./StreamEnd.css";

/**
 * What the end of Changes says: how many changed files the stream showed, and
 * of how many when a filter hides some. It is true of a saved review, a
 * branch, working changes, a commit, and a range alike.
 */
export function streamEndLabel(shown: number, total: number) {
  if (shown < total) return `${shown} of ${total} changed files`;
  return `${shown} changed ${shown === 1 ? "file" : "files"}`;
}

/**
 * The end of the Changes stream: Med's sun on its horizon, with the icon's
 * dawn (or night) colours bleeding up from the bottom edge, and the count of
 * files. Drawn with gradients and two paths, so nothing loads; StreamEnd.css
 * raises the sun as the reader arrives.
 */
export function StreamEnd({ shown, total }: { shown: number; total: number }) {
  // A reference to the clip, which is in each pane's end: React's id, as a
  // name that url() reads without escapes.
  const sky = `stream-sky-${useId().replace(/[^\w-]/g, "")}`;
  return (
    <div data-stream-end="" {...stylex.props(styles.root)}>
      <span data-stream-dawn="" aria-hidden="true" {...stylex.props(styles.dawn)} />
      <div {...stylex.props(styles.horizonRow)}>
        <span aria-hidden="true" {...stylex.props(styles.horizon)} />
        {/* The icon's sun, with its reflection a little to the right. The
            sky clips the sun, so that it comes up from behind the horizon. */}
        <svg viewBox="0 0 36 36" aria-hidden="true" {...stylex.props(styles.sun)}>
          <clipPath id={sky}>
            <rect width="36" height="18" />
          </clipPath>
          <g clipPath={`url(#${sky})`}>
            <path
              data-stream-sun=""
              d="M0 16A15 15 0 0 1 30 16Z"
              {...stylex.props(styles.sunHalf)}
            />
          </g>
          <path
            data-stream-reflection=""
            d="M6 20A15 15 0 0 0 36 20Z"
            {...stylex.props(styles.reflection)}
          />
        </svg>
      </div>
      <p {...stylex.props(styles.count)}>{streamEndLabel(shown, total)}</p>
    </div>
  );
}

// The icon's colours, at dawn or at night by the theme's appearance
// (StreamEnd.css). The build turns light-dark() into variables that only a
// stylesheet's color-scheme sets, and Med sets it on the root at run time.
const skyColor = "var(--med-stream-sky)";
const glowColor = "var(--med-stream-glow)";
const seaColor = "var(--med-stream-sea)";

const styles = stylex.create({
  root: {
    position: "relative",
    isolation: "isolate",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 14,
    // Room after the last file, so the end does not crowd its diff.
    paddingTop: 48,
    paddingBottom: 30,
    paddingInline: 24,
  },
  // The colours rise from the bottom and thin out above the horizon: the sky
  // on one side, the sea on the other, the dawn between.
  dawn: {
    position: "absolute",
    inset: 0,
    zIndex: -1,
    pointerEvents: "none",
    backgroundImage: `radial-gradient(34% 82% at 50% 100%, ${glowColor}, transparent), radial-gradient(38% 70% at 18% 100%, ${skyColor}, transparent), radial-gradient(38% 70% at 82% 100%, ${seaColor}, transparent)`,
    // The floor (StreamEnd.css) is 1 where the end meets the pane's bottom edge.
    maskImage:
      "linear-gradient(to top, rgb(0 0 0 / var(--med-stream-floor, 0)), #000 24%, rgb(0 0 0 / 0.4) 58%, transparent 90%)",
  },
  horizonRow: {
    position: "relative",
    display: "flex",
    justifyContent: "center",
    alignSelf: "stretch",
  },
  horizon: {
    position: "absolute",
    insetInline: 0,
    top: "50%",
    height: 1,
    marginTop: -0.5,
    backgroundImage:
      "linear-gradient(to right, transparent 12%, var(--med-stream-horizon) 50%, transparent 88%)",
  },
  sun: {
    position: "relative",
    display: "block",
    width: 24,
    height: 24,
    overflow: "visible",
    // A light page is as pale as the sun, so a dawn rim draws its edge.
    filter:
      "drop-shadow(0 0 1px var(--med-stream-rim)) drop-shadow(0 0 6px var(--med-stream-halo))",
  },
  sunHalf: { fill: "#fffaf1" },
  reflection: { fill: "#fffaf1", fillOpacity: "var(--med-stream-reflection)" },
  count: {
    margin: 0,
    color: tokens.muted,
    fontFamily: tokens.ui,
    fontSize: 11.5,
    lineHeight: "16px",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  },
});
