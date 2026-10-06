import { useSyncExternalStore } from "react";

const query = typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;

export function reducedMotion(): boolean {
  return query?.matches ?? false;
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (listener) => {
      query?.addEventListener("change", listener);
      return () => query?.removeEventListener("change", listener);
    },
    reducedMotion,
  );
}

/** Mirrors the CSS tokens. */
export const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
export const EASE_IN_OUT = "cubic-bezier(0.65, 0, 0.35, 1)";
export const T_FAST = 140;
export const T_MID = 220;
export const T_SLOW = 300;
