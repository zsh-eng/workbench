import type { CurlFold } from "./curl-geometry";

/**
 * Draws the curled part of a turning page with WebGL, over the live pages.
 *
 * Only the part past the crease is drawn here; the flat part stays live DOM,
 * clipped at the crease, so text before the fold is the real text. Two
 * passes share one canvas:
 *
 * 1. Shadows, as a full-stage quad: a soft shadow the curl casts on the page
 *    beneath, and the drop shadow the flipped-over part casts on the page's
 *    own front. Both are solved analytically from the fold.
 * 2. The page, as a grid mesh bent in the vertex shader. Its front shows the
 *    page raster; its back shows paper with the front's ink faintly through
 *    it, blurred and mirrored as it would be through thin paper. A soft
 *    highlight runs along the fold.
 */

export interface CurlLook {
  /** The page colour, 0–1 sRGB. */
  paper: [number, number, number];
  dark: boolean;
  /** How strongly the front's ink shows through the back, 0–1. */
  showThrough: number;
}

const MESH_COLUMNS = 44;

const MESH_VERTEX = `
attribute vec2 aUv;
uniform vec2 uSize;
uniform vec2 uOrigin;
uniform vec2 uNormal;
uniform float uRadius;
uniform float uCamera;
varying vec2 vUv;
varying float vDepth;
const float PI = 3.14159265;
void main() {
  vec2 q = aUv * uSize;
  float d = dot(q - uOrigin, uNormal);
  vec3 p;
  if (d <= 0.0) {
    p = vec3(q, 0.0);
  } else if (d < PI * uRadius) {
    float phi = d / uRadius;
    p = vec3(q - uNormal * d + uNormal * uRadius * sin(phi), uRadius * (1.0 - cos(phi)));
  } else {
    p = vec3(q - uNormal * (2.0 * d - PI * uRadius), 2.0 * uRadius);
  }
  vec2 centre = uSize * 0.5;
  vec2 screen = centre + (p.xy - centre) * (uCamera / (uCamera - p.z));
  gl_Position = vec4(
    screen.x / uSize.x * 2.0 - 1.0,
    1.0 - screen.y / uSize.y * 2.0,
    -p.z / (uSize.x * 4.0),
    1.0
  );
  vUv = aUv;
  vDepth = d;
}
`;

const MESH_FRAGMENT = `
precision highp float;
uniform sampler2D uPage;
uniform vec2 uNormal;
uniform float uRadius;
uniform vec3 uPaper;
uniform float uShowThrough;
uniform float uDark;
uniform vec2 uTexel;
varying vec2 vUv;
varying float vDepth;
const float PI = 3.14159265;
const vec3 LIGHT = vec3(0.0, -0.24, 0.97);
void main() {
  if (vDepth < -0.5) discard;
  float phi = clamp(vDepth / uRadius, 0.0, PI);
  vec3 front = vec3(-uNormal * sin(phi), cos(phi));
  bool back = vDepth > uRadius * PI * 0.5;
  vec3 normal = back ? -front : front;
  float ambient = 0.36;
  float lit = (ambient + (1.0 - ambient) * max(dot(normal, LIGHT), 0.0))
    / (ambient + (1.0 - ambient) * LIGHT.z);
  vec3 colour;
  if (!back) {
    colour = texture2D(uPage, vUv).rgb * lit;
  } else {
    // Ink seen through the sheet spreads in its fibres: a small blur.
    vec2 spread = uTexel * 3.6;
    vec3 ink = texture2D(uPage, vUv).rgb * 0.36
      + texture2D(uPage, vUv + vec2(spread.x, spread.y)).rgb * 0.16
      + texture2D(uPage, vUv + vec2(-spread.x, spread.y)).rgb * 0.16
      + texture2D(uPage, vUv + vec2(spread.x, -spread.y)).rgb * 0.16
      + texture2D(uPage, vUv + vec2(-spread.x, -spread.y)).rgb * 0.16;
    vec3 sheet = mix(uPaper, ink, uShowThrough);
    // The back of the sheet reads a touch apart from the page beneath.
    sheet = mix(sheet * 0.965, sheet + 0.035, uDark);
    colour = sheet * lit;
    float curve = 1.0 - smoothstep(PI * 0.82, PI * 0.98, phi);
    float shine = pow(max(normal.z, 0.0), 9.0) * curve;
    float rim = pow(1.0 - max(normal.z, 0.0), 2.0) * curve;
    colour += shine * mix(0.13, 0.07, uDark) + rim * uDark * 0.06;
  }
  gl_FragColor = vec4(colour, 1.0);
}
`;

const SHADOW_VERTEX = `
attribute vec2 aUv;
uniform vec2 uSize;
varying vec2 vPos;
void main() {
  vPos = aUv * uSize;
  gl_Position = vec4(aUv.x * 2.0 - 1.0, 1.0 - aUv.y * 2.0, 0.0, 1.0);
}
`;

const SHADOW_FRAGMENT = `
precision highp float;
uniform vec2 uSize;
uniform vec2 uOrigin;
uniform vec2 uNormal;
uniform float uRadius;
uniform float uStrength;
varying vec2 vPos;
const float PI = 3.14159265;
float outside(vec2 p) {
  vec2 d = abs(p - uSize * 0.5) - uSize * 0.5;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  float d = dot(vPos - uOrigin, uNormal);
  float alpha;
  if (d > 0.0) {
    // The page beneath, in the shadow of the lifted curl. The curl spans
    // the crease only where the page has paper, so the shadow does too.
    float past = max(d - uRadius * 0.8, 0.0);
    float core = exp(-past / (uRadius * 0.45 + 3.0));
    float soft = exp(-past / (uRadius * 2.2 + 18.0));
    vec2 onCrease = vPos - uNormal * d;
    float reach = 1.0 - smoothstep(0.0, uRadius + 10.0, outside(onCrease));
    alpha = uStrength * (0.42 * core + 0.2 * soft) * reach;
  } else {
    // The page's own front, under the edge of its flipped-over part, which
    // hovers a little above it and lets light under its edge.
    // Light from above drops the shadow a little below its edge.
    float lift = 2.0 * uRadius;
    vec2 p = vPos - vec2(0.0, lift * 0.12);
    float pd = dot(p - uOrigin, uNormal);
    vec2 source = p + uNormal * (PI * uRadius - 2.0 * pd);
    float gap = outside(source);
    alpha = uStrength * 0.3 * (1.0 - smoothstep(0.0, lift * 0.5 + 6.0, gap));
  }
  gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
}
`;

export function compile(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Shader did not compile");
  }
  return shader;
}

export function link(
  gl: WebGLRenderingContext,
  vertex: string,
  fragment: string,
): WebGLProgram {
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertex));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragment));
  gl.bindAttribLocation(program, 0, "aUv");
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program did not link");
  }
  return program;
}

export function uniforms<Name extends string>(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  names: readonly Name[],
): Record<Name, WebGLUniformLocation | null> {
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<Name, WebGLUniformLocation | null>;
}

const MESH_UNIFORMS = [
  "uSize",
  "uOrigin",
  "uNormal",
  "uRadius",
  "uCamera",
  "uPage",
  "uPaper",
  "uShowThrough",
  "uDark",
  "uTexel",
] as const;
const SHADOW_UNIFORMS = [
  "uSize",
  "uOrigin",
  "uNormal",
  "uRadius",
  "uStrength",
] as const;

interface PageTexture {
  texture: WebGLTexture;
  width: number;
  height: number;
}

/** Keeps textures for the pages a turn can need: this one, and either side. */
const MAX_TEXTURES = 3;

export class CurlRenderer {
  private readonly gl: WebGLRenderingContext;
  private readonly mesh: WebGLProgram;
  private readonly shadow: WebGLProgram;
  private readonly meshUniforms: Record<
    (typeof MESH_UNIFORMS)[number],
    WebGLUniformLocation | null
  >;
  private readonly shadowUniforms: Record<
    (typeof SHADOW_UNIFORMS)[number],
    WebGLUniformLocation | null
  >;
  private readonly gridBuffer: WebGLBuffer;
  private readonly quadBuffer: WebGLBuffer;
  private readonly indexBuffer: WebGLBuffer;
  private indexCount = 0;
  private gridRows = 0;
  private width = 0;
  private height = 0;
  private readonly textures = new Map<string, PageTexture>();
  private cleared = true;

  /** Returns null where WebGL is unavailable; the slide stays in use. */
  static create(canvas: HTMLCanvasElement): CurlRenderer | null {
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
      return new CurlRenderer(gl);
    } catch {
      return null;
    }
  }

  private constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    this.mesh = link(gl, MESH_VERTEX, MESH_FRAGMENT);
    this.shadow = link(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);
    this.meshUniforms = uniforms(gl, this.mesh, MESH_UNIFORMS);
    this.shadowUniforms = uniforms(gl, this.shadow, SHADOW_UNIFORMS);
    this.gridBuffer = gl.createBuffer()!;
    this.indexBuffer = gl.createBuffer()!;
    this.quadBuffer = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
  }

  get isLost(): boolean {
    return this.gl.isContextLost();
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
      Math.round((MESH_COLUMNS * height) / Math.max(1, width)),
    );
    if (rows === this.gridRows) return;
    this.gridRows = rows;
    this.buildGrid(MESH_COLUMNS, rows);
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
    else {
      entry = { texture: gl.createTexture()!, width: 0, height: 0 };
    }
    gl.bindTexture(gl.TEXTURE_2D, entry.texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
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

  clear(): void {
    if (this.cleared) return;
    const { gl } = this;
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    this.cleared = true;
  }

  draw(key: string, fold: CurlFold, look: CurlLook): boolean {
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

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.shadow);
    gl.uniform2f(this.shadowUniforms.uSize, this.width, this.height);
    gl.uniform2f(this.shadowUniforms.uOrigin, fold.originX, fold.originY);
    gl.uniform2f(this.shadowUniforms.uNormal, fold.normalX, fold.normalY);
    gl.uniform1f(this.shadowUniforms.uRadius, fold.radius);
    gl.uniform1f(this.shadowUniforms.uStrength, look.dark ? 0.9 : 0.62);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.disable(gl.BLEND);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.useProgram(this.mesh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, page.texture);
    gl.uniform1i(this.meshUniforms.uPage, 0);
    gl.uniform2f(this.meshUniforms.uSize, this.width, this.height);
    gl.uniform2f(this.meshUniforms.uOrigin, fold.originX, fold.originY);
    gl.uniform2f(this.meshUniforms.uNormal, fold.normalX, fold.normalY);
    gl.uniform1f(this.meshUniforms.uRadius, fold.radius);
    gl.uniform1f(
      this.meshUniforms.uCamera,
      Math.max(this.width, this.height) * 3,
    );
    gl.uniform3f(this.meshUniforms.uPaper, ...look.paper);
    gl.uniform1f(this.meshUniforms.uShowThrough, look.showThrough);
    gl.uniform1f(this.meshUniforms.uDark, look.dark ? 1 : 0);
    gl.uniform2f(this.meshUniforms.uTexel, 1 / page.width, 1 / page.height);
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
    gl.deleteBuffer(this.gridBuffer);
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.indexBuffer);
    gl.deleteProgram(this.mesh);
    gl.deleteProgram(this.shadow);
    // A canvas still on the page (React's second mount in development, or
    // the curl chosen again) keeps its context for the next renderer, which
    // could not start on a lost one. One that has gone gives it up now.
    const { canvas } = gl;
    if (canvas instanceof HTMLCanvasElement && canvas.isConnected) return;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
