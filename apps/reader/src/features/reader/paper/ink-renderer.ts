import { link, uniforms } from "./curl-renderer";

/**
 * Ink drawn into the paper (Debug, the WebGL ink).
 *
 * The page's text is rastered alone, where the DOM laid it out, and this
 * pass lets it soak into the sheet: the ink wicks a little way along the
 * fibres, thins on the tooth it cannot fill, and lies a little unevenly, as
 * a sheet takes it. The grain is the page's own tile, so the fibres the ink
 * follows are the ones the paper shows. One small WebGL canvas serves every
 * page; each result is copied out at once.
 */

const VERTEX = `
attribute vec2 aUv;
varying vec2 vUv;
void main() {
  vUv = aUv;
  gl_Position = vec4(aUv.x * 2.0 - 1.0, 1.0 - aUv.y * 2.0, 0.0, 1.0);
}
`;

const FRAGMENT = `
precision highp float;
uniform sampler2D uInk;
uniform sampler2D uGrain;
uniform vec2 uSize;
uniform float uTile;
uniform float uReach;
uniform vec2 uToothOffset;
varying vec2 vUv;

float grain(vec2 px) {
  return texture2D(uGrain, fract(px / uTile)).a;
}

void main() {
  vec2 px = vUv * uSize;
  vec4 ink = texture2D(uInk, vUv);
  // The ink around, in eight taps: what may have wicked here.
  vec4 around = vec4(0.0);
  for (int tap = 0; tap < 8; tap++) {
    float angle = float(tap) * 0.785398;
    around += texture2D(uInk, vUv + vec2(cos(angle), sin(angle)) * uReach / uSize);
  }
  around /= 8.0;
  float fibre = grain(px);
  float tooth = grain(px + uToothOffset);
  float wicked = around.a * smoothstep(0.2, 0.7, fibre) * 0.45;
  float cover = max(ink.a, wicked);
  cover *= 1.0 - 0.24 * tooth;
  cover *= 0.94 + 0.06 * (1.0 - grain(px * 0.23 + 53.0));
  float weight = ink.a + around.a;
  vec3 colour = weight > 0.001 ? (ink.rgb + around.rgb) / weight : vec3(0.0);
  gl_FragColor = vec4(colour * cover, cover);
}
`;

const UNIFORMS = [
  "uInk",
  "uGrain",
  "uSize",
  "uTile",
  "uReach",
  "uToothOffset",
] as const;

/** Where App.css puts the tooth, in CSS px, so it does not sit on the grain. */
const TOOTH_OFFSET = [37, 91] as const;

class InkRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly program: WebGLProgram;
  private readonly locations: Record<
    (typeof UNIFORMS)[number],
    WebGLUniformLocation | null
  >;
  private readonly quad: WebGLBuffer;
  private readonly inkTexture: WebGLTexture;
  private readonly grainTexture: WebGLTexture;
  private grainSource: HTMLCanvasElement | null = null;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.program = link(gl, VERTEX, FRAGMENT);
    this.locations = uniforms(gl, this.program, UNIFORMS);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    this.inkTexture = texture(gl);
    this.grainTexture = texture(gl);
  }

  /**
   * Soaks `ink` (text alone, on a clear canvas) into the grain `tile` (its
   * alpha, at the raster's scale). Returns the GL canvas, to copy out now.
   */
  render(
    ink: HTMLCanvasElement,
    tile: HTMLCanvasElement,
    pixelRatio: number,
  ): HTMLCanvasElement | null {
    const { gl } = this;
    const canvas = gl.canvas as HTMLCanvasElement;
    if (gl.isContextLost()) return null;
    canvas.width = ink.width;
    canvas.height = ink.height;
    gl.viewport(0, 0, ink.width, ink.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.inkTexture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, ink);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.grainTexture);
    if (this.grainSource !== tile) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tile);
      this.grainSource = tile;
    }
    gl.useProgram(this.program);
    const at = this.locations;
    gl.uniform1i(at.uInk, 0);
    gl.uniform1i(at.uGrain, 1);
    gl.uniform2f(at.uSize, ink.width, ink.height);
    gl.uniform1f(at.uTile, tile.width);
    gl.uniform1f(at.uReach, 0.55 * pixelRatio);
    gl.uniform2f(
      at.uToothOffset,
      TOOTH_OFFSET[0] * pixelRatio,
      TOOTH_OFFSET[1] * pixelRatio,
    );
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return canvas;
  }
}

function texture(gl: WebGLRenderingContext): WebGLTexture {
  const created = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, created);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return created;
}

let shared: InkRenderer | null | undefined;

/** The one ink renderer, or null where WebGL is unavailable. */
export function inkRenderer(): InkRenderer | null {
  if (shared !== undefined) return shared;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl", {
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
      antialias: false,
    });
    shared = gl ? new InkRenderer(gl) : null;
    canvas.addEventListener("webglcontextlost", () => {
      shared = undefined;
    });
  } catch {
    shared = null;
  }
  return shared;
}
