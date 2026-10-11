import { useState, type MouseEvent } from "react";

export interface SpecimenState {
  id: string;
  label: string;
}

/** What a frame specimen receives from the page. */
export interface FrameSpecimenProps {
  state: string;
  nonce?: number;
}

export interface Selection {
  state: string;
  /** Counts choices, so choosing the current state again replays it. */
  nonce: number;
}

/** A specimen's chosen state. Choosing the current state again replays it. */
export function useSelection(states: readonly SpecimenState[]) {
  const [selection, setSelection] = useState<Selection>({
    state: states[0].id,
    nonce: 0,
  });
  const choose = (state: string) =>
    setSelection((value) => ({ state, nonce: value.nonce + 1 }));
  return { ...selection, choose };
}

/** Links inside a specimen do not leave the page. */
export function keepLinksInPlace(event: MouseEvent) {
  if ((event.target as Element).closest?.("a[href]")) event.preventDefault();
}

/** Reduced motion: a run does not start by itself, but Replay still plays. */
export function prefersReducedMotion() {
  return (
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}
