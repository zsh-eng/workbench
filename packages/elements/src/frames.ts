import { useEffect, useLayoutEffect, useRef, useState } from "react";

/** The device sizes that Elements pages show, in CSS pixels. */
export const DEVICES = {
  desktop: { label: "Desktop", width: 1280, height: 800 },
  phone: { label: "Phone", width: 390, height: 844 },
} as const;

export type DeviceId = keyof typeof DEVICES;

/**
 * The page tells a specimen frame which state to show. The nonce changes on
 * every choice, so choosing the current state again replays it.
 */
export interface FrameMessage {
  type: "elements:state";
  state: string;
  nonce: number;
}

const ROW_GAP_PX = 24;

/**
 * One scale for a row of device frames, so that the row fits its container.
 * "actual" shows device pixels and lets the row scroll.
 */
export function useDeviceRowScale(
  devices: readonly DeviceId[],
  zoom: "fit" | "actual",
) {
  const row = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = row.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const natural =
    devices.reduce((sum, id) => sum + DEVICES[id].width, 0) +
    ROW_GAP_PX * (devices.length - 1);
  // Each frame has a 1px border on both sides.
  const borders = devices.length * 2;
  const scale =
    zoom === "actual" || width === 0
      ? 1
      : Math.min(1, (width - borders) / natural);
  return { row, scale, gap: ROW_GAP_PX };
}

/** True once `node` comes within `margin` of the view; it then stays true. */
export function useNearView<T extends Element>(margin = "600px") {
  const ref = useRef<T>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setNear(true);
      },
      { rootMargin: `${margin} 0px` },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near, margin]);
  return { ref, near };
}

/**
 * A frame says it is ready once its listeners are in place. The page then
 * sends its messages again: a lazy route can mount long after the frame's
 * load event, and messages sent before then are lost.
 */
export interface FrameReadyMessage {
  type: "elements:ready";
}

/** True for a ready message from `frame`. Use it on the page side. */
export function isFrameReady(
  event: MessageEvent,
  frame: HTMLIFrameElement | null,
) {
  return (
    event.origin === location.origin &&
    !!frame &&
    event.source === frame.contentWindow &&
    (event.data as FrameReadyMessage | undefined)?.type === "elements:ready"
  );
}

/**
 * The frame side of `FrameMessage`: the state from `?state=`, then from the
 * page's messages. Only messages from this origin count. It tells the page
 * when it is ready, so put it in the frame's top component.
 */
export function useFrameSelection(fallback: string) {
  const [selection, setSelection] = useState(() => ({
    state: new URLSearchParams(location.search).get("state") ?? fallback,
    nonce: 0,
  }));
  useEffect(() => {
    const receive = (event: MessageEvent<FrameMessage>) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type !== "elements:state") return;
      setSelection({ state: event.data.state, nonce: event.data.nonce });
    };
    window.addEventListener("message", receive);
    if (window.parent !== window) {
      const ready: FrameReadyMessage = { type: "elements:ready" };
      window.parent.postMessage(ready, location.origin);
    }
    return () => window.removeEventListener("message", receive);
  }, []);
  return selection;
}

/**
 * The page drives a timeline inside a frame, for example to scrub a sheet
 * that the frame owns. `time: null` gives control back to the frame.
 */
export interface FrameTimeMessage {
  type: "elements:time";
  time: number | null;
}

/** The frame side of `FrameTimeMessage`: seconds, or null when released. */
export function useFrameTime() {
  const [time, setTime] = useState<number | null>(null);
  useEffect(() => {
    const receive = (event: MessageEvent<FrameTimeMessage>) => {
      if (event.origin !== location.origin) return;
      if (event.data?.type !== "elements:time") return;
      setTime(event.data.time);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);
  return time;
}
