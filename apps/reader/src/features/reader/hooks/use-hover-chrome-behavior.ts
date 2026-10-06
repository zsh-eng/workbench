import { useCallback, useEffect, useRef, type FocusEventHandler } from "react";
import type {
  ReaderChromeRailProps,
  ReaderChromeSurfaceProps,
} from "../chrome";

export const CHROME_HIDE_DELAY_MS = 200;

interface UseHoverChromeBehaviorOptions {
  enabled: boolean;
  isChromeSuppressed: boolean;
  topRailHeight: number;
  bottomRailHeight: number;
  showChrome: () => void;
  hideChrome: () => void;
}

interface UseHoverChromeBehaviorResult {
  showHoverRails: boolean;
  topRailProps: ReaderChromeRailProps;
  bottomRailProps: ReaderChromeRailProps;
  chromeSurfaceProps: ReaderChromeSurfaceProps;
}

/**
 * Owns hover-capable chrome behavior: invisible rails reveal chrome, chrome
 * surfaces keep it open while hovered/focused, and leaving schedules a short
 * delayed hide so moving between rails and controls does not flicker.
 */
export function useHoverChromeBehavior({
  enabled,
  isChromeSuppressed,
  topRailHeight,
  bottomRailHeight,
  showChrome,
  hideChrome,
}: UseHoverChromeBehaviorOptions): UseHoverChromeBehaviorResult {
  const hideTimeoutRef = useRef<number | null>(null);
  const focusedSurfaceRef = useRef<HTMLElement | null>(null);

  const clearHideTimeout = useCallback(() => {
    if (hideTimeoutRef.current === null) return;

    window.clearTimeout(hideTimeoutRef.current);
    hideTimeoutRef.current = null;
  }, []);

  const revealChrome = useCallback(() => {
    if (!enabled || isChromeSuppressed) return;

    clearHideTimeout();
    showChrome();
  }, [clearHideTimeout, enabled, isChromeSuppressed, showChrome]);

  const scheduleHideChrome = useCallback(() => {
    clearHideTimeout();
    if (!enabled || isChromeSuppressed) return;

    hideTimeoutRef.current = window.setTimeout(() => {
      hideTimeoutRef.current = null;
      if (focusedSurfaceRef.current?.contains(document.activeElement)) return;
      hideChrome();
    }, CHROME_HIDE_DELAY_MS);
  }, [clearHideTimeout, enabled, hideChrome, isChromeSuppressed]);

  const handleChromeFocus = useCallback<FocusEventHandler<HTMLElement>>(
    (event) => {
      focusedSurfaceRef.current = event.currentTarget;
      revealChrome();
    },
    [revealChrome],
  );

  const handleChromeBlur = useCallback<FocusEventHandler<HTMLElement>>(
    (event) => {
      if (!enabled) return;

      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node &&
        event.currentTarget.contains(nextTarget)
      ) {
        return;
      }

      focusedSurfaceRef.current = null;
      scheduleHideChrome();
    },
    [enabled, scheduleHideChrome],
  );

  const handleChromePointerEnter = useCallback(() => {
    revealChrome();
  }, [revealChrome]);

  const handleChromePointerLeave = useCallback(() => {
    scheduleHideChrome();
  }, [scheduleHideChrome]);

  useEffect(() => {
    if (!enabled || isChromeSuppressed) {
      clearHideTimeout();
    }
  }, [clearHideTimeout, enabled, isChromeSuppressed]);

  useEffect(() => {
    return () => {
      clearHideTimeout();
    };
  }, [clearHideTimeout]);

  const chromeSurfaceProps: ReaderChromeSurfaceProps = {
    onBlur: handleChromeBlur,
    onFocus: handleChromeFocus,
    onPointerEnter: handleChromePointerEnter,
    onPointerLeave: handleChromePointerLeave,
  };

  return {
    showHoverRails: enabled,
    topRailProps: {
      "aria-hidden": true,
      "data-reader-chrome-rail": "top",
      onPointerEnter: handleChromePointerEnter,
      onPointerLeave: handleChromePointerLeave,
      style: { height: `${topRailHeight}px` },
    },
    bottomRailProps: {
      "aria-hidden": true,
      "data-reader-chrome-rail": "bottom",
      onPointerEnter: handleChromePointerEnter,
      onPointerLeave: handleChromePointerLeave,
      style: { height: `${bottomRailHeight}px` },
    },
    chromeSurfaceProps,
  };
}
