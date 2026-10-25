import { link, uniforms } from "./curl-renderer";
import { Leaf, LEAF_NODES, LEAF_SEGMENT, LEAF_WIDTH } from "./leaf-physics";

/**
 * Draws a turning leaf of paper with WebGL, over the live pages.
 *
 * The leaf's shape comes from the strip simulation (`Leaf`): a cross-section
 * that the page is swept along, so every ruling across the bent part stays
 * straight, as paper does. Only the part past the lift line is drawn; the
 * flat part stays live DOM, clipped there. Two passes share one canvas:
 *
 * 1. Shade on the pages below, as a full-stage quad. The leaf hides part of
 *    the room's light from each point on the page: a view factor, worked out
 *    along the sweep from the leaf's cross-section, so the shade is sharp
 *    where the leaf touches and soft where it is high. Light that passes
 *    through the leaf keeps the shade warm rather than grey.
 * 2. The leaf, as a grid swept along the strip in the vertex shader. Paper
 *    is matte: room light from above and a soft window key, no highlight.
 *    The front shows the page raster; the back is the same paper and grain,
 *    with the front's ink showing faintly through, and both sides glow a
 *    little with light that comes through the sheet.
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
  /** Tilt of the rulings from the spine's direction, radians. */
  tilt: number;
  /** Height the rulings tilt about, from the stage top. */
  pivotY: number;
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

const LEAF_VERTEX = `
attribute vec2 aUv;
uniform vec2 uSize;
uniform vec2 uNodes[${NODE_COUNT}];
uniform vec2 uTangents[${NODE_COUNT}];
uniform float uSegment;
uniform vec2 uPivot;
uniform vec2 uDir;
uniform float uCamera;
uniform float uLift;
varying vec2 vUv;
varying vec2 vPage;
varying float vAlong;
varying vec3 vNormal;
varying float vHeight;
varying float vGround;

void strip(float s, out vec2 point, out vec2 tangent) {
  if (s <= 0.0) {
    point = vec2(s, 0.0);
    tangent = vec2(1.0, 0.0);
    return;
  }
  float f = s / uSegment;
  if (f >= ${LEAF_NODES}.0) {
    vec2 before = uNodes[${LEAF_NODES - 1}];
    vec2 end = uNodes[${LEAF_NODES}];
    point = end + (end - before) * (f - ${LEAF_NODES}.0);
    tangent = uTangents[${LEAF_NODES}];
    return;
  }
  int index = int(floor(f));
  float t = f - float(index);
  point = mix(uNodes[index], uNodes[index + 1], t);
  tangent = normalize(mix(uTangents[index], uTangents[index + 1], t));
}

void main() {
  vec2 page = aUv * uSize;
  vec2 offset = page - uPivot;
  vec2 across = vec2(-uDir.y, uDir.x);
  float along = dot(offset, uDir);
  vec2 point;
  vec2 tangent;
  strip(along, point, tangent);
  float side = dot(offset, across);
  vec3 world = vec3(uPivot + uDir * point.x + across * side, point.y);
  // Nearer the eye looks larger, measured from the lift line, so the leaf
  // still meets the live page there without a seam.
  vec2 anchor = uPivot + uDir * min(along, uLift) + across * side;
  vec2 screen = anchor + (world.xy - anchor) * (uCamera / (uCamera - world.z));
  gl_Position = vec4(
    screen.x / uSize.x * 2.0 - 1.0,
    1.0 - screen.y / uSize.y * 2.0,
    -world.z / (uSize.x * 4.0),
    1.0
  );
  vUv = aUv;
  vPage = page;
  vAlong = along;
  vNormal = vec3(-uDir * tangent.y, tangent.x);
  vHeight = world.z;
  vGround = point.x;
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
varying vec2 vUv;
varying vec2 vPage;
varying float vAlong;
varying vec3 vNormal;
varying float vHeight;
varying float vGround;
const vec3 KEY = vec3(${KEY.map((value) => value.toFixed(5)).join(", ")});
const vec3 WARM = ${WARM};

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
 * Light falling on a face, with a page facing up as 1: the room above and
 * its walls, the lit page below for a face turned down, and a soft window
 * key.
 */
float light(vec3 normal) {
  float sky = 0.62 + 0.38 * normal.z;
  float bounce = 0.5 * (1.0 - normal.z) * 0.75 * 0.7;
  return 0.7 * (sky + bounce) + 0.3 * max(dot(normal, KEY), 0.0) / KEY.z;
}

/**
 * The room light the lifted leaf hides from a point on it near the stack:
 * as the shade below works it out at the lift line, so the leaf leaves the
 * live page in the same light, fading as the leaf rises into the open.
 */
vec3 hidden() {
  // Just short of the lift line: the ground beyond it lies under the leaf.
  float span = uRange.y - uRange.x;
  float ground = min(vGround, uLift - 1.5 * span / ${SHADE_SAMPLES}.0);
  float at = clamp((ground - uRange.x) / span, 0.0, 1.0);
  vec2 shade = texture2D(uShade, vec2(at, 0.5)).rg;
  float blocked = clamp((0.7 * shade.r + 0.3 * shade.g) * uStrength, 0.0, 0.95);
  float near = 1.0 - smoothstep(0.0, 24.0, vHeight);
  return mix(vec3(1.0), vec3(1.0 - blocked) + blocked * uFill * WARM, near);
}

void main() {
  if (vAlong < uLift - 0.5) discard;
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
    vec2 spread = uTexel * 3.0;
    float behind = (ink(vUv) * 0.2
      + (ink(vUv + spread) + ink(vUv - spread)
        + ink(vUv + vec2(spread.x, -spread.y))
        + ink(vUv + vec2(-spread.x, spread.y))) * 0.2) * uShow;
    vec3 sheet = uPaper;
    if (uHasGrain > 0.5) {
      vec4 grain = texture2D(uGrain, fract(vPage / uGrainTile));
      sheet = mix(sheet, grain.rgb, grain.a);
    }
    colour = (sheet * lit * (1.0 - 0.035 * behind)
      + sheet * through * WARM * (1.0 - 0.95 * behind)) * hidden();
  }
  gl_FragColor = vec4(colour, 1.0);
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
uniform vec2 uPivot;
uniform vec2 uDir;
uniform vec2 uRange;
uniform vec3 uPaper;
uniform float uStrength;
uniform float uFill;
varying vec2 vPos;
const vec3 WARM = ${WARM};
void main() {
  float along = dot(vPos - uPivot, uDir);
  float at = clamp((along - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
  vec2 hidden = texture2D(uShade, vec2(at, 0.5)).rg;
  float blocked = clamp((0.7 * hidden.r + 0.3 * hidden.g) * uStrength, 0.0, 0.95);
  // A darker, warmer paper, not grey: some light comes through the leaf.
  vec3 kept = vec3(1.0 - blocked) + blocked * uFill * WARM;
  float alpha = 1.0 - min(kept.r, min(kept.g, kept.b));
  gl_FragColor = vec4(uPaper * (kept - (1.0 - alpha)), alpha);
}
`;

const LEAF_UNIFORMS = [
  "uSize",
  "uNodes",
  "uTangents",
  "uSegment",
  "uPivot",
  "uDir",
  "uCamera",
  "uPage",
  "uGrain",
  "uTexel",
  "uPaper",
  "uInk",
  "uLift",
  "uShow",
  "uTransmit",
  "uGrainTile",
  "uHasGrain",
  "uShade",
  "uRange",
  "uStrength",
  "uFill",
] as const;
const SHADE_UNIFORMS = [
  "uSize",
  "uShade",
  "uPivot",
  "uDir",
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
  nodes: Float32Array;
  tangents: Float32Array;
  segment: number;
  /** Where the lift line is, along the sweep from the pivot. */
  lift: number;
  dirX: number;
  dirY: number;
  pivotY: number;
  shade: Uint8Array;
  shadeFrom: number;
  shadeTo: number;
}

/**
 * Puts the strip in stage pixels and works out the shade it casts: for
 * each point along the sweep, how much of the sky and of the window key the
 * lifted leaf hides, as a view factor in its cross-section.
 */
export function leafGeometry(
  pose: LeafPose,
  width: number,
  height: number,
): LeafGeometry {
  const { leaf, tilt, pivotY } = pose;
  const scale = width / LEAF_WIDTH;
  const nodes = new Float32Array(NODE_COUNT * 2);
  const tangents = new Float32Array(NODE_COUNT * 2);
  for (let index = 0; index <= LEAF_NODES; index++) {
    nodes[index * 2] = leaf.x[index]! * scale;
    nodes[index * 2 + 1] = leaf.z[index]! * scale;
  }
  for (let index = 0; index <= LEAF_NODES; index++) {
    const before = Math.max(0, index - 1);
    const after = Math.min(LEAF_NODES, index + 1);
    const tx = leaf.x[after]! - leaf.x[before]!;
    const tz = leaf.z[after]! - leaf.z[before]!;
    const length = Math.hypot(tx, tz) || 1;
    tangents[index * 2] = tx / length;
    tangents[index * 2 + 1] = tz / length;
  }
  const lift = leaf.liftLine() * scale;
  const dirX = Math.cos(tilt);
  const dirY = Math.sin(tilt);

  const shadeFrom = -0.1 * width;
  const shadeTo = 1.15 * width + Math.abs(dirY) * height;
  const shade = new Uint8Array(SHADE_SAMPLES * 4);
  const first = Math.round(lift / (LEAF_SEGMENT * scale));
  const keyAcross = KEY[0] * dirX + KEY[1] * dirY;
  const keyAngle = Math.atan2(keyAcross, KEY[2]);
  for (let sample = 0; sample < SHADE_SAMPLES; sample++) {
    const at =
      shadeFrom + ((shadeTo - shadeFrom) * (sample + 0.5)) / SHADE_SAMPLES;
    let low = Infinity;
    let high = -Infinity;
    for (let index = first; index <= LEAF_NODES; index++) {
      const angle = Math.atan2(
        nodes[index * 2]! - at,
        Math.max(0.5, nodes[index * 2 + 1]!),
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
    reach = Math.max(reach, nodes[index * 2]!);
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
    nodes,
    tangents,
    segment: LEAF_SEGMENT * scale,
    lift,
    dirX,
    dirY,
    pivotY,
    shade,
    shadeFrom,
    shadeTo,
  };
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class LeafRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly leafProgram: WebGLProgram;
  private readonly shadeProgram: WebGLProgram;
  private readonly leafUniforms: Record<
    (typeof LEAF_UNIFORMS)[number],
    WebGLUniformLocation | null
  >;
  private readonly shadeUniforms: Record<
    (typeof SHADE_UNIFORMS)[number],
    WebGLUniformLocation | null
  >;
  private readonly gridBuffer: WebGLBuffer;
  private readonly quadBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private readonly shadeTexture: WebGLTexture;
  private readonly grainTexture: WebGLTexture;
  private grainTile = 0;
  private indexCount = 0;
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
    this.shadeProgram = link(gl, SHADE_VERTEX, SHADE_FRAGMENT);
    this.leafUniforms = uniforms(gl, this.leafProgram, LEAF_UNIFORMS);
    this.shadeUniforms = uniforms(gl, this.shadeProgram, SHADE_UNIFORMS);
    this.gridBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;
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
    const rows = Math.max(8, Math.round((COLUMNS * height) / Math.max(1, width)));
    if (rows === this.gridRows) return;
    this.gridRows = rows;
    this.buildGrid(COLUMNS, rows);
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

  draw(key: string, geometry: LeafGeometry, look: LeafLook): boolean {
    const page = this.textures.get(key);
    if (!page || this.width <= 0) return false;
    const { gl } = this;
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
    gl.uniform2f(shade.uPivot, 0, geometry.pivotY);
    gl.uniform2f(shade.uDir, geometry.dirX, geometry.dirY);
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, page.texture);
    gl.uniform1i(leaf.uPage, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
    gl.uniform1i(leaf.uGrain, 1);
    gl.uniform2f(leaf.uSize, this.width, this.height);
    gl.uniform2fv(leaf.uNodes, geometry.nodes);
    gl.uniform2fv(leaf.uTangents, geometry.tangents);
    gl.uniform1f(leaf.uSegment, geometry.segment);
    gl.uniform2f(leaf.uPivot, 0, geometry.pivotY);
    gl.uniform2f(leaf.uDir, geometry.dirX, geometry.dirY);
    gl.uniform1f(leaf.uCamera, Math.max(this.width, this.height) * 4);
    gl.uniform2f(leaf.uTexel, 1 / page.width, 1 / page.height);
    gl.uniform3f(leaf.uPaper, ...look.paper);
    gl.uniform3f(leaf.uInk, ...look.ink);
    gl.uniform1f(leaf.uLift, geometry.lift);
    gl.uniform1f(leaf.uShow, look.showThrough ? 1 : 0);
    gl.uniform1f(leaf.uTransmit, look.dark ? 0.06 : 0.12);
    gl.uniform1f(leaf.uGrainTile, this.grainTile || 1);
    gl.uniform1f(leaf.uHasGrain, this.grainTile ? 1 : 0);
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
    gl.deleteProgram(this.leafProgram);
    gl.deleteProgram(this.shadeProgram);
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
