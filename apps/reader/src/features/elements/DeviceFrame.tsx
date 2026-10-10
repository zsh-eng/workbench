import { THEME_CLASSES, type ReaderTheme } from "@/types/reader.types";
import { cn } from "@/lib/utils";
import { ExternalLink, RotateCw } from "lucide-react";
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

export const DEVICES = {
  desktop: { label: "Desktop", width: 1280, height: 800 },
  phone: { label: "Phone", width: 390, height: 844 },
} as const;

export type DeviceId = keyof typeof DEVICES;

export interface StageSettings {
  theme: ReaderTheme;
  /** Fit scales each row to the page; actual shows device pixels. */
  zoom: "fit" | "actual";
}

export const StageContext = createContext<StageSettings>({
  theme: "light",
  zoom: "fit",
});

/** A state message for a specimen frame. The nonce replays the same state. */
export interface FrameMessage {
  type: "elements:state";
  state: string;
  nonce: number;
}

const GAP_PX = 24;

/** Width of a row of devices, so a row can share one scale. */
export function useRowScale(devices: readonly DeviceId[]) {
  const row = useRef<HTMLDivElement>(null);
  const { zoom } = useContext(StageContext);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = row.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const natural =
    devices.reduce((sum, id) => sum + DEVICES[id].width, 0) +
    GAP_PX * (devices.length - 1);
  // Each frame adds a 1px border on both sides.
  const borders = devices.length * 2;
  const scale =
    zoom === "actual" || width === 0
      ? 1
      : Math.min(1, (width - borders) / natural);
  return { row, scale };
}

/** A desktop and a phone of one address, at one scale. */
export function DevicePair({
  src,
  title,
  message,
  devices = ["desktop", "phone"],
}: {
  src: string;
  title: string;
  message?: FrameMessage;
  devices?: readonly DeviceId[];
}) {
  const { row, scale } = useRowScale(devices);
  return (
    <div
      ref={row}
      className="flex items-start overflow-x-auto pb-2"
      style={{ gap: GAP_PX }}
    >
      {devices.map((device) => (
        <DeviceFrame
          key={device}
          device={device}
          src={src}
          title={`${title}, ${DEVICES[device].label.toLowerCase()}`}
          scale={scale}
          message={message}
        />
      ))}
    </div>
  );
}

/**
 * One live frame of the app at a device size. Media queries, touch layout and
 * useIsMobile see the device width. The frame loads when it nears the screen
 * and then stays, so its state survives scrolling.
 */
export function DeviceFrame({
  device,
  src,
  title,
  scale,
  message,
}: {
  device: DeviceId;
  src: string;
  title: string;
  scale: number;
  message?: FrameMessage;
}) {
  const { width, height, label } = DEVICES[device];
  const { theme } = useContext(StageContext);
  const shell = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [near, setNear] = useState(false);
  const [loadKey, setLoadKey] = useState(0);
  // Each document load counts, so a full navigation inside the frame gets
  // the theme and state again.
  const [loads, setLoads] = useState(0);
  const loaded = loads > 0;

  useEffect(() => {
    const node = shell.current;
    if (!node || near) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setNear(true);
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [near]);

  // The frame shares this origin, so the theme applies to its document
  // without a saved setting. The app sets its own class once it mounts, so
  // the preview theme is restored whenever the class changes.
  useEffect(() => {
    const doc = loaded ? frame.current?.contentDocument : null;
    if (!doc) return;
    const root = doc.documentElement;
    const apply = () => {
      if (root.classList.contains(theme)) return;
      root.classList.remove(...THEME_CLASSES);
      root.classList.add(theme);
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [theme, loaded, loads]);

  useEffect(() => {
    if (!loaded || !message) return;
    frame.current?.contentWindow?.postMessage(message, location.origin);
  }, [message, loaded, loads]);

  return (
    <figure className="m-0 shrink-0">
      <figcaption className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-numeric tabular-nums">
          {width} × {height}
        </span>
        <span className="flex-1" />
        <button
          type="button"
          aria-label={`Reload ${title}`}
          title="Reload"
          onClick={() => {
            setLoads(0);
            setLoadKey((key) => key + 1);
          }}
          className="grid size-7 place-items-center rounded-lg hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <RotateCw className="size-3.5" aria-hidden="true" />
        </button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title} in a new tab`}
          title="Open in a new tab"
          className="grid size-7 place-items-center rounded-lg hover:bg-secondary hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      </figcaption>
      <div
        ref={shell}
        className={cn(
          "relative overflow-hidden border border-border bg-background shadow-sm",
          device === "phone" ? "rounded-[1.75rem]" : "rounded-xl",
        )}
        style={{ width: width * scale + 2, height: height * scale + 2 }}
      >
        {near && (
          <iframe
            key={loadKey}
            ref={frame}
            src={src}
            title={title}
            onLoad={() => setLoads((count) => count + 1)}
            className="absolute top-0 left-0 origin-top-left border-0"
            style={{ width, height, transform: `scale(${scale})` }}
          />
        )}
        {!loaded && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-xs text-muted-foreground">
            Loading…
          </div>
        )}
      </div>
    </figure>
  );
}
