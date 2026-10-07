/**
 * The welcome's backdrop: a page of code lines on a plane that recedes from the
 * viewer, drawn by one fragment shader. As in Med's icon, most lines are quiet
 * and a few changed ones carry the accent and a gutter mark. The lines drift
 * slowly, focus falls where the setup card is, and each added source sends a
 * wave across the page.
 */

export interface FieldColors {
  canvas: string;
  text: string;
  accent: string;
  green: string;
  dark: boolean;
}

export interface Field {
  setColors(colors: FieldColors): void;
  /** Sends a wave out from under the card; strength 1 is one added source. */
  pulse(strength?: number): void;
  dispose(): void;
}

const VERTEX = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

const FRAGMENT = `#version 300 es
precision highp float;
uniform vec2 uRes;
uniform float uTime;
uniform float uIntro;
uniform vec2 uPointer;
uniform vec3 uBg;
uniform vec3 uInk;
uniform vec3 uAccent;
uniform vec3 uGreen;
uniform float uDark;
uniform vec4 uPulse;
uniform vec4 uPower;
out vec4 outColor;

const float HEIGHT = 2.2;
const float FOCAL = 1.45;
const float ROW = 0.36;
const float PAGE = 5.4;
// The screen point under the setup card, in the units of uv below.
const vec2 CARD = vec2(0.0, -0.06);

float hash(vec2 p) {
  p = fract(p * vec2(234.34, 435.345));
  p += dot(p, p + 34.23);
  return fract(p.x * p.y);
}

vec3 ray(vec2 uv, float pitch, float yaw) {
  vec3 d = normalize(vec3(uv, -FOCAL));
  float c = cos(pitch), s = sin(pitch);
  d = vec3(d.x, d.y * c + d.z * s, d.z * c - d.y * s);
  float cy = cos(yaw), sy = sin(yaw);
  return vec3(d.x * cy - d.z * sy, d.y, d.x * sy + d.z * cy);
}

void main() {
  vec2 uv = (gl_FragCoord.xy - 0.5 * uRes) / uRes.y;
  float pitch = mix(0.66, 0.31, uIntro) + uPointer.y * 0.012;
  float yaw = uPointer.x * 0.035;
  vec3 d = ray(uv, pitch, yaw);
  float below = smoothstep(0.0, 0.02, -d.y);
  float t = HEIGHT / max(-d.y, 1e-4);
  vec2 q = vec2(d.x, -d.z) * t;

  vec3 dc = ray(CARD, pitch, yaw);
  float focusT = HEIGHT / max(-dc.y, 1e-4);
  vec2 center = vec2(dc.x, -dc.z) * focusT;

  // Rows scroll away slowly; pages sit side by side with a gutter at the left.
  float v = q.y + uTime * 0.14;
  float row = floor(v / ROW);
  float fy = (fract(v / ROW) - 0.5) * ROW;
  float page = floor(q.x / PAGE + 0.5);
  float fx = q.x - page * PAGE + PAGE * 0.5;

  // Blocks of five rows read like paragraphs of code: a shared indent, a
  // blank line now and then, and sometimes a short hunk of changed lines.
  float block = floor(row / 5.0);
  float inBlock = row - block * 5.0;
  float hb = hash(vec2(block, page));
  float hr = hash(vec2(row, page + 17.0));
  float hl = hash(vec2(row + 41.0, page - 3.0));
  float blank = step(hr, 0.13);
  float changed = step(hb, 0.2) * step(inBlock, floor(hash(vec2(block, page + 5.0)) * 3.0));
  changed *= 1.0 - blank;
  float indent = floor(hb * 3.0) * 0.48 + step(0.62, hl) * 0.48;
  float x0 = 1.05 + indent;
  float x1 = min(x0 + 0.6 + pow(hash(vec2(row, page + 9.0)), 1.2) * 3.4, PAGE - 0.35);
  float dLine = length(vec2(fx - clamp(fx, x0, x1), fy)) - 0.065;
  float dMark = length(vec2(fx - 0.55, max(abs(fy) - ROW * 0.2, 0.0))) - 0.05;

  // Anti-aliasing from the pixel footprint, depth of field around the card,
  // and a plain average where rows are closer together than a few pixels.
  vec2 fw = fwidth(q);
  float soft = max(fw.x, fw.y) * 0.8 + abs(t - focusT) * 0.011;
  float line = (1.0 - blank) * (1.0 - smoothstep(-soft, soft, dLine));
  float mark = changed * (1.0 - smoothstep(-soft, soft, dMark));
  float lod = 1.0 - smoothstep(2.0, 5.0, ROW / max(fw.y, 1e-5));
  line = mix(line, 0.2, lod);
  mark *= 1.0 - lod;

  float wave = 0.0;
  float dist = length(q - center);
  for (int i = 0; i < 4; i++) {
    float age = uTime - uPulse[i];
    if (uPulse[i] < 0.0 || age < 0.0 || age > 4.5) continue;
    float width = 0.7 + age * 0.6;
    float ring = exp(-pow((dist - age * 5.0) / width, 2.0));
    wave = max(wave, ring * (1.0 - age / 4.5) * uPower[i]);
  }
  wave = min(wave, 1.0);

  vec2 k = (uv - CARD) * vec2(0.85, 1.5);
  float spot = exp(-dot(k, k) * 2.2);
  float fog = exp(-t * 0.055);
  float reveal = 1.0 - smoothstep(uIntro * 80.0 - 10.0, uIntro * 80.0, t);
  // Lines close to the viewer fade, so the page gathers around the card.
  float near = smoothstep(2.6, 6.5, t);
  float vis = below * fog * reveal * (0.4 + 0.6 * spot) * mix(0.3, 1.0, near);

  vec3 lineColor = mix(mix(uInk, uAccent, changed), uGreen, wave);
  float lineAlpha = mix(mix(0.12, 0.17, uDark), mix(0.6, 0.8, uDark), max(changed, wave));

  vec3 color = uBg;
  // A low haze at the horizon and a soft pool of light under the card.
  color = mix(color, uAccent, exp(-abs(d.y) * 12.0) * mix(0.04, 0.07, uDark));
  color = mix(color, uAccent, spot * below * mix(0.04, 0.09, uDark));
  float glow = changed * exp(-max(dLine, 0.0) / (0.09 + soft));
  color = mix(color, mix(uAccent, uGreen, wave), (glow * 0.16 + wave * 0.05) * vis);
  color = mix(color, lineColor, line * lineAlpha * vis);
  color = mix(color, uAccent, mark * mix(0.65, 0.85, uDark) * vis);
  // Dither so the soft gradients do not band.
  color += (hash(gl_FragCoord.xy + fract(uTime) * 61.0) - 0.5) / 255.0;
  outColor = vec4(color, 1.0);
}`;

function rgb(color: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(color.trim())?.[1];
  if (hex) {
    const value = parseInt(hex, 16);
    return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
  }
  // Other CSS colors go through a canvas, which reports them as hex.
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return [0.5, 0.5, 0.5];
  context.fillStyle = color;
  const normalized = String(context.fillStyle);
  return normalized.startsWith("#") ? rgb(normalized) : [0.5, 0.5, 0.5];
}

function compile(gl: WebGL2RenderingContext, type: number, source: string) {
  const shader = gl.createShader(type)!;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw new Error(gl.getShaderInfoLog(shader) ?? "The welcome shader did not compile.");
  return shader;
}

const INTRO_MS = 2600;

/** Starts the backdrop on a canvas. Throws when WebGL 2 is not available; the
 * page's CSS background then stays. With `still`, it draws one settled frame. */
export function createField(
  canvas: HTMLCanvasElement,
  colors: FieldColors,
  { still = false }: { still?: boolean } = {},
): Field {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
  });
  if (!gl) throw new Error("WebGL 2 is not available.");
  const program = gl.createProgram()!;
  gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program) ?? "The welcome shader did not link.");
  gl.useProgram(program);

  // One triangle that covers the screen.
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const uniform = (name: string) => gl.getUniformLocation(program, name);
  const u = {
    res: uniform("uRes"),
    time: uniform("uTime"),
    intro: uniform("uIntro"),
    pointer: uniform("uPointer"),
    bg: uniform("uBg"),
    ink: uniform("uInk"),
    accent: uniform("uAccent"),
    green: uniform("uGreen"),
    dark: uniform("uDark"),
    pulse: uniform("uPulse"),
    power: uniform("uPower"),
  };

  const applyColors = (next: FieldColors) => {
    gl.uniform3fv(u.bg, rgb(next.canvas));
    gl.uniform3fv(u.ink, rgb(next.text));
    gl.uniform3fv(u.accent, rgb(next.accent));
    gl.uniform3fv(u.green, rgb(next.green));
    gl.uniform1f(u.dark, next.dark ? 1 : 0);
  };
  applyColors(colors);

  const pulses = [-1, -1, -1, -1];
  const powers = [0, 0, 0, 0];
  let nextPulse = 0;
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const start = performance.now();
  let last = start;
  let frame = 0;
  let disposed = false;

  const resize = () => {
    // Two device pixels per CSS pixel keep lines in focus crisp on Retina screens.
    const scale = Math.min(devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.round(canvas.clientWidth * scale));
    const height = Math.max(1, Math.round(canvas.clientHeight * scale));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    gl.viewport(0, 0, width, height);
    gl.uniform2f(u.res, width, height);
  };

  const draw = (now: number) => {
    const elapsed = still ? INTRO_MS : now - start;
    const progress = Math.min(elapsed / INTRO_MS, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    const follow = 1 - Math.exp(-dt * 2.5);
    pointer.x += (pointer.tx - pointer.x) * follow;
    pointer.y += (pointer.ty - pointer.y) * follow;
    gl.uniform1f(u.time, still ? 0 : elapsed / 1000);
    gl.uniform1f(u.intro, ease);
    gl.uniform2f(u.pointer, pointer.x, pointer.y);
    gl.uniform4fv(u.pulse, pulses);
    gl.uniform4fv(u.power, powers);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const loop = (now: number) => {
    if (disposed) return;
    draw(now);
    frame = document.hidden ? 0 : requestAnimationFrame(loop);
  };
  const wake = () => {
    if (!disposed && !document.hidden && !frame && !still) {
      last = performance.now();
      frame = requestAnimationFrame(loop);
    }
  };
  const redraw = () => {
    if (still) draw(performance.now());
  };
  const onPointer = (event: PointerEvent) => {
    pointer.tx = (event.clientX / innerWidth) * 2 - 1;
    pointer.ty = -((event.clientY / innerHeight) * 2 - 1);
  };
  const observer = new ResizeObserver(() => {
    resize();
    redraw();
  });
  observer.observe(canvas);
  resize();
  if (still) redraw();
  else {
    addEventListener("pointermove", onPointer);
    document.addEventListener("visibilitychange", wake);
    wake();
  }
  canvas.dataset.field = "on";

  return {
    setColors(next) {
      applyColors(next);
      redraw();
    },
    pulse(strength = 1) {
      if (still) return;
      pulses[nextPulse] = (performance.now() - start) / 1000;
      powers[nextPulse] = strength;
      nextPulse = (nextPulse + 1) % pulses.length;
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", wake);
      delete canvas.dataset.field;
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}
