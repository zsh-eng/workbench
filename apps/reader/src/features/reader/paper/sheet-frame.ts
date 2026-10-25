/**
 * How a turning leaf lies over its page (Debug curl): the frame that lays
 * the leaf's cross-section (the strip in `leaf-physics.ts`) out across the
 * page as paper.
 *
 * Paper bends but does not stretch, so a bent page is a developable surface:
 * it is straight along its rulings and bends only across them. A hand that
 * holds the page at one point bends it along rulings that meet at a point
 * on the spine's line, beyond the page, so the bent part is a cone, as in
 * Hong, Card & Chen's page turn. Held near the middle of the edge and
 * pulled straight across, that point is far away and the rulings are all
 * but parallel: a roll. Held at a corner and pulled across the page, it
 * comes near, and the corner curls tighter than the far end of the fold.
 * The spine is itself one of the rulings, so it stays straight and flat,
 * and the line where the page leaves the stack is straight (study C5).
 *
 * The frame is the reference section, the circle about the apex through a
 * point of the page (its origin): its direction there (`angle`), its
 * curvature on the flat page (`cone`, one over the distance to the apex,
 * signed; 0 for parallel rulings), and its arc from the spine to the
 * origin. Every page point has a place along the section (`s`, the arc of
 * its ruling from the spine) and an offset along its ruling (`w`). The
 * strip is the section's shape; `w` carries it along the rulings.
 *
 * Page coordinates are stage pixels with y down; `angle` is positive when
 * the section turns towards the foot of the page.
 */

export interface SheetFrame {
  /** A point on the reference section, page px. */
  originX: number;
  originY: number;
  /** The section's direction at the origin, radians from straight across. */
  angle: number;
  /**
   * One over the distance from the origin to the apex, along its ruling.
   * Positive puts the apex below the page, negative above; 0 is a roll.
   */
  cone: number;
  /** Arc along the section from the spine's ruling to the origin, px. */
  arc: number;
  /** Arc the whole strip covers on this section, px: the leaf as laid out. */
  length: number;
}

/** The steepest a held section can turn: past this a fold reads as a crease. */
export const MAX_GRIP_ANGLE = (42 * Math.PI) / 180;
/**
 * The apex keeps this far beyond the page, as a share of its width: paper
 * near the apex would have to bend too tightly for a page.
 */
const APEX_CLEARANCE = 0.3;
/**
 * The page may reach this far past the end of the strip on a section:
 * beyond the strip the leaf goes on straight, which a little of the far
 * corner can do without showing.
 */
const OVERREACH = 1.1;

/**
 * The parallel roll of the first leaf, kept to compare: rulings tilted by
 * `tilt` about a point on the spine.
 */
export function rollFrame(
  pivotY: number,
  tilt: number,
  pageWidth: number,
): SheetFrame {
  return {
    originX: 0,
    originY: pivotY,
    angle: tilt,
    cone: 0,
    arc: 0,
    length: pageWidth,
  };
}

/**
 * The cone of a page held at (gripX, gripY), its section turned to `angle`
 * there: the grip's ruling meets the spine's line at the apex.
 */
export function gripFrame(
  gripX: number,
  gripY: number,
  angle: number,
  pageWidth: number,
): SheetFrame {
  const x = Math.max(1, gripX);
  const flat = Math.abs(angle) < 1e-5;
  const cone = flat ? 0 : Math.sin(angle) / x;
  const arc = flat ? x : angle / cone;
  return {
    originX: x,
    originY: gripY,
    angle,
    cone,
    arc,
    length: Math.max(pageWidth, arc),
  };
}

/** Where a page point lies on the frame: its arc `s` and ruling offset `w`. */
export function toSection(
  frame: SheetFrame,
  x: number,
  y: number,
): [number, number] {
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const dx = x - frame.originX;
  const dy = y - frame.originY;
  const d = dx * cos + dy * sin;
  const t = -dx * sin + dy * cos;
  const k = frame.cone;
  if (k === 0) return [frame.arc + d, t];
  const a = k * d;
  const b = 1 - k * t;
  return [
    frame.arc + Math.atan2(a, b) / k,
    (2 * t - k * t * t - k * d * d) / (1 + Math.hypot(a, b)),
  ];
}

function sinc(value: number): number {
  return Math.abs(value) < 1e-6
    ? 1 - (value * value) / 6
    : Math.sin(value) / value;
}

/** The flat page at arc `s` of the reference section: point, tangent, ruling. */
export interface SectionPoint {
  x: number;
  y: number;
  /** Unit direction of increasing arc. */
  tx: number;
  ty: number;
  /** Unit ruling, oriented like `w`. */
  ux: number;
  uy: number;
}

export function sectionAt(frame: SheetFrame, s: number): SectionPoint {
  const sigma = s - frame.arc;
  const turn = frame.cone * sigma;
  const along = sigma * sinc(turn);
  const aside = sigma * Math.sin(turn / 2) * sinc(turn / 2);
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  const heading = frame.angle + turn;
  return {
    x: frame.originX + cos * along - sin * aside,
    y: frame.originY + sin * along + cos * aside,
    tx: Math.cos(heading),
    ty: Math.sin(heading),
    ux: -Math.sin(heading),
    uy: Math.cos(heading),
  };
}

/** The furthest arc any part of the page reaches on this frame. */
export function pageReach(
  frame: SheetFrame,
  pageWidth: number,
  height: number,
): number {
  let furthest = 0;
  for (const [x, y] of [
    [pageWidth, 0],
    [pageWidth, height],
    [0, 0],
    [0, height],
  ] as const) {
    furthest = Math.max(furthest, toSection(frame, x, y)[0]);
  }
  return furthest;
}

/** Where the cone's apex meets the spine's line, or null for a roll. */
export function apexY(frame: SheetFrame): number | null {
  if (frame.cone === 0) return null;
  return frame.originY + Math.cos(frame.angle) / frame.cone;
}

/**
 * The section angle a hand gets at a grip, as near `wanted` as paper
 * allows: the apex stays clear of the page, and the strip covers the page.
 * A grip at a corner can turn the fold steeply; one near the middle of the
 * edge, hardly at all, since the corners either side would trail.
 */
export function holdAngle(
  gripX: number,
  gripY: number,
  wanted: number,
  pageWidth: number,
  height: number,
): number {
  const target = Math.max(-MAX_GRIP_ANGLE, Math.min(MAX_GRIP_ANGLE, wanted));
  const fits = (angle: number) => {
    const frame = gripFrame(gripX, gripY, angle, pageWidth);
    const apex = apexY(frame);
    if (apex === null) return true;
    const clearance = APEX_CLEARANCE * pageWidth;
    if (apex > -clearance && apex < height + clearance) return false;
    return pageReach(frame, pageWidth, height) <= frame.length * OVERREACH;
  };
  if (fits(target)) return target;
  let low = 0;
  let high = target;
  for (let step = 0; step < 14; step++) {
    const middle = (low + high) / 2;
    if (fits(middle)) low = middle;
    else high = middle;
  }
  return low;
}
