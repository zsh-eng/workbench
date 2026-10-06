/** Focus before the first paint, with the saved query ready to replace. */
export function focusPaletteInput(input: HTMLInputElement | null): false {
  input?.focus({ preventScroll: true });
  input?.select();
  // Base UI must not queue another focus operation on the next frame.
  return false;
}

/** The first match that is on screen. Hidden workspaces keep their elements
 * mounted, so a plain query can find one that cannot take focus. */
export function visibleElement<T extends HTMLElement = HTMLElement>(selector: string): T | null {
  return (
    [...document.querySelectorAll<T>(selector)].find(
      (element) => element.getClientRects().length > 0,
    ) ?? null
  );
}
