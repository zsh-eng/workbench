import { Button } from "@/components/ui/button";
import type { Beat } from "@workbench/elements";
import {
  formatSeconds,
  type DemoControls as DemoApi,
} from "@workbench/elements/react";
import { RefreshCcw } from "lucide-react";
import { Choice } from "./Choice";

const SPEEDS = [
  { id: "0.25", label: "0.25×" },
  { id: "1", label: "1×" },
] as const;

/**
 * Controls for a demo from `useDemoPlayer`. A run gets one Replay or Reset
 * button. A timeline gets Play, Pause or Replay, a scrubber with its beats,
 * the time, and a speed choice for studying a curve.
 */
export function DemoControls({
  demo,
  label,
  beats = [],
  restartLabel = "Replay",
}: {
  demo: DemoApi;
  /** Names the demo for assistive technology, for example "Card enter". */
  label: string;
  beats?: readonly Beat[];
  restartLabel?: "Replay" | "Reset";
}) {
  const { state, player } = demo;
  if (state.kind === "run") {
    const restart = demo.restartButtonProps(restartLabel);
    return (
      <Button
        variant="outline"
        size="sm"
        {...restart}
        aria-label={`${restartLabel} ${label}`}
      >
        <RefreshCcw aria-hidden="true" />
        {restartLabel}
      </Button>
    );
  }

  const play = demo.playButtonProps();
  const span = state.end - state.start || 1;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        className="size-8"
        title={play["aria-label"]}
        {...play}
      >
        {play["data-action"] === "pause" ? (
          <PauseIcon />
        ) : play["data-action"] === "replay" ? (
          <RefreshCcw aria-hidden="true" />
        ) : (
          <PlayIcon />
        )}
      </Button>
      <div
        {...demo.scrubberProps(`${label} timeline`)}
        className="group relative h-8 w-36 cursor-pointer rounded-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring sm:w-44"
      >
        <span className="absolute inset-x-1.5 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-primary"
            style={{ width: "calc(var(--demo-progress) * 100%)" }}
          />
          {beats.map((beat) => (
            <span
              key={beat.label}
              title={beat.label}
              className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground/40"
              style={{ left: `${((beat.at - state.start) / span) * 100}%` }}
            />
          ))}
          <span
            className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background shadow-sm"
            style={{ left: "calc(var(--demo-progress) * 100%)" }}
          />
        </span>
      </div>
      <span className="min-w-24 text-xs tabular-nums text-muted-foreground">
        {formatSeconds(state.time)}
        {state.beat && ` · ${state.beat.label}`}
      </span>
      <Choice
        label={`${label} speed`}
        value={String(state.speed)}
        options={SPEEDS}
        onChange={(speed) => player.setSpeed(Number(speed))}
      />
    </div>
  );
}

// The app's icon set has no play or pause glyphs; these match its strokes.
function PlayIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
