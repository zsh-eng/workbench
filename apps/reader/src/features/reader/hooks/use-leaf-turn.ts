import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  carriedEdge,
  creaseUnder,
  Leaf,
  LEAF_NODES,
  LEAF_WIDTH,
} from "../paper/leaf-physics";
import {
  rubberBandSwipeOffset,
  SWIPE_DIRECTION_LOCK_PX,
  SYSTEM_NAVIGATION_EDGE_PX,
  type SwipeDirection,
} from "./use-spread-swipe-navigation";
import {
  getHorizontalTapZone,
  isControlTarget,
  MAX_TOUCH_TAP_DURATION_MS,
} from "./use-touch-spread-tap-nav";

/** Radius of the roll a hand turns a page round, as a fraction of its width. */
const HAND_ROLL = 0.25;
/**
 * The edge leads the finger, so the page comes over the top while the
 * thumb is still well inside the screen.
 */
const EDGE_LEAD = 1.6;
/** Where the edge lies once a page has turned: a little short of flat. */
const TURNED_CREASE =
  (0.1 * LEAF_WIDTH - Math.PI * HAND_ROLL * LEAF_WIDTH) / 2;
/** A backward turn lays the page down faster than the finger moves. */
const BACKWARD_GAIN = 1.5;
/**
 * The hill a page let go must cross, as the angle of its middle above the
 * right-hand stack. A book's hill is upright, too far for a thumb, so the
 * phone's gravity leans away from a nearer hilltop on either side: a page
 * let go about 40% of the way across falls over, and short of that falls
 * back. A page coming back has its own hill, as far for the thumb.
 */
const HILL_FORWARD = (9 * Math.PI) / 180;
const HILL_BACKWARD = (38 * Math.PI) / 180;
const LEAN = (60 * Math.PI) / 180;
const HILL_WIDTH = (6 * Math.PI) / 180;
/** How much of a flick's speed goes into spinning the page over. */
const FLICK_SPIN = 1;
/** The tilt a middle grip allows the roll, following the finger. */
const MIDDLE_TILT = 0.07;
/** A corner grip tilts the roll this much, so the corner leads. */
const CORNER_TILT = 0.42;
const CORNER_ZONE_PX = 56;
/** A tap pushes the page this far across, accelerating, then lets go. */
const PUSH_DISTANCE = 0.46;
const PUSH_SECONDS = 0.2;
/** A fresh drag that reverses this far turns the other way instead. */
const REVERSE_PX = 12;

export type LeafPage = "current" | "previous";

/** What the stage shows of a turn, for the presenter. */
export type LeafView =
  | {
      kind: "moving";
      leaf: Leaf;
      /** Which page is the leaf: this one turning away, or the last coming back. */
      page: LeafPage;
      /** Tilt of the roll's rulings, radians; 0 runs them up the spine. */
      tilt: number;
      /** Height the rulings tilt about, from the stage top. */
      pivotY: number;
    }
  /** The page has turned over and gone; the next waits for promotion. */
  | { kind: "turned" }
  /** The last page has been laid back down; it waits for promotion. */
  | { kind: "laid" };

type LeafPhase = "idle" | "dragging" | "settling" | "awaiting-navigation";

interface Gesture {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  width: number;
  height: number;
  /** A fresh turn waits for the direction; a catch holds the page at once. */
  mode: "fresh" | "catch";
  axis: "pending" | "locked";
  direction: SwipeDirection;
  /**
   * For a catch: the node held, where it was, and how far it lay from the
   * spine. A hand holding a page swings that point about the spine.
   */
  node: number;
  nodeX: number;
  nodeReach: number;
  samples: { x: number; t: number }[];
}

interface Turn {
  leaf: Leaf;
  page: LeafPage;
  canTurn: boolean;
  /** The rulings' tilt the hand asks for, and the tilt shown. */
  tilt: number;
  shownTilt: number;
  pivotY: number;
  corner: -1 | 0 | 1;
  /** A tap's scripted push, while it runs. */
  push: { direction: SwipeDirection; startedAt: number; width: number } | null;
}

interface UseLeafTurnOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  currentSpreadId: number | null;
  previousSpreadId: number | null;
  nextSpreadId: number | null;
  onPrevious: () => void;
  onNext: () => void;
  onSwipeStart?: () => void;
  /** A page let go, and whether it is about to turn. */
  onRelease?: (turns: boolean, speed: number) => void;
  /** The page moved; `travel` is how far its edge has come, in px. */
  onMove?: (travel: number) => void;
  /** The page has come to rest. */
  onSettled?: () => void;
  /** Called every frame a turn changes, and with null once it is over. */
  present: (view: LeafView | null) => void;
}

interface UseLeafTurnResult {
  phase: LeafPhase;
  isInteractionActive: boolean;
  /** Turns the page as a tap: a short push. False if it cannot turn. */
  turn: (direction: SwipeDirection, holdY?: number) => boolean;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

/**
 * Turns pages as a leaf of paper you hold (Debug curl).
 *
 * The page is a simulated strip (`Leaf`). A finger that swipes picks up its
 * edge and carries it round a roll, so the leaf curls over; let go, and
 * gravity, the air and the stack below decide where it lands. A touch at
 * any time catches a moving page where the finger meets it, including one
 * already falling over, so there is no moment when touches are ignored.
 *
 * Navigation follows the paper: a forward turn is sent once the leaf has
 * gone over the spine, a backward one once it lies down again. Until the
 * Reader promotes the new spread, the stage shows the turned state, and a
 * new touch waits for the promotion before it picks up the next leaf.
 */
export function useLeafTurn(options: UseLeafTurnOptions): UseLeafTurnResult {
  const {
    containerRef,
    enabled,
    currentSpreadId,
    previousSpreadId,
    nextSpreadId,
  } = options;
  const [phase, setPhaseState] = useState<LeafPhase>("idle");
  const phaseRef = useRef<LeafPhase>("idle");
  const turnRef = useRef<Turn | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  const pendingRef = useRef<SwipeDirection | null>(null);
  const queuedRef = useRef<SwipeDirection | null>(null);
  const frameRef = useRef(0);
  const lastTickRef = useRef(0);
  const sizeRef = useRef({ width: 0, height: 0 });
  const turnPageRef = useRef<
    (direction: SwipeDirection, holdY?: number) => boolean
  >(() => false);

  const setPhase = useCallback((next: LeafPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const adjacent = useEffectEvent(() => ({
    previous: previousSpreadId,
    next: nextSpreadId,
  }));
  const present = useEffectEvent((view: LeafView | null) =>
    options.present(view),
  );
  const notifyStart = useEffectEvent(() => options.onSwipeStart?.());
  const notifyRelease = useEffectEvent((turns: boolean, speed: number) =>
    options.onRelease?.(turns, speed),
  );
  const notifyMove = useEffectEvent((travel: number) =>
    options.onMove?.(travel),
  );
  const notifySettled = useEffectEvent(() => options.onSettled?.());
  const navigate = useEffectEvent((direction: SwipeDirection) => {
    if (direction === "next") options.onNext();
    else options.onPrevious();
  });

  const stopLoop = useCallback(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    lastTickRef.current = 0;
  }, []);

  const resetTurn = useEffectEvent(() => {
    stopLoop();
    turnRef.current = null;
    gestureRef.current = null;
    pendingRef.current = null;
    queuedRef.current = null;
    present(null);
    setPhase("idle");
  });

  /**
   * Shows the leaf. A tilted roll may not reach the spine, which stays
   * flat, so the tilt shrinks as the lift line nears it.
   */
  const showMoving = useEffectEvent((turn: Turn) => {
    const { width, height } = sizeRef.current;
    const lift = turn.leaf.liftLine() * (width / LEAF_WIDTH);
    const reach = turn.tilt > 0 ? height - turn.pivotY : turn.pivotY;
    const limit = Math.asin(Math.min(1, (0.9 * lift) / Math.max(1, reach)));
    turn.shownTilt = Math.max(-limit, Math.min(limit, turn.tilt));
    present({
      kind: "moving",
      leaf: turn.leaf,
      page: turn.page,
      tilt: turn.shownTilt,
      pivotY: turn.pivotY,
    });
  });

  /**
   * Whether the page can turn: the spread it turns to may arrive while the
   * page is in hand. Without one, the hill is out of reach.
   */
  const aim = useEffectEvent((turn: Turn) => {
    const forward = turn.page === "current";
    const target = forward ? adjacent().next : adjacent().previous;
    turn.canTurn = target !== null;
  });

  /** Leans gravity away from the hilltop, whichever side the page is on. */
  const lean = (turn: Turn) => {
    const forward = turn.page === "current";
    const hill = turn.canTurn
      ? forward
        ? HILL_FORWARD
        : HILL_BACKWARD
      : forward
        ? Math.PI
        : 0;
    turn.leaf.tilt = LEAN * Math.tanh((turn.leaf.angle() - hill) / HILL_WIDTH);
  };

  /** Starts a turn: the current page lifts, or the last one comes back. */
  const beginTurn = useEffectEvent(
    (direction: SwipeDirection, pivotY: number, corner: -1 | 0 | 1): Turn => {
      const turn: Turn = {
        leaf: new Leaf(direction === "next" ? "right" : "left"),
        page: direction === "next" ? "current" : "previous",
        canTurn: false,
        tilt: corner * CORNER_TILT,
        shownTilt: 0,
        pivotY,
        corner,
        push: null,
      };
      aim(turn);
      lean(turn);
      turnRef.current = turn;
      return turn;
    },
  );

  /**
   * Carries the edge for a finger `travel` px from where it started: round
   * the hand's roll for a forward turn, back off it for a backward one.
   */
  const carry = useEffectEvent(
    (turn: Turn, travel: number, rise: number, width: number) => {
      aim(turn);
      const metres = LEAF_WIDTH / width;
      const forward = turn.page === "current";
      let distance = forward ? Math.min(0, travel) : Math.max(0, travel);
      if (!turn.canTurn) distance = rubberBandSwipeOffset(distance, width);
      const radius = HAND_ROLL * LEAF_WIDTH;
      const crease = forward
        ? creaseUnder(LEAF_WIDTH + EDGE_LEAD * distance * metres, radius)
        : Math.min(LEAF_WIDTH, TURNED_CREASE + BACKWARD_GAIN * distance * metres);
      const [x, z, angle] = carriedEdge(crease, radius);
      turn.leaf.holdAt(LEAF_NODES, x, z + 0.0005, angle);
      const lean = Math.max(-1, Math.min(1, -rise / 240));
      turn.tilt =
        turn.corner === 0
          ? lean * MIDDLE_TILT
          : turn.corner * CORNER_TILT + lean * MIDDLE_TILT;
    },
  );

  const ensureLoop = useEffectEvent(() => {
    if (frameRef.current) return;
    lastTickRef.current = 0;
    frameRef.current = requestAnimationFrame(tick);
  });

  /** Lets the leaf go with the finger's speed (px/s, + rightward). */
  const letGo = useEffectEvent((turn: Turn, speed: number) => {
    const { leaf } = turn;
    aim(turn);
    leaf.release();
    const width = sizeRef.current.width || 1;
    // A flick spins the page about the spine, the way the finger moved,
    // unless there is no page to turn to that way.
    const spin = (-FLICK_SPIN * speed) / width;
    const over = turn.page === "current" ? spin > 0 : spin < 0;
    if (turn.canTurn || !over) leaf.spin(spin);
    const lands = leaf.predict();
    const turns =
      turn.canTurn &&
      (turn.page === "current" ? lands === "left" : lands === "right");
    notifyRelease(turns, speed);
    setPhase("settling");
    ensureLoop();
  });

  /** The leaf has landed or gone; turn the page if it did. */
  const finish = useEffectEvent((turn: Turn, outcome: "turned" | "home") => {
    stopLoop();
    turnRef.current = null;
    if (outcome === "home") {
      present(null);
      setPhase("idle");
      notifySettled();
      startQueued();
      return;
    }
    const direction: SwipeDirection =
      turn.page === "current" ? "next" : "previous";
    present({ kind: direction === "next" ? "turned" : "laid" });
    pendingRef.current = direction;
    setPhase("awaiting-navigation");
    notifySettled();
    navigate(direction);
    // Should the Reader not move, show it as it is rather than wait.
    window.setTimeout(() => {
      if (pendingRef.current !== direction) return;
      pendingRef.current = null;
      present(null);
      setPhase("idle");
    }, 1500);
  });

  const startQueued = useEffectEvent(() => {
    const queued = queuedRef.current;
    queuedRef.current = null;
    if (queued) turnPageRef.current(queued);
  });

  function tick(now: number) {
    frameRef.current = 0;
    const turn = turnRef.current;
    if (!turn) return;
    const elapsed = lastTickRef.current
      ? Math.min(1 / 30, (now - lastTickRef.current) / 1000)
      : 1 / 60;
    lastTickRef.current = now;
    const { leaf } = turn;
    if (turn.push) {
      const { width, startedAt, direction } = turn.push;
      const t = Math.min(1, (now - startedAt) / 1000 / PUSH_SECONDS);
      const sign = direction === "next" ? -1 : 1;
      carry(turn, sign * PUSH_DISTANCE * width * t * t, 0, width);
      if (t >= 1) {
        turn.push = null;
        leaf.advance(elapsed);
        letGo(turn, (sign * 2 * PUSH_DISTANCE * width) / PUSH_SECONDS);
        showMoving(turn);
        return;
      }
    }
    lean(turn);
    leaf.advance(elapsed);
    notifyMove(leaf.reach() * (sizeRef.current.width / LEAF_WIDTH));
    if (!leaf.held) {
      // Let go, a corner's tilt relaxes as the leaf falls.
      turn.tilt *= Math.exp(-3 * elapsed);
      const gone = leaf.reach() <= 0;
      const down = leaf.landedRight();
      if (turn.page === "current" && gone) return finish(turn, "turned");
      if (turn.page === "current" && down) return finish(turn, "home");
      if (turn.page === "previous" && down) return finish(turn, "turned");
      if (turn.page === "previous" && gone) return finish(turn, "home");
    }
    showMoving(turn);
    frameRef.current = requestAnimationFrame(tick);
  }

  // The Reader promoted the spread a turn asked for: the turned state can
  // give way to the new pages, before the browser paints them.
  useLayoutEffect(() => {
    if (!pendingRef.current) return;
    pendingRef.current = null;
    present(null);
    setPhase("idle");
    startQueued();
  }, [currentSpreadId, setPhase]);

  useEffect(() => {
    if (enabled) return;
    resetTurn();
  }, [enabled]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const measure = () => {
      const rect = container.getBoundingClientRect();
      sizeRef.current = { width: rect.width, height: rect.height };
      return rect;
    };

    const fingerSpeed = (gesture: Gesture): number => {
      const samples = gesture.samples;
      const last = samples[samples.length - 1];
      if (!last) return 0;
      const first =
        samples.find((sample) => last.t - sample.t <= 80) ?? samples[0]!;
      const seconds = (last.t - first.t) / 1000;
      if (seconds <= 0.004 || performance.now() - last.t > 60) return 0;
      return (last.x - first.x) / seconds;
    };

    /** Grabs the moving leaf where the finger meets it. */
    const catchLeaf = (turn: Turn, event: PointerEvent, rect: DOMRect) => {
      const metres = LEAF_WIDTH / rect.width;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const along =
        (x * Math.cos(turn.shownTilt) +
          (y - turn.pivotY) * Math.sin(turn.shownTilt)) *
        metres;
      const { leaf } = turn;
      let node = LEAF_NODES;
      let best = Infinity;
      for (let index = 2; index <= LEAF_NODES; index++) {
        // The finger meets the topmost layer under it.
        const score =
          Math.abs(leaf.x[index]! - along) - leaf.z[index]! * 0.5;
        if (score < best) {
          best = score;
          node = index;
        }
      }
      turn.push = null;
      leaf.holdAt(node, leaf.x[node]!, leaf.z[node]!);
      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        width: rect.width,
        height: rect.height,
        mode: "catch",
        axis: "locked",
        direction: turn.page === "current" ? "next" : "previous",
        node,
        nodeX: leaf.x[node]!,
        nodeReach: Math.hypot(leaf.x[node]!, leaf.z[node]!),
        samples: [{ x: event.clientX, t: performance.now() }],
      };
      container.setPointerCapture(event.pointerId);
      setPhase("dragging");
      ensureLoop();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      if (gestureRef.current) return;
      if (isControlTarget(event.target)) return;
      if (hasActiveTextSelection()) return;
      const rect = measure();
      const turn = turnRef.current;
      if (turn && phaseRef.current === "settling") {
        catchLeaf(turn, event, rect);
        return;
      }
      if (
        event.clientX - rect.left <= SYSTEM_NAVIGATION_EDGE_PX ||
        rect.right - event.clientX <= SYSTEM_NAVIGATION_EDGE_PX
      ) {
        return;
      }
      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        width: rect.width,
        height: rect.height,
        mode: "fresh",
        axis: "pending",
        direction: "next",
        node: LEAF_NODES,
        nodeX: 0,
        nodeReach: 0,
        samples: [{ x: event.clientX, t: performance.now() }],
      };
    };

    const lockFresh = (gesture: Gesture, deltaX: number, event: PointerEvent) => {
      gesture.axis = "locked";
      gesture.direction = deltaX < 0 ? "next" : "previous";
      const rect = container.getBoundingClientRect();
      const x = gesture.startX - rect.left;
      const y = gesture.startY - rect.top;
      const nearEdge = gesture.width - x <= CORNER_ZONE_PX;
      const corner: -1 | 0 | 1 =
        gesture.direction === "next" && nearEdge
          ? y >= gesture.height - CORNER_ZONE_PX
            ? 1
            : y <= CORNER_ZONE_PX
              ? -1
              : 0
          : 0;
      beginTurn(gesture.direction, y, corner);
      container.setPointerCapture(event.pointerId);
      window.getSelection()?.removeAllRanges();
      setPhase("dragging");
      notifyStart();
      ensureLoop();
    };

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;
      gesture.samples.push({ x: event.clientX, t: performance.now() });
      if (gesture.samples.length > 12) gesture.samples.shift();

      if (gesture.mode === "catch") {
        event.preventDefault();
        const turn = turnRef.current;
        if (!turn) return;
        const metres = LEAF_WIDTH / gesture.width;
        const reach = gesture.nodeReach;
        const x = Math.max(
          -reach,
          Math.min(reach, gesture.nodeX + deltaX * metres),
        );
        turn.leaf.holdAt(gesture.node, x, Math.sqrt(reach * reach - x * x));
        return;
      }

      if (gesture.axis === "pending") {
        // A touch made while the last turn is promoted waits for it.
        if (phaseRef.current === "awaiting-navigation") return;
        if (
          Math.abs(deltaX) < SWIPE_DIRECTION_LOCK_PX &&
          Math.abs(deltaY) < SWIPE_DIRECTION_LOCK_PX
        ) {
          return;
        }
        if (
          Math.abs(deltaY) >= Math.abs(deltaX) ||
          Date.now() - gesture.startedAt > MAX_TOUCH_TAP_DURATION_MS ||
          hasActiveTextSelection()
        ) {
          gestureRef.current = null;
          return;
        }
        lockFresh(gesture, deltaX, event);
      }

      event.preventDefault();
      let turn = turnRef.current;
      if (!turn) return;
      // A fresh drag that comes back past where it began turns the other way.
      const reversed =
        (gesture.direction === "next" && deltaX > REVERSE_PX) ||
        (gesture.direction === "previous" && deltaX < -REVERSE_PX);
      if (reversed) {
        gesture.direction = gesture.direction === "next" ? "previous" : "next";
        turn = beginTurn(gesture.direction, turn.pivotY, 0);
      }
      carry(turn, deltaX, deltaY, gesture.width);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      if (container.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
      const turn = turnRef.current;
      if (gesture.axis !== "locked" || !turn) return;
      // A tap that only caught the page: the side zones would turn it too.
      const tapped =
        gesture.mode === "catch" &&
        Math.abs(event.clientX - gesture.startX) < SWIPE_DIRECTION_LOCK_PX;
      if (
        !tapped ||
        getHorizontalTapZone(event.clientX, container.getBoundingClientRect()) !==
          "center"
      ) {
        event.preventDefault();
      }
      letGo(turn, fingerSpeed(gesture));
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;
      gestureRef.current = null;
      const turn = turnRef.current;
      if (gesture.axis === "locked" && turn) letGo(turn, 0);
    };

    turnPageRef.current = (direction, holdY) => {
      const busy = phaseRef.current;
      if (gestureRef.current) return true;
      if (busy === "awaiting-navigation") {
        queuedRef.current = direction;
        return true;
      }
      if (busy !== "idle") {
        // A page already falling the same way: hurry it, then push again.
        const turn = turnRef.current;
        const same =
          turn &&
          turn.canTurn &&
          (turn.page === "current") === (direction === "next");
        if (!same) return true;
        queuedRef.current = direction;
        finish(turn, "turned");
        return true;
      }
      const target =
        direction === "next" ? adjacent().next : adjacent().previous;
      if (target === null) return false;
      const rect = measure();
      const turn = beginTurn(direction, holdY ?? rect.height * 0.6, 0);
      turn.push = { direction, startedAt: performance.now(), width: rect.width };
      notifyStart();
      setPhase("settling");
      ensureLoop();
      return true;
    };

    container.addEventListener("pointerdown", handlePointerDown);
    container.addEventListener("pointermove", handlePointerMove, {
      passive: false,
    });
    container.addEventListener("pointerup", handlePointerUp);
    container.addEventListener("pointercancel", handlePointerCancel);
    return () => {
      container.removeEventListener("pointerdown", handlePointerDown);
      container.removeEventListener("pointermove", handlePointerMove);
      container.removeEventListener("pointerup", handlePointerUp);
      container.removeEventListener("pointercancel", handlePointerCancel);
      turnPageRef.current = () => false;
      resetTurn();
    };
  }, [containerRef, enabled, setPhase]);

  useEffect(() => stopLoop, [stopLoop]);

  const turn = useCallback(
    (direction: SwipeDirection, holdY?: number) =>
      turnPageRef.current(direction, holdY),
    [],
  );

  return {
    phase,
    isInteractionActive: phase !== "idle",
    turn,
  };
}

