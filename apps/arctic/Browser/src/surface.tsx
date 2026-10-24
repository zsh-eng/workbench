import {
  useEffect,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import type { SheetProps } from "./sheet";
import { showToast } from "./state";

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

/**
 * How much of the window the phone keyboard covers. It covers the page
 * without resizing it; the visual viewport is what stays in view.
 */
export function keyboardHeight() {
  const viewport = window.visualViewport;
  return viewport
    ? Math.max(0, innerHeight - viewport.height - viewport.offsetTop)
    : 0;
}

/** Keeps a bar fixed at the bottom above the keyboard while `active`. */
export function useAboveKeyboard(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
) {
  useEffect(() => {
    const element = ref.current;
    const viewport = window.visualViewport;
    if (!active || !element || !viewport) return;
    const place = () => {
      const keyboard = keyboardHeight();
      element.style.transform = keyboard
        ? `translateY(${-Math.round(keyboard)}px)`
        : "";
    };
    place();
    viewport.addEventListener("resize", place);
    viewport.addEventListener("scroll", place);
    return () => {
      viewport.removeEventListener("resize", place);
      viewport.removeEventListener("scroll", place);
      element.style.transform = "";
    };
  }, [ref, active]);
}

type SheetModule = typeof import("./sheet");
let sheet: SheetModule | undefined;
let loading: Promise<SheetModule> | undefined;
let retryURL: string | undefined;

/**
 * Loads the sheet's code once. A failed load is forgotten, so the next sheet
 * tries again. The browser also remembers a module that failed to fetch, for
 * the life of the page, so the next try asks for the same file at a new
 * address (Chromium's error names the file; Safari's does not).
 */
function loadSheet() {
  loading ??= (
    retryURL ? import(/* @vite-ignore */ retryURL) : import("./sheet")
  ).then(
    (module: SheetModule) => (sheet = module),
    (error: unknown) => {
      loading = undefined;
      const file = /https?:\/\/\S+?\.(?:js|tsx)\b/.exec(String(error))?.[0];
      if (file) retryURL = `${file}?retry=${Date.now()}`;
      throw error;
    },
  );
  return loading;
}

/**
 * React Aria's sheet stays out of the first load. A phone loads it just
 * after the first page appears (24 kB compressed, from the service worker's
 * cache), so the first sheet opens at once.
 */
export function preloadSheet() {
  if (!compact.matches || sheet) return;
  const load = () => void loadSheet().catch(() => {});
  if (typeof requestIdleCallback === "function")
    requestIdleCallback(load, { timeout: 400 });
  else setTimeout(load, 100);
}

export function Sheet(props: SheetProps) {
  // A sheet that never opened needs no code.
  const [used, setUsed] = useState(props.isOpen);
  const [, setLoaded] = useState(false);
  if (props.isOpen && !used) setUsed(true);
  const { isOpen, onOpenChange } = props;
  useEffect(() => {
    if (!isOpen || sheet) return;
    let current = true;
    loadSheet().then(
      () => current && setLoaded(true),
      () => {
        // Closed, so the next tap opens it again and tries the code again.
        if (!current) return;
        onOpenChange(false);
        showToast(
          "Arctic could not open this. Check the connection and try again.",
        );
      },
    );
    return () => {
      current = false;
    };
  }, [isOpen, onOpenChange]);
  // Loaded code renders in the same commit as the tap, so a field in the
  // sheet can take focus in that tap and the phone opens its keyboard.
  // React.lazy would wait a task, even for code that is already here.
  if (!used || !sheet) return null;
  return <sheet.Sheet {...props} />;
}
