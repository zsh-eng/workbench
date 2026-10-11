import { Route, Routes } from "react-router";
import { ElementsFrame } from "./ElementsFrame";
import { ElementsPage } from "./ElementsPage";

/**
 * Routes under /debug/elements. App loads this module lazily, so the
 * Elements page and its sample data stay out of the first load.
 */
export default function ElementsRoutes() {
  return (
    <Routes>
      <Route index element={<ElementsPage />} />
      <Route path="frame/:specimenId" element={<ElementsFrame />} />
      <Route
        path="*"
        element={
          <p className="p-6 text-sm text-muted-foreground">
            No such page. Open <a href="/debug/elements">Elements</a>.
          </p>
        }
      />
    </Routes>
  );
}
