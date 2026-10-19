import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import type { PageBreakSelection } from "./use-page-break-selection";

/** Stillness at the page's last word that counts as holding there. */
export const HOLD_DWELL_MS = 650;
/** Changes that must lead up to the edge: a drag, not a long press. */
const MIN_DRAG_CHANGES = 3;
const DRAG_WINDOW_MS = 1600;

/**
 * Whether a finger (or mouse button) is known to be down.
 *
 * - down: a touch or press started and has not ended.
 * - native: the browser took the gesture over (touchcancel or
 *   pointercancel), as iOS does when it drags selection handles. The page
 *   then hears nothing until the next touch, so a lift is invisible.
 * - up: the last touch or press ended.
 */
type Contact = "down" | "native" | "up";

export interface HoldSignal {
  at: number;
  name: string;
  detail?: string;
}

// A short log of the signals, for `?selectAcrossLog=1`.
const log: HoldSignal[] = [];
const listeners = new Set<() => void>();
let snapshot: readonly HoldSignal[] = [];
function record(name: string, detail?: string) {
  log.push({ at: Math.round(performance.now()), name, detail });
  if (log.length > 40) log.splice(0, log.length - 40);
  snapshot = [...log];
  for (const listener of listeners) listener();
}

export function useHoldSignals(): readonly HoldSignal[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
  );
}

/**
 * "Hold at the edge": dragging the selection's end to the page's last word
 * and holding it there carries the selection into the column, like a
 * reading app turning the page mid-selection.
 *
 * A page cannot see a finger on iOS's selection handles: Safari takes the
 * touch over (the page gets touchcancel, or nothing) and only
 * `selectionchange` arrives while the handle moves. Holding still and
 * lifting both look like silence. So this fires only when:
 *
 * - the selection's end reached the last word by moving there, over at
 *   least a few changes (a drag, not a long press on the last word);
 * - it then stays still for HOLD_DWELL_MS;
 * - and no release was heard since (a mouse button or a touch that the
 *   page itself saw end).
 *
 * Where a lift is invisible, someone who simply ends a selection at the
 * page's last word by dragging there also matches: that is the misfire
 * this variant cannot rule out.
 */
export function useHoldAtPageEdge({
  enabled,
  pageBreak,
  onHold,
}: {
  enabled: boolean;
  pageBreak: PageBreakSelection | null;
  onHold: (pageBreak: PageBreakSelection) => void;
}) {
  const contact = useRef<Contact>("up");
  const changes = useRef<number[]>([]);
  const lastChange = useRef(0);
  const timer = useRef(0);

  // At the page's last word, or its first for a selection running back.
  const atEdge =
    pageBreak !== null &&
    (pageBreak.continuation.edge === "end"
      ? pageBreak.selection.end >= pageBreak.pageText.end - 1
      : pageBreak.selection.start <= pageBreak.pageText.start + 1);

  const fire = useEffectEvent(() => {
    timer.current = 0;
    if (!pageBreak || !atEdge) return;
    if (contact.current === "up") {
      record("dwell skipped", "released");
      return;
    }
    const since = lastChange.current - DRAG_WINDOW_MS;
    const recent = changes.current.filter((at) => at >= since).length;
    if (recent < MIN_DRAG_CHANGES) {
      record("dwell skipped", `${recent} changes`);
      return;
    }
    record("hold → column", contact.current);
    onHold(pageBreak);
  });

  const arm = useEffectEvent(() => {
    window.clearTimeout(timer.current);
    timer.current = 0;
    if (!enabled || !atEdge) return;
    const wait = Math.max(0, lastChange.current + HOLD_DWELL_MS - Date.now());
    timer.current = window.setTimeout(fire, wait);
    record("dwell", `${wait} ms, ${contact.current}`);
  });

  // Each new measurement at the edge restarts the wait.
  useEffect(() => {
    arm();
  }, [atEdge, pageBreak, enabled]);

  useEffect(() => {
    if (!enabled) return;
    const onSelectionChange = () => {
      const now = Date.now();
      lastChange.current = now;
      changes.current.push(now);
      if (changes.current.length > 30) changes.current.shift();
      record("selectionchange");
    };
    // A new touch or press ends any hold: it starts another gesture.
    const down = (event: Event) => {
      contact.current = "down";
      window.clearTimeout(timer.current);
      record(event.type);
    };
    const up = (event: Event) => {
      contact.current = "up";
      window.clearTimeout(timer.current);
      record(event.type);
    };
    const native = (event: Event) => {
      if (contact.current === "down") contact.current = "native";
      record(event.type);
    };
    let moves = 0;
    const move = (event: Event) => {
      // Logged sparsely; it shows whether moves arrive during a drag.
      if (moves++ % 8 === 0) record(event.type, `#${moves}`);
    };
    const options = { capture: true, passive: true };
    document.addEventListener("selectionchange", onSelectionChange);
    window.addEventListener("touchstart", down, options);
    window.addEventListener("mousedown", down, options);
    window.addEventListener("touchend", up, options);
    window.addEventListener("mouseup", up, options);
    window.addEventListener("pointerup", up, options);
    window.addEventListener("touchcancel", native, options);
    window.addEventListener("pointercancel", native, options);
    window.addEventListener("touchmove", move, options);
    return () => {
      window.clearTimeout(timer.current);
      document.removeEventListener("selectionchange", onSelectionChange);
      window.removeEventListener("touchstart", down, options);
      window.removeEventListener("mousedown", down, options);
      window.removeEventListener("touchend", up, options);
      window.removeEventListener("mouseup", up, options);
      window.removeEventListener("pointerup", up, options);
      window.removeEventListener("touchcancel", native, options);
      window.removeEventListener("pointercancel", native, options);
      window.removeEventListener("touchmove", move, options);
    };
  }, [enabled]);
}
