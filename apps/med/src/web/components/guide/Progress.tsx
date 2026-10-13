import * as stylex from "@stylexjs/stylex";
import { tokens } from "../../theme.stylex";
import { Icon } from "../Icon";

/** A segment's viewed files as a small ring; a check once all are viewed. */
export function Progress({
  value,
  total,
  size = 16,
}: {
  value: number;
  total: number;
  size?: number;
}) {
  if (total > 0 && value >= total)
    return (
      <span {...stylex.props(styles.done, styles.size(size))} aria-hidden="true">
        <Icon name="check" size={size - 6} />
      </span>
    );
  const radius = size / 2 - 1.5;
  const length = 2 * Math.PI * radius;
  const share = total ? value / total : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      {...stylex.props(styles.ring)}
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth="1.5"
        {...stylex.props(styles.track)}
      />
      {share > 0 && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray={`${length * share} ${length}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          {...stylex.props(styles.fill)}
        />
      )}
    </svg>
  );
}

const styles = stylex.create({
  ring: { flexShrink: 0, marginTop: 1 },
  track: { stroke: tokens.lineStrong },
  fill: {
    stroke: tokens.green,
    transitionProperty: "stroke-dasharray",
    transitionDuration: "320ms",
    transitionTimingFunction: tokens.easeOut,
  },
  size: (size: number) => ({ width: size, height: size }),
  done: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginTop: 1,
    borderRadius: "50%",
    backgroundColor: tokens.green,
    color: tokens.canvas,
  },
});
