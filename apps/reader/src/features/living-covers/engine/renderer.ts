import type { CoverScene } from "../scene";
import {
  COVER_FRAGMENT,
  COVER_VERTEX,
  SHADOW_FRAGMENT,
  SHADOW_VERTEX,
  SIDE_FRAGMENT,
  SIDE_VERTEX,
} from "./shaders";

/**
 * One WebGL2 context that draws one book at a time. The engine moves a few
 * of these between the covers on screen, so shaders compile once per
 * context, not once per cover.
 */

type Vec3 = [number, number, number];
type Mat4 = Float32Array;

export interface BookTextures {
  cover: TexImageSource;
  depth: TexImageSource | null;
  materials: TexImageSource | null;
  life: TexImageSource | null;
}

export interface FrameParams {
  /** Canvas size in CSS pixels; the book sits at its centre. */
  canvas: { width: number; height: number; pixelRatio: number };
  /** The cover's size on the page, in CSS pixels. */
  book: { width: number; height: number; thickness: number; pages: number };
  /** The part of the cover image that fills the face: x, y, width, height. */
  crop: [number, number, number, number];
  /** Eye and light in world space: the book's centre is the origin, y up. */
  eye: Vec3;
  light: Vec3;
  yaw: number;
  pitch: number;
  time: number;
  steps: number;
  shadowSteps: number;
  /** 0 to 1: how much of the book's shadow to draw. */
  shadow: number;
  /** 0: lit, 1: depth map, 2: material and life masks. */
  view: number;
  scene: CoverScene;
}

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row]! * b[col * 4 + k]!;
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function translation(x: number, y: number, z: number): Mat4 {
  // prettier-ignore
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
}

function rotationY(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // prettier-ignore
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotationX(angle: number): Mat4 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  // prettier-ignore
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function frustum(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 {
  const out = new Float32Array(16);
  out[0] = (2 * near) / (right - left);
  out[5] = (2 * near) / (top - bottom);
  out[8] = (right + left) / (right - left);
  out[9] = (top + bottom) / (top - bottom);
  out[10] = -(far + near) / (far - near);
  out[11] = -1;
  out[14] = (-2 * far * near) / (far - near);
  return out;
}

function transformDirection(m: Mat4, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[4]! * v[1] + m[8]! * v[2],
    m[1]! * v[0] + m[5]! * v[1] + m[9]! * v[2],
    m[2]! * v[0] + m[6]! * v[1] + m[10]! * v[2],
  ];
}

function compile(gl: WebGL2RenderingContext, vertex: string, fragment: string) {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? "Shader did not compile");
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Program did not link");
  }
  const uniforms = new Map<string, WebGLUniformLocation | null>();
  return {
    program,
    uniform(name: string) {
      if (!uniforms.has(name))
        uniforms.set(name, gl.getUniformLocation(program, name));
      return uniforms.get(name)!;
    },
  };
}

type Program = ReturnType<typeof compile>;

export class BookRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private cover: Program;
  private side: Program;
  private shadow: Program;
  private quad: WebGLVertexArrayObject;
  private shadowQuad: WebGLVertexArrayObject;
  private sides: WebGLVertexArrayObject;
  private sideBuffer: WebGLBuffer;
  private sideKey = "";
  private textures: Record<keyof BookTextures, WebGLTexture>;
  private fallback: { depth: WebGLTexture; black: WebGLTexture };
  private has = { depth: false, materials: false, life: false };
  lost = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      depth: false,
      stencil: false,
      powerPreference: "low-power",
    });
    if (!gl) throw new Error("WebGL2 is not available");
    this.gl = gl;
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.lost = true;
    });
    this.cover = compile(gl, COVER_VERTEX, COVER_FRAGMENT);
    this.side = compile(gl, SIDE_VERTEX, SIDE_FRAGMENT);
    this.shadow = compile(gl, SHADOW_VERTEX, SHADOW_FRAGMENT);

    const quadData = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
    this.quad = this.vertexArray(this.cover.program, quadData);
    this.shadowQuad = this.vertexArray(this.shadow.program, quadData);
    this.sides = gl.createVertexArray()!;
    this.sideBuffer = gl.createBuffer()!;

    this.textures = {
      cover: gl.createTexture()!,
      depth: gl.createTexture()!,
      materials: gl.createTexture()!,
      life: gl.createTexture()!,
    };
    this.fallback = {
      // Surface height everywhere, flat relief.
      depth: this.solidTexture([255, 128, 255, 255]),
      black: this.solidTexture([0, 0, 0, 255]),
    };
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private vertexArray(program: WebGLProgram, data: Float32Array) {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    const location = gl.getAttribLocation(program, "aPos");
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    return vao;
  }

  private solidTexture(rgba: number[]): WebGLTexture {
    const gl = this.gl;
    const texture = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array(rgba),
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    return texture;
  }

  /** Upload one book's images. Data maps skip colour management. */
  setTextures(images: BookTextures): void {
    const gl = this.gl;
    const upload = (
      texture: WebGLTexture,
      image: TexImageSource,
      color: boolean,
      mipmaps: boolean,
    ) => {
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.pixelStorei(
        gl.UNPACK_COLORSPACE_CONVERSION_WEBGL,
        color ? gl.BROWSER_DEFAULT_WEBGL : gl.NONE,
      );
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      if (mipmaps) {
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(
          gl.TEXTURE_2D,
          gl.TEXTURE_MIN_FILTER,
          gl.LINEAR_MIPMAP_LINEAR,
        );
      } else {
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      }
    };
    upload(this.textures.cover, images.cover, true, true);
    this.has = {
      depth: images.depth !== null,
      materials: images.materials !== null,
      life: images.life !== null,
    };
    if (images.depth) upload(this.textures.depth, images.depth, false, false);
    if (images.materials)
      upload(this.textures.materials, images.materials, false, true);
    if (images.life) upload(this.textures.life, images.life, false, false);
  }

  private bindTexture(unit: number, texture: WebGLTexture) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  }

  /** The page block and spine, rebuilt when the book's size changes. */
  private buildSides(width: number, height: number, thickness: number) {
    const key = `${width}:${height}:${thickness}`;
    if (key === this.sideKey) return;
    this.sideKey = key;
    const gl = this.gl;
    const x = width / 2;
    const y = height / 2;
    const t = thickness;
    // Each vertex: position, normal, face (kind, across, along).
    // prettier-ignore
    const faces = [
      // Spine, at the left.
      [[-x, y, 0], [-x, y, -t], [-x, -y, 0], [-x, -y, -t], [-1, 0, 0], 0],
      // Fore-edge, at the right.
      [[x, y, 0], [x, y, -t], [x, -y, 0], [x, -y, -t], [1, 0, 0], 1],
      // Head, at the top.
      [[-x, y, 0], [-x, y, -t], [x, y, 0], [x, y, -t], [0, 1, 0], 1],
      // Tail, at the bottom.
      [[-x, -y, 0], [-x, -y, -t], [x, -y, 0], [x, -y, -t], [0, -1, 0], 1],
    ] as const;
    const data: number[] = [];
    for (const [a, b, c, d, normal, kind] of faces) {
      const corners = [
        [a, 0, 0],
        [b, 1, 0],
        [c, 0, 1],
        [b, 1, 0],
        [d, 1, 1],
        [c, 0, 1],
      ] as const;
      for (const [position, across, along] of corners) {
        data.push(...position, ...normal, kind, across, along);
      }
    }
    gl.bindVertexArray(this.sides);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.sideBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    const stride = 9 * 4;
    const attributes = [
      ["aPos", 0],
      ["aNormal", 3],
      ["aFace", 6],
    ] as const;
    for (const [name, offset] of attributes) {
      const location = gl.getAttribLocation(this.side.program, name);
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, 3, gl.FLOAT, false, stride, offset * 4);
    }
    gl.bindVertexArray(null);
  }

  draw(frame: FrameParams): void {
    if (this.lost) return;
    const gl = this.gl;
    const { canvas, book, scene } = frame;
    const width = Math.round(canvas.width * canvas.pixelRatio);
    const height = Math.round(canvas.height * canvas.pixelRatio);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // An off-axis frustum through the canvas: the plane z = 0 maps to itself.
    const [ex, ey, ez] = frame.eye;
    const near = ez * 0.25;
    const scale = near / ez;
    const projection = frustum(
      (-canvas.width / 2 - ex) * scale,
      (canvas.width / 2 - ex) * scale,
      (-canvas.height / 2 - ey) * scale,
      (canvas.height / 2 - ey) * scale,
      near,
      ez + 4000,
    );
    const viewProj = multiply(projection, translation(-ex, -ey, -ez));
    const pivot = -book.thickness / 2;
    const model = multiply(
      translation(0, 0, pivot),
      multiply(
        rotationY(frame.yaw),
        multiply(rotationX(frame.pitch), translation(0, 0, -pivot)),
      ),
    );

    // Shadow first, then the sides, then the face over them.
    if (frame.shadow > 0) {
      gl.useProgram(this.shadow.program);
      gl.uniformMatrix4fv(this.shadow.uniform("uModel"), false, model);
      gl.uniformMatrix4fv(this.shadow.uniform("uViewProj"), false, viewProj);
      gl.uniform2f(this.shadow.uniform("uSize"), book.width, book.height);
      const spread = book.width * 0.12;
      gl.uniform1f(this.shadow.uniform("uSpread"), spread);
      gl.uniform1f(this.shadow.uniform("uDepthZ"), -book.thickness - 0.5);
      // The wide shadow falls away from the light.
      const [lx, ly, lz] = frame.light;
      const reach = (book.thickness + book.width * 0.05) / Math.max(lz, 1);
      gl.uniform4f(
        this.shadow.uniform("uShadow"),
        -lx * reach * 0.5,
        -book.width * 0.04 - ly * reach * 0.25,
        book.width * 0.07,
        frame.shadow,
      );
      gl.bindVertexArray(this.shadowQuad);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    if (book.thickness > 0.5) {
      this.buildSides(book.width, book.height, book.thickness);
      gl.useProgram(this.side.program);
      gl.uniformMatrix4fv(this.side.uniform("uModel"), false, model);
      gl.uniformMatrix4fv(this.side.uniform("uViewProj"), false, viewProj);
      gl.uniform3fv(this.side.uniform("uEye"), frame.eye);
      gl.uniform3fv(this.side.uniform("uLight"), frame.light);
      const edge = scene.object.edge ?? [0.94, 0.92, 0.87];
      gl.uniform3fv(this.side.uniform("uEdge"), edge);
      gl.uniform1f(this.side.uniform("uPages"), book.pages);
      gl.uniform1f(this.side.uniform("uThickness"), book.thickness);
      this.bindTexture(0, this.textures.cover);
      gl.uniform1i(this.side.uniform("uCover"), 0);
      gl.bindVertexArray(this.sides);
      gl.drawArrays(gl.TRIANGLES, 0, 24);
    }

    const p = this.cover;
    gl.useProgram(p.program);
    gl.uniformMatrix4fv(p.uniform("uModel"), false, model);
    gl.uniformMatrix4fv(p.uniform("uViewProj"), false, viewProj);
    gl.uniform2f(p.uniform("uSize"), book.width, book.height);
    gl.uniform4fv(p.uniform("uCrop"), frame.crop);
    gl.uniform3fv(p.uniform("uEye"), frame.eye);
    gl.uniform3fv(p.uniform("uLight"), frame.light);
    gl.uniform3fv(p.uniform("uT"), transformDirection(model, [1, 0, 0]));
    gl.uniform3fv(p.uniform("uB"), transformDirection(model, [0, -1, 0]));
    gl.uniform3fv(p.uniform("uN"), transformDirection(model, [0, 0, 1]));
    gl.uniform4f(
      p.uniform("uShape"),
      this.has.depth ? scene.parallax : 0,
      this.has.depth ? scene.relief : 0,
      scene.shading,
      1,
    );
    gl.uniform4f(
      p.uniform("uPaper"),
      scene.paper.gloss,
      scene.paper.roughness,
      scene.paper.grain,
      scene.paper.weave,
    );
    gl.uniform4f(
      p.uniform("uFoil"),
      scene.foil.roughness,
      scene.foil.iridescence,
      scene.foil.grain,
      scene.foil.strength,
    );
    gl.uniform4f(
      p.uniform("uMisc"),
      scene.glow.strength,
      this.has.materials ? 1 : 0,
      this.has.life ? 1 : 0,
      frame.time,
    );
    const { shimmer, mist, pulse, glints } = scene.life;
    gl.uniform4f(
      p.uniform("uLifeAmount"),
      shimmer?.amount ?? 0,
      mist?.opacity ?? 0,
      pulse?.amount ?? 0,
      0,
    );
    gl.uniform4f(
      p.uniform("uLifeSpeed"),
      shimmer?.speed ?? 1,
      mist?.speed ?? 1,
      pulse?.speed ?? 1,
      0,
    );
    gl.uniform3fv(p.uniform("uMistColor"), mist?.color ?? [1, 1, 1]);
    const shown = glints.slice(0, 8);
    gl.uniform1i(p.uniform("uGlintCount"), shown.length);
    if (shown.length > 0) {
      gl.uniform4fv(
        p.uniform("uGlints"),
        shown.flatMap((glint) => [glint.x, glint.y, glint.size, glint.phase]),
      );
      gl.uniform3fv(
        p.uniform("uGlintColors"),
        shown.flatMap((glint) => glint.color),
      );
    }
    gl.uniform4f(
      p.uniform("uQuality"),
      frame.steps,
      frame.shadowSteps,
      Math.min(3, book.width * 0.02),
      1,
    );
    gl.uniform1i(p.uniform("uView"), frame.view);
    const textures = [
      ["uCover", this.textures.cover],
      ["uDepth", this.has.depth ? this.textures.depth : this.fallback.depth],
      [
        "uMaterials",
        this.has.materials ? this.textures.materials : this.fallback.black,
      ],
      ["uLife", this.has.life ? this.textures.life : this.fallback.black],
    ] as const;
    textures.forEach(([name, texture], unit) => {
      this.bindTexture(unit, texture);
      gl.uniform1i(p.uniform(name), unit);
    });
    gl.bindVertexArray(this.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
