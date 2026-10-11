import { THEME_CLASSES, type ReaderTheme } from "@/types/reader.types";
import { cn } from "@/lib/utils";
import { ExternalLink, RotateCw } from "lucide-react";
import {
  DEVICES,
  useDeviceRowScale,
  useNearView,
  type DeviceId,
  type FrameMessage,
} from "@workbench/elements/frames";
import { createContext, useContext, useEffect, useRef, useState } from "react";

export { DEVICES, type DeviceId, type FrameMessage };

export interface StageSettings {
  theme: ReaderTheme;
  /** Fit scales each row to the page; actual shows device pixels. */
  zoom: "fit" | "actual";
}

export const StageContext = createContext<StageSettings>({
  theme: "light",
  zoom: "fit",
});

/** One scale for a row of devices, from the page's zoom. */
export function useRowScale(devices: readonly DeviceId[]) {
  const { zoom } = useContext(StageContext);
  return useDeviceRowScale(devices, zoom);
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
  const { row, scale, gap } = useRowScale(devices);
  return (
    <div
      ref={row}
      className="flex items-start overflow-x-auto pb-2"
      style={{ gap }}
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
 * Variants of one specimen side by side on one device, for example the
 * shipped design and a proposal. Each frame gets `variant=<id>`.
 */
export function VariantRow({
  src,
  title,
  message,
  device,
  variants,
}: {
  src: string;
  title: string;
  message?: FrameMessage;
  device: DeviceId;
  variants: readonly { id: string; label: string }[];
}) {
  const devices = variants.map(() => device);
  const { row, scale, gap } = useRowScale(devices);
  return (
    <div
      ref={row}
      className="flex items-start overflow-x-auto pb-2"
      style={{ gap }}
    >
      {variants.map((variant) => (
        <DeviceFrame
          key={variant.id}
          device={device}
          label={variant.label}
          src={`${src}${src.includes("?") ? "&" : "?"}variant=${variant.id}`}
          title={`${title}, ${variant.label.toLowerCase()}`}
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
  label = DEVICES[device].label,
}: {
  device: DeviceId;
  src: string;
  title: string;
  scale: number;
  message?: FrameMessage;
  /** Names the frame; the device name by default. */
  label?: string;
}) {
  const { width, height } = DEVICES[device];
  const { theme } = useContext(StageContext);
  const { ref: shell, near } = useNearView<HTMLDivElement>();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loadKey, setLoadKey] = useState(0);
  // Each document load counts, so a full navigation inside the frame gets
  // the theme and state again.
  const [loads, setLoads] = useState(0);
  const loaded = loads > 0;

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
