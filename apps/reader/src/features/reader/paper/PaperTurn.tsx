import type { MotionValue } from "motion/react";
import { useLayoutEffect, useRef, type RefObject } from "react";
import { useLeafTurn, type LeafView } from "../hooks/use-leaf-turn";
import { BookBlock, foreEdgeWidth } from "./BookBlock";
import type { PaperGrain } from "./paper-grain";
import type { LeafGrip } from "./paper-preference";
import { useLeafCurl } from "./use-leaf-curl";
import { usePageCurl, type PageCurlLayers } from "./use-page-curl";
import { usePageFeel, type PageFeel } from "./use-page-feel";

/** What the stage needs back from a leaf turn. */
export type LeafTurnState = Pick<
  ReturnType<typeof useLeafTurn>,
  "phase" | "isInteractionActive" | "turn"
>;

interface PaperTurnProps {
  /** The leaf you can hold, or the first curl, driven by the swipe. */
  kind: "leaf" | "curl";
  stageRef: RefObject<HTMLElement | null>;
  layers: PageCurlLayers;
  keys: {
    previous: string | null;
    current: string | null;
    next: string | null;
  };
  swipeEnabled: boolean;
  /** The swipe's motion, which drives the first curl. */
  swipe: {
    dragOffset: MotionValue<number>;
    dragY: MotionValue<number>;
    grabY: MotionValue<number>;
    idle: boolean;
  };
  spreadIds: {
    current: number | null;
    previous: number | null;
    next: number | null;
  };
  onPrevious: () => void;
  onNext: () => void;
  onSwipeStart?: () => void;
  grip: LeafGrip;
  bookBlock: boolean;
  readPages: number;
  unreadPages: number;
  grain: PaperGrain;
  showThrough: boolean;
  haptics: boolean;
  sound: boolean;
  /** Set to the turn's feel, which the swipe plays for the first curl. */
  feelRef: RefObject<PageFeel | null>;
  /** The leaf's turn as it changes, and null once this unmounts. */
  onLeafTurn: (state: LeafTurnState | null) => void;
}

/**
 * The page curls (Debug), loaded only when one is chosen: the leaf's
 * gesture and the curl's drawing, the book around the leaf, and the turn's
 * feel. The stage keeps the pages and the slide; this draws over them.
 */
export function PaperTurn({
  kind,
  stageRef,
  layers,
  keys,
  swipeEnabled,
  swipe,
  spreadIds,
  onPrevious,
  onNext,
  onSwipeStart,
  grip,
  bookBlock,
  readPages,
  unreadPages,
  grain,
  showThrough,
  haptics,
  sound,
  feelRef,
  onLeafTurn,
}: PaperTurnProps) {
  const leaf = kind === "leaf";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const feel = usePageFeel({ haptics, sound });
  // The leaf lies in a book: its unread stack takes the stage's right edge.
  const showBook = leaf && bookBlock && spreadIds.current !== null;
  const foreEdge = showBook ? foreEdgeWidth(unreadPages) : 0;

  const presenter = useRef<(view: LeafView | null) => void>(() => {});
  const leafTurn = useLeafTurn({
    containerRef: stageRef,
    enabled: swipeEnabled && leaf,
    grip,
    foreEdge,
    currentSpreadId: spreadIds.current,
    previousSpreadId: spreadIds.previous,
    nextSpreadId: spreadIds.next,
    onPrevious,
    onNext,
    onSwipeStart: () => {
      feel.start();
      onSwipeStart?.();
    },
    onRelease: (turns, speed) => feel.release(turns ? 1 : 0, speed),
    onMove: feel.drag,
    onSettled: feel.settled,
    present: (view) => presenter.current(view),
  });

  usePageCurl({
    enabled: !leaf,
    stageRef,
    canvasRef,
    layers,
    dragOffset: swipe.dragOffset,
    dragY: swipe.dragY,
    grabY: swipe.grabY,
    keys,
    idle: swipe.idle,
    grain,
    showThrough,
  });

  useLeafCurl({
    enabled: leaf,
    stageRef,
    canvasRef,
    layers,
    keys,
    idle: leafTurn.phase === "idle",
    foreEdge,
    grain,
    showThrough,
    presenterRef: presenter,
  });

  useLayoutEffect(() => {
    if (leaf) return;
    return swipe.dragOffset.on("change", feel.drag);
  }, [leaf, swipe.dragOffset, feel.drag]);

  useLayoutEffect(() => {
    feelRef.current = feel;
    return () => {
      feelRef.current = null;
    };
  }, [feel, feelRef]);

  const { phase, isInteractionActive, turn } = leafTurn;
  useLayoutEffect(() => {
    onLeafTurn(leaf ? { phase, isInteractionActive, turn } : null);
  }, [leaf, phase, isInteractionActive, turn, onLeafTurn]);
  useLayoutEffect(() => () => onLeafTurn(null), [onLeafTurn]);

  return (
    <>
      {showBook && (
        <BookBlock readPages={readPages} unreadPages={unreadPages} />
      )}
      {/* One canvas per kind of curl: each owns its WebGL context. */}
      <canvas
        key={kind}
        ref={canvasRef}
        data-reader-page-curl
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-[3] h-full w-full"
        style={{ visibility: "hidden" }}
      />
    </>
  );
}
