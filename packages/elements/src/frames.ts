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
  const natural = devices.reduce((sum, id) => sum + DEVICES[id].width, 0);
  // Only the devices scale. The gaps and each frame's 1px borders keep their
  // size, so they come off the width first.
  const fixed = ROW_GAP_PX * (devices.length - 1) + devices.length * 2;
  const scale =
    zoom === "actual" || width === 0
      ? 1
      : Math.min(1, Math.max(0, width - fixed) / natural);
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
 * The frame side of `FrameMessage`: the state from `?state=`, then from the
 * page's messages. Only messages from this origin count.
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
    return () => window.removeEventListener("message", receive);
  }, []);
  return selection;
}
