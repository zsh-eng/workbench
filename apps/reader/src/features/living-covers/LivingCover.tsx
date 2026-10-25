import { cn } from "@/lib/utils";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  engine,
  type CoverMode,
  type DebugView,
  type LivingViewHandle,
  type ViewState,
} from "./engine/engine";
import { setDragTilt } from "./engine/tilt";
import type { CoverScene } from "./scene";
import { useCoverScene } from "./scene-registry";

/** Pages for a book with no count: a mid-length novel. */
const DEFAULT_PAGES = 320;

/**
 * A cover as a lit object. The plain image stays underneath: it holds the
 * layout, shows while the scene loads, and remains if WebGL is missing or
 * the engine gives the cover's context to another one on screen.
 *
 * `data-living` says what shows: `loading`, `ready` (live), `still`
 * (reduced motion: one lit frame) or `idle` (the plain image).
 * `data-scene` names the scene, `default` for the automatic sheen.
 */
export function LivingCover({
  coverUrl,
  coverFileId,
  scene: sceneOverride,
  mode = "grid",
  fit = "cover",
  naturalAspect = false,
  pages,
  draggable = false,
  debugView = "lit",
  className,
  style,
}: {
  coverUrl: string;
  coverFileId?: string | null;
  /** Use this scene instead of looking one up by the cover's file id. */
  scene?: CoverScene;
  mode?: CoverMode;
  fit?: "cover" | "fill";
  /** Size the box to the cover image's own shape, for a book on its own. */
  naturalAspect?: boolean;
  pages?: number | null;
  /** Drag the book to turn it, for the hero. */
  draggable?: boolean;
  /** Show the lit cover, or the hand-made depth or material maps. */
  debugView?: DebugView;
  className?: string;
  style?: CSSProperties;
}) {
  const looked = useCoverScene(sceneOverride ? null : coverFileId);
  const scene = sceneOverride ?? looked;
  const slotRef = useRef<HTMLSpanElement>(null);
  const hostRef = useRef<HTMLSpanElement>(null);
  const [state, setState] = useState<ViewState>("loading");
  const [aspect, setAspect] = useState<number | null>(null);
  const bookPages = pages ?? scene?.object.pages ?? DEFAULT_PAGES;
  const handle = useRef<LivingViewHandle | null>(null);
  const initialView = useRef(debugView);

  useEffect(() => {
    const slot = slotRef.current;
    const host = hostRef.current;
    if (!slot || !host || !scene) return;
    // Without WebGL the plain cover is the whole story.
    if (!engine.supported()) {
      setState("idle");
      return;
    }
    setState("loading");
    const view = engine.add({
      slot,
      host,
      coverUrl,
      scene,
      mode,
      fit,
      pages: bookPages,
      debugView: initialView.current,
      onState: setState,
    });
    handle.current = view;
    return () => {
      view.dispose();
      handle.current = null;
    };
  }, [coverUrl, scene, mode, fit, bookPages]);

  useEffect(() => {
    initialView.current = debugView;
    handle.current?.setDebugView(debugView);
  }, [debugView]);

  const drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const shown = state === "ready" || state === "still";

  return (
    <span
      ref={slotRef}
      data-living={state}
      data-scene={scene?.id ?? "pending"}
      className={cn(
        "relative block",
        draggable && "touch-none select-none",
        className,
      )}
      style={
        naturalAspect && aspect ? { ...style, aspectRatio: aspect } : style
      }
      onPointerDown={
        draggable
          ? (event) => {
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }
          : undefined
      }
      onPointerMove={
        draggable
          ? (event) => {
              const start = drag.current;
              if (!start || start.id !== event.pointerId) return;
              const reach = Math.max(event.currentTarget.clientWidth, 120);
              setDragTilt({
                x: (event.clientX - start.x) / reach,
                y: (event.clientY - start.y) / reach,
              });
            }
          : undefined
      }
      onPointerUp={
        draggable
          ? () => {
              drag.current = null;
              setDragTilt(null);
            }
          : undefined
      }
      onPointerCancel={
        draggable
          ? () => {
              drag.current = null;
              setDragTilt(null);
            }
          : undefined
      }
    >
      <span
        className={cn(
          "absolute inset-0 overflow-hidden rounded-[inherit] bg-secondary transition-opacity duration-200",
          shown && "opacity-0",
        )}
      >
        <img
          src={coverUrl}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const image = event.currentTarget;
            if (image.naturalHeight > 0)
              setAspect(image.naturalWidth / image.naturalHeight);
          }}
          className="image-outline pointer-events-none size-full object-cover select-none"
          style={{ objectFit: fit === "cover" ? "cover" : "fill" }}
        />
      </span>
      <span
        ref={hostRef}
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute transition-opacity duration-200",
          shown ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  );
}
