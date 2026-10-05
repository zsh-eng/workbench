/**
 * The System prototype on its own, filling the window.
 */
import { useStudioLibrary } from "../data/use-studio-library";
import "../studio.css";
import { SystemPrototype } from "./SystemPrototype";

export function SystemPage() {
  const studio = useStudioLibrary();
  return (
    <div className="h-svh w-full">
      <SystemPrototype key={studio.source} library={studio.library} />
    </div>
  );
}
