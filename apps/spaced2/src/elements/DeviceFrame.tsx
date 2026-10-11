import { cn } from "@/lib/utils";
import {
  DEVICES,
  isFrameReady,
  useDeviceRowScale,
  useNearView,
  type DeviceId,
  type FrameMessage,
} from "@workbench/elements/frames";
import { useMediaQuery } from "@uidotdev/usehooks";
import { RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { previewTheme, useStage } from "./stage";

const BOTH: readonly DeviceId[] = ["desktop", "phone"];

/**
 * A desktop and a phone of one address. On a wide page they share one row and
 * one scale; on a narrow page each device gets its own row.
 */
export function DevicePair({
  src,
  title,
  message,
}: {
  src: string;
  title: string;
  message?: FrameMessage;
}) {
  const narrow = useMediaQuery("(max-width: 767px)");
  const rows = narrow ? BOTH.map((device) => [device]) : [BOTH];
  return (
    <div className="grid gap-6">
      {rows.map((devices) => (
        <DeviceRow
          key={devices.join(" ")}
          devices={devices}
          src={src}
          title={title}
          message={message}
        />
      ))}
    </div>
  );
}

function DeviceRow({
  devices,
  src,
  title,
  message,
}: {
  devices: readonly DeviceId[];
  src: string;
  title: string;
  message?: FrameMessage;
}) {
  const { frameZoom } = useStage();
  const { row, scale, gap } = useDeviceRowScale(devices, frameZoom);
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
 * One frame of the app at a device size, so media queries and touch layout
 * see the device width. The frame loads when it nears the view and then
 * stays, so its state survives scrolling.
 */
function DeviceFrame({
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
  const { theme } = useStage();
  const { ref: shell, near } = useNearView<HTMLDivElement>();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loadKey, setLoadKey] = useState(0);
  // Each document load counts, so a navigation inside the frame gets the
  // theme and the state again.
  const [loads, setLoads] = useState(0);
  const loaded = loads > 0;

  // The frame shares this origin, so the preview theme applies to its
  // document without a saved setting.
  useEffect(() => {
    const doc = loaded ? frame.current?.contentDocument : null;
    if (!doc) return;
    return previewTheme(doc, theme);
  }, [theme, loaded, loads]);

  useEffect(() => {
    if (!loaded || !message) return;
    frame.current?.contentWindow?.postMessage(message, location.origin);
  }, [message, loaded, loads]);

  // The frame's route loads lazily, so it can mount after the load event.
  // It says when it is ready, and gets the theme and the state again.
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (isFrameReady(event, frame.current)) setLoads((count) => count + 1);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, []);

  return (
    <figure className="m-0 shrink-0">
      <figcaption className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{label}</span>
        <span className="tabular-nums">
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
          className="grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <RefreshCcw className="size-3.5" aria-hidden="true" />
        </button>
        <a
          href={src}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title} in a new tab`}
          title="Open in a new tab"
          className="grid size-7 place-items-center rounded-md hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <OpenIcon />
        </a>
      </figcaption>
      <div
        ref={shell}
        className={cn(
          "relative overflow-hidden border border-border bg-muted shadow-sm dark:bg-background",
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

// The app's icon set has no "open in a new tab" glyph; this matches its strokes.
function OpenIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M14 4h6v6" />
      <path d="M20 4 11 13" />
      <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}
