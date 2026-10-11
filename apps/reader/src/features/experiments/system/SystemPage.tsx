/**
 * The System prototype on its own, filling the window. `?nav=header` shows
 * the variant without a sidebar.
 */
import { useSearchParams } from "react-router-dom";
import { useStudioLibrary } from "../data/use-studio-library";
import "../studio.css";
import { SystemPrototype } from "./SystemPrototype";

export function SystemPage() {
  const studio = useStudioLibrary();
  const [params] = useSearchParams();
  return (
    <div className="h-svh w-full">
      <SystemPrototype
        key={studio.source}
        library={studio.library}
        nav={params.get("nav") === "header" ? "header" : "sidebar"}
      />
    </div>
  );
}
