import { useFrameSelection } from "@workbench/elements/frames";
import { useEffect, useState } from "react";
import { useParams } from "react-router";
import { silenceVibration } from "./frame-sandbox";
import { frameSpecimen } from "./frame-specimens";
import { keepLinksInPlace } from "./selection";
import { FRAME_READY } from "./stage";

/**
 * One specimen alone at device size. The Elements page changes its state
 * with `elements:state` messages, so a change does not reload the frame.
 * Each choice mounts the specimen again, so choosing a state again replays it.
 */
export function ElementsFrame() {
  const { specimenId = "" } = useParams();
  const specimen = frameSpecimen(specimenId);
  const selection = useFrameSelection(specimen?.states[0]?.id ?? "");
  useState(silenceVibration);

  useEffect(() => {
    document.title = `${specimen?.title ?? "Specimen"} · Elements · Spaced`;
    if (window.parent !== window)
      window.parent.postMessage({ type: FRAME_READY }, location.origin);
  }, [specimen]);

  if (!specimen)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No specimen named “{specimenId}”.
      </p>
    );
  return (
    <div className="min-h-svh" onClickCapture={keepLinksInPlace}>
      <specimen.Component
        key={`${selection.state}:${selection.nonce}`}
        state={selection.state}
        nonce={selection.nonce}
      />
    </div>
  );
}
