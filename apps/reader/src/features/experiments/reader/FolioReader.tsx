/**
 * Folio: a paginated spread that behaves like a printed book.
 *
 * Text is paginated with CSS columns. Each visible page is a clipped window
 * into the same column flow, so a page turn only changes transforms. The
 * turning leaf is a chain of nested 3D strips; bending the chain mid-turn
 * gives the page a curl, and per-strip shading follows each strip's angle.
 */
import {
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
  type AnimationPlaybackControls,
  type MotionValue,
} from "motion/react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { WALDEN_CHAPTER } from "../data/sample-texts";
import { StageSurface, useElementSize } from "../primitives";

const STRIP_COUNT = 6;
const COLUMN_GAP = 48;
const BEND_DEGREES = 40;
const FIRST_FOLIO = 89;
const DRAG_THRESHOLD_PX = 6;
const PEEL_ZONE_PX = 64;
const PEEL_PROGRESS = 0.045;
const FORE_EDGE_MAX_PX = 12;

interface Geometry {
  single: boolean;
  pageW: number;
  pageH: number;
  padX: number;
  padTop: number;
  textW: number;
  textH: number;
  fontSize: number;
  lineHeight: number;
}

type PageKind =
  | { kind: "front" }
  | { kind: "text"; flowIndex: number }
  | { kind: "end" }
  | { kind: "blank" };

/** A turn between resting state `from` and `from + 1`. */
interface Turn {
  from: number;
  direction: 1 | -1;
  mode: "drag" | "auto" | "peel";
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function computeGeometry(width: number, height: number): Geometry | null {
  if (width < 200 || height < 200) return null;
  const single = width < 780;
  const availableH = height - 190;
  const maxPageW = single ? width - 80 : (width - 150) / 2;
  let pageH = Math.min(availableH, 720);
  const pageW = Math.min(maxPageW, pageH * 0.68);
  pageH = Math.min(pageH, pageW / 0.6);
  const fontSize = clamp(pageW / 23.5, 14.5, 19);
  const lineHeight = Math.round(fontSize * 1.47);
  const padX = Math.round(pageW * 0.115);
  const padTop = Math.round(lineHeight * 2.6);
  const padBottom = Math.round(lineHeight * 2.4);
  const textH =
    Math.floor((pageH - padTop - padBottom) / lineHeight) * lineHeight;
  return {
    single,
    pageW: Math.round(pageW),
    pageH: Math.round(pageH),
    padX,
    padTop,
    textW: Math.round(pageW) - padX * 2,
    textH,
    fontSize,
    lineHeight,
  };
}

function buildPages(flowPageCount: number): PageKind[] {
  const pages: PageKind[] = [
    { kind: "front" },
    ...Array.from({ length: flowPageCount }, (_, flowIndex) => ({
      kind: "text" as const,
      flowIndex,
    })),
    { kind: "end" },
  ];
  if (pages.length % 2 === 1) pages.push({ kind: "blank" });
  return pages;
}

/* ---------- Leaf geometry ---------- */

function extraCurl(strip: number, progress: number, bendSign: number) {
  const t = strip / (STRIP_COUNT - 1);
  return bendSign * BEND_DEGREES * Math.sin(Math.PI * progress) * t * t;
}

function worldAngle(strip: number, progress: number, bendSign: number) {
  return -180 * progress + extraCurl(strip, progress, bendSign);
}

function relativeAngle(strip: number, progress: number, bendSign: number) {
  if (strip === 0) return worldAngle(0, progress, bendSign);
  return (
    extraCurl(strip, progress, bendSign) -
    extraCurl(strip - 1, progress, bendSign)
  );
}

function shadeAt(angle: number) {
  // Strips turned edge-on to the reader catch the least light.
  return 0.26 * Math.pow(Math.abs(Math.sin((angle * Math.PI) / 180)), 1.6);
}

/** Horizontal position of the leaf's outer edge relative to the spine. */
function edgeOffset(progress: number, bendSign: number, pageW: number) {
  const stripW = pageW / STRIP_COUNT;
  let x = 0;
  for (let strip = 0; strip < STRIP_COUNT; strip += 1) {
    x += stripW * Math.cos((worldAngle(strip, progress, bendSign) * Math.PI) / 180);
  }
  return x;
}

/* ---------- Text flow ---------- */

function ChapterFlow({ g, page }: { g: Geometry; page: number }) {
  return (
    <div
      className="xp-book-text"
      style={{
        width: g.textW,
        height: g.textH,
        columnWidth: g.textW,
        columnGap: COLUMN_GAP,
        columnFill: "auto",
        fontSize: g.fontSize,
        lineHeight: `${g.lineHeight}px`,
        transform: `translateX(${-page * (g.textW + COLUMN_GAP)}px)`,
      }}
    >
      <div
        className="text-center"
        style={{
          breakInside: "avoid",
          paddingTop: g.lineHeight * 2,
          paddingBottom: g.lineHeight * 1.5,
        }}
      >
        <p className="xp-smcp" style={{ fontSize: "0.82em", letterSpacing: "0.22em", textIndent: 0 }}>
          Chapter {WALDEN_CHAPTER.number}
        </p>
        <h4
          className="mx-auto text-balance italic"
          style={{
            fontSize: "1.72em",
            lineHeight: 1.08,
            marginTop: g.lineHeight * 0.6,
            maxWidth: "11em",
            textAlign: "center",
            letterSpacing: "-0.01em",
          }}
        >
          {WALDEN_CHAPTER.title}
        </h4>
        <div aria-hidden="true" className="mx-auto mt-[1.1em] h-px w-10 bg-foreground/35" />
      </div>
      {WALDEN_CHAPTER.paragraphs.map((paragraph, index) => (
        <p key={index} className={index === 0 ? "xp-opening" : undefined}>
          {paragraph}
        </p>
      ))}
    </div>
  );
}

function PageFace({
  page,
  g,
  side,
  ghost = false,
}: {
  page: PageKind;
  g: Geometry;
  side: "left" | "right";
  ghost?: boolean;
}) {
  const gutter =
    side === "right"
      ? "linear-gradient(to right, rgba(0,0,0,0.13), rgba(0,0,0,0.04) 3%, transparent 9%)"
      : "linear-gradient(to left, rgba(0,0,0,0.13), rgba(0,0,0,0.04) 3%, transparent 9%)";
  const folio = page.kind === "text" ? FIRST_FOLIO + page.flowIndex : null;
  const isOpener = page.kind === "text" && page.flowIndex === 0;

  return (
    <div
      className="absolute top-0 left-0 overflow-hidden bg-card text-card-foreground"
      style={{ width: g.pageW, height: g.pageH, opacity: ghost ? 0.07 : 1 }}
    >
      {page.kind === "text" && (
        <>
          {!isOpener && (
            <p
              className="absolute inset-x-0 text-center text-muted-foreground"
              style={{
                top: g.lineHeight * 1.1,
                fontSize: g.fontSize * 0.74,
                fontFamily: "var(--font-serif)",
              }}
            >
              {side === "left" ? (
                <span className="xp-smcp" style={{ letterSpacing: "0.24em" }}>
                  {WALDEN_CHAPTER.book}
                </span>
              ) : (
                <span className="italic">{WALDEN_CHAPTER.title}</span>
              )}
            </p>
          )}
          <div
            className="absolute overflow-hidden"
            style={{ left: g.padX, top: g.padTop, width: g.textW, height: g.textH }}
          >
            <ChapterFlow g={g} page={page.flowIndex} />
          </div>
          <p
            className="xp-serif xp-onum absolute text-muted-foreground"
            style={{
              bottom: g.lineHeight * 1.1,
              fontSize: g.fontSize * 0.8,
              ...(isOpener
                ? { left: 0, right: 0, textAlign: "center" }
                : side === "left"
                  ? { left: g.padX }
                  : { right: g.padX }),
            }}
          >
            {folio}
          </p>
        </>
      )}

      {page.kind === "front" && (
        <div
          className="xp-serif absolute inset-0 flex flex-col items-center justify-center text-center"
          style={{ padding: g.padX * 1.4 }}
        >
          <p className="leading-none text-muted-foreground/45" style={{ fontSize: g.pageW * 0.3 }}>
            {WALDEN_CHAPTER.number}
          </p>
          <p
            className="mt-[1.4em] text-balance italic text-foreground/80"
            style={{ fontSize: g.fontSize * 1.02, lineHeight: 1.45, maxWidth: "19em" }}
          >
            I do not propose to write an ode to dejection, but to brag as
            lustily as chanticleer in the morning, standing on his roost, if
            only to wake my neighbors up.
          </p>
          <p className="xp-smcp mt-[1.2em] text-muted-foreground" style={{ fontSize: g.fontSize * 0.74, letterSpacing: "0.2em" }}>
            {WALDEN_CHAPTER.author}
          </p>
        </div>
      )}

      {page.kind === "end" && (
        <div className="xp-serif absolute inset-0 flex flex-col items-center justify-center gap-3 text-center text-muted-foreground">
          <div aria-hidden="true" className="h-px w-10 bg-foreground/30" />
          <p className="italic" style={{ fontSize: g.fontSize * 1.05 }}>
            Here the excerpt ends.
          </p>
          <p className="xp-smcp" style={{ fontSize: g.fontSize * 0.7, letterSpacing: "0.2em" }}>
            Set in EB Garamond
          </p>
        </div>
      )}

      <div aria-hidden="true" className="pointer-events-none absolute inset-0" style={{ background: gutter }} />
    </div>
  );
}

/* ---------- Turning leaf ---------- */

function LeafStrip({
  strip,
  g,
  progress,
  bendSign,
  front,
  back,
}: {
  strip: number;
  g: Geometry;
  progress: MotionValue<number>;
  bendSign: number;
  front: ReactNode;
  back: ReactNode;
}) {
  const stripW = g.pageW / STRIP_COUNT;
  const rotateY = useTransform(progress, (p) => relativeAngle(strip, p, bendSign));
  const frontShade = useTransform(progress, (p) => {
    const a = shadeAt(worldAngle(strip, p, bendSign));
    const b = shadeAt(worldAngle(Math.min(strip + 1, STRIP_COUNT - 1), p, bendSign));
    return `linear-gradient(to right, rgba(0,0,0,${a}), rgba(0,0,0,${b}))`;
  });
  const backShade = useTransform(progress, (p) => {
    const a = shadeAt(worldAngle(strip, p, bendSign));
    const b = shadeAt(worldAngle(Math.min(strip + 1, STRIP_COUNT - 1), p, bendSign));
    return `linear-gradient(to right, rgba(0,0,0,${b * 0.8}), rgba(0,0,0,${a * 0.8}))`;
  });

  return (
    <motion.div
      className="absolute top-0"
      style={{
        left: strip === 0 ? 0 : stripW,
        // A sub-pixel overlap hides seams between strips.
        width: stripW + 0.75,
        height: g.pageH,
        transformStyle: "preserve-3d",
        transformOrigin: "0% 50%",
        rotateY,
      }}
    >
      <div className="absolute inset-0 overflow-hidden" style={{ backfaceVisibility: "hidden" }}>
        <div className="absolute top-0" style={{ left: -strip * stripW }}>
          {front}
        </div>
        <motion.div className="absolute inset-0" style={{ background: frontShade }} />
      </div>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)" }}
      >
        <div className="absolute top-0" style={{ left: -(g.pageW - (strip + 1) * stripW) }}>
          {back}
        </div>
        <motion.div className="absolute inset-0" style={{ background: backShade }} />
      </div>
      {strip < STRIP_COUNT - 1 && (
        <LeafStrip
          strip={strip + 1}
          g={g}
          progress={progress}
          bendSign={bendSign}
          front={front}
          back={back}
        />
      )}
    </motion.div>
  );
}

function CastShadows({
  g,
  progress,
  bendSign,
  active,
}: {
  g: Geometry;
  progress: MotionValue<number>;
  bendSign: number;
  active: boolean;
}) {
  const edge = useTransform(progress, (p) => edgeOffset(p, bendSign, g.pageW));
  const strength = useTransform(progress, (p) => Math.min(1, Math.sin(Math.PI * p) * 1.6));
  const rightOpacity = useTransform([edge, strength], ([x, s]) =>
    active && (x as number) > 0 ? (s as number) : 0,
  );
  const leftOpacity = useTransform([edge, strength], ([x, s]) =>
    active && (x as number) < 0 && !g.single ? (s as number) : 0,
  );
  const leftEdge = useTransform(edge, (x) => g.pageW + x - 90);

  return (
    <>
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 h-full w-[90px]"
        style={{
          left: g.single ? 0 : g.pageW,
          x: edge,
          opacity: rightOpacity,
          background: "linear-gradient(to right, rgba(0,0,0,0.22), transparent)",
        }}
      />
      <motion.div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-0 h-full w-[90px]"
        style={{
          x: leftEdge,
          opacity: leftOpacity,
          background: "linear-gradient(to left, rgba(0,0,0,0.22), transparent)",
        }}
      />
    </>
  );
}

/* ---------- Reader ---------- */

export function FolioReader() {
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const g = computeGeometry(stage.width, stage.height);

  return (
    <StageSurface tone="paper" className="relative size-full select-none">
      <div ref={stageRef} className="xp-desk absolute inset-0">
        {g && <FolioBook g={g} />}
      </div>
    </StageSurface>
  );
}

function FolioBook({ g }: { g: Geometry }) {
  const reducedMotion = useReducedMotion() ?? false;
  const measureRef = useRef<HTMLDivElement>(null);
  const [flowPageCount, setFlowPageCount] = useState(0);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled) setFontsReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useLayoutEffect(() => {
    const flow = measureRef.current?.firstElementChild as HTMLElement | null;
    if (!flow) return;
    const stride = g.textW + COLUMN_GAP;
    setFlowPageCount(Math.max(1, Math.round((flow.scrollWidth + COLUMN_GAP) / stride)));
  }, [g, fontsReady]);

  const pages = buildPages(flowPageCount);
  const unit = g.single ? 1 : 2;
  const restCount = g.single ? pages.length : pages.length / 2;
  const [rest, setRestState] = useState(0);
  const [turn, setTurnState] = useState<Turn | null>(null);
  const progress = useMotionValue(0);
  const animationRef = useRef<AnimationPlaybackControls | null>(null);
  const queueRef = useRef<Array<1 | -1>>([]);
  // Event handlers read the latest state synchronously through these refs.
  const restRef = useRef(0);
  const turnRef = useRef<Turn | null>(null);
  const restCountRef = useRef(restCount);
  const dragRef = useRef<{
    startX: number;
    lastX: number;
    lastT: number;
    velocity: number;
    side: 1 | -1;
    dragging: boolean;
    pointerId: number;
  } | null>(null);

  useLayoutEffect(() => {
    restCountRef.current = restCount;
  }, [restCount]);

  useEffect(() => () => animationRef.current?.stop(), []);

  const setTurn = (next: Turn | null) => {
    turnRef.current = next;
    setTurnState(next);
  };
  const setRest = (next: number) => {
    restRef.current = next;
    setRestState(next);
  };

  const safeRest = clamp(rest, 0, Math.max(0, restCount - 1));
  const pageAt = (index: number): PageKind => pages[index] ?? { kind: "blank" };

  // Resting state, or the two resting states a turn moves between.
  const turnFrom = turn?.from ?? safeRest;
  const baseLeft = g.single ? null : pageAt(turnFrom * unit);
  const baseRight = g.single
    ? pageAt(turn ? turnFrom + 1 : safeRest)
    : pageAt(turn ? turnFrom * unit + 3 : safeRest * unit + 1);
  const leafFront = g.single ? pageAt(turnFrom) : pageAt(turnFrom * unit + 1);
  const leafBack = g.single ? pageAt(turnFrom) : pageAt(turnFrom * unit + 2);
  const bendSign = turn?.direction === -1 ? 1 : -1;

  const readFraction = restCount <= 1 ? 0 : safeRest / (restCount - 1);
  const leftEdge = useSpring(2 + FORE_EDGE_MAX_PX * readFraction, { stiffness: 180, damping: 26 });
  const rightEdge = useSpring(2 + FORE_EDGE_MAX_PX * (1 - readFraction), { stiffness: 180, damping: 26 });
  useEffect(() => {
    leftEdge.set(2 + FORE_EDGE_MAX_PX * readFraction);
    rightEdge.set(2 + FORE_EDGE_MAX_PX * (1 - readFraction));
  }, [leftEdge, readFraction, rightEdge]);

  /** Animates a turn to completion (or back) and settles the resting state. */
  function runTurn(
    from: number,
    direction: 1 | -1,
    options: { duration?: number; startAt?: number; complete?: boolean } = {},
  ) {
    const complete = options.complete ?? true;
    const startP = options.startAt ?? (direction === 1 ? 0 : 1);
    const forwardEnd = complete ? 1 : 0;
    const endP = direction === 1 ? forwardEnd : 1 - forwardEnd;
    const restAfter = endP === 1 ? from + 1 : from;

    animationRef.current?.stop();
    setTurn({ from, direction, mode: "auto" });
    progress.set(startP);

    const settle = () => {
      setTurn(null);
      setRest(restAfter);
      progress.set(0);
      const next = queueRef.current.shift();
      if (next === 1) turnForward(true);
      else if (next === -1) turnBackward(true);
    };

    if (reducedMotion) {
      settle();
      return;
    }

    const duration = options.duration ?? 0.8;
    animationRef.current = animate(progress, endP, {
      duration: duration * Math.max(0.4, Math.abs(endP - startP)),
      ease: options.startAt === undefined ? [0.45, 0.05, 0.3, 1] : [0.2, 0.7, 0.3, 1],
      onComplete: settle,
    });
  }

  function turnForward(quick = false) {
    const current = restRef.current;
    if (turnRef.current && turnRef.current.mode !== "peel") {
      if (!quick) queueRef.current.push(1);
      return;
    }
    if (current >= restCountRef.current - 1) return;
    runTurn(current, 1, quick ? { duration: 0.36 } : {});
  }

  function turnBackward(quick = false) {
    const current = restRef.current;
    if (turnRef.current && turnRef.current.mode !== "peel") {
      if (!quick) queueRef.current.push(-1);
      return;
    }
    if (current <= 0) return;
    runTurn(current - 1, -1, quick ? { duration: 0.36 } : {});
  }

  /** Jumps several spreads by riffling through each leaf quickly. */
  function riffleTo(target: number) {
    const current = restRef.current;
    if (target === current || (turnRef.current && turnRef.current.mode !== "peel")) return;
    const direction: 1 | -1 = target > current ? 1 : -1;
    queueRef.current = Array.from({ length: Math.abs(target - current) - 1 }, () => direction);
    if (direction === 1) runTurn(current, 1, { duration: 0.36 });
    else runTurn(current - 1, -1, { duration: 0.36 });
  }

  // Map a pointer x on the spread to a turning side.
  function sideForPointer(clientX: number, rect: DOMRect): 1 | -1 {
    const x = clientX - rect.left;
    if (g.single) return x > rect.width * 0.4 ? 1 : -1;
    return x > rect.width / 2 ? 1 : -1;
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      startX: event.clientX,
      lastX: event.clientX,
      lastT: performance.now(),
      velocity: 0,
      side: sideForPointer(event.clientX, rect),
      dragging: false,
      pointerId: event.pointerId,
    };
  }

  function updatePeel(event: PointerEvent<HTMLDivElement>) {
    if (reducedMotion || dragRef.current) return;
    const current = turnRef.current;
    if (current && current.mode !== "peel") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const nearEdge = rect.right - event.clientX < PEEL_ZONE_PX && restRef.current < restCount - 1;
    if (nearEdge && !current) {
      setTurn({ from: restRef.current, direction: 1, mode: "peel" });
      animationRef.current?.stop();
      animationRef.current = animate(progress, PEEL_PROGRESS, { type: "spring", stiffness: 300, damping: 22 });
    } else if (!nearEdge && current?.mode === "peel") {
      releasePeel();
    }
  }

  function releasePeel() {
    if (turnRef.current?.mode !== "peel") return;
    animationRef.current?.stop();
    animationRef.current = animate(progress, 0, {
      type: "spring",
      stiffness: 320,
      damping: 28,
      onComplete: () => {
        if (turnRef.current?.mode === "peel") setTurn(null);
      },
    });
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) {
      updatePeel(event);
      return;
    }
    const dx = event.clientX - drag.startX;
    const now = performance.now();
    const dt = Math.max(1, now - drag.lastT);
    drag.velocity = drag.velocity * 0.6 + ((event.clientX - drag.lastX) / dt) * 0.4;
    drag.lastX = event.clientX;
    drag.lastT = now;

    if (!drag.dragging) {
      if (Math.abs(dx) < DRAG_THRESHOLD_PX) return;
      const current = restRef.current;
      if (drag.side === 1 && current >= restCount - 1) return;
      if (drag.side === -1 && current <= 0) return;
      drag.dragging = true;
      try {
        event.currentTarget.setPointerCapture(drag.pointerId);
      } catch {
        // Synthetic or already released pointers cannot be captured.
      }
      animationRef.current?.stop();
      queueRef.current = [];
      setTurn({ from: drag.side === 1 ? current : current - 1, direction: drag.side, mode: "drag" });
    }

    // The outer edge follows the pointer: x = pageW * cos(PI * p).
    const startEdge = drag.side === 1 ? g.pageW : -g.pageW;
    const edgeX = clamp((startEdge + dx * 1.1) / g.pageW, -1, 1);
    progress.set(Math.acos(edgeX) / Math.PI);
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;

    if (!drag.dragging) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (sideForPointer(event.clientX, rect) === 1) turnForward();
      else turnBackward();
      return;
    }

    const current = turnRef.current;
    if (!current) return;
    const p = progress.get();
    const flick = Math.abs(drag.velocity) > 0.35;
    const complete =
      drag.side === 1
        ? flick ? drag.velocity < 0 : p > 0.42
        : flick ? drag.velocity > 0 : p < 0.58;
    runTurn(current.from, drag.side, { startAt: p, complete, duration: 0.62 });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      turnForward();
    } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      turnBackward();
    }
  }

  const bookW = g.single ? g.pageW : g.pageW * 2;
  const visibleFolios = (g.single ? [pageAt(safeRest)] : [pageAt(safeRest * 2), pageAt(safeRest * 2 + 1)])
    .flatMap((page) => (page.kind === "text" ? [FIRST_FOLIO + page.flowIndex] : []));
  const textPagesLeft = Math.max(
    0,
    flowPageCount - (visibleFolios.length ? visibleFolios[visibleFolios.length - 1] - FIRST_FOLIO + 1 : 0),
  );

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-7 pb-2">
      <div
        aria-hidden="true"
        className="invisible absolute top-0 left-0 overflow-hidden"
        ref={measureRef}
        style={{ width: g.textW, height: g.textH }}
      >
        <ChapterFlow g={g} page={0} />
      </div>

      <div
        role="region"
        aria-roledescription="book"
        aria-label={`${WALDEN_CHAPTER.book}, ${WALDEN_CHAPTER.title}`}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className="relative rounded-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-8 focus-visible:ring-offset-muted"
        style={{ width: bookW, height: g.pageH }}
      >
        {/* Shadow under the book block */}
        <div
          aria-hidden="true"
          className="absolute -inset-x-6 -bottom-6 h-10 rounded-[50%] bg-black/25 blur-2xl"
        />
        {/* Fore-edges: the stack of pages read and still to read */}
        {!g.single && (
          <motion.div
            aria-hidden="true"
            className="xp-fore-edge absolute top-[3px] bottom-[3px] rounded-l-[3px] shadow-sm"
            style={{ width: leftEdge, x: "-100%", left: 0 }}
          />
        )}
        <motion.div
          aria-hidden="true"
          className="xp-fore-edge absolute top-[3px] bottom-[3px] rounded-r-[3px] shadow-sm"
          style={{ width: rightEdge, left: bookW }}
        />

        <div
          className="absolute inset-0 cursor-grab touch-pan-y overflow-visible active:cursor-grabbing"
          style={{ perspective: 2600, perspectiveOrigin: "50% 40%" }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            const current = turnRef.current;
            if (current?.mode === "drag") runTurn(current.from, current.direction, { startAt: progress.get(), complete: false });
          }}
          onPointerLeave={releasePeel}
        >
          {baseLeft && (
            <div className="absolute top-0 left-0" style={{ width: g.pageW, height: g.pageH }}>
              <PageFace page={baseLeft} g={g} side="left" />
            </div>
          )}
          <div
            className="absolute top-0"
            style={{ left: g.single ? 0 : g.pageW, width: g.pageW, height: g.pageH }}
          >
            <PageFace page={baseRight} g={g} side="right" />
          </div>
          {/* Spine crease */}
          {!g.single && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-black/15"
              style={{ left: g.pageW }}
            />
          )}

          <CastShadows g={g} progress={progress} bendSign={bendSign} active={turn !== null} />

          <div
            className="absolute top-0"
            style={{
              left: g.single ? 0 : g.pageW,
              width: g.pageW,
              height: g.pageH,
              transformStyle: "preserve-3d",
              visibility: turn ? "visible" : "hidden",
            }}
          >
            <LeafStrip
              strip={0}
              g={g}
              progress={progress}
              bendSign={bendSign}
              front={<PageFace page={leafFront} g={g} side="right" />}
              back={
                g.single ? (
                  <div className="relative bg-card" style={{ width: g.pageW, height: g.pageH }}>
                    <PageFace page={leafBack} g={g} side="right" ghost />
                  </div>
                ) : (
                  <PageFace page={leafBack} g={g} side="left" />
                )
              }
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2.5">
        <div className="flex items-center gap-1.5" role="group" aria-label="Go to spread">
          {Array.from({ length: restCount }, (_, index) => {
            const active = index === safeRest;
            return (
              <button
                key={index}
                type="button"
                aria-label={`Go to ${g.single ? "page" : "spread"} ${index + 1}`}
                aria-current={active ? "page" : undefined}
                onClick={() => riffleTo(index)}
                className="group grid size-5 cursor-pointer place-items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <motion.span
                  className="block h-1.5 rounded-full bg-foreground"
                  animate={{ width: active ? 18 : 6, opacity: active ? 0.85 : 0.22 }}
                  transition={{ type: "spring", stiffness: 420, damping: 32 }}
                />
              </button>
            );
          })}
        </div>
        <p className="xp-serif xp-onum text-sm text-muted-foreground italic">
          {visibleFolios.length > 0 ? `p. ${visibleFolios.join("–")}` : "Frontispiece"}
          <span className="mx-2 not-italic opacity-40">·</span>
          {textPagesLeft === 0
            ? "end of chapter"
            : `${textPagesLeft} ${textPagesLeft === 1 ? "page" : "pages"} left in chapter`}
        </p>
      </div>
    </div>
  );
}
