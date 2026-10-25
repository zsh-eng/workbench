import { link, uniforms } from "./curl-renderer";
import { Leaf, LEAF_NODES, LEAF_SEGMENT, LEAF_WIDTH } from "./leaf-physics";
import { pageReach, sectionAt, type SheetFrame } from "./sheet-frame";

/**
 * Draws a turning leaf of paper with WebGL, over the live pages.
 *
 * The leaf's shape comes from two things: the strip simulation (`Leaf`),
 * which gives the cross-section and how it bends, and the sheet frame
 * (`SheetFrame`), which lays that section out over the page along straight
 * rulings. On the CPU the strip's bends are turned into a fan of rulings
 * that meet at the frame's apex, so the bent part is an exact cone (or,
 * with the apex at infinity, a roll); the vertex shader places each page
 * point on its ruling. Only the part past the lift line is drawn; the flat
 * part stays live DOM, clipped there. Three passes share one canvas:
 *
 * 1. Shade on the pages below, as a full-stage quad. The leaf hides part of
 *    the room's light from each point on the page: a view factor, worked out
 *    along the section from the leaf's cross-section, so the shade is sharp
 *    where the leaf touches and soft where it is high. Light that passes
 *    through the leaf keeps the shade warm rather than grey.
 * 2. The leaf, as a grid. Paper is matte: room light from above and a soft
 *    window key, no highlight. The front shows the page raster; the back is
 *    the same paper and grain, with the front's ink and pigment showing
 *    faintly through in their own colours, and both sides glow a little with
 *    light that comes through the sheet.
 * 3. The leaf's cut edges, the fore-edge, head and tail, as a thin band the
 *    thickness of the paper. It shows where the leaf stands up to the eye.
 */

export interface LeafLook {
  /** The page and ink colours, 0–1 sRGB. */
  paper: [number, number, number];
  ink: [number, number, number];
  dark: boolean;
  showThrough: boolean;
}

export interface LeafPose {
  leaf: Leaf;
  frame: SheetFrame;
}

const COLUMNS = 64;
const SHADE_SAMPLES = 128;
/** Window light from the upper left, page coordinates (y down, z up). */
const KEY = (() => {
  const key = [-0.35, -0.45, 0.82];
  const length = Math.hypot(...key);
  return key.map((value) => value / length) as [number, number, number];
})();
const KEY_SOFTNESS = 0.22;
const WARM = "vec3(1.06, 0.98, 0.84)";
const NODE_COUNT = LEAF_NODES + 1;
/**
 * The leaf's thickness on screen, CSS px. Book paper is about 0.1 mm, a
 * third of a pixel at a phone's scale; this shows it a little thicker, so
 * the cut edge reads as a line rather than a shimmer.
 */
export const LEAF_THICKNESS_PX = 0.9;
/** How far the cut edge shows past the face, seen from above, CSS px. */
const LEAF_EDGE_SPREAD_PX = 0.6;

/** The frame, the fan and the lookup from a page point to its place on it. */
const SWEEP = `
uniform vec2 uSize;
uniform float uPageWidth;
uniform vec2 uOrigin;
uniform float uAngle;
uniform float uCone;
uniform float uArc;
uniform float uSegment;
uniform float uLift;
uniform vec2 uLiftPoint;
uniform vec2 uLiftRuling;
uniform float uCamera;
uniform vec3 uNodes[${NODE_COUNT}];
uniform vec3 uRulings[${NODE_COUNT}];
uniform vec3 uNormals[${NODE_COUNT}];

/** A page point's arc along the section and offset along its ruling. */
vec2 section(vec2 page) {
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  vec2 q = page - uOrigin;
  float d = dot(q, dir);
  float t = dot(q, vec2(-dir.y, dir.x));
  if (abs(uCone) < 1e-9) return vec2(uArc + d, t);
  float a = uCone * d;
  float b = 1.0 - uCone * t;
  return vec2(
    uArc + atan(a, b) / uCone,
    (2.0 * t - uCone * t * t - uCone * d * d) / (1.0 + length(vec2(a, b)))
  );
}

/** Where the point at (s, w) lies in the room, and the paper's normal. */
void sweep(vec2 sw, out vec3 world, out vec3 normal, out vec3 ruling) {
  float f = sw.x / uSegment;
  if (f <= 0.0) {
    world = uNodes[0] + (uNodes[1] - uNodes[0]) * f + sw.y * uRulings[0];
    normal = uNormals[0];
    ruling = uRulings[0];
    return;
  }
  if (f >= ${LEAF_NODES}.0) {
    vec3 end = uNodes[${LEAF_NODES}];
    world = end + (end - uNodes[${LEAF_NODES - 1}]) * (f - ${LEAF_NODES}.0)
      + sw.y * uRulings[${LEAF_NODES}];
    normal = uNormals[${LEAF_NODES}];
    ruling = uRulings[${LEAF_NODES}];
    return;
  }
  int index = int(floor(f));
  float t = f - float(index);
  ruling = mix(uRulings[index], uRulings[index + 1], t);
  world = mix(uNodes[index], uNodes[index + 1], t) + sw.y * ruling;
  normal = normalize(mix(uNormals[index], uNormals[index + 1], t));
}

/**
 * Projects a point: nearer the eye looks larger, measured from the lift
 * line along its ruling, so the leaf meets the live page there without a
 * seam.
 */
vec4 project(vec2 page, vec2 sw, vec3 world) {
  vec2 anchor = sw.x < uLift ? page : uLiftPoint + sw.y * uLiftRuling;
  vec2 screen = anchor + (world.xy - anchor) * (uCamera / (uCamera - world.z));
  return vec4(
    screen.x / uSize.x * 2.0 - 1.0,
    1.0 - screen.y / uSize.y * 2.0,
    -world.z / (uSize.x * 4.0),
    1.0
  );
}
`;

const LEAF_VERTEX = `
attribute vec2 aUv;
${SWEEP}
varying vec2 vUv;
varying vec2 vPage;
varying float vS;
varying vec3 vNormal;
varying float vHeight;

void main() {
  vec2 page = aUv * vec2(uPageWidth, uSize.y);
  vec2 sw = section(page);
  vec3 world;
  vec3 normal;
  vec3 ruling;
  sweep(sw, world, normal, ruling);
  gl_Position = project(page, sw, world);
  vUv = page / uSize;
  vPage = page;
  vS = sw.x;
  vNormal = normal;
  vHeight = world.z;
}
`;

/** Room light on a face, with a page facing up as 1. */
const LIGHT = `
const vec3 KEY = vec3(${KEY.map((value) => value.toFixed(5)).join(", ")});
const vec3 WARM = ${WARM};

/**
 * Light falling on a face, with a page facing up as 1: the room above and
 * its walls, the lit page below for a face turned down, and a soft window
 * key.
 */
float light(vec3 normal) {
  float sky = 0.62 + 0.38 * normal.z;
  float bounce = 0.5 * (1.0 - normal.z) * 0.75 * 0.7;
  return 0.7 * (sky + bounce) + 0.3 * max(dot(normal, KEY), 0.0) / KEY.z;
}
`;

const LEAF_FRAGMENT = `
precision highp float;
uniform sampler2D uPage;
uniform sampler2D uGrain;
uniform sampler2D uShade;
uniform vec2 uRange;
uniform float uStrength;
uniform float uFill;
uniform vec2 uTexel;
uniform vec3 uPaper;
uniform vec3 uInk;
uniform float uLift;
uniform float uShow;
uniform float uTransmit;
uniform float uGrainTile;
uniform float uHasGrain;
uniform float uDark;
varying vec2 vUv;
varying vec2 vPage;
varying float vS;
varying vec3 vNormal;
varying float vHeight;
${LIGHT}

float luma(vec3 colour) {
  return dot(colour, vec3(0.2126, 0.7152, 0.0722));
}

/** How much ink covers the page here, 0–1, from the raster. */
float ink(vec2 uv) {
  float paper = luma(uPaper);
  float span = paper - luma(uInk);
  span = abs(span) < 0.05 ? 0.05 : span;
  return clamp((paper - luma(texture2D(uPage, uv).rgb)) / span, 0.0, 1.0);
}

/**
 * What the front lays on the sheet here, seen through it: on light paper,
 * the share of light its ink and pigment let through, in their colours
 * (black ink, yellow highlighter); on dark paper, its ink's cover.
 */
vec3 printed(vec2 uv) {
  vec2 spread = uTexel * 3.0;
  if (uDark > 0.5) {
    float behind = ink(uv) * 0.2
      + (ink(uv + spread) + ink(uv - spread)
        + ink(uv + vec2(spread.x, -spread.y))
        + ink(uv + vec2(-spread.x, spread.y))) * 0.2;
    return vec3(1.0 - behind);
  }
  vec3 front = texture2D(uPage, uv).rgb * 0.2
    + (texture2D(uPage, uv + spread).rgb + texture2D(uPage, uv - spread).rgb
      + texture2D(uPage, uv + vec2(spread.x, -spread.y)).rgb
      + texture2D(uPage, uv + vec2(-spread.x, spread.y)).rgb) * 0.2;
  return clamp(front / max(uPaper, vec3(0.04)), 0.0, 1.0);
}

/**
 * The room light the lifted leaf hides from a point on it near the stack:
 * as the shade below works it out at the lift line, so the leaf leaves the
 * live page in the same light, fading as the leaf rises into the open.
 */
vec3 hidden() {
  // Just short of the lift line: the ground beyond it lies under the leaf.
  float span = uRange.y - uRange.x;
  float ground = min(vS, uLift - 1.5 * span / ${SHADE_SAMPLES}.0);
  float at = clamp((ground - uRange.x) / span, 0.0, 1.0);
  vec2 shade = texture2D(uShade, vec2(at, 0.5)).rg;
  float blocked = clamp((0.7 * shade.r + 0.3 * shade.g) * uStrength, 0.0, 0.95);
  float near = 1.0 - smoothstep(0.0, 24.0, vHeight);
  return mix(vec3(1.0), vec3(1.0 - blocked) + blocked * uFill * WARM, near);
}

void main() {
  if (vS < uLift - 0.5) discard;
  vec3 normal = normalize(vNormal);
  bool front = normal.z >= 0.0;
  vec3 seen = front ? normal : -normal;
  // Light reaching the far side comes through the sheet, once the leaf is
  // high enough for light to get under it. A face is never lit brighter
  // than the page lying flat, which would read as a different paper.
  float open = smoothstep(1.5, 40.0, vHeight);
  float lit = min(light(seen), 1.0);
  float through = light(-seen) * open * uTransmit;
  vec3 colour;
  if (front) {
    vec3 gain = min(vec3(lit) + through * WARM, vec3(1.0));
    colour = texture2D(uPage, vUv).rgb * gain * hidden();
  } else {
    // Reflected light loses a little where the front is printed; light
    // coming through the sheet carries the print at almost full strength.
    vec3 print = printed(vUv);
    vec3 sheet = uPaper;
    if (uHasGrain > 0.5) {
      vec4 grain = texture2D(uGrain, fract(vPage / uGrainTile));
      sheet = mix(sheet, grain.rgb, grain.a);
    }
    colour = (sheet * lit * mix(vec3(1.0), print, 0.04 * uShow)
      + sheet * through * WARM * mix(vec3(1.0), print, 0.95 * uShow))
      * hidden();
  }
  gl_FragColor = vec4(colour, 1.0);
}
`;

const EDGE_VERTEX = `
attribute vec2 aUv;
attribute float aDepth;
attribute vec2 aOut;
${SWEEP}
uniform float uThickness;
uniform float uBevel;
varying float vS;
varying vec3 vFacing;

void main() {
  vec2 page = aUv * vec2(uPageWidth, uSize.y);
  vec2 sw = section(page);
  vec3 world;
  vec3 normal;
  vec3 ruling;
  sweep(sw, world, normal, ruling);
  // Which way the cut faces: the page's outward direction at the edge,
  // carried onto the bent sheet by the section's tangent and ruling.
  float heading = uAngle + uCone * (sw.x - uArc);
  vec2 across = vec2(cos(heading), sin(heading));
  vec2 along = vec2(-across.y, across.x);
  vec3 tangent = normalize(cross(ruling, normal));
  vFacing = normalize(dot(aOut, across) * tangent + dot(aOut, along) * ruling);
  // The cut edge runs from the front of the sheet to its back. Seen from
  // above, a sheet lying near flat would show none of it, so it also
  // reaches a little outward over the page, as the edge's own shadow does.
  world -= normal * uThickness * aDepth;
  float outward = length(vFacing.xy);
  if (outward > 0.001) world.xy += vFacing.xy / outward * uBevel * aDepth;
  vS = sw.x;
  gl_Position = project(page, sw, world);
}
`;

const EDGE_FRAGMENT = `
precision highp float;
uniform float uLift;
uniform vec3 uEdge;
varying float vS;
varying vec3 vFacing;
${LIGHT}

void main() {
  if (vS < uLift - 0.5) discard;
  gl_FragColor = vec4(uEdge * min(light(normalize(vFacing)), 1.0), 1.0);
}
`;

const SHADE_VERTEX = `
attribute vec2 aUv;
uniform vec2 uSize;
varying vec2 vPos;
void main() {
  vPos = aUv * uSize;
  gl_Position = vec4(aUv.x * 2.0 - 1.0, 1.0 - aUv.y * 2.0, 0.0, 1.0);
}
`;

const SHADE_FRAGMENT = `
precision highp float;
uniform sampler2D uShade;
uniform vec2 uOrigin;
uniform float uAngle;
uniform float uCone;
uniform float uArc;
uniform vec2 uRange;
uniform vec3 uPaper;
uniform float uStrength;
uniform float uFill;
varying vec2 vPos;
const vec3 WARM = ${WARM};

float arcOf(vec2 page) {
  vec2 dir = vec2(cos(uAngle), sin(uAngle));
  vec2 q = page - uOrigin;
  float d = dot(q, dir);
  if (abs(uCone) < 1e-9) return uArc + d;
  float t = dot(q, vec2(-dir.y, dir.x));
  return uArc + atan(uCone * d, 1.0 - uCone * t) / uCone;
}

void main() {
  float at = clamp((arcOf(vPos) - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  vec2 hidden = texture2D(uShade, vec2(at, 0.5)).rg;
  float blocked = clamp((0.7 * hidden.r + 0.3 * hidden.g) * uStrength, 0.0, 0.95);
  // A darker, warmer paper, not grey: some light comes through the leaf.
  vec3 kept = vec3(1.0 - blocked) + blocked * uFill * WARM;
  float alpha = 1.0 - min(kept.r, min(kept.g, kept.b));
  gl_FragColor = vec4(uPaper * (kept - (1.0 - alpha)), alpha);
}
`;

const SWEEP_UNIFORMS = [
  "uSize",
  "uPageWidth",
  "uOrigin",
  "uAngle",
  "uCone",
  "uArc",
  "uSegment",
  "uLift",
  "uLiftPoint",
  "uLiftRuling",
  "uCamera",
  "uNodes",
  "uRulings",
  "uNormals",
] as const;
const LEAF_UNIFORMS = [
  ...SWEEP_UNIFORMS,
  "uPage",
  "uGrain",
  "uTexel",
  "uPaper",
  "uInk",
  "uShow",
  "uTransmit",
  "uGrainTile",
  "uHasGrain",
  "uDark",
  "uShade",
  "uRange",
  "uStrength",
  "uFill",
] as const;
const EDGE_UNIFORMS = [
  ...SWEEP_UNIFORMS,
  "uThickness",
  "uBevel",
  "uEdge",
] as const;
const SHADE_UNIFORMS = [
  "uSize",
  "uShade",
  "uOrigin",
  "uAngle",
  "uCone",
  "uArc",
  "uRange",
  "uPaper",
  "uStrength",
  "uFill",
] as const;

interface PageTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** Keeps textures for the pages a turn can need: this one, and either side. */
const MAX_TEXTURES = 3;

/** The leaf's pose in stage pixels, ready for the shaders. */
export interface LeafGeometry {
  frame: SheetFrame;
  /** Width of the page the leaf is: the stage less the book's fore-edge. */
  pageWidth: number;
  /** The fan: each node's place in the room, its ruling, and the normal. */
  nodes: Float32Array;
  rulings: Float32Array;
  normals: Float32Array;
  /** Arc between nodes, px. */
  segment: number;
  /** Arc of the lift line, where the leaf leaves the stack. */
  lift: number;
  /** The lift line on the page: a point, its ruling and the way it lifts. */
  liftX: number;
  liftY: number;
  liftRulingX: number;
  liftRulingY: number;
  liftNormalX: number;
  liftNormalY: number;
  shade: Uint8Array;
  shadeFrom: number;
  shadeTo: number;
}

function wrap(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function sinc(value: number): number {
  return Math.abs(value) < 1e-6
    ? 1 - (value * value) / 6
    : Math.sin(value) / value;
}

/**
 * Lays the strip out on its frame and works out the shade it casts.
 *
 * Up to the lift line the leaf is the flat page. From there, each segment
 * of the strip is a flat facet between two rulings that meet at the apex:
 * the facet turns within its own plane by the cone's angle, and at each
 * ruling the paper bends about that ruling by the strip's angle. So the
 * bent leaf is developable whatever the strip does, and with no cone it is
 * the strip swept along parallel rulings.
 *
 * The shade is, for each point along the section, how much of the sky and
 * of the window key the lifted leaf hides: a view factor in its
 * cross-section. A cone scales its section about the apex, which keeps
 * those angles, so the same shade serves every ruling.
 */
export function leafGeometry(
  pose: LeafPose,
  pageWidth: number,
  height: number,
): LeafGeometry {
  const { leaf, frame } = pose;
  const scale = frame.length / LEAF_WIDTH;
  const segment = frame.length / LEAF_NODES;
  const first = Math.min(
    LEAF_NODES,
    Math.round(leaf.liftLine() / LEAF_SEGMENT),
  );
  const lift = first * segment;
  const nodes = new Float32Array(NODE_COUNT * 3);
  const rulings = new Float32Array(NODE_COUNT * 3);
  const normals = new Float32Array(NODE_COUNT * 3);
  for (let index = 0; index <= first; index++) {
    const flat = sectionAt(frame, index * segment);
    nodes.set([flat.x, flat.y, 0], index * 3);
    rulings.set([flat.ux, flat.uy, 0], index * 3);
    normals.set([0, 0, 1], index * 3);
  }
  const liftFlat = sectionAt(frame, lift);

  // The fan, from the lift line on.
  const turn = frame.cone * segment;
  const ahead = segment * sinc(turn);
  const aside = segment * Math.sin(turn / 2) * sinc(turn / 2);
  const cosTurn = Math.cos(turn);
  const sinTurn = Math.sin(turn);
  const point = [liftFlat.x, liftFlat.y, 0];
  let ruling = [liftFlat.ux, liftFlat.uy, 0];
  let tangent = [liftFlat.tx, liftFlat.ty, 0];
  let normal = [0, 0, 1];
  let heading = 0;
  const facets: number[][] = [];
  for (let index = first; index < LEAF_NODES; index++) {
    const direction = Math.atan2(
      leaf.z[index + 1]! - leaf.z[index]!,
      leaf.x[index + 1]! - leaf.x[index]!,
    );
    const bend = wrap(direction - heading);
    heading = direction;
    const cosBend = Math.cos(bend);
    const sinBend = Math.sin(bend);
    const bentTangent = tangent.map(
      (value, axis) => value * cosBend + normal[axis]! * sinBend,
    );
    normal = normal.map(
      (value, axis) => value * cosBend - tangent[axis]! * sinBend,
    );
    tangent = bentTangent;
    facets[index] = normal;
    for (let axis = 0; axis < 3; axis++) {
      point[axis]! += tangent[axis]! * ahead + ruling[axis]! * aside;
    }
    const nextRuling = ruling.map(
      (value, axis) => value * cosTurn - tangent[axis]! * sinTurn,
    );
    tangent = tangent.map(
      (value, axis) => value * cosTurn + ruling[axis]! * sinTurn,
    );
    ruling = nextRuling;
    nodes.set(point, (index + 1) * 3);
    rulings.set(ruling, (index + 1) * 3);
  }
  // A node's normal is between the facets either side of it.
  for (let index = first; index <= LEAF_NODES; index++) {
    const before = index === first ? [0, 0, 1] : facets[index - 1]!;
    const after = index === LEAF_NODES ? before : facets[index]!;
    const sum = before.map((value, axis) => value + after[axis]!);
    const length = Math.hypot(sum[0]!, sum[1]!, sum[2]!) || 1;
    normals.set(
      sum.map((value) => value / length),
      index * 3,
    );
  }

  const shadeFrom = -0.1 * frame.length;
  const shadeTo =
    Math.max(frame.length, pageReach(frame, pageWidth, height)) +
    0.15 * frame.length;
  const shade = new Uint8Array(SHADE_SAMPLES * 4);
  const keyAcross = KEY[0] * liftFlat.tx + KEY[1] * liftFlat.ty;
  const keyAngle = Math.atan2(keyAcross, KEY[2]);
  const stripX = (index: number) => leaf.x[index]! * scale;
  const stripZ = (index: number) => leaf.z[index]! * scale;
  for (let sample = 0; sample < SHADE_SAMPLES; sample++) {
    const at =
      shadeFrom + ((shadeTo - shadeFrom) * (sample + 0.5)) / SHADE_SAMPLES;
    let low = Infinity;
    let high = -Infinity;
    for (let index = first; index <= LEAF_NODES; index++) {
      const angle = Math.atan2(
        stripX(index) - at,
        Math.max(0.5, stripZ(index)),
      );
      low = Math.min(low, angle);
      high = Math.max(high, angle);
    }
    let sky = 0;
    let key = 0;
    if (high > low) {
      sky = (Math.sin(high) - Math.sin(low)) / 2;
      key =
        smoothstep(low - KEY_SOFTNESS, low + KEY_SOFTNESS, keyAngle) *
        (1 - smoothstep(high - KEY_SOFTNESS, high + KEY_SOFTNESS, keyAngle));
    }
    shade[sample * 4] = Math.round(Math.min(1, Math.max(0, sky)) * 255);
    shade[sample * 4 + 1] = Math.round(key * 255);
    shade[sample * 4 + 3] = 255;
  }
  // The ground the leaf covers is never seen, but the texture blends into
  // it: bridge it, so no dark line shows at the lift line.
  let reach = lift;
  for (let index = first; index <= LEAF_NODES; index++) {
    reach = Math.max(reach, stripX(index));
  }
  const step = (shadeTo - shadeFrom) / SHADE_SAMPLES;
  const before = Math.floor((lift - shadeFrom) / step - 0.5);
  const after = Math.ceil((reach - shadeFrom) / step - 0.5);
  if (before >= 0 && after < SHADE_SAMPLES && after - before > 1) {
    for (let sample = before + 1; sample < after; sample++) {
      const t = (sample - before) / (after - before);
      for (const channel of [0, 1]) {
        shade[sample * 4 + channel] = Math.round(
          shade[before * 4 + channel]! * (1 - t) +
            shade[after * 4 + channel]! * t,
        );
      }
    }
  }
  return {
    frame,
    pageWidth,
    nodes,
    rulings,
    normals,
    segment,
    lift,
    liftX: liftFlat.x,
    liftY: liftFlat.y,
    liftRulingX: liftFlat.ux,
    liftRulingY: liftFlat.uy,
    liftNormalX: liftFlat.tx,
    liftNormalY: liftFlat.ty,
    shade,
    shadeFrom,
    shadeTo,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

type Locations<Name extends string> = Record<Name, WebGLUniformLocation | null>;

export class LeafRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly leafProgram: WebGLProgram;
  private readonly edgeProgram: WebGLProgram;
  private readonly shadeProgram: WebGLProgram;
  private readonly leafUniforms: Locations<(typeof LEAF_UNIFORMS)[number]>;
  private readonly edgeUniforms: Locations<(typeof EDGE_UNIFORMS)[number]>;
  private readonly shadeUniforms: Locations<(typeof SHADE_UNIFORMS)[number]>;
  private readonly edgeDepth: number;
  private readonly edgeOut: number;
  private readonly gridBuffer: WebGLBuffer;
  private readonly quadBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly edgeBuffer: WebGLBuffer;
  private readonly edgeIndexBuffer: WebGLBuffer;
  private readonly shadeTexture: WebGLTexture;
  private readonly grainTexture: WebGLTexture;
  private grainTile = 0;
  private indexCount = 0;
  private edgeIndexCount = 0;
  private gridRows = 0;
  private width = 0;
  private height = 0;
  private readonly textures = new Map<string, PageTexture>();
  private cleared = true;

  /** Returns null where WebGL is unavailable; the slide stays in use. */
  static create(canvas: HTMLCanvasElement): LeafRenderer | null {
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      depth: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) return null;
    try {
      return new LeafRenderer(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.leafProgram = link(gl, LEAF_VERTEX, LEAF_FRAGMENT);
    this.edgeProgram = link(gl, EDGE_VERTEX, EDGE_FRAGMENT);
    this.shadeProgram = link(gl, SHADE_VERTEX, SHADE_FRAGMENT);
    this.leafUniforms = uniforms(gl, this.leafProgram, LEAF_UNIFORMS);
    this.edgeUniforms = uniforms(gl, this.edgeProgram, EDGE_UNIFORMS);
    this.shadeUniforms = uniforms(gl, this.shadeProgram, SHADE_UNIFORMS);
    this.edgeDepth = gl.getAttribLocation(this.edgeProgram, "aDepth");
    this.edgeOut = gl.getAttribLocation(this.edgeProgram, "aOut");
    this.gridBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;
    this.edgeBuffer = gl.createBuffer()!;
    this.edgeIndexBuffer = gl.createBuffer()!;
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.shadeTexture = this.texture();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      SHADE_SAMPLES,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    this.grainTexture = this.texture();
  }

  private texture(): WebGLTexture {
    const { gl } = this;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return texture;
  }

  /** Sizes the drawing buffer and rebuilds the grid for the page's aspect. */
  resize(width: number, height: number, pixelRatio: number): void {
    const canvas = this.gl.canvas as HTMLCanvasElement;
    const bufferWidth = Math.max(1, Math.round(width * pixelRatio));
    const bufferHeight = Math.max(1, Math.round(height * pixelRatio));
    if (canvas.width !== bufferWidth) canvas.width = bufferWidth;
    if (canvas.height !== bufferHeight) canvas.height = bufferHeight;
    this.width = width;
    this.height = height;
    const rows = Math.max(
      8,
      Math.round((COLUMNS * height) / Math.max(1, width)),
    );
    if (rows === this.gridRows) return;
    this.gridRows = rows;
    this.buildGrid(COLUMNS, rows);
    this.buildEdges(COLUMNS, rows);
  }

  private buildGrid(columns: number, rows: number): void {
    const { gl } = this;
    const vertices = new Float32Array((columns + 1) * (rows + 1) * 2);
    let offset = 0;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        vertices[offset++] = column / columns;
        vertices[offset++] = row / rows;
      }
    }
    const indices = new Uint16Array(columns * rows * 6);
    offset = 0;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const topLeft = row * (columns + 1) + column;
        const bottomLeft = topLeft + columns + 1;
        indices.set(
          [
            topLeft,
            bottomLeft,
            topLeft + 1,
            topLeft + 1,
            bottomLeft,
            bottomLeft + 1,
          ],
          offset,
        );
        offset += 6;
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    this.indexCount = indices.length;
  }

  /**
   * The cut edges, as strips along the head, the fore-edge and the tail:
   * each sample twice, on the front of the sheet and on its back, with the
   * page's outward direction there.
   */
  private buildEdges(columns: number, rows: number): void {
    const { gl } = this;
    const edges: [number, number, number, number][][] = [
      Array.from({ length: columns + 1 }, (_, i) => [i / columns, 0, 0, -1]),
      Array.from({ length: rows + 1 }, (_, i) => [1, i / rows, 1, 0]),
      Array.from({ length: columns + 1 }, (_, i) => [i / columns, 1, 0, 1]),
    ];
    const vertices: number[] = [];
    const indices: number[] = [];
    for (const samples of edges) {
      const start = vertices.length / 5;
      for (const [u, v, outX, outY] of samples) {
        vertices.push(u, v, 0, outX, outY, u, v, 1, outX, outY);
      }
      for (let index = 0; index < samples.length - 1; index++) {
        const front = start + index * 2;
        indices.push(
          front,
          front + 1,
          front + 2,
          front + 2,
          front + 1,
          front + 3,
        );
      }
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeIndexBuffer);
    gl.bufferData(
      gl.ELEMENT_ARRAY_BUFFER,
      new Uint16Array(indices),
      gl.STATIC_DRAW,
    );
    this.edgeIndexCount = indices.length;
  }

  hasPage(key: string): boolean {
    return this.textures.has(key);
  }

  /** Uploads a page raster under its content key, evicting the oldest. */
  setPage(key: string, source: HTMLCanvasElement): void {
    const { gl } = this;
    let entry = this.textures.get(key);
    if (entry) this.textures.delete(key);
    else entry = { texture: this.texture(), width: 0, height: 0 };
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    entry.width = source.width;
    entry.height = source.height;
    this.textures.set(key, entry);
    while (this.textures.size > MAX_TEXTURES) {
      const [oldestKey, oldest] = this.textures.entries().next().value!;
      gl.deleteTexture(oldest.texture);
      this.textures.delete(oldestKey);
    }
  }

  /** Marks a page as just used, so eviction keeps it. */
  touchPage(key: string): void {
    const entry = this.textures.get(key);
    if (!entry) return;
    this.textures.delete(key);
    this.textures.set(key, entry);
  }

  /** The grain tile for the back of the leaf; null for plain paper. */
  setGrain(tile: HTMLCanvasElement | null, size: number): void {
    const { gl } = this;
    this.grainTile = tile ? size : 0;
    if (!tile) return;
    gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile);
  }

  clear(): void {
    if (this.cleared) return;
    const { gl } = this;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.cleared = true;
  }

  /** The frame and fan, for the leaf and its edges alike. */
  private setSweep(
    at: Locations<(typeof SWEEP_UNIFORMS)[number]>,
    geometry: LeafGeometry,
  ): void {
    const { gl } = this;
    const { frame } = geometry;
    gl.uniform2f(at.uSize, this.width, this.height);
    gl.uniform1f(at.uPageWidth, geometry.pageWidth);
    gl.uniform2f(at.uOrigin, frame.originX, frame.originY);
    gl.uniform1f(at.uAngle, frame.angle);
    gl.uniform1f(at.uCone, frame.cone);
    gl.uniform1f(at.uArc, frame.arc);
    gl.uniform1f(at.uSegment, geometry.segment);
    gl.uniform1f(at.uLift, geometry.lift);
    gl.uniform2f(at.uLiftPoint, geometry.liftX, geometry.liftY);
    gl.uniform2f(at.uLiftRuling, geometry.liftRulingX, geometry.liftRulingY);
    gl.uniform1f(at.uCamera, Math.max(this.width, this.height) * 4);
    gl.uniform3fv(at.uNodes, geometry.nodes);
    gl.uniform3fv(at.uRulings, geometry.rulings);
    gl.uniform3fv(at.uNormals, geometry.normals);
  }

  draw(key: string, geometry: LeafGeometry, look: LeafLook): boolean {
    const page = this.textures.get(key);
    if (!page || this.width <= 0) return false;
    const { gl } = this;
    const { frame } = geometry;
    const canvas = gl.canvas as HTMLCanvasElement;
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.cleared = false;
    gl.enableVertexAttribArray(0);

    // Shade on the pages below.
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.shadeProgram);
    const shade = this.shadeUniforms;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.shadeTexture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      SHADE_SAMPLES,
      1,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      geometry.shade,
    );
    gl.uniform1i(shade.uShade, 0);
    gl.uniform2f(shade.uSize, this.width, this.height);
    gl.uniform2f(shade.uOrigin, frame.originX, frame.originY);
    gl.uniform1f(shade.uAngle, frame.angle);
    gl.uniform1f(shade.uCone, frame.cone);
    gl.uniform1f(shade.uArc, frame.arc);
    gl.uniform2f(shade.uRange, geometry.shadeFrom, geometry.shadeTo);
    gl.uniform3f(shade.uPaper, ...look.paper);
    const strength = look.dark ? 1.1 : 0.6;
    const fill = look.dark ? 0.08 : 0.2;
    gl.uniform1f(shade.uStrength, strength);
    gl.uniform1f(shade.uFill, fill);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // The leaf.
    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.useProgram(this.leafProgram);
    const leaf = this.leafUniforms;
    this.setSweep(leaf, geometry);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, page.texture);
    gl.uniform1i(leaf.uPage, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
    gl.uniform1i(leaf.uGrain, 1);
    gl.uniform2f(leaf.uTexel, 1 / page.width, 1 / page.height);
    gl.uniform3f(leaf.uPaper, ...look.paper);
    gl.uniform3f(leaf.uInk, ...look.ink);
    gl.uniform1f(leaf.uShow, look.showThrough ? 1 : 0);
    gl.uniform1f(leaf.uTransmit, look.dark ? 0.06 : 0.12);
    gl.uniform1f(leaf.uGrainTile, this.grainTile || 1);
    gl.uniform1f(leaf.uHasGrain, this.grainTile ? 1 : 0);
    gl.uniform1f(leaf.uDark, look.dark ? 1 : 0);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.shadeTexture);
    gl.uniform1i(leaf.uShade, 2);
    gl.uniform2f(leaf.uRange, geometry.shadeFrom, geometry.shadeTo);
    gl.uniform1f(leaf.uStrength, strength);
    gl.uniform1f(leaf.uFill, fill);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    gl.drawElements(gl.TRIANGLES, this.indexCount, gl.UNSIGNED_SHORT, 0);

    // Its cut edges: a little darker than the face on light paper, where
    // the fibres are rough, and a little lighter on dark paper.
    gl.useProgram(this.edgeProgram);
    const edge = this.edgeUniforms;
    this.setSweep(edge, geometry);
    gl.uniform1f(edge.uThickness, LEAF_THICKNESS_PX);
    gl.uniform1f(edge.uBevel, LEAF_EDGE_SPREAD_PX);
    const [red, green, blue] = look.paper;
    if (look.dark) {
      gl.uniform3f(
        edge.uEdge,
        red * 1.5 + 0.05,
        green * 1.5 + 0.05,
        blue * 1.5 + 0.045,
      );
    } else {
      gl.uniform3f(edge.uEdge, red * 0.84, green * 0.82, blue * 0.78);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.edgeBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
    gl.enableVertexAttribArray(this.edgeDepth);
    gl.vertexAttribPointer(this.edgeDepth, 1, gl.FLOAT, false, 20, 8);
    gl.enableVertexAttribArray(this.edgeOut);
    gl.vertexAttribPointer(this.edgeOut, 2, gl.FLOAT, false, 20, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.edgeIndexBuffer);
    gl.drawElements(gl.TRIANGLES, this.edgeIndexCount, gl.UNSIGNED_SHORT, 0);
    gl.disableVertexAttribArray(this.edgeDepth);
    gl.disableVertexAttribArray(this.edgeOut);
    return true;
  }

  dispose(): void {
    const { gl } = this;
    for (const entry of this.textures.values()) gl.deleteTexture(entry.texture);
    this.textures.clear();
    gl.deleteTexture(this.shadeTexture);
    gl.deleteTexture(this.grainTexture);
    gl.deleteBuffer(this.gridBuffer);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteBuffer(this.edgeBuffer);
    gl.deleteBuffer(this.edgeIndexBuffer);
    gl.deleteProgram(this.leafProgram);
    gl.deleteProgram(this.edgeProgram);
    gl.deleteProgram(this.shadeProgram);
    // A canvas still on the page (React's second mount in development, or
    // the curl chosen again) keeps its context for the next renderer, which
    // could not start on a lost one. One that has gone gives it up now.
    const { canvas } = gl;
    if (canvas instanceof HTMLCanvasElement && canvas.isConnected) return;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
