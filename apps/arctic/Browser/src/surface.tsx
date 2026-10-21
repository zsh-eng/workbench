import { Suspense, lazy, useState, useSyncExternalStore } from "react";
import type { SheetProps } from "./sheet";

/**
 * Phones get sheets; wider windows get popovers and menus by their controls.
 * One width decides, so a narrow desktop window behaves as a phone does.
 */
const compact = matchMedia("(max-width: 720px)");

export function useCompact() {
  return useSyncExternalStore(
    (listener) => {
      compact.addEventListener("change", listener);
      return () => compact.removeEventListener("change", listener);
    },
    () => compact.matches,
  );
}

/** A window wide enough for the library's sidebar. */
const wide = matchMedia("(min-width: 1100px)");

export function useWide() {
  return useSyncExternalStore(
    (listener) => {
      wide.addEventListener("change", listener);
      return () => wide.removeEventListener("change", listener);
    },
    () => wide.matches,
  );
}

const loadSheet = () => import("./sheet");
const LazySheet = lazy(() =>
  loadSheet().then((module) => ({ default: module.Sheet })),
);

/**
 * React Aria's sheet stays out of the first load. A phone loads it just
 * after the library appears (24 kB compressed, from the service worker's
 * cache), so the first sheet opens at once.
 */
export function preloadSheet() {
  if (!compact.matches) return;
  const load = () => void loadSheet();
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(load, { timeout: 400 });
  else setTimeout(load, 100);
}

export function Sheet(props: SheetProps) {
  // A sheet that never opened needs no code.
  const [used, setUsed] = useState(props.isOpen);
  if (props.isOpen && !used) setUsed(true);
  if (!used) return null;
  return (
    <Suspense fallback={null}>
      <LazySheet {...props} />
    </Suspense>
  );
}
