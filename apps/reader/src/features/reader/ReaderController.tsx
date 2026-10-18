import type { ChromeInteractionMode } from "@/features/reader/hooks/use-input-behavior";
import { useCallback, useState, type ReactNode, type RefObject } from "react";
import type { ReaderChromeRailProps, ReaderChromeSurfaceProps } from "./chrome";
import {
  CHROME_HIDE_DELAY_MS,
  useHoverChromeBehavior,
} from "./hooks/use-hover-chrome-behavior";
import { useScrollTapChrome } from "./hooks/use-scroll-tap-chrome";
import { useTouchSpreadTapNav } from "./hooks/use-touch-spread-tap-nav";

export { CHROME_HIDE_DELAY_MS };

interface ReaderControllerChildrenState {
  chromeVisible: boolean;
  progressPeek: ReturnType<typeof useTouchSpreadTapNav>;
  showHoverRails: boolean;
  topRailProps: ReaderChromeRailProps;
  bottomRailProps: ReaderChromeRailProps;
  chromeSurfaceProps: ReaderChromeSurfaceProps;
  showChrome: () => void;
  hideChrome: () => void;
}

interface ReaderControllerProps {
  onNextPage: () => void;
  onPrevPage: () => void;
  canGoPrev: boolean;
  canGoNext: boolean;
  chromeInteractionMode: ChromeInteractionMode;
  isChromeSuppressed?: boolean;
  /**
   * Prototype scroll mode: a tap toggles the chrome and nothing else. Tap
   * zones, page swipes and the upward progress peek are off.
   */
  scrollMode?: boolean;
  onDismissContentTap?: () => void;
  containerRef: RefObject<HTMLElement | null>;
  topRailHeight: number;
  bottomRailHeight: number;
  children: (state: ReaderControllerChildrenState) => ReactNode;
}

/**
 * Headless auto-hiding chrome controller for the paginated reader.
 *
 * Responsibilities:
 * - switches between touch and hover chrome behavior
 * - keeps tap-zone navigation active only in touch mode
 * - dismisses chrome through the existing reading gestures
 * - manages hover enter/leave timing for auto-hidden chrome
 * - suppresses chrome while peer overlays like sheets are open
 *
 * Contract for callers:
 * - render the returned top/bottom hover rails in the non-reading bands
 * - spread `chromeSurfaceProps` onto any chrome surface that should keep the
 *   chrome visible while hovered or focused
 *
 * The controller is intentionally headless so the reader layout stays in
 * charge of where rails and chrome surfaces live.
 */
export function ReaderController({
  onNextPage,
  onPrevPage,
  canGoPrev,
  canGoNext,
  chromeInteractionMode,
  isChromeSuppressed = false,
  scrollMode = false,
  onDismissContentTap,
  containerRef,
  topRailHeight,
  bottomRailHeight,
  children,
}: ReaderControllerProps) {
  const isHoverMode = chromeInteractionMode === "hover";
  const isTouchMode = chromeInteractionMode === "touch";
  const [chromeState, setChromeState] = useState(() => ({
    mode: chromeInteractionMode,
    visible: false,
  }));
  const chromeVisible =
    chromeState.mode === chromeInteractionMode &&
    chromeState.visible &&
    !isChromeSuppressed;

  const showChrome = useCallback(() => {
    if (isChromeSuppressed) return;
    setChromeState({ mode: chromeInteractionMode, visible: true });
  }, [chromeInteractionMode, isChromeSuppressed]);

  const hideChrome = useCallback(() => {
    setChromeState((state) =>
      state.visible || state.mode !== chromeInteractionMode
        ? { mode: chromeInteractionMode, visible: false }
        : state,
    );
  }, [chromeInteractionMode]);

  const progressPeek = useTouchSpreadTapNav({
    containerRef,
    enabled: isTouchMode && !isChromeSuppressed && !scrollMode,
    onPrevSpread: onPrevPage,
    onNextSpread: onNextPage,
    onShowChrome: showChrome,
    onHideChrome: onDismissContentTap ?? hideChrome,
    chromeVisible: chromeVisible || Boolean(onDismissContentTap),
    canGoPrev,
    canGoNext,
  });

  useScrollTapChrome({
    containerRef,
    enabled: isTouchMode && !isChromeSuppressed && scrollMode,
    chromeVisible: chromeVisible || Boolean(onDismissContentTap),
    onShowChrome: showChrome,
    onHideChrome: onDismissContentTap ?? hideChrome,
  });

  const hoverChrome = useHoverChromeBehavior({
    enabled: isHoverMode,
    isChromeSuppressed,
    topRailHeight,
    bottomRailHeight,
    showChrome,
    hideChrome,
  });

  return (
    <>
      {children({
        chromeVisible,
        progressPeek,
        showHoverRails: hoverChrome.showHoverRails,
        showChrome,
        hideChrome,
        topRailProps: hoverChrome.topRailProps,
        bottomRailProps: hoverChrome.bottomRailProps,
        chromeSurfaceProps: hoverChrome.chromeSurfaceProps,
      })}
    </>
  );
}
