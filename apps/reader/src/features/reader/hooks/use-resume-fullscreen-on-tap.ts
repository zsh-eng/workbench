import { useEffect } from "react";
import { resumeReadingFullscreen } from "../reading-fullscreen";
import { TOUCH_TAP_MOVE_TOLERANCE_PX } from "./use-touch-spread-tap-nav";

/**
 * A tap on the Reader's page (not a drag or a selection's press) goes back to
 * full screen. It still turns the page or shows the chrome: no tap is lost.
 * `pointerup` is the event that counts as a gesture for a finger.
 */
export function useResumeFullscreenOnTap(stage: HTMLElement | null): void {
  useEffect(() => {
    if (!stage) return;
    let down: { x: number; y: number } | null = null;
    const onPointerDown = (event: PointerEvent) => {
      down = { x: event.clientX, y: event.clientY };
    };
    const onPointerUp = (event: PointerEvent) => {
      const moved =
        !down ||
        Math.hypot(event.clientX - down.x, event.clientY - down.y) >
          TOUCH_TAP_MOVE_TOLERANCE_PX;
      down = null;
      if (moved || window.getSelection()?.toString()) return;
      resumeReadingFullscreen();
    };
    stage.addEventListener("pointerdown", onPointerDown, { capture: true });
    stage.addEventListener("pointerup", onPointerUp, { capture: true });
    return () => {
      stage.removeEventListener("pointerdown", onPointerDown, {
        capture: true,
      });
      stage.removeEventListener("pointerup", onPointerUp, { capture: true });
    };
  }, [stage]);
}
