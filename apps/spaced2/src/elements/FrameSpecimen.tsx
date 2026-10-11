import type { FrameMessage } from "@workbench/elements/frames";
import { useDemoPlayer } from "@workbench/elements/react";
import { useMemo } from "react";
import { Choice } from "./Choice";
import { DemoControls } from "./DemoControls";
import { DevicePair } from "./DeviceFrame";
import {
  frameSpecimen,
  specimenSrc,
  type FrameSpecimenId,
} from "./frame-specimens";
import { useSelection } from "./selection";

/**
 * A specimen in desktop and phone frames. The state row and Replay or Reset
 * send `elements:state` messages, so a change does not reload the frames.
 */
export function FrameSpecimen({ id }: { id: FrameSpecimenId }) {
  const specimen = frameSpecimen(id)!;
  const initial = specimen.states[0].id;
  const selection = useSelection(specimen.states);
  // Each state is a run: Replay when it plays by itself, Reset when it waits.
  const demo = useDemoPlayer();
  const current =
    specimen.states.find((state) => state.id === selection.state) ??
    specimen.states[0];
  const message = useMemo<FrameMessage>(
    () => ({
      type: "elements:state",
      state: selection.state,
      // Both counts only grow, so each choice or restart is a new nonce.
      nonce: selection.nonce + demo.state.run,
    }),
    [selection.state, selection.nonce, demo.state.run],
  );
  return (
    <figure className="m-0 min-w-0">
      <figcaption className="mb-3 flex flex-col gap-3">
        <div>
          <h3 className="text-sm font-medium">{specimen.title}</h3>
          <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
            {specimen.note}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {specimen.states.length > 1 && (
            <Choice
              label={`${specimen.title} state`}
              value={selection.state}
              options={specimen.states}
              onChange={selection.choose}
            />
          )}
          <DemoControls
            demo={demo}
            label={specimen.title}
            restartLabel={current.demo}
          />
        </div>
      </figcaption>
      <div
        ref={demo.stageRef}
        {...demo.stageProps()}
        className="rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <DevicePair
          src={specimenSrc(specimen.id, initial)}
          title={specimen.title}
          message={message}
        />
      </div>
    </figure>
  );
}
