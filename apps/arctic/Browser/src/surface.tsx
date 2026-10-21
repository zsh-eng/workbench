import { useEffect, useState, useSyncExternalStore } from "react";
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

let sheet: typeof import("./sheet") | undefined;
let loading: Promise<unknown> | undefined;
const loadSheet = () =>
  (loading ??= import("./sheet").then((module) => (sheet = module)));

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
  const [, setLoaded] = useState(false);
  if (props.isOpen && !used) setUsed(true);
  useEffect(() => {
    if (used && !sheet) void loadSheet().then(() => setLoaded(true));
  }, [used]);
  // Loaded code renders in the same commit as the tap, so a field in the
  // sheet can take focus in that tap and the phone opens its keyboard.
  // React.lazy would wait a task, even for code that is already here.
  if (!used || !sheet) return null;
  return <sheet.Sheet {...props} />;
}
