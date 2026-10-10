import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { FrameMessage } from "./DeviceFrame";
import { SPECIMENS } from "./specimens";

/**
 * One specimen alone in a device frame. The Elements page changes its state
 * with a message, so a change does not reload the frame.
 */
export function ElementsFrame() {
  const { specimenId } = useParams();
  const specimen = SPECIMENS.find((item) => item.id === specimenId);
  const [selection, setSelection] = useState(() => ({
    state:
      new URLSearchParams(location.search).get("state") ??
      specimen?.states[0]?.id ??
      "",
    nonce: 0,
  }));
  useEffect(() => {
    const receive = (event: MessageEvent<FrameMessage>) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type !== "elements:state") return;
      setSelection({ state: event.data.state, nonce: event.data.nonce });
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  if (!specimen)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No specimen named “{specimenId}”.
      </p>
    );
  return <specimen.Component state={selection.state} nonce={selection.nonce} />;
}
