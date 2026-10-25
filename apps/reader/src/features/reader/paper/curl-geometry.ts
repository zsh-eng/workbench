/**
 * The shape of a page as it curls, in the stage's CSS pixels (y down).
 *
 * The turning page bends around a cylinder that lies on the page, as in
 * Hong et al., "Turning pages of 3D electronic books" (2006), but with the
 * cylinder's axis free to tilt rather than a cone, so the shape can follow a
 * finger exactly. Points before the crease stay flat; points past it wrap
 * half way round the cylinder and then lie flipped over, face down, on top.
 *
 * The fold is solved from where the page is held: a grab point on the free
 * edge. Paper is inextensible, so once the grab point has gone round the
 * curl it lies exactly where it was carried to. Early in a turn it is
 * carried by the finger, so the lifted edge stays under it; from there the
 * page takes over and gathers speed, as a sheet does once it is past
 * upright, until it has travelled the two widths that lay it over the spine.
 */

export interface CurlShape {
  /** Curl radius as the page first lifts, as a fraction of the page width. */
  radiusStart: number;
  /** Curl radius from mid-turn on. */
  radiusFull: number;
  /**
   * How far the held corner leads the rest of the edge, as a fraction of
   * the page width: a grab low on the page lifts the bottom corner first.
   */
  lead: number;
  /** The steepest the fold may tilt, in radians. */
  maxTilt: number;
}

/** A soft curl, like a sheet of book paper held by its corner. */
export const SOFT_CURL: CurlShape = {
  radiusStart: 0.075,
  radiusFull: 0.15,
  lead: 0.26,
  maxTilt: 0.62,
};

export interface CurlFold {
  /** A point on the crease, where the page leaves the plane. */
  originX: number;
  originY: number;
  /** Unit normal of the crease, pointing towards the page's free edge. */
  normalX: number;
  normalY: number;
  radius: number;
}

export type TurnSide = "next" | "previous";

/**
 * Turn progress from the swipe offset. A forward turn curls the current
 * page away (0 at rest, 1 gone); a backward turn lays the previous page
 * back down, so it starts fully turned. Both directions share one progress,
 * so promoting a page mid-turn keeps the same shape on screen.
 */
export function turnProgress(
  offset: number,
  width: number,
): { side: TurnSide; progress: number } | null {
  if (width <= 0 || offset === 0) return null;
  if (offset < 0) {
    return { side: "next", progress: Math.min(1, -offset / width) };
  }
  return { side: "previous", progress: Math.max(0, 1 - offset / width) };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Distance from the crease to the grab point, along the normal, for a grab
 * point that has travelled `travel` pixels in the plane. On the cylinder the
 * relation is `travel = d - R sin(d / R)`; past it, the page lies flat.
 */
function grabDepth(travel: number, radius: number): number {
  const halfTurn = Math.PI * radius;
  if (travel >= halfTurn) return (travel + halfTurn) / 2;
  let low = 0;
  let high = halfTurn;
  for (let step = 0; step < 28; step++) {
    const mid = (low + high) / 2;
    if (mid - radius * Math.sin(mid / radius) < travel) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

/**
 * Solves the fold for a turn in progress.
 *
 * `grabY` is where the finger first touched, from the stage top; `dragY` is
 * its vertical travel since. Both directions hold the page by its right
 * edge: on a phone the spine is the left edge of the screen.
 */
export function computeCurlFold(options: {
  width: number;
  height: number;
  progress: number;
  grabY: number;
  dragY: number;
  shape?: CurlShape;
}): CurlFold {
  const { width, height, progress, grabY, dragY, shape = SOFT_CURL } = options;
  const radius =
    width *
    (shape.radiusStart +
      (shape.radiusFull - shape.radiusStart) * smoothstep(0, 0.45, progress));

  // A grab below the middle leads with the bottom corner, above it with the
  // top one. The lead swells in mid-turn and is gone by either end.
  const fromMiddle = height > 0 ? (grabY - height / 2) / (height / 2) : 0;
  const lead =
    -Math.max(-1, Math.min(1, fromMiddle)) *
    shape.lead *
    width *
    Math.sin(Math.PI * progress);

  // Under the finger at first (slope 1), two widths at the end.
  const towardGrabX = progress * (1 + progress) * width;
  const towardGrabY = -(dragY + lead);
  const travel = Math.hypot(towardGrabX, towardGrabY);
  if (travel < 1e-6) {
    return { originX: width, originY: grabY, normalX: 1, normalY: 0, radius };
  }

  let angle = Math.atan2(towardGrabY, towardGrabX);
  angle = Math.max(-shape.maxTilt, Math.min(shape.maxTilt, angle));
  const normalX = Math.cos(angle);
  const normalY = Math.sin(angle);
  const depth = grabDepth(travel, radius);
  return {
    originX: width - normalX * depth,
    originY: grabY - normalY * depth,
    normalX,
    normalY,
    radius,
  };
}

/** Signed distance of a point from the crease; positive on the free side. */
export function creaseDistance(fold: CurlFold, x: number, y: number): number {
  return (x - fold.originX) * fold.normalX + (y - fold.originY) * fold.normalY;
}

/**
 * The part of the page that still lies flat, as a CSS polygon. The live
 * page shows through it, so text before the crease never changes.
 * `overlap` lets it reach just past the crease to meet the curl.
 */
export function flatPartPolygon(
  fold: CurlFold,
  width: number,
  height: number,
  overlap = 0.75,
): string {
  const corners: [number, number][] = [
    [0, 0],
    [width, 0],
    [width, height],
    [0, height],
  ];
  const kept: [number, number][] = [];
  for (let index = 0; index < corners.length; index++) {
    const [ax, ay] = corners[index]!;
    const [bx, by] = corners[(index + 1) % corners.length]!;
    const da = creaseDistance(fold, ax, ay) - overlap;
    const db = creaseDistance(fold, bx, by) - overlap;
    if (da <= 0) kept.push([ax, ay]);
    if (da <= 0 !== db <= 0) {
      const t = da / (da - db);
      kept.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
    }
  }
  if (kept.length < 3) return "polygon(0px 0px, 0px 0px, 0px 0px)";
  return `polygon(${kept
    .map(([x, y]) => `${x.toFixed(2)}px ${y.toFixed(2)}px`)
    .join(", ")})`;
}
