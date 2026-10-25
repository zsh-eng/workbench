import { link, uniforms } from "./curl-renderer";

/**
 * Highlighter pigment soaked into the paper (Debug paper).
 *
 * A highlight on paper is not a box of colour behind the words. It is a
 * translucent ink laid down by a felt tip: it multiplies with the sheet, so
 * the print stays black and the paper takes the tint; it soaks into the
 * fibres, so its edges are soft and a little ragged and it follows the
 * paper's tooth; and it is a stroke, so it wanders a little, pools where
 * the tip first touches, is streaked along its length by the tip's felt,
 * and ends on the slant of a chisel tip.
 *
 * Each highlighted line is one stroke, drawn as a quad whose fragment
 * shader works out the stroke's shape and how much pigment lies at each
 * point. Strokes multiply into a white buffer (light paper), so where two
 * cross they darken and mix as real pigment does; on dark paper they add,
 * as a faint glow, since a dark page cannot be dyed. The grain tile is the
 * page's own, so the pigment follows the fibres the paper shows. One small
 * WebGL canvas serves every page; each result is copied out at once.
 */

/** One stroke of the pen along one line of a highlight, page CSS px. */
export interface PigmentStroke {
  left: number;
  top: number;
  right: number;
  bottom: number;
  /** Transmittance on light paper, or glow on dark, 0–1 sRGB. */
  colour: [number, number, number];
  /** The highlight whose tools are open takes a little more pigment. */
  active: boolean;
  /** Varies one stroke from another, the same for the same text. */
  seed: number;
  /** Whether the pen started or ended here, rather than at a line break. */
  starts: boolean;
  ends: boolean;
}

/** `marker` is a felt-tip stroke; `wash` the same pigment laid evenly. */
export type PigmentStyle = "marker" | "wash";

const VERTEX = `
attribute vec2 aUv;
attribute vec4 aRect;
attribute vec4 aColour;
attribute vec4 aShape;
uniform vec2 uSize;
uniform float uRatio;
varying vec2 vPx;
varying vec4 vRect;
varying vec4 vColour;
varying vec4 vShape;
void main() {
  // The quad reaches past the line a little, for the slant and the bleed.
  float margin = 4.0 * uRatio;
  vec2 low = aRect.xy - vec2(margin + (aRect.w - aRect.y) * 0.3, margin);
  vec2 high = aRect.zw + vec2(margin + (aRect.w - aRect.y) * 0.3, margin);
  vec2 px = mix(low, high, aUv);
  vPx = px;
  vRect = aRect;
  vColour = aColour;
  vShape = aShape;
  gl_Position = vec4(px.x / uSize.x * 2.0 - 1.0, 1.0 - px.y / uSize.y * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform sampler2D uGrain;
uniform float uTile;
uniform vec2 uOffset;
uniform float uRatio;
uniform float uMarker;
uniform float uDark;
uniform float uHasGrain;
varying vec2 vPx;
varying vec4 vRect;
varying vec4 vColour;
varying vec4 vShape;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

/** The paper's own grain here: tooth and fibres, 0–1. */
float grain(vec2 px) {
  if (uHasGrain < 0.5) return 0.35;
  return texture2D(uGrain, fract((px + uOffset) / uTile)).a;
}

void main() {
  float seed = vShape.x;
  float chosen = vShape.y;
  float starts = vShape.z;
  float ends = vShape.w;
  float css = 1.0 / uRatio;
  vec2 at = vPx * css;
  float lineHeight = (vRect.w - vRect.y) * css;
  float along = at.x - vRect.x * css;
  float strokeLength = (vRect.z - vRect.x) * css;

  // The stroke's middle wanders a little as the hand does, and its height
  // breathes with the pressure; a wash keeps the line's own box.
  float wander = (noise(vec2(along / 90.0, seed)) - 0.5) * 0.08 * lineHeight * uMarker;
  float middle = (vRect.y + vRect.w) * 0.5 * css + 0.03 * lineHeight * uMarker + wander;
  float halfHeight = lineHeight * mix(0.5, 0.43, uMarker)
    * (1.0 + (noise(vec2(along / 50.0, seed + 7.0)) - 0.5) * 0.06 * uMarker);
  float across = (at.y - middle) / halfHeight;

  // A chisel tip ends on a slant; a line break cuts straight.
  float slant = 0.22 * halfHeight * uMarker;
  float startEdge = along + across * slant * starts;
  float endEdge = strokeLength - along + across * slant * ends;

  // The edge is the felt's, a little uneven along its length, top and
  // bottom apart; past it, pigment soaks a little way along the fibres.
  float fibre = grain(vPx);
  float side = across < 0.0 ? 0.0 : 1.0;
  float uneven = (noise(vec2(along / 7.0, seed + 31.0 + side * 17.0)) - 0.5) * 0.9;
  float soak = 0.2 + 0.55 * fibre * fibre + uneven;
  float feather = 0.6;
  float edge = (1.0 - abs(across)) * halfHeight;
  float inside = smoothstep(-soak - feather, -soak + feather, edge);
  inside *= smoothstep(-soak - feather, -soak + feather, startEdge);
  inside *= smoothstep(-soak - feather, -soak + feather, endEdge);
  if (inside <= 0.002) discard;

  // How much pigment lies here: streaks from the felt along the stroke,
  // a pool where the tip first touched, a little less where it lifted,
  // and more in the paper's tooth than on its peaks.
  float density = mix(0.86, 0.92, uMarker);
  float streak = noise(vec2(along / 160.0, across * 5.0 + seed * 3.0));
  density *= 1.0 + (streak - 0.5) * 0.22 * uMarker;
  density *= 1.0 + (noise(vec2(along / 28.0, seed + 19.0)) - 0.5) * 0.08;
  density *= 1.0 + 0.16 * exp(-max(startEdge, 0.0) / 5.0) * starts * uMarker;
  density *= 1.0 - 0.1 * exp(-max(endEdge, 0.0) / 9.0) * ends * uMarker;
  density *= 0.9 + 0.22 * fibre;
  // As the stroke dries, pigment is carried out to its edge and stays
  // there: a faint tide line, plainer in a wash than under a felt tip.
  float rim = min(min(edge, startEdge), endEdge) + soak;
  density *= 1.0 + mix(0.2, 0.1, uMarker) * exp(-max(rim, 0.0) / 1.3);
  density *= 1.0 + 0.22 * chosen;
  density = clamp(density * inside, 0.0, 1.0);

  if (uDark > 0.5) {
    gl_FragColor = vec4(vColour.rgb * density, 1.0);
  } else {
    // Light through a layer of dye: thicker pigment deepens the hue as
    // well as darkening it, as a pool of ink does.
    gl_FragColor = vec4(pow(max(vColour.rgb, vec3(0.02)), vec3(density)), 1.0);
  }
}
`;

const UNIFORMS = [
  "uSize",
  "uRatio",
  "uGrain",
  "uTile",
  "uOffset",
  "uMarker",
  "uDark",
  "uHasGrain",
] as const;

/** Floats per vertex: corner, rect, colour, shape. */
const STRIDE = 2 + 4 + 4 + 4;

class PigmentRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly locations: Record<
    (typeof UNIFORMS)[number],
    WebGLUniformLocation | null
  >;
  private readonly attributes: { rect: number; colour: number; shape: number };
  private readonly buffer: WebGLBuffer;
  private readonly grainTexture: WebGLTexture;
  private grainSource: HTMLCanvasElement | null = null;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.program = link(gl, VERTEX, FRAGMENT);
    this.locations = uniforms(gl, this.program, UNIFORMS);
    this.attributes = {
      rect: gl.getAttribLocation(this.program, "aRect"),
      colour: gl.getAttribLocation(this.program, "aColour"),
      shape: gl.getAttribLocation(this.program, "aShape"),
    };
    this.buffer = gl.createBuffer()!;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.grainTexture = texture;
  }

  /**
   * Draws `strokes` into a canvas `width` × `height` CSS px whose top left
   * is at `origin` on the page. Returns the GL canvas, to copy out now.
   */
  render(options: {
    strokes: PigmentStroke[];
    origin: [number, number];
    width: number;
    height: number;
    pixelRatio: number;
    dark: boolean;
    style: PigmentStyle;
    /** The page's grain tile (alpha), its size in CSS px, and its offset. */
    grain: { tile: HTMLCanvasElement; size: number } | null;
  }): HTMLCanvasElement | null {
    const { gl } = this;
    const { strokes, origin, pixelRatio: ratio, dark, grain } = options;
    const canvas = gl.canvas as HTMLCanvasElement;
    if (gl.isContextLost()) return null;
    canvas.width = Math.max(1, Math.round(options.width * ratio));
    canvas.height = Math.max(1, Math.round(options.height * ratio));
    gl.viewport(0, 0, canvas.width, canvas.height);
    if (dark) gl.clearColor(0, 0, 0, 1);
    else gl.clearColor(1, 1, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const data = new Float32Array(strokes.length * 6 * STRIDE);
    let offset = 0;
    const corners = [
      [0, 0],
      [1, 0],
      [0, 1],
      [0, 1],
      [1, 0],
      [1, 1],
    ] as const;
    for (const stroke of strokes) {
      for (const [u, v] of corners) {
        data.set(
          [
            u,
            v,
            (stroke.left - origin[0]) * ratio,
            (stroke.top - origin[1]) * ratio,
            (stroke.right - origin[0]) * ratio,
            (stroke.bottom - origin[1]) * ratio,
            ...stroke.colour,
            1,
            stroke.seed,
            stroke.active ? 1 : 0,
            stroke.starts ? 1 : 0,
            stroke.ends ? 1 : 0,
          ],
          offset,
        );
        offset += STRIDE;
      }
    }

    gl.useProgram(this.program);
    const at = this.locations;
    gl.uniform2f(at.uSize, canvas.width, canvas.height);
    gl.uniform1f(at.uRatio, ratio);
    gl.uniform1f(at.uMarker, options.style === "marker" ? 1 : 0);
    gl.uniform1f(at.uDark, dark ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
    if (grain && this.grainSource !== grain.tile) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        grain.tile,
      );
      this.grainSource = grain.tile;
    }
    gl.uniform1i(at.uGrain, 0);
    gl.uniform1f(at.uHasGrain, grain ? 1 : 0);
    gl.uniform1f(at.uTile, (grain?.size ?? 1) * ratio);
    // The canvas sits at `origin`; the grain is tiled from the page's corner.
    gl.uniform2f(at.uOffset, origin[0] * ratio, origin[1] * ratio);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STREAM_DRAW);
    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, bytes, 0);
    const { rect, colour, shape } = this.attributes;
    gl.enableVertexAttribArray(rect);
    gl.vertexAttribPointer(rect, 4, gl.FLOAT, false, bytes, 8);
    gl.enableVertexAttribArray(colour);
    gl.vertexAttribPointer(colour, 4, gl.FLOAT, false, bytes, 24);
    gl.enableVertexAttribArray(shape);
    gl.vertexAttribPointer(shape, 4, gl.FLOAT, false, bytes, 40);

    gl.enable(gl.BLEND);
    // Light paper: each stroke multiplies what is there, as layers of
    // pigment do. Dark paper: each adds its glow.
    if (dark) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.drawArrays(gl.TRIANGLES, 0, strokes.length * 6);
    gl.disable(gl.BLEND);
    gl.disableVertexAttribArray(rect);
    gl.disableVertexAttribArray(colour);
    gl.disableVertexAttribArray(shape);
    return canvas;
  }
}

let shared: PigmentRenderer | null | undefined;

/** The one pigment renderer, or null where WebGL is unavailable. */
export function pigmentRenderer(): PigmentRenderer | null {
  if (shared !== undefined) return shared;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", {
      alpha: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    shared = gl ? new PigmentRenderer(gl) : null;
    canvas.addEventListener("webglcontextlost", () => {
      shared = undefined;
    });
  } catch {
    shared = null;
  }
  return shared;
}
