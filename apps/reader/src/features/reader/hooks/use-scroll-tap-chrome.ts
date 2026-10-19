import { useEffect, useEffectEvent, type RefObject } from "react";
import { dispatchReaderTouchTapHandled } from "./reader-interaction-events";
import {
  isCleanTouchTap,
  isInteractiveTapTarget,
} from "./use-touch-spread-tap-nav";

interface UseScrollTapChromeOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  chromeVisible: boolean;
  onShowChrome: () => void;
  onHideChrome: () => void;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

/**
 * Touch gestures for the prototype scroll mode. A clean tap anywhere toggles
 * the chrome. There are no tap zones, swipes or progress peek: vertical drags
 * belong to native scrolling, which cancels the pointer.
 */
export function useScrollTapChrome({
  containerRef,
  enabled,
  chromeVisible,
  onShowChrome,
  onHideChrome,
}: UseScrollTapChromeOptions): void {
  const toggleChrome = useEffectEvent(() => {
    if (chromeVisible) onHideChrome();
    else onShowChrome();
  });

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    let press: {
      id: number;
      startX: number;
      startY: number;
      startedAt: number;
      target: EventTarget | null;
    } | null = null;

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !event.isPrimary) return;
      press = hasActiveTextSelection()
        ? null
        : {
            id: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startedAt: Date.now(),
            target: event.target,
          };
    };
    const onPointerUp = (event: PointerEvent) => {
      const current = press;
      press = null;
      if (!current || current.id !== event.pointerId) return;
      if (event.defaultPrevented || isInteractiveTapTarget(current.target)) {
        return;
      }
      if (hasActiveTextSelection()) return;
      const isTap = isCleanTouchTap({
        startX: current.startX,
        startY: current.startY,
        endX: event.clientX,
        endY: event.clientY,
        startedAt: current.startedAt,
        endedAt: Date.now(),
        moved: false,
      });
      if (!isTap) return;
      toggleChrome();
      dispatchReaderTouchTapHandled();
    };
    // Native scrolling takes over a drag and cancels its pointer.
    const onPointerCancel = () => {
      press = null;
    };

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerCancel);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [containerRef, enabled]);
}
