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
  LEAF_SEGMENT,
  LEAF_WIDTH,
} from "../paper/leaf-physics";
import type { LeafGrip } from "../paper/paper-preference";
import {
  gripFrame,
  holdAngle,
  rollFrame,
  toSection,
  type SheetFrame,
} from "../paper/sheet-frame";
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
 * Holding the edge, the edge leads the finger, so the page comes over the
 * top while the thumb is still well inside the screen.
 */
const EDGE_LEAD = 1.6;
/** Where the edge lies once a page has turned: a little short of flat. */
const TURNED_CREASE = (0.1 * LEAF_WIDTH - Math.PI * HAND_ROLL * LEAF_WIDTH) / 2;
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
/** A finger leaving faster than this, px a second, flicks the page. */
const FLICK_SPEED = 450;
/** How far a flick leans gravity, until the page passes upright. */
const FLING_LEAN = (95 * Math.PI) / 180;
/** Holding the edge: the tilt a middle grip allows the roll. */
const MIDDLE_TILT = 0.07;
/** Holding the edge: a corner grip tilts the roll this much. */
const CORNER_TILT = 0.42;
const CORNER_ZONE_PX = 56;
/**
 * Held anywhere, a touch this near a corner of the fore-edge holds the
 * corner, and may pull it across the page as steeply as this (dy over dx):
 * a thumb takes a corner up and over, not straight across.
 */
const CORNER_REACH_X = 72;
const CORNER_REACH_Y = 150;
const CORNER_PULL_SLOPE = 2.4;
/**
 * Held anywhere, the fold turns to lie across the pull, the way the hand
 * moves the paper. Short pulls go straight across, as a thumb's first
 * millimetres are noise: the pull is measured as if it began this much
 * further right.
 */
const PULL_STEADY_PX = 48;
/** How fast the fold turns to follow the pull, seconds. */
const FOLD_FOLLOW = 0.06;
/** Let go, the fold straightens as the leaf falls, seconds. */
const FOLD_RELAX = 0.33;
/**
 * Held anywhere, a touch this near the spine holds the page this far out:
 * paper held at the gutter cannot be turned by pulling it.
 */
const NEAREST_GRIP = 0.35;
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
      /** How the leaf's section lies over the page. */
      frame: SheetFrame;
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
  grip: LeafGrip;
  /**
   * Where the hand holds the page, in page px: the paper point held. For
   * the edge grip, `gripY` is the height the roll tilts about.
   */
  gripX: number;
  gripY: number;
  /** The node of the strip at the grip. */
  node: number;
  /** The fold's angle the hand asks for, and the angle shown. */
  wanted: number;
  angle: number;
  corner: -1 | 0 | 1;
  /** A finger carrying the held point, as it last moved, page px. */
  pull: { x: number; y: number; travelX: number; travelY: number } | null;
  /** A tap's scripted push, while it runs. */
  push: { direction: SwipeDirection; startedAt: number } | null;
  /**
   * A flick carries the page over the hill whichever side it is on: 1
   * onward, -1 home, 0 for a page let go gently.
   */
  fling: -1 | 0 | 1;
}

interface UseLeafTurnOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  grip: LeafGrip;
  /** Px at the right of the stage that the book's fore-edge takes. */
  foreEdge: number;
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
 * The page is a simulated strip (`Leaf`) laid over the page by a sheet
 * frame (`SheetFrame`). A finger that swipes takes hold of the paper where
 * it touches and carries that point, under the finger, round the hand's
 * roll; the fold lies across the pull, so a corner pulled across the page
 * makes a cone and the middle of the edge a roll. Let go, and gravity, the
 * air and the stack below decide where it lands. A touch at any time
 * catches a moving page where the finger meets it, including one already
 * falling over, so there is no moment when touches are ignored.
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
  const settings = useEffectEvent(() => ({
    grip: options.grip,
    foreEdge: options.foreEdge,
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

  /** The page the leaf is: the stage less the book's fore-edge. */
  const pageSize = () => {
    const { width, height } = sizeRef.current;
    return {
      width: Math.max(1, width - settings().foreEdge),
      height,
    };
  };

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
   * How the leaf lies over the page now. Held at the edge, a tilted roll
   * may not reach the spine, which stays flat, so the tilt shrinks as the
   * lift line nears it. Held anywhere, the cone's apex lies on the spine's
   * line, so the spine always stays flat.
   */
  const frameOf = (turn: Turn): SheetFrame => {
    const { width, height } = pageSize();
    if (turn.grip === "anywhere") {
      return gripFrame(turn.gripX, turn.gripY, turn.angle, width);
    }
    const lift = turn.leaf.liftLine() * (width / LEAF_WIDTH);
    const reach = turn.wanted > 0 ? height - turn.gripY : turn.gripY;
    const limit = Math.asin(Math.min(1, (0.9 * lift) / Math.max(1, reach)));
    turn.angle = Math.max(-limit, Math.min(limit, turn.wanted));
    return rollFrame(turn.gripY, turn.angle, width);
  };

  const showMoving = useEffectEvent((turn: Turn) => {
    present({
      kind: "moving",
      leaf: turn.leaf,
      page: turn.page,
      frame: frameOf(turn),
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

  /**
   * Leans gravity away from the hilltop, whichever side the page is on;
   * `leaf` may be a copy, to look ahead.
   */
  const lean = (turn: Turn, leaf: Leaf = turn.leaf) => {
    const forward = turn.page === "current";
    const onward = turn.canTurn && turn.fling !== -1;
    const toLeft = onward === forward;
    const angle = leaf.angle();
    const hill =
      turn.fling !== 0 || !turn.canTurn
        ? toLeft
          ? 0
          : Math.PI
        : forward
          ? HILL_FORWARD
          : HILL_BACKWARD;
    // A flicked page is thrown until it stands past upright.
    const thrown =
      turn.fling !== 0 && (toLeft ? angle < Math.PI / 2 : angle > Math.PI / 2);
    leaf.tilt =
      (thrown ? FLING_LEAN : LEAN) * Math.tanh((angle - hill) / HILL_WIDTH);
  };

  /**
   * Starts a turn: the current page lifts, or the last one comes back.
   * `gripX` is where the finger took the page; held at the edge, or coming
   * back, the hand holds the fore-edge.
   */
  const beginTurn = useEffectEvent(
    (
      direction: SwipeDirection,
      gripX: number,
      gripY: number,
      corner: -1 | 0 | 1,
    ): Turn => {
      const { width } = pageSize();
      const grip = settings().grip;
      const held = grip === "anywhere" && direction === "next";
      const x = held
        ? Math.max(NEAREST_GRIP * width, Math.min(width, gripX))
        : width;
      const node = held
        ? Math.max(
            2,
            Math.min(LEAF_NODES, Math.round((x / width) * LEAF_NODES)),
          )
        : LEAF_NODES;
      const turn: Turn = {
        leaf: new Leaf(direction === "next" ? "right" : "left"),
        page: direction === "next" ? "current" : "previous",
        canTurn: false,
        grip,
        gripX: x,
        gripY,
        node,
        wanted: grip === "edge" ? corner * CORNER_TILT : 0,
        angle: 0,
        corner,
        pull: null,
        push: null,
        fling: 0,
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
  const carry = useEffectEvent((turn: Turn, travel: number, rise: number) => {
    aim(turn);
    const { width } = pageSize();
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
    if (turn.grip !== "edge") return;
    const lean = Math.max(-1, Math.min(1, -rise / 240));
    turn.wanted =
      turn.corner === 0
        ? lean * MIDDLE_TILT
        : turn.corner * CORNER_TILT + lean * MIDDLE_TILT;
  });

  /**
   * Holding the page anywhere: carries the held point under the finger,
   * round the hand's roll, with the fold turned across the pull. The paper
   * beyond the grip is free, and hangs or falls as the strip makes it.
   */
  const carryHeld = useEffectEvent((turn: Turn, elapsed: number) => {
    const pull = turn.pull;
    if (!pull) return;
    aim(turn);
    const { width, height } = pageSize();
    let travelX = Math.min(0, pull.travelX);
    if (!turn.canTurn) travelX = rubberBandSwipeOffset(travelX, width);
    const targetX = turn.gripX + travelX;
    const targetY = turn.gripY + pull.travelY;
    turn.wanted = holdAngle(
      turn.gripX,
      turn.gripY,
      Math.atan2(turn.gripY - targetY, turn.gripX - targetX + PULL_STEADY_PX),
      width,
      height,
    );
    turn.angle +=
      (turn.wanted - turn.angle) * (1 - Math.exp(-elapsed / FOLD_FOLLOW));
    const frame = frameOf(turn);
    const toStrip = LEAF_WIDTH / frame.length;
    const [arc] = toSection(frame, targetX, targetY);
    const held = turn.node * LEAF_SEGMENT;
    const radius = HAND_ROLL * LEAF_WIDTH;
    const crease = creaseUnder(arc * toStrip, radius, held);
    const [x, z, angle] = carriedEdge(crease, radius, held);
    turn.leaf.holdAt(turn.node, x, z + 0.0005, angle);
  });

  const ensureLoop = useEffectEvent(() => {
    if (frameRef.current) return;
    lastTickRef.current = 0;
    frameRef.current = requestAnimationFrame(tick);
  });

  /** Lets the leaf go with the finger's speed (px/s, + rightward). */
  const letGo = useEffectEvent((turn: Turn, speed: number) => {
    const { leaf } = turn;
    aim(turn);
    turn.pull = null;
    leaf.release();
    const width = pageSize().width;
    // A flick spins the page about the spine, the way the finger moved,
    // unless there is no page to turn to that way.
    const spin = (-FLICK_SPIN * speed) / width;
    const over = turn.page === "current" ? spin > 0 : spin < 0;
    if (turn.canTurn || !over) leaf.spin(spin);
    turn.fling =
      Math.abs(speed) < FLICK_SPEED ? 0 : over && turn.canTurn ? 1 : -1;
    const lands = leaf.predict((copy) => lean(turn, copy));
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
      const { startedAt, direction } = turn.push;
      const width = pageSize().width;
      const t = Math.min(1, (now - startedAt) / 1000 / PUSH_SECONDS);
      const sign = direction === "next" ? -1 : 1;
      carry(turn, sign * PUSH_DISTANCE * width * t * t, 0);
      if (t >= 1) {
        turn.push = null;
        leaf.advance(elapsed);
        letGo(turn, (sign * 2 * PUSH_DISTANCE * width) / PUSH_SECONDS);
        showMoving(turn);
        return;
      }
    }
    if (turn.pull) carryHeld(turn, elapsed);
    lean(turn);
    leaf.advance(elapsed);
    notifyMove(leaf.reach() * (pageSize().width / LEAF_WIDTH));
    if (!leaf.held) {
      // Let go, a corner's fold straightens as the leaf falls.
      const relax = Math.exp(-elapsed / FOLD_RELAX);
      turn.wanted *= relax;
      if (turn.grip === "anywhere") turn.angle *= relax;
      const gone = leaf.goneLeft();
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

    /**
     * The finger's speed as it lifts, over its last 80 ms, by the events'
     * own times: moves can arrive together, a frame late.
     */
    const fingerSpeed = (gesture: Gesture, lift: PointerEvent): number => {
      const samples = gesture.samples;
      const last = samples[samples.length - 1];
      if (!last) return 0;
      const first =
        samples.find((sample) => last.t - sample.t <= 80) ?? samples[0]!;
      const seconds = (last.t - first.t) / 1000;
      if (seconds <= 0.004 || lift.timeStamp - last.t > 60) return 0;
      return (last.x - first.x) / seconds;
    };

    /** Grabs the moving leaf where the finger meets it. */
    const catchLeaf = (turn: Turn, event: PointerEvent, rect: DOMRect) => {
      const frame = frameOf(turn);
      const [arc] = toSection(
        frame,
        event.clientX - rect.left,
        event.clientY - rect.top,
      );
      const along = arc * (LEAF_WIDTH / frame.length);
      const { leaf } = turn;
      let node = LEAF_NODES;
      let best = Infinity;
      for (let index = 2; index <= LEAF_NODES; index++) {
        // The finger meets the topmost layer under it.
        const score = Math.abs(leaf.x[index]! - along) - leaf.z[index]! * 0.5;
        if (score < best) {
          best = score;
          node = index;
        }
      }
      turn.push = null;
      turn.pull = null;
      turn.fling = 0;
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
        samples: [{ x: event.clientX, t: event.timeStamp }],
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
        samples: [{ x: event.clientX, t: event.timeStamp }],
      };
    };

    /** Whether a touch began by a corner of the fore-edge. */
    const atCorner = (gesture: Gesture) => {
      const rect = container.getBoundingClientRect();
      const x = gesture.startX - rect.left;
      const y = gesture.startY - rect.top;
      return (
        rect.width - x <= CORNER_REACH_X &&
        (y <= CORNER_REACH_Y || rect.height - y <= CORNER_REACH_Y)
      );
    };

    const lockFresh = (
      gesture: Gesture,
      deltaX: number,
      event: PointerEvent,
    ) => {
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
      beginTurn(gesture.direction, x, y, corner);
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
      gesture.samples.push({ x: event.clientX, t: event.timeStamp });
      if (gesture.samples.length > 12) gesture.samples.shift();

      if (gesture.mode === "catch") {
        event.preventDefault();
        const turn = turnRef.current;
        if (!turn) return;
        const metres = LEAF_WIDTH / pageSize().width;
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
        const steepest =
          settings().grip === "anywhere" && atCorner(gesture) && deltaX < 0
            ? CORNER_PULL_SLOPE
            : 1;
        if (
          Math.abs(deltaY) >= steepest * Math.abs(deltaX) ||
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
        const rect = container.getBoundingClientRect();
        turn = beginTurn(
          gesture.direction,
          gesture.startX - rect.left,
          turn.gripY,
          0,
        );
      }
      const held = turn.grip === "anywhere" && turn.page === "current";
      if (held) {
        turn.pull = {
          x: event.clientX,
          y: event.clientY,
          travelX: deltaX,
          travelY: deltaY,
        };
        return;
      }
      carry(turn, deltaX, deltaY);
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
        getHorizontalTapZone(
          event.clientX,
          container.getBoundingClientRect(),
        ) !== "center"
      ) {
        event.preventDefault();
      }
      letGo(turn, fingerSpeed(gesture, event));
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
      // A tap pushes the fore-edge, as a hand would.
      const turn = beginTurn(
        direction,
        rect.width,
        holdY ?? rect.height * 0.6,
        0,
      );
      turn.gripX = pageSize().width;
      turn.node = LEAF_NODES;
      turn.push = { direction, startedAt: performance.now() };
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
