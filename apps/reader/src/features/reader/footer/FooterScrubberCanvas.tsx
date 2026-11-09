import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

interface FooterScrubberCanvasProps {
  currentPage: number;
  totalPages: number;
  chapterStartPages: (number | null)[];
  onScrubCommit: (page: number) => void;
  onScrubPreview?: (page: number) => void;
  cancelMomentumSignal?: number;
  readOnly?: boolean;
  pageStep?: number;
}

const TICK_SPACING = 6; // Pixels between page ticks; lower = denser ticks and faster scrub for same drag distance.
const PLAYHEAD_H = 6; // Playhead nub height in pixels.
const TOP_PAD = 4; // Baseline top inset where normal ticks begin.
const PLAYHEAD_RISE = 3; // How far the playhead rises above TOP_PAD.
const PLAYHEAD_TICK_GAP = 4; // Required center gap (px) between playhead bottom and the centered tick.
const PLAYHEAD_TOP = TOP_PAD - PLAYHEAD_RISE;
const PLAYHEAD_BOTTOM = PLAYHEAD_TOP + PLAYHEAD_H;
const MAX_CENTER_DIP_OFFSET = PLAYHEAD_BOTTOM - TOP_PAD + PLAYHEAD_TICK_GAP; // Full dip at exact center.
const DIP_RADIUS_PAGES = 3.6; // Width of the single raised-cosine lobe in pages.
const DIP_FALLOFF_POWER = 1; // 1 = pure raised cosine, higher = tighter center.
const BOTTOM_DIP_FRACTION = 0.35; // How much of dip applies to tick bottoms (0=anchor bottoms, 1=no shortening).
const CHAPTER_MARKER_H = 8; // Chapter marker height in pixels (playhead-like, but longer).
const CHAPTER_MARKER_W = 2; // Chapter marker width in pixels.
const CHAPTER_MARKER_ALPHA = 0.9;
// --- Momentum deceleration ---
//
// We model deceleration as exponential decay:  vel *= exp(-k * dt)
//
// Apple documents two UIScrollView.DecelerationRate presets:
//   .normal = 0.998
//   .fast   = 0.99
// These are per-frame multiplicative factors, but Apple does not publicly
// document the exact time unit (per ms? per 1/60s?). Best available
// interpretation treats them as per-millisecond, which maps to this formula via:
//   k = -ln(rate) * 1000
//   normal → k ≈ 2.0
//   fast   → k ≈ 10.0
//
// For a scrubber the user navigates to a target position — coasting past it
// feels wrong — so we lean toward the "fast" end. k=8 is a best-effort
// approximation; tune upward (toward 10) if it feels too slidey, or down
// (toward 5) if it feels too abrupt.
const MOMENTUM_FRICTION = 6;
// Minimum fling velocity (pages/sec) required to trigger momentum on release.
// Below this the release is treated as a deliberate stop.
const MOMENTUM_THRESHOLD = 3;
// Cap on initial momentum velocity (pages/sec). At TICK_SPACING=10, this is
// equivalent to a pixel velocity cap of MAX_VELOCITY * 10. A typical fast
// finger swipe is ~1500–3000 px/sec (150–300 pages/sec), so 60 was far too
// low — it capped nearly every real fling, making k=8 produce only ~7 pages
// of travel total. 400 lets fast flings reach ~50 pages of travel at k=8.
const MOMENTUM_MAX_VELOCITY = 400;

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

function getDipFactor(signedDistanceInPages: number): number {
  const normalizedDistance = Math.abs(signedDistanceInPages) / DIP_RADIUS_PAGES;
  if (normalizedDistance >= 1) return 0;

  // One raised-cosine lobe keeps a wave-like profile without introducing
  // multiple crests inside the active scrub region.
  const raisedCosine = 0.5 + 0.5 * Math.cos(normalizedDistance * Math.PI);
  return raisedCosine ** DIP_FALLOFF_POWER;
}

interface CanvasColors {
  fg: string;
  mutedFg: string;
  uiFont: string;
}

function toCanvasColor(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  if (
    /^(#|rgb\(|rgba\(|hsl\(|hsla\(|oklch\(|oklab\(|lch\(|lab\(|color\()/i.test(
      trimmed,
    )
  ) {
    return trimmed;
  }
  // Support raw HSL channel tokens like "0 0% 5%".
  return `hsl(${trimmed})`;
}

function resolveColors(el: HTMLElement): CanvasColors {
  const style = getComputedStyle(el);
  return {
    fg: toCanvasColor(
      style.getPropertyValue("--foreground"),
      "oklch(0.145 0 0)",
    ),
    mutedFg: toCanvasColor(
      style.getPropertyValue("--muted-foreground"),
      "oklch(0.556 0 0)",
    ),
    uiFont:
      style.getPropertyValue("--font-sans").trim() ||
      '"DM Sans", "Inter", system-ui, sans-serif',
  };
}

function drawCanvas(
  canvas: HTMLCanvasElement,
  displayPage: number,
  totalPages: number,
  chapterStartSet: Set<number>,
  colors: CanvasColors,
) {
  if (totalPages <= 0) return;

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (W === 0 || H === 0) return;

  if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
    // Keep layout sizing in CSS so responsive width changes can recenter the playhead.
    canvas.width = W * dpr;
    canvas.height = H * dpr;
  }

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(dpr, dpr);

  const cx = W / 2;
  const FADE_ZONE = 64;

  const halfVisible = Math.ceil(cx / TICK_SPACING) + 2;
  const startPg = Math.max(1, Math.floor(displayPage - halfVisible));
  const endPg = Math.min(totalPages, Math.ceil(displayPage + halfVisible));
  ctx.lineCap = "round";

  for (let p = startPg; p <= endPg; p++) {
    const x = cx + (p - displayPage) * TICK_SPACING;
    if (x < -TICK_SPACING || x > W + TICK_SPACING) continue;

    // Edge fade
    const distFromEdge = Math.min(x, W - x);
    const edgeAlpha = smoothstep(0, FADE_ZONE, distFromEdge);
    if (edgeAlpha <= 0) continue;

    // Tick type
    const isChapter = chapterStartSet.has(p);
    const isMod20 = p % 20 === 0;
    const isMod10 = p % 10 === 0;

    let tickH: number;
    let tickTopOffset: number; // extra top offset so chapter ticks cover "middle" of range
    let lineWidth: number;
    let color: string;
    let baseAlpha: number;

    if (isMod20) {
      tickH = 34;
      tickTopOffset = 0;
      lineWidth = 0.9;
      color = colors.mutedFg;
      baseAlpha = 0.7;
    } else if (isMod10) {
      tickH = 31;
      tickTopOffset = 0;
      lineWidth = 0.9;
      color = colors.mutedFg;
      baseAlpha = 0.5;
    } else {
      tickH = 28;
      tickTopOffset = 0;
      lineWidth = 0.75;
      color = colors.mutedFg;
      baseAlpha = 0.3;
    }

    // Dip: top keeps full playhead gap; bottom can dip less to keep the bump shallower.
    const dist = p - displayPage;
    const dipOffset = MAX_CENTER_DIP_OFFSET * getDipFactor(dist);
    const bottomDipOffset = dipOffset * BOTTOM_DIP_FRACTION;
    const tickTop = TOP_PAD + tickTopOffset + dipOffset;
    const tickBottom = TOP_PAD + tickTopOffset + tickH + bottomDipOffset;

    ctx.globalAlpha = edgeAlpha * baseAlpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, tickTop);
    ctx.lineTo(x, tickBottom);
    ctx.stroke();

    if (isChapter) {
      const markerCenterY = (tickTop + tickBottom) / 2;
      const markerTop = markerCenterY - CHAPTER_MARKER_H / 2;
      const markerBottom = markerCenterY + CHAPTER_MARKER_H / 2;

      ctx.globalAlpha = edgeAlpha * CHAPTER_MARKER_ALPHA;
      ctx.strokeStyle = colors.fg;
      ctx.lineWidth = CHAPTER_MARKER_W;
      ctx.beginPath();
      ctx.moveTo(x, markerTop);
      ctx.lineTo(x, markerBottom);
      ctx.stroke();
    }

    // Number label every 20 pages
    if (isMod20 && distFromEdge > FADE_ZONE * 0.35) {
      ctx.globalAlpha = edgeAlpha * 0.55;
      ctx.fillStyle = colors.mutedFg;
      ctx.font = `500 9px ${colors.uiFont}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(String(p), x, TOP_PAD + 34 + 5);
    }
  }

  // Playhead nub — very short, anchored to top, drawn last (on top)
  ctx.globalAlpha = 1;
  ctx.strokeStyle = colors.fg;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, PLAYHEAD_TOP);
  ctx.lineTo(cx, PLAYHEAD_BOTTOM);
  ctx.stroke();

  ctx.restore();
}

export function FooterScrubberCanvas({
  currentPage,
  totalPages,
  chapterStartPages,
  onScrubCommit,
  onScrubPreview,
  cancelMomentumSignal,
  readOnly = false,
  pageStep = 1,
}: FooterScrubberCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const displayPageRef = useRef<number>(currentPage);
  // Two separate RAF handles: spring owns rafRef, momentum owns momentumRafRef.
  // This prevents the spring useEffect cleanup (which fires on every currentPage
  // change) from cancelling a live momentum animation — critical because
  // onScrubPreview is often wired to the same setter as onScrubCommit, meaning
  // currentPage can change on every momentum frame.
  const rafRef = useRef<number>(0);
  const momentumRafRef = useRef<number>(0);
  const isMomentumRef = useRef(false);
  const colorsRef = useRef<CanvasColors | null>(null);
  const chapterStartSet = useMemo(
    () => new Set(chapterStartPages.filter((p): p is number => p !== null)),
    [chapterStartPages],
  );

  // Drag state
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartPageRef = useRef<number>(currentPage);
  const lastPreviewPageRef = useRef<number>(currentPage);
  // Velocity tracking: recent pointer positions for momentum computation
  const dragHistoryRef = useRef<{ x: number; t: number }[]>([]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (!colorsRef.current) colorsRef.current = resolveColors(canvas);
    drawCanvas(
      canvas,
      displayPageRef.current,
      totalPages,
      chapterStartSet,
      colorsRef.current,
    );
  }, [chapterStartSet, totalPages]);

  const emitPreviewIfChanged = useCallback(
    (page: number) => {
      const intPage = Math.round(page);
      if (intPage !== lastPreviewPageRef.current) {
        lastPreviewPageRef.current = intPage;
        onScrubPreview?.(intPage);
      }
    },
    [onScrubPreview],
  );

  // Spring animation toward currentPage (idle / post-commit state)
  useEffect(() => {
    if (isDraggingRef.current || isMomentumRef.current) return;
    const target = currentPage;
    let velocity = 0;
    let lastTime: number | null = null;

    cancelAnimationFrame(rafRef.current);

    const tick = (now: number) => {
      const dt = Math.min((now - (lastTime ?? now)) / 1000, 0.05);
      lastTime = now;
      const force = 280 * (target - displayPageRef.current);
      velocity = (velocity + force * dt) * (1 - 32 * dt);
      displayPageRef.current = Math.max(
        1,
        Math.min(totalPages, displayPageRef.current + velocity * dt),
      );
      redraw();
      if (
        Math.abs(target - displayPageRef.current) > 0.005 ||
        Math.abs(velocity) > 0.05
      ) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        displayPageRef.current = target;
        redraw();
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [currentPage, redraw, totalPages]);

  // Observers keep their lifetime while drawing the latest committed data.
  const redrawObservedCanvas = useEffectEvent(() => {
    colorsRef.current = null;
    redraw();
  });

  // Resize observer
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(redrawObservedCanvas);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Theme observer
  useEffect(() => {
    const mo = new MutationObserver(redrawObservedCanvas);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    return () => mo.disconnect();
  }, []);

  useLayoutEffect(() => {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(momentumRafRef.current);
    isMomentumRef.current = false;
    isDraggingRef.current = false;
    dragHistoryRef.current = [];
  }, [cancelMomentumSignal]);

  useEffect(() => {
    return () => {
      cancelAnimationFrame(rafRef.current);
      cancelAnimationFrame(momentumRafRef.current);
      isMomentumRef.current = false;
      isDraggingRef.current = false;
      dragHistoryRef.current = [];
    };
  }, []);

  function startMomentum(initialVelocity: number) {
    let vel =
      Math.sign(initialVelocity) *
      Math.min(Math.abs(initialVelocity), MOMENTUM_MAX_VELOCITY);
    let lastTime: number | null = null;

    isMomentumRef.current = true;
    cancelAnimationFrame(momentumRafRef.current);

    function commit(page: number) {
      isMomentumRef.current = false;
      displayPageRef.current = page;
      redraw();
      onScrubCommit(page);
    }

    const tick = (now: number) => {
      const dt = Math.min((now - (lastTime ?? now)) / 1000, 0.05);
      lastTime = now;

      // Exponential decay: vel *= e^(-k*dt)
      vel *= Math.exp(-MOMENTUM_FRICTION * dt);
      const prevPage = displayPageRef.current;
      const rawNext = Math.max(1, Math.min(totalPages, prevPage + vel * dt));

      // Hard boundary — already an integer, stop cleanly.
      if (rawNext === 1 || rawNext === totalPages) {
        commit(rawNext);
        return;
      }

      // Per-tick stopping rule:
      // At each integer tick crossed, check whether the remaining momentum
      // (|vel| / k = total area left under the decay curve = total distance left)
      // is enough to reach the *next* tick (1 page away). If not, stop here.
      //
      // Because we stop exactly at the integer we just crossed, no snap is needed —
      // the playhead is already on a tick. This is the user's natural deceleration
      // rather than a pre-computed target with an adjusted velocity.
      const firstTickAhead =
        vel > 0 ? Math.floor(prevPage) + 1 : Math.ceil(prevPage) - 1;
      const crossedTick = (
        vel > 0 ? rawNext >= firstTickAhead : rawNext <= firstTickAhead
      )
        ? firstTickAhead
        : null;

      if (crossedTick !== null && Math.abs(vel) / MOMENTUM_FRICTION < 1) {
        commit(Math.max(1, Math.min(totalPages, crossedTick)));
        return;
      }

      displayPageRef.current = rawNext;
      redraw();
      emitPreviewIfChanged(rawNext);

      if (Math.abs(vel) > 0.4) {
        momentumRafRef.current = requestAnimationFrame(tick);
      } else {
        // Fallback: velocity decayed to near-zero without crossing a tick boundary.
        // Only happens when starting between ticks with low velocity that can't
        // reach the next tick. Snap to nearest integer; jump is at most half a tick.
        commit(Math.round(rawNext));
      }
    };

    momentumRafRef.current = requestAnimationFrame(tick);
  }

  function handlePointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    cancelAnimationFrame(rafRef.current);
    cancelAnimationFrame(momentumRafRef.current);
    isMomentumRef.current = false;
    isDraggingRef.current = true;
    dragStartXRef.current = e.clientX;
    dragStartPageRef.current = displayPageRef.current;
    lastPreviewPageRef.current = Math.round(displayPageRef.current);
    dragHistoryRef.current = [{ x: e.clientX, t: performance.now() }];
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (!isDraggingRef.current) return;
    const now = performance.now();

    // Track history for velocity; keep only the last 80ms
    dragHistoryRef.current.push({ x: e.clientX, t: now });
    const cutoff = now - 80;
    dragHistoryRef.current = dragHistoryRef.current.filter(
      (h) => h.t >= cutoff,
    );

    const dx = e.clientX - dragStartXRef.current;
    const page = Math.max(
      1,
      Math.min(totalPages, dragStartPageRef.current - dx / TICK_SPACING),
    );
    displayPageRef.current = page;
    redraw();
    emitPreviewIfChanged(page);
  }

  // A cancelled touch (the system took the gesture) chooses nothing: the
  // reader goes back to the page the drag started from.
  function handlePointerCancel() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;
    dragHistoryRef.current = [];
    const start = Math.round(dragStartPageRef.current);
    if (lastPreviewPageRef.current !== start) {
      // Previews moved the reader; the spring follows it back.
      onScrubCommit(start);
      return;
    }
    displayPageRef.current = start;
    redraw();
  }

  function handlePointerUp() {
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    // Compute fling velocity from recent history
    const history = dragHistoryRef.current;
    let velocityPagesPerSec = 0;
    if (history.length >= 2) {
      const oldest = history[0]!;
      const newest = history[history.length - 1]!;
      const dtSec = (newest.t - oldest.t) / 1000;
      if (dtSec > 0.001) {
        const dxPx = newest.x - oldest.x;
        velocityPagesPerSec = -(dxPx / dtSec) / TICK_SPACING;
      }
    }

    if (Math.abs(velocityPagesPerSec) > MOMENTUM_THRESHOLD) {
      startMomentum(velocityPagesPerSec);
    } else {
      // Same snap-before-commit pattern as momentum settle: if preview already
      // updated currentPage to this value, the spring won't re-fire.
      displayPageRef.current = Math.round(displayPageRef.current);
      redraw();
      onScrubCommit(displayPageRef.current);
    }
  }

  return (
    <div className="relative rounded-lg focus-within:outline-2 focus-within:outline-ring">
    <canvas
      aria-hidden="true"
      ref={canvasRef}
      className={
        readOnly ? "block w-full" : "block w-full cursor-ew-resize touch-none"
      }
      style={{ height: 56 }}
      onPointerDown={readOnly ? undefined : handlePointerDown}
      onPointerMove={readOnly ? undefined : handlePointerMove}
      onPointerUp={readOnly ? undefined : handlePointerUp}
      onPointerCancel={readOnly ? undefined : handlePointerCancel}
    />
    {!readOnly && (
      <input
        type="range"
        className="sr-only"
        aria-label="Reading page"
        aria-valuetext={`Page ${currentPage} of ${totalPages}`}
        step={pageStep}
        min={1}
        max={Math.max(1, totalPages)}
        value={currentPage}
        onKeyDown={(event) => event.stopPropagation()}
        onChange={(event) => {
          // Keyboard and assistive input interrupt any pointer momentum.
          cancelAnimationFrame(rafRef.current);
          cancelAnimationFrame(momentumRafRef.current);
          isMomentumRef.current = false;
          isDraggingRef.current = false;
          const page = Number(event.target.value);
          displayPageRef.current = page;
          redraw();
          onScrubCommit(page);
        }}
      />
    )}
    </div>
  );
}
