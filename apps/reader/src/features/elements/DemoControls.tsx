import {
  formatSeconds,
  type DemoControls as Demo,
} from "@workbench/elements/react";
import type { Beat } from "@workbench/elements";
import { Pause, Play, RotateCcw } from "lucide-react";
import { Choice } from "./ElementsLayout";

const SPEEDS = [
  { id: "0.25", label: "0.25×" },
  { id: "1", label: "1×" },
] as const;

/**
 * Reader's controls for a demo timeline: play, pause or replay, a scrubber
 * with its beats, and speed. The player is headless; this is its look.
 */
export function DemoControls({
  demo,
  beats = [],
  label,
}: {
  demo: Demo;
  beats?: readonly Beat[];
  label: string;
}) {
  const { state } = demo;
  const play = demo.playButtonProps();
  const span = state.end - state.start || 1;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-border/70 px-3 py-2">
      <button
        {...play}
        className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary text-foreground hover:bg-secondary/70 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {play["data-action"] === "pause" ? (
          <Pause className="size-3.5" aria-hidden="true" />
        ) : play["data-action"] === "replay" ? (
          <RotateCcw className="size-3.5" aria-hidden="true" />
        ) : (
          <Play className="size-3.5" aria-hidden="true" />
        )}
      </button>
      <div
        {...demo.scrubberProps(label)}
        className="group relative h-8 min-w-48 flex-1 cursor-pointer outline-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 rounded-full bg-border" />
        <div className="absolute top-1/2 left-0 h-0.5 w-[calc(var(--demo-progress)*100%)] -translate-y-1/2 rounded-full bg-foreground" />
        {beats.map((beat) => (
          <span
            key={beat.at}
            aria-hidden="true"
            className="absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground/60"
            style={{ left: `${((beat.at - state.start) / span) * 100}%` }}
          />
        ))}
        <span
          aria-hidden="true"
          className="absolute top-1/2 left-[calc(var(--demo-progress)*100%)] size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-sm transition-shadow group-focus-visible:ring-2 group-focus-visible:ring-ring"
        />
      </div>
      <p className="w-36 shrink-0 text-xs text-muted-foreground">
        <span className="font-numeric tabular-nums text-foreground">
          {formatSeconds(state.time - state.start)}
        </span>
        {state.beat && <> · {state.beat.label}</>}
      </p>
      <Choice
        label="Speed"
        value={String(state.speed) as (typeof SPEEDS)[number]["id"]}
        options={SPEEDS}
        onChange={(speed) => demo.player.setSpeed(Number(speed))}
      />
    </div>
  );
}
