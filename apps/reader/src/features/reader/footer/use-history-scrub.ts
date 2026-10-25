import {
  animate,
  useMotionTemplate,
  useMotionValue,
  useReducedMotion,
  type AnimationPlaybackControls,
} from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
} from "react";
import { hapticTick } from "@/lib/haptics";

/** Distance between visits: compact, stable cells keep grouped replacements
 * from shifting the trail. */
export const ENTRY_PITCH_REM = 4.5;
// Sideways travel that turns a press into a scrub; less is a tap.
const SCRUB_SLOP_PX = 8;
type Slide = {
  duration: number;
  ease: readonly [number, number, number, number];
};
const HOP_EASE: Slide["ease"] = [0.77, 0, 0.175, 1];
const SETTLE: Slide = { duration: 0.2, ease: [0.23, 1, 0.32, 1] };

interface Visit {
  slot: number;
  page: number | null;
}

interface HistoryScrubOptions {
  /** The strip, which takes the pointer once a press becomes a scrub. */
  root: RefObject<HTMLDivElement | null>;
  entries: Visit[];
  cursor: number;
  expanded: boolean;
  /** How long a hop from a tap or key slides the trail; 0 for none. */
  hopDuration: number;
  onSelect: (index: number, animate: boolean) => void;
  onExpandedChange: (expanded: boolean, animate: boolean) => void;
  onPreview?: (index: number) => void;
  onRestore?: () => void;
}

interface Press {
  pointerId: number;
  pointerType: string;
  startX: number;
  startY: number;
  scrubbing: boolean;
  /** The current visit when the press began: where a cancel returns. */
  origin: number;
  /** Whether the strip was quiet, so a cancel can quiet it again. */
  quiet: boolean;
  selected: number;
  /** Whether the reader shows a preview rather than the origin. */
  previewing: boolean;
  pitchPx: number;
}

/**
 * Press and drag along the trail to scrub it. Visits slide under the centre
 * as the finger moves them, the reader previews the one there, and letting
 * go takes it. Letting go back on the starting visit, or a cancelled touch,
 * or Escape, leaves the reader where it was. A press that does not travel
 * sideways stays a tap.
 */
export function useHistoryScrub({
  root,
  entries,
  cursor,
  expanded,
  hopDuration,
  onSelect,
  onExpandedChange,
  onPreview,
  onRestore,
}: HistoryScrubOptions) {
  const reduceMotion = useReducedMotion();
  const press = useRef<Press | null>(null);
  const endedAt = useRef(-Infinity);
  const escape = useRef<((event: KeyboardEvent) => void) | null>(null);
  // The visit under the finger; then the one a release took, until history
  // moves its cursor there. The strip centres these instead of the cursor.
  const [selected, setSelected] = useState<{
    index: number;
    origin: number;
  } | null>(null);
  const [landing, setLanding] = useState<{
    index: number;
    from: number;
  } | null>(null);
  const shown =
    selected?.index ??
    (landing?.from === cursor && entries[landing.index]
      ? landing.index
      : cursor);
  const activeSlot = entries[shown].slot;

  const track = useMotionValue(-activeSlot * ENTRY_PITCH_REM);
  const trackTransform = useMotionTemplate`translateX(${track}rem)`;
  const rest = useRef(track.get());
  const motion = useRef<AnimationPlaybackControls | null>(null);
  const moveTrack = (target: number, transition: Slide | null) => {
    rest.current = target;
    motion.current?.stop();
    if (transition?.duration)
      motion.current = animate(track, target, transition);
    else track.set(target);
  };
  useLayoutEffect(() => {
    // The finger owns the trail while it scrubs.
    if (press.current?.scrubbing) return;
    const target = -activeSlot * ENTRY_PITCH_REM;
    if (target === rest.current) return;
    moveTrack(target, { duration: hopDuration, ease: HOP_EASE });
  });

  // A hop that history never takes gives the strip back to its cursor.
  useEffect(() => {
    if (!landing) return;
    const timer = window.setTimeout(() => setLanding(null), 1500);
    return () => window.clearTimeout(timer);
  }, [landing]);

  // A scrub spans many renders; its handlers read the latest one.
  const latest = useRef({
    entries,
    onSelect,
    onExpandedChange,
    onPreview,
    onRestore,
    reduceMotion,
    end: (_commit: boolean) => {},
  });
  const end = (commit: boolean) => {
    const current = press.current;
    press.current = null;
    if (escape.current)
      window.removeEventListener("keydown", escape.current, true);
    escape.current = null;
    if (!current?.scrubbing) return;
    endedAt.current = performance.now();
    const { entries, onSelect, onExpandedChange, onRestore, reduceMotion } =
      latest.current;
    const target = commit ? current.selected : current.origin;
    if (target !== current.origin) {
      setLanding({ index: target, from: current.origin });
      onSelect(target, false);
    } else {
      if (current.previewing) onRestore?.();
      if (current.quiet) onExpandedChange(false, false);
    }
    setSelected(null);
    moveTrack(
      -entries[target].slot * ENTRY_PITCH_REM,
      reduceMotion ? null : SETTLE,
    );
  };
  useLayoutEffect(() => {
    latest.current = {
      entries,
      onSelect,
      onExpandedChange,
      onPreview,
      onRestore,
      reduceMotion,
      end,
    };
  });
  // Leaving mid-scrub, as when the chrome hides, keeps the reader's place.
  useEffect(
    () => () => {
      if (press.current?.previewing) latest.current.onRestore?.();
      press.current = null;
      if (escape.current)
        window.removeEventListener("keydown", escape.current, true);
    },
    [],
  );

  const begin = (current: Press, clientX: number) => {
    current.scrubbing = true;
    // Follow from here, so the slop does not jump the trail.
    current.startX = clientX;
    current.pitchPx =
      ENTRY_PITCH_REM *
      (parseFloat(getComputedStyle(document.documentElement).fontSize) || 16);
    motion.current?.stop();
    root.current?.setPointerCapture(current.pointerId);
    escape.current = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      root.current?.releasePointerCapture(current.pointerId);
      latest.current.end(false);
    };
    window.addEventListener("keydown", escape.current, true);
    setSelected({ index: current.origin, origin: current.origin });
    if (current.quiet) onExpandedChange(true, true);
  };

  const follow = (current: Press, clientX: number) => {
    const { entries, onPreview, onRestore } = latest.current;
    const position =
      current.origin - (clientX - current.startX) / current.pitchPx;
    track.set(
      -(entries[0].slot + detent(position, entries.length - 1)) *
        ENTRY_PITCH_REM,
    );
    const next = nearestVisit(entries, position);
    if (next === null || next === current.selected) return;
    current.selected = next;
    if (current.pointerType !== "mouse") hapticTick();
    setSelected({ index: next, origin: current.origin });
    if (next === current.origin) {
      if (current.previewing) onRestore?.();
      current.previewing = false;
    } else {
      onPreview?.(next);
      current.previewing = true;
    }
  };

  const handlers = {
    onPointerDown(event: PointerEvent<HTMLDivElement>) {
      // A new press owns the clicks that follow it.
      endedAt.current = -Infinity;
      if (!onPreview || entries.length < 2 || !event.isPrimary) return;
      if (event.pointerType === "mouse" && event.button !== 0) return;
      press.current = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        scrubbing: false,
        origin: cursor,
        quiet: !expanded,
        selected: cursor,
        previewing: false,
        pitchPx: 0,
      };
    },
    onPointerMove(event: PointerEvent<HTMLDivElement>) {
      const current = press.current;
      if (current?.pointerId !== event.pointerId) return;
      if (!current.scrubbing) {
        const dx = Math.abs(event.clientX - current.startX);
        const dy = Math.abs(event.clientY - current.startY);
        if (dy > SCRUB_SLOP_PX && dy > dx) press.current = null;
        if (dx < SCRUB_SLOP_PX || dy > dx) return;
        begin(current, event.clientX);
      }
      follow(current, event.clientX);
    },
    onPointerUp(event: PointerEvent<HTMLDivElement>) {
      if (press.current?.pointerId === event.pointerId) end(true);
    },
    onPointerCancel(event: PointerEvent<HTMLDivElement>) {
      if (press.current?.pointerId === event.pointerId) end(false);
    },
    onLostPointerCapture(event: PointerEvent<HTMLDivElement>) {
      // A touch starts captured by the visit under it, which loses capture
      // when the strip takes it: that is not the end of the scrub.
      if (event.target !== event.currentTarget) return;
      if (press.current?.pointerId === event.pointerId) end(false);
    },
    // Letting go of a scrub is not a tap on the visit under the finger.
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (event.detail === 0) return;
      if (performance.now() - endedAt.current > 400) return;
      event.preventDefault();
      event.stopPropagation();
    },
  };

  return {
    handlers,
    /** The visit centred on the trail. */
    shown,
    activeSlot,
    /** Where letting go stays put, while a scrub has moved off it. */
    origin:
      selected && selected.index !== selected.origin ? selected.origin : null,
    scrubbing: selected !== null,
    trackTransform,
  };
}

/** Holds the trail near each visit, then lets it go quickly, so it settles
 * into detents without drifting from the finger. */
function detent(position: number, last: number): number {
  if (position < 0) return -overscroll(-position);
  if (position > last) return last + overscroll(position - last);
  const nearest = Math.round(position);
  const offset = position - nearest;
  return (
    nearest + Math.sign(offset) * 0.5 * Math.pow(2 * Math.abs(offset), 1.6)
  );
}

/** Past either end the trail gives a little, then stops. */
function overscroll(distance: number): number {
  return (0.5 * distance) / (distance + 1);
}

/** The visit nearest a position that the layout can place. */
function nearestVisit(entries: Visit[], position: number): number | null {
  const target = Math.max(
    0,
    Math.min(entries.length - 1, Math.round(position)),
  );
  for (let step = 0; step < entries.length; step++) {
    for (const index of [target - step, target + step]) {
      if (entries[index] && entries[index].page !== null) return index;
    }
  }
  return null;
}
