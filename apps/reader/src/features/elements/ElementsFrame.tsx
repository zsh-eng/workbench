import { useFrameSelection } from "@workbench/elements/frames";
import { useParams } from "react-router-dom";
import { SPECIMENS } from "./specimens";

/**
 * One specimen alone in a device frame. The Elements page changes its state
 * with a message, so a change does not reload the frame.
 */
export function ElementsFrame() {
  const { specimenId } = useParams();
  const specimen = SPECIMENS.find((item) => item.id === specimenId);
  const selection = useFrameSelection(specimen?.states[0]?.id ?? "");
  if (!specimen)
    return (
      <p className="p-6 text-sm text-muted-foreground">
        No specimen named “{specimenId}”.
      </p>
    );
  return <specimen.Component state={selection.state} nonce={selection.nonce} />;
}
