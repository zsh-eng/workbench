import { animate, useMotionValue, useReducedMotion } from "motion/react";
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
  getHorizontalTapZone,
  isControlTarget,
  MAX_TOUCH_TAP_DURATION_MS,
} from "./use-touch-spread-tap-nav";

export const SWIPE_DIRECTION_LOCK_PX = 10;
export const SYSTEM_NAVIGATION_EDGE_PX = 24;
export const SWIPE_DECELERATION_RATE = 0.99;
export const SWIPE_COMMIT_DISTANCE_RATIO = 0.25;
/** The settle spring for page turns; scroll mode's page snap uses it too. */
export const SWIPE_SETTLE_SPRING = {
  type: "spring",
  duration: 0.4,
  bounce: 0,
} as const;
/** A curled page floats a little longer before it lands. */
export const CURL_SETTLE_SPRING = {
  type: "spring",
  duration: 0.52,
  bounce: 0,
} as const;

type SwipePhase = "idle" | "dragging" | "settling" | "awaiting-navigation";
export type SwipeDirection = "previous" | "next";

interface SwipeGesture {
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  startOffset: number;
  startDragY: number;
  resumeTargetOffset: number | null;
  width: number;
  axis: "pending" | "horizontal";
}

interface PendingNavigation {
  direction: SwipeDirection;
  targetSpreadId: number;
  width: number;
  dispatched: boolean;
}

interface UseSpreadSwipeNavigationOptions {
  containerRef: RefObject<HTMLElement | null>;
  enabled: boolean;
  currentSpreadId: number | null;
  previousSpreadId: number | null;
  nextSpreadId: number | null;
  onPrevious: () => void;
  onNext: () => void;
  onSwipeStart?: () => void;
  /** A released swipe, with where it will settle (0 returns the page). */
  onRelease?: (targetOffset: number, velocity: number) => void;
  /** The page has come to rest after a swipe or a turn. */
  onSettled?: () => void;
  disableMotion?: boolean;
  /** The settle spring; the curl gives paper a little longer in the air. */
  settleSpring?: typeof SWIPE_SETTLE_SPRING | typeof CURL_SETTLE_SPRING;
}

interface UseSpreadSwipeNavigationResult {
  dragOffset: ReturnType<typeof useMotionValue<number>>;
  /** The finger's vertical travel; a curl tilts with it. */
  dragY: ReturnType<typeof useMotionValue<number>>;
  /** Where the page is held, from the stage top. */
  grabY: ReturnType<typeof useMotionValue<number>>;
  phase: SwipePhase;
  isInteractionActive: boolean;
  /**
   * Turns the page as a swipe would, from rest. Returns false when the
   * page cannot turn now, so the caller can navigate another way.
   */
  turn: (direction: SwipeDirection, holdY?: number) => boolean;
}

function hasActiveTextSelection(): boolean {
  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString());
}

function isSystemNavigationEdge(clientX: number): boolean {
  return (
    clientX <= SYSTEM_NAVIGATION_EDGE_PX ||
    window.innerWidth - clientX <= SYSTEM_NAVIGATION_EDGE_PX
  );
}

/** Applies resistance when the user pulls beyond a book boundary. */
export function rubberBandSwipeOffset(
  distance: number,
  dimension: number,
): number {
  if (dimension <= 0 || distance === 0) return 0;

  const normalizedDistance = (Math.abs(distance) * 0.55) / dimension;
  const resistedDistance = (1 - 1 / (normalizedDistance + 1)) * dimension;
  return Math.sign(distance) * resistedDistance;
}

/** Projects the release velocity with the same decay model used by momentum UI. */
export function projectSwipeOffset(offset: number, velocity: number): number {
  const velocityPerMillisecond = velocity / 1000;
  const projectedTravel =
    (velocityPerMillisecond * SWIPE_DECELERATION_RATE) /
    (1 - SWIPE_DECELERATION_RATE);
  return offset + projectedTravel;
}

export function resolveSwipeTarget(options: {
  startOffset?: number;
  offset: number;
  velocity: number;
  width: number;
  canGoPrevious: boolean;
  canGoNext: boolean;
}): number {
  const {
    startOffset = 0,
    offset,
    velocity,
    width,
    canGoPrevious,
    canGoNext,
  } = options;
  if (width <= 0) return 0;

  const gestureOffset = offset - startOffset;
  const projectedOffset = projectSwipeOffset(gestureOffset, velocity);
  const commitDistance = width * SWIPE_COMMIT_DISTANCE_RATIO;

  if (projectedOffset <= -commitDistance && canGoNext) return -width;
  if (projectedOffset >= commitDistance && canGoPrevious) return width;
  return 0;
}

/** Keeps the same pixels on screen after the worker promotes an adjacent page. */
export function rebaseSwipeOffset(
  offset: number,
  direction: SwipeDirection,
  width: number,
): number {
  return direction === "next" ? offset + width : offset - width;
}

/**
 * Owns the direct-manipulation part of page turns.
 *
 * A resolved turn is sent to pagination immediately. When the worker promotes
 * the adjacent spread, the live offset is rebased to the new current spread so
 * the same pixels stay on screen and the remaining settle stays interruptible.
 */
export function useSpreadSwipeNavigation(
  options: UseSpreadSwipeNavigationOptions,
): UseSpreadSwipeNavigationResult {
  const {
    containerRef,
    enabled,
    currentSpreadId,
    previousSpreadId,
    nextSpreadId,
    onPrevious,
    onNext,
    onSwipeStart,
    onRelease,
    onSettled,
    disableMotion = false,
    settleSpring = SWIPE_SETTLE_SPRING,
  } = options;
  const prefersReducedMotion = useReducedMotion();
  const dragOffset = useMotionValue(0);
  const dragY = useMotionValue(0);
  const grabY = useMotionValue(0);
  const verticalAnimationRef = useRef<{ stop: () => void } | null>(null);
  const turnRef = useRef<
    (direction: SwipeDirection, holdY?: number) => boolean
  >(() => false);
  const [phase, setPhaseState] = useState<SwipePhase>("idle");

  const phaseRef = useRef<SwipePhase>("idle");
  const gestureRef = useRef<SwipeGesture | null>(null);
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const animationRef = useRef<{ stop: () => void } | null>(null);
  const animationGenerationRef = useRef(0);
  const settleTargetOffsetRef = useRef<number | null>(null);
  const stageWidthRef = useRef(0);
  const settleRef = useRef<(targetOffset: number, velocity: number) => void>(
    () => {},
  );
  const lastObservedCurrentSpreadIdRef = useRef(currentSpreadId);
  // Gesture subscriptions read adjacent targets from the latest committed render.
  const notifySwipeStart = useEffectEvent(() => onSwipeStart?.());
  const notifyRelease = useEffectEvent((target: number, velocity: number) =>
    onRelease?.(target, velocity),
  );
  const notifySettled = useEffectEvent(() => onSettled?.());
  const adjacentSpreads = useEffectEvent(() => ({
    previous: previousSpreadId,
    next: nextSpreadId,
  }));

  const setPhase = useCallback((nextPhase: SwipePhase) => {
    phaseRef.current = nextPhase;
    setPhaseState(nextPhase);
  }, []);

  const stopAnimation = useCallback(() => {
    animationGenerationRef.current += 1;
    animationRef.current?.stop();
    animationRef.current = null;
    verticalAnimationRef.current?.stop();
    verticalAnimationRef.current = null;
  }, []);

  const resetInteraction = useCallback(() => {
    stopAnimation();
    gestureRef.current = null;
    pendingNavigationRef.current = null;
    settleTargetOffsetRef.current = null;
    dragOffset.set(0);
    dragY.set(0);
    setPhase("idle");
  }, [dragOffset, dragY, setPhase, stopAnimation]);

  const dispatchPendingNavigationIfReady = useEffectEvent((offset: number) => {
    const pendingNavigation = pendingNavigationRef.current;
    if (!pendingNavigation || pendingNavigation.dispatched) return;

    const reachedCurrentSpread =
      pendingNavigation.direction === "next" ? offset <= 0 : offset >= 0;
    if (!reachedCurrentSpread) return;

    pendingNavigation.dispatched = true;
    setPhase("awaiting-navigation");
    if (pendingNavigation.direction === "next") {
      onNext();
      return;
    }
    onPrevious();
  });

  useLayoutEffect(() => {
    const previousCurrentSpreadId = lastObservedCurrentSpreadIdRef.current;
    lastObservedCurrentSpreadIdRef.current = currentSpreadId;
    const pendingNavigation = pendingNavigationRef.current;
    if (!pendingNavigation?.dispatched) return;
    if (
      currentSpreadId !== pendingNavigation.targetSpreadId &&
      currentSpreadId === previousCurrentSpreadId
    ) {
      return;
    }

    const velocity = dragOffset.getVelocity();
    const rebasedOffset = rebaseSwipeOffset(
      dragOffset.get(),
      pendingNavigation.direction,
      pendingNavigation.width,
    );
    stopAnimation();
    pendingNavigationRef.current = null;
    dragOffset.set(rebasedOffset);
    if (rebasedOffset === 0) {
      settleTargetOffsetRef.current = null;
      dragY.set(0);
      setPhase("idle");
      notifySettled();
      return;
    }
    settleRef.current(0, velocity);
  }, [currentSpreadId, dragOffset, dragY, setPhase, stopAnimation]);

  useEffect(() => {
    if (enabled) return;
    resetInteraction();
  }, [enabled, resetInteraction]);

  useEffect(
    () =>
      dragOffset.on("change", (offset) => {
        dispatchPendingNavigationIfReady(offset);
      }),
    [dragOffset],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !enabled) return;

    const releasePointerCapture = (pointerId: number) => {
      if (!container.hasPointerCapture(pointerId)) return;
      container.releasePointerCapture(pointerId);
    };

    const finishSettle = (targetOffset: number) => {
      if (targetOffset !== 0) {
        dispatchPendingNavigationIfReady(dragOffset.get());
        return;
      }

      settleTargetOffsetRef.current = null;
      dragOffset.set(0);
      dragY.set(0);
      setPhase("idle");
      notifySettled();
    };

    const settle = (targetOffset: number, velocity: number) => {
      stopAnimation();
      settleTargetOffsetRef.current = targetOffset;
      const direction: SwipeDirection | null =
        targetOffset < 0 ? "next" : targetOffset > 0 ? "previous" : null;
      const targetSpreadId =
        direction === "next"
          ? adjacentSpreads().next
          : direction === "previous"
            ? adjacentSpreads().previous
            : null;

      if (direction && targetSpreadId !== null) {
        pendingNavigationRef.current = {
          direction,
          targetSpreadId,
          width: stageWidthRef.current,
          dispatched: false,
        };
      } else {
        pendingNavigationRef.current = null;
      }

      setPhase("settling");
      if (disableMotion || prefersReducedMotion) {
        dragOffset.set(targetOffset);
        dragY.set(0);
        dispatchPendingNavigationIfReady(targetOffset);
        finishSettle(targetOffset);
        return;
      }

      const generation = animationGenerationRef.current;
      verticalAnimationRef.current = animate(dragY, 0, settleSpring);
      const controls = animate(dragOffset, targetOffset, {
        ...settleSpring,
        velocity,
      });
      animationRef.current = controls;
      dispatchPendingNavigationIfReady(dragOffset.get());
      void controls.then(() => {
        if (animationGenerationRef.current !== generation) return;
        animationRef.current = null;
        finishSettle(targetOffset);
      });
    };
    settleRef.current = settle;

    const handlePointerDown = (event: PointerEvent) => {
      if (!event.isPrimary || event.button !== 0) return;
      if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
      if (pendingNavigationRef.current) return;
      if (phaseRef.current === "awaiting-navigation") return;
      if (phaseRef.current !== "idle" && phaseRef.current !== "settling") {
        return;
      }
      if (isControlTarget(event.target)) return;
      if (hasActiveTextSelection()) return;
      if (isSystemNavigationEdge(event.clientX)) return;

      const startOffset = dragOffset.get();
      const resuming = phaseRef.current === "settling";
      const resumeTargetOffset = resuming
        ? settleTargetOffsetRef.current
        : null;
      stopAnimation();
      setPhase("idle");
      const rect = container.getBoundingClientRect();
      const width = rect.width;
      stageWidthRef.current = width;
      // A caught page stays held where it was; a fresh one where touched.
      if (!resuming) grabY.set(event.clientY - rect.top);
      gestureRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        startedAt: Date.now(),
        startOffset,
        startDragY: resuming ? dragY.get() : 0,
        resumeTargetOffset,
        width,
        axis: "pending",
      };
    };

    const handlePointerMove = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      const deltaX = event.clientX - gesture.startX;
      const deltaY = event.clientY - gesture.startY;

      if (gesture.axis === "pending") {
        if (
          Math.abs(deltaX) < SWIPE_DIRECTION_LOCK_PX &&
          Math.abs(deltaY) < SWIPE_DIRECTION_LOCK_PX
        ) {
          return;
        }

        if (Math.abs(deltaY) >= Math.abs(deltaX)) {
          gestureRef.current = null;
          if (gesture.resumeTargetOffset !== null) {
            settle(gesture.resumeTargetOffset, 0);
          }
          return;
        }

        if (
          Date.now() - gesture.startedAt > MAX_TOUCH_TAP_DURATION_MS ||
          hasActiveTextSelection()
        ) {
          gestureRef.current = null;
          if (gesture.resumeTargetOffset !== null) {
            settle(gesture.resumeTargetOffset, 0);
          }
          return;
        }

        gesture.axis = "horizontal";
        container.setPointerCapture(event.pointerId);
        window.getSelection()?.removeAllRanges();
        setPhase("dragging");
        notifySwipeStart();
      }

      event.preventDefault();

      let nextOffset = gesture.startOffset + deltaX;
      if (nextOffset < 0 && adjacentSpreads().next === null) {
        nextOffset = rubberBandSwipeOffset(nextOffset, gesture.width);
      } else if (nextOffset > 0 && adjacentSpreads().previous === null) {
        nextOffset = rubberBandSwipeOffset(nextOffset, gesture.width);
      } else {
        nextOffset = Math.max(
          -gesture.width,
          Math.min(gesture.width, nextOffset),
        );
      }
      dragOffset.set(nextOffset);
      dragY.set(gesture.startDragY + deltaY);
    };

    const handlePointerUp = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      gestureRef.current = null;
      releasePointerCapture(event.pointerId);
      if (gesture.axis !== "horizontal") {
        if (gesture.resumeTargetOffset !== null) {
          const tapZone = getHorizontalTapZone(
            event.clientX,
            container.getBoundingClientRect(),
          );
          // The parent tap recognizer owns center taps that toggle reader chrome.
          // Resume the page spring without consuming that clean pointerup.
          if (tapZone !== "center") event.preventDefault();
          settle(gesture.resumeTargetOffset, 0);
        }
        return;
      }

      event.preventDefault();
      const targetOffset = resolveSwipeTarget({
        startOffset: gesture.startOffset,
        offset: dragOffset.get(),
        velocity: dragOffset.getVelocity(),
        width: gesture.width,
        canGoPrevious: adjacentSpreads().previous !== null,
        canGoNext: adjacentSpreads().next !== null,
      });
      notifyRelease(targetOffset, dragOffset.getVelocity());
      settle(targetOffset, dragOffset.getVelocity());
    };

    turnRef.current = (direction, holdY) => {
      if (phaseRef.current !== "idle" || gestureRef.current) return false;
      const target =
        direction === "next"
          ? adjacentSpreads().next
          : adjacentSpreads().previous;
      if (target === null) return false;
      const rect = container.getBoundingClientRect();
      stageWidthRef.current = rect.width;
      grabY.set(holdY ?? rect.height * 0.72);
      dragY.set(0);
      notifySwipeStart();
      const targetOffset = direction === "next" ? -rect.width : rect.width;
      notifyRelease(targetOffset, 0);
      settle(targetOffset, 0);
      return true;
    };

    const handlePointerCancel = (event: PointerEvent) => {
      const gesture = gestureRef.current;
      if (!gesture || gesture.pointerId !== event.pointerId) return;

      gestureRef.current = null;
      releasePointerCapture(event.pointerId);
      if (gesture.axis === "horizontal") settle(0, 0);
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
      stopAnimation();
      gestureRef.current = null;
      turnRef.current = () => false;
    };
  }, [
    containerRef,
    disableMotion,
    dragOffset,
    dragY,
    enabled,
    grabY,
    prefersReducedMotion,
    setPhase,
    settleSpring,
    stopAnimation,
  ]);

  const turn = useCallback(
    (direction: SwipeDirection, holdY?: number) =>
      turnRef.current(direction, holdY),
    [],
  );

  return {
    dragOffset,
    dragY,
    grabY,
    phase,
    isInteractionActive: phase !== "idle",
    turn,
  };
}
