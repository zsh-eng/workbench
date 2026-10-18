import { useHotkey } from "@tanstack/react-hotkeys";

interface UsePaginationKeyboardNavOptions {
  onNextSpread: () => void;
  onPrevSpread: () => void;
  /** Off while scroll mode owns the keyboard. */
  enabled?: boolean;
}

export function usePaginationKeyboardNav(
  options: UsePaginationKeyboardNavOptions,
) {
  const { onNextSpread, onPrevSpread, enabled = true } = options;

  useHotkey("ArrowLeft", onPrevSpread, {
    target: window,
    enabled,
    ignoreInputs: true,
    stopPropagation: false,
    meta: {
      name: "Previous page",
      description: "Move to the previous Reader spread",
    },
  });

  useHotkey("ArrowRight", onNextSpread, {
    target: window,
    enabled,
    ignoreInputs: true,
    stopPropagation: false,
    meta: {
      name: "Next page",
      description: "Move to the next Reader spread",
    },
  });
}
