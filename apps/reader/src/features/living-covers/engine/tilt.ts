import { useSyncExternalStore } from "react";

/**
 * How the reader holds the phone, as a tilt from -1 to 1 on each axis.
 *
 * The neutral pose follows the phone slowly, so any way of holding it rests
 * at the centre and only a turn of the wrist moves the light. Without a
 * gyroscope, a pointer over the page or a drag on a book stands in.
 *
 * iOS asks for motion access, and only from a tap. `requestTilt` must run
 * in a click handler; after one grant, the first tap of a later visit asks
 * again silently, because iOS remembers the answer for the site.
 */

export type TiltPermission = "unsupported" | "prompt" | "granted" | "denied";

interface TiltState {
  /** Where the input says the tilt is. */
  target: { x: number; y: number };
  /** Set while a finger or mouse drags a book; it wins over the gyroscope. */
  drag: { x: number; y: number } | null;
  permission: TiltPermission;
  /** True once the gyroscope has reported. */
  live: boolean;
}

const GRANTED_KEY = "reader-living-covers-tilt-granted";
/** Degrees of wrist turn that reach the edge of the range. */
const RANGE_DEGREES = 18;
/** How fast the neutral pose follows the phone, per event. */
const NEUTRAL_FOLLOW = 0.015;

type OrientationEventWithPermission = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

const listeners = new Set<() => void>();
const state: TiltState = {
  target: { x: 0, y: 0 },
  drag: null,
  permission: initialPermission(),
  live: false,
};
let snapshot = { permission: state.permission, live: state.live };
let neutral: { beta: number; gamma: number } | null = null;
let started = false;

function initialPermission(): TiltPermission {
  if (typeof window === "undefined" || !("DeviceOrientationEvent" in window))
    return "unsupported";
  const event = DeviceOrientationEvent as OrientationEventWithPermission;
  if (typeof event.requestPermission !== "function") return "granted";
  return "prompt";
}

function publish() {
  if (
    snapshot.permission !== state.permission ||
    snapshot.live !== state.live
  ) {
    snapshot = { permission: state.permission, live: state.live };
  }
  for (const listener of listeners) listener();
}

function clamp(value: number) {
  return Math.max(-1, Math.min(1, value));
}

function handleOrientation(event: DeviceOrientationEvent) {
  if (event.beta === null || event.gamma === null) return;
  let beta = event.beta;
  let gamma = event.gamma;
  // In landscape the axes swap.
  const angle = screen.orientation?.angle ?? 0;
  if (angle === 90) [beta, gamma] = [-gamma, beta];
  else if (angle === 270 || angle === -90) [beta, gamma] = [gamma, -beta];
  if (!neutral) neutral = { beta, gamma };
  neutral.beta += (beta - neutral.beta) * NEUTRAL_FOLLOW;
  neutral.gamma += (gamma - neutral.gamma) * NEUTRAL_FOLLOW;
  state.target = {
    x: clamp((gamma - neutral.gamma) / RANGE_DEGREES),
    y: clamp((beta - neutral.beta) / RANGE_DEGREES),
  };
  if (!state.live) {
    state.live = true;
  }
  publish();
}

function handlePointer(event: PointerEvent) {
  if (state.live || event.pointerType === "touch") return;
  // The eye follows the pointer, as if the phone turned away from it.
  state.target = {
    x: clamp((0.5 - event.clientX / window.innerWidth) * 1.6),
    y: clamp((0.5 - event.clientY / window.innerHeight) * 1.6),
  };
  publish();
}

function listen() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("pointermove", handlePointer, { passive: true });
  if (state.permission === "granted") {
    window.addEventListener("deviceorientation", handleOrientation);
  } else if (state.permission === "prompt" && readGranted()) {
    // A grant from an earlier visit: renew it on the first tap.
    window.addEventListener(
      "click",
      () => {
        void requestTilt();
      },
      { once: true, capture: true },
    );
  }
}

function readGranted() {
  try {
    return localStorage.getItem(GRANTED_KEY) === "true";
  } catch {
    return false;
  }
}

/** Ask for motion access. Call from a tap. */
export async function requestTilt(): Promise<TiltPermission> {
  const event = DeviceOrientationEvent as OrientationEventWithPermission;
  if (typeof event.requestPermission !== "function") return state.permission;
  try {
    const answer = await event.requestPermission();
    state.permission = answer;
    if (answer === "granted") {
      try {
        localStorage.setItem(GRANTED_KEY, "true");
      } catch {
        // The grant still holds for this visit.
      }
      window.addEventListener("deviceorientation", handleOrientation);
    }
  } catch {
    // Not from a tap, or the browser refused: ask again on the next one.
    state.permission = "prompt";
  }
  publish();
  return state.permission;
}

export function subscribeTilt(listener: () => void): () => void {
  listen();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The input's current tilt, before smoothing. */
export function readTilt(): { x: number; y: number } {
  return state.drag ?? state.target;
}

/** The drag on a book, if one is held. */
export function readDragTilt(): { x: number; y: number } | null {
  return state.drag;
}

/** A book being dragged sets the tilt directly; `null` lets go. */
export function setDragTilt(value: { x: number; y: number } | null): void {
  state.drag = value && { x: clamp(value.x), y: clamp(value.y) };
  publish();
}

/** Simulated tilt for recordings and tests: `window.__livingCoverTilt(x, y)`. */
export function setSimulatedTilt(x: number, y: number): void {
  state.live = true;
  state.target = { x: clamp(x), y: clamp(y) };
  publish();
}

export function useTiltPermission(): {
  permission: TiltPermission;
  live: boolean;
} {
  return useSyncExternalStore(
    subscribeTilt,
    () => snapshot,
    () => snapshot,
  );
}
