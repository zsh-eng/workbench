import "./background-activity.css";
import type { CSSProperties } from "react";

/** Progress as a ring that fills. `null` is an unknown size: a slow sweep. */
export function ProgressRing({
  fraction,
  size = 18,
  className,
}: {
  fraction: number | null;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={["ba-ring", className].filter(Boolean).join(" ")}
      data-unknown={fraction === null || undefined}
      style={
        {
          "--ba-ring-size": `${size}px`,
          "--ba-fraction": fraction ?? 0,
        } as CSSProperties
      }
    >
      <svg viewBox="0 0 24 24">
        <circle className="ba-ring-track" cx="12" cy="12" r="10" />
        <circle
          className="ba-ring-fill"
          cx="12"
          cy="12"
          r="10"
          pathLength={1}
        />
      </svg>
    </span>
  );
}

/** A check that draws once when it mounts. */
export function DrawnCheck({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={["ba-check", className].filter(Boolean).join(" ")}
      style={{ "--ba-ring-size": `${size}px` } as CSSProperties}
    >
      <svg viewBox="0 0 24 24">
        <path d="M6.5 12.5 10.5 16.5 17.5 8" pathLength={1} />
      </svg>
    </span>
  );
}
