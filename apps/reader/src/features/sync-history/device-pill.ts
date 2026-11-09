import type { DeviceType } from "@/types/session";

/** A device as Activity names it beside a change: "this iPhone", "your Mac". */
export interface DevicePill {
  words: string;
  type: DeviceType | null;
  /** The device you're holding, which wears the ribbon. */
  here: boolean;
}

/** How Activity's book rows name the device a change came from. */
export interface DevicePillNamer {
  pill(deviceId: string | null): DevicePill;
}

/**
 * The device you're holding, which can tell what the server cannot: an iPad
 * sends a Mac's user agent but has touch points, and no Mac does. Chrome on
 * a large Android tablet may ask for desktop sites and say Linux; touch
 * tells that apart from a computer too.
 */
export function deviceHere(): { label: string; type: DeviceType | null } {
  const agent = navigator.userAgent;
  const touch = navigator.maxTouchPoints > 1;
  if (/iPhone|iPod/.test(agent)) return { label: "iPhone", type: "mobile" };
  if (/iPad/.test(agent) || (/Macintosh/.test(agent) && touch))
    return { label: "iPad", type: "tablet" };
  if (/Macintosh/.test(agent)) return { label: "Mac", type: "desktop" };
  if (/Android/.test(agent))
    return /Mobile/.test(agent)
      ? { label: "Android phone", type: "mobile" }
      : { label: "Android tablet", type: "tablet" };
  if (/CrOS/.test(agent)) return { label: "Chromebook", type: "desktop" };
  if (/Windows/.test(agent)) return { label: "Windows PC", type: "desktop" };
  if (/Linux/.test(agent))
    return touch
      ? { label: "Android tablet", type: "tablet" }
      : { label: "Linux computer", type: "desktop" };
  return { label: "device", type: null };
}
