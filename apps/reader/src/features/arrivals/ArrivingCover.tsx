import { cn } from "@/lib/utils";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { coverKnown } from "./arrival-progress";
import type { Arrival, ArrivalLook } from "./arrival-store";
import {
  arrivalEngineSupported,
  engine,
  prefersReducedMotion,
  warmArrivalEngine,
  type ArrivalDirection,
} from "./engine/arrival-engine";

export interface ArrivingCoverProps {
  arrival: Arrival;
  look: ArrivalLook;
  /**
   * The cover as it will stay: the Library's own image, or the title set in
   * type. It takes over, under a short cross-fade, once the arrival rests.
   */
  plain: ReactNode;
  /** True when `plain` shows the finished cover, decoded and ready. */
  plainReady: boolean;
  /** A living cover's depth map, for the raking light. */
  relief?: string | null;
  /** The drawing is done and `plain` shows: the arrival can go. */
  onSettled: () => void;
  className?: string;
}

const coverUrls = new WeakMap<Blob, string>();

/** One object URL per cover Blob, kept while the page lives. */
export function useCoverUrl(cover: Blob | null): string | null {
  if (!cover) return null;
  let url = coverUrls.get(cover);
  if (!url) {
    url = URL.createObjectURL(cover);
    coverUrls.set(cover, url);
  }
  return url;
}

/** Covers decoded once, so a cover that moves to another tile shows at once. */
const decodedUrls = new Set<string>();

export function useDecoded(url: string | null): boolean {
  const [decoded, setDecoded] = useState<string | null>(null);
  useEffect(() => {
    if (!url || decodedUrls.has(url)) return;
    let cancelled = false;
    const image = new Image();
    image.src = url;
    image
      .decode()
      .catch(() => undefined)
      .then(() => {
        decodedUrls.add(url);
        if (!cancelled) setDecoded(url);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  return url !== null && (decoded === url || decodedUrls.has(url));
}

/** Ready the shader engine, unless the drawing will not move. */
export function warmArrivingCover() {
  if (!prefersReducedMotion()) warmArrivalEngine();
}

function subscribeReducedMotion(listener: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}

/** True when the shader engine has given up on this device for the visit. */
function useEngineAvailable(): boolean {
  return useSyncExternalStore(
    (listener) => engine.subscribe(listener),
    arrivalEngineSupported,
  );
}

/**
 * A book's cover while it arrives: paper while the file is saved and read,
 * then the chosen look, in step with the import, then the plain cover.
 * With reduced motion the paper simply gives way to the cover.
 */
export function ArrivingCover(props: ArrivingCoverProps) {
  const reduced = useSyncExternalStore(
    subscribeReducedMotion,
    prefersReducedMotion,
  );
  const engineAvailable = useEngineAvailable();
  const { arrival, className } = props;
  const hasImage = arrival.cover !== null;
  const look =
    reduced || props.look === "still"
      ? "still"
      : !hasImage && coverKnown(arrival.progress.stage)
        ? "type"
        : props.look === "calm" || !engineAvailable
          ? "calm"
          : "shader";
  return (
    <span
      data-arrival={arrival.progress.stage}
      data-arrival-look={look}
      className={cn("relative block overflow-hidden bg-secondary", className)}
    >
      {look === "shader" ? (
        <ShaderArrival {...props} look={props.look as ArrivalDirection} />
      ) : look === "calm" ? (
        <CalmArrival {...props} />
      ) : (
        <StillArrival {...props} />
      )}
    </span>
  );
}

/**
 * The handover: `plain` sits under the drawing from the start, hidden, and
 * shows when the drawing fades. Both show the same picture by then.
 */
function useHandover(props: ArrivingCoverProps, rested: boolean) {
  const { plainReady, onSettled } = props;
  const handing = rested && plainReady;
  const settled = useRef(onSettled);
  settled.current = onSettled;
  useEffect(() => {
    if (!handing) return;
    // Settle after the cross-fade; a hidden tab may not run the transition.
    const timer = window.setTimeout(() => settled.current(), 220);
    return () => window.clearTimeout(timer);
  }, [handing]);
  return handing;
}

function ShaderArrival(props: ArrivingCoverProps & { look: ArrivalDirection }) {
  const { arrival, look, plain, relief = null } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [rested, setRested] = useState(false);
  const handing = useHandover(props, rested);
  const input = useRef({
    progress: arrival.progress,
    changedAt: arrival.changedAt,
    cover: arrival.cover,
    relief,
  });
  input.current = {
    progress: arrival.progress,
    changedAt: arrival.changedAt,
    cover: arrival.cover,
    relief,
  };
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const slot = canvas?.parentElement;
    if (!canvas || !slot) return;
    return engine.attach({
      key: arrival.key,
      canvas,
      slot,
      direction: look,
      read: () => input.current,
      onRest: () => setRested(true),
    });
  }, [arrival.key, look]);
  useEffect(() => engine.wake(), [arrival.progress, arrival.cover, relief]);
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          handing ? "opacity-100" : "opacity-0",
        )}
      >
        {plain}
      </span>
      <canvas
        ref={canvasRef}
        aria-hidden="true"
        data-arrival-canvas=""
        className={cn(
          "pointer-events-none absolute inset-0 size-full transition-opacity duration-200",
          handing && "opacity-0",
        )}
      />
    </>
  );
}

/**
 * Compositor only: the cover in black and white fades up over the paper
 * when the import has read it, and its colour fades up when it is ready.
 */
function CalmArrival(props: ArrivingCoverProps) {
  const { arrival, plain } = props;
  const url = useCoverUrl(arrival.cover);
  const decoded = useDecoded(url);
  const known = decoded && coverKnown(arrival.progress.stage);
  const ready = decoded && arrival.progress.stage === "ready";
  const [rested, setRested] = useState(false);
  const handing = useHandover(props, rested);
  // At rest when the colour has faded up. A timer, not transitionend: a
  // tile that mounts with its book ready has no transition to end.
  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => setRested(true), 750);
    return () => window.clearTimeout(timer);
  }, [ready]);
  return (
    <>
      <span
        aria-hidden="true"
        className={cn(
          "absolute inset-0 transition-opacity duration-200",
          handing ? "opacity-100" : "opacity-0",
        )}
      >
        {plain}
      </span>
      {url && !handing && (
        <>
          <img
            src={url}
            alt=""
            draggable={false}
            className={cn(
              "pointer-events-none absolute inset-0 size-full object-cover grayscale transition-opacity duration-700 ease-out select-none",
              known ? "opacity-100" : "opacity-0",
            )}
          />
          <img
            src={url}
            alt=""
            draggable={false}
            className={cn(
              "pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-700 ease-in-out select-none",
              ready ? "opacity-100" : "opacity-0",
            )}
          />
        </>
      )}
    </>
  );
}

/**
 * Reduced motion, and a book without a cover: paper, then the cover as it
 * will stay, in one short cross-fade when there is something to show.
 */
function StillArrival(props: ArrivingCoverProps) {
  const { arrival, plain } = props;
  const ready = arrival.progress.stage === "ready";
  const show =
    arrival.cover === null
      ? coverKnown(arrival.progress.stage)
      : ready && props.plainReady;
  useHandover(props, show && ready);
  return (
    <span
      className={cn(
        "absolute inset-0 transition-opacity duration-200",
        show ? "opacity-100" : "opacity-0",
      )}
    >
      {plain}
    </span>
  );
}
