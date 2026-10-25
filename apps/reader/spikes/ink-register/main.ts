/**
 * Ink-register spike for the page-turn study.
 *
 * Question: if the Reader draws its own ink into a WebGL paper (option B in
 * the study) from the pagination engine's layout, and keeps the real DOM text
 * on top but transparent for selection and VoiceOver, does the drawn ink land
 * on the same device pixels as the DOM glyphs would?
 *
 * The page shows one justified paragraph twice, one copy under the other at
 * an integer CSS-pixel offset:
 *   A. DOM text, built the way PageSliceView builds a manual-justify slice.
 *   B. The same DOM, transparent, over a WebGL canvas. The canvas ink comes
 *      from fillText into a coverage texture at device resolution.
 * `measure.ts` screenshots the page and compares B with A word by word.
 *
 * URL parameters:
 *   font=lora|iowan       Lora is bundled; Iowan is an Apple system font.
 *   size=18               CSS px; the line height is round(size × 1.5).
 *   x=engine|dom          engine: positions from the engine's own widths and
 *                         a half-leading baseline. dom: positions read back
 *                         from the invisible DOM (word ranges, baseline probe).
 *   baseline=float|round  engine only: font ascent/descent exact or rounded.
 *   control=1             copy B shows DOM text too; measures the method.
 *   emboss=1              letterpress shading (visual only, not for measuring).
 *   sel=1                 select two lines of copy B.
 *   perf=1                time a full-screen coverage draw and upload.
 */
import "@fontsource/lora/400.css";
import { layoutTextLines } from "../../src/lib/pagination-v2/shared/layout-text-lines";
import {
  measureCollapsedSpaceWidth,
  measureTextWidth,
} from "../../src/lib/pagination-v2/shared/measure";
import { prepareBlocks } from "../../src/lib/pagination-v2/shared/prepare-blocks";
import type {
  PageFragment,
  PageLine,
  PreparedTextBlock,
} from "../../src/lib/pagination-v2/shared/types";

// Alice's Adventures in Wonderland, chapter I (public domain).
const TEXT =
  "Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do: once or twice she had peeped into the book her sister was reading, but it had no pictures or conversations in it, “and what is the use of a book,” thought Alice “without pictures or conversations?”";

const STACKS: Record<string, string> = {
  lora: '"Lora", Georgia, serif',
  iowan: '"Iowan Old Style", "Palatino Linotype", serif',
};
const PAPER = [0xf6 / 255, 0xef / 255, 0xdf / 255];
const INK = [0x2a / 255, 0x26 / 255, 0x22 / 255];
const PAD = 12;
const COPY_GAP = 12;

const params = new URLSearchParams(location.search);
const fontId = params.get("font") ?? "lora";
const stack = STACKS[fontId] ?? STACKS.lora;
const sizePx = Number(params.get("size") ?? 18);
const lineHeight = Math.round(sizePx * 1.5);
const xSource = params.get("x") === "dom" ? "dom" : "engine";
const baselineMode = params.get("baseline") === "round" ? "round" : "float";
const control = params.get("control") === "1";
const emboss = params.get("emboss") === "1";
const dpr = window.devicePixelRatio || 1;

const statusEl = document.getElementById("status") as HTMLDivElement;
const copiesEl = document.getElementById("copies") as HTMLDivElement;

function parseFont(font: string) {
  const match =
    /^(?:(italic|normal)\s+)?(\d{3}|normal|bold)\s+(\d+(?:\.\d+)?)px\s+(.+)$/.exec(
      font.trim(),
    );
  if (!match) throw new Error(`Unexpected font: ${font}`);
  const [, style, weight, size, family] = match;
  return { style: style ?? "normal", weight, size: Number(size), family };
}

function applyFont(el: HTMLElement, font: string) {
  const parsed = parseFont(font);
  el.style.fontFamily = parsed.family;
  el.style.fontSize = `${parsed.size}px`;
  el.style.fontStyle = parsed.style;
  el.style.fontWeight = parsed.weight;
  el.style.lineHeight = "inherit";
}

/** Builds one text slice the way PageSliceView renders manual-justify lines. */
function buildPage(lines: PageLine[], textWidth: number, firstFont: string) {
  const page = document.createElement("p");
  page.className = "page";
  page.style.margin = "0";
  page.style.left = `${PAD}px`;
  page.style.top = `${PAD}px`;
  page.style.width = `${textWidth}px`;
  page.style.height = `${lines.length * lineHeight}px`;
  page.style.lineHeight = `${lineHeight}px`;
  page.style.textAlign = "left";
  applyFont(page, firstFont);
  page.style.lineHeight = `${lineHeight}px`;

  for (const line of lines) {
    const last = line.fragments[line.fragments.length - 1];
    const trailing = last?.kind === "space" ? last : null;
    const content = trailing ? line.fragments.slice(0, -1) : line.fragments;
    const span = document.createElement("span");
    span.style.whiteSpace = "nowrap";
    if (line.indentPx !== undefined)
      span.style.marginLeft = `${line.indentPx}px`;
    if (
      line.wordSpacingPx !== undefined &&
      Math.abs(line.wordSpacingPx) > 0.01
    ) {
      span.style.wordSpacing = `${line.wordSpacingPx}px`;
    }
    // A zero-size inline-block sits with its bottom edge on the baseline.
    const probe = document.createElement("span");
    probe.className = "probe";
    span.append(probe);
    for (const fragment of content) {
      const child = document.createElement("span");
      applyFont(child, fragment.font);
      if (
        fragment.marginRightPx !== undefined &&
        Math.abs(fragment.marginRightPx) > 0.01
      ) {
        child.style.marginRight = `${fragment.marginRightPx}px`;
      }
      child.dataset.kind = fragment.kind;
      child.textContent = fragment.text;
      span.append(child);
    }
    page.append(span);
    if (trailing) {
      const space = document.createElement("span");
      applyFont(space, trailing.font);
      space.textContent = trailing.text;
      page.append(space);
    }
  }
  return page;
}

function buildCopy(
  kind: "dom" | "ink",
  lines: PageLine[],
  width: number,
  height: number,
  textWidth: number,
  firstFont: string,
) {
  const copy = document.createElement("div");
  copy.className = `copy ${kind}`;
  copy.style.width = `${width}px`;
  copy.style.height = `${height}px`;
  const page = buildPage(lines, textWidth, firstFont);
  copy.append(page);
  for (const [left, top] of [
    [0, 0],
    [width - 6, height - 6],
  ]) {
    const marker = document.createElement("div");
    marker.className = "marker";
    marker.style.left = `${left}px`;
    marker.style.top = `${top}px`;
    marker.style.zIndex = "2";
    copy.append(marker);
  }
  return { copy, page };
}

type Glyphs = { text: string; font: string; x: number; y: number }[];

/**
 * Ink positions from the engine's own model: its word widths, and for a
 * justified line the space width it solved for (the line's free width shared
 * between its spaces). The baseline uses the CSS half-leading model.
 */
function engineGlyphs(
  lines: PageLine[],
  ctx: CanvasRenderingContext2D,
  textWidth: number,
): Glyphs {
  const out: Glyphs = [];
  lines.forEach((line, lineIndex) => {
    const last = line.fragments[line.fragments.length - 1];
    const content =
      last?.kind === "space" ? line.fragments.slice(0, -1) : line.fragments;
    const words = content.filter((f) => f.kind === "text");
    const spaces = content.length - words.length;
    const wordWidth = words.reduce(
      (sum, f) => sum + measureTextWidth(f.text, f.font),
      0,
    );
    let x = PAD + (line.indentPx ?? 0);
    for (const fragment of content) {
      ctx.font = fragment.font;
      const metrics = ctx.measureText("Hxgy");
      let ascent = metrics.fontBoundingBoxAscent;
      let descent = metrics.fontBoundingBoxDescent;
      if (baselineMode === "round") {
        ascent = Math.round(ascent);
        descent = Math.round(descent);
      }
      const baseline =
        PAD +
        lineIndex * lineHeight +
        (lineHeight - (ascent + descent)) / 2 +
        ascent;
      if (fragment.kind === "space") {
        x +=
          line.wordSpacingPx !== undefined && spaces > 0
            ? (textWidth - (line.indentPx ?? 0) - wordWidth) / spaces
            : measureCollapsedSpaceWidth(fragment.font);
        continue;
      }
      out.push({ text: fragment.text, font: fragment.font, x, y: baseline });
      x +=
        measureTextWidth(fragment.text, fragment.font) +
        (fragment.marginRightPx ?? 0);
    }
  });
  return out;
}

/** Ink positions read back from the invisible DOM: word ranges and baseline probes. */
function domGlyphs(page: HTMLElement, origin: DOMRect): Glyphs {
  const out: Glyphs = [];
  for (const lineSpan of Array.from(page.children)) {
    const probe = lineSpan.querySelector(".probe");
    if (!probe) continue;
    const baseline = probe.getBoundingClientRect().bottom - origin.top;
    for (const child of Array.from(
      lineSpan.querySelectorAll<HTMLElement>("[data-kind=text]"),
    )) {
      const node = child.firstChild;
      if (!node) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rect = range.getBoundingClientRect();
      const fragmentFont = `${child.style.fontStyle} ${child.style.fontWeight} ${child.style.fontSize} ${child.style.fontFamily}`;
      out.push({
        text: child.textContent ?? "",
        font: fragmentFont,
        x: rect.left - origin.left,
        y: baseline,
      });
    }
  }
  return out;
}

function drawCoverage(canvas: HTMLCanvasElement, glyphs: Glyphs) {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#000";
  ctx.textBaseline = "alphabetic";
  for (const glyph of glyphs) {
    ctx.font = glyph.font;
    ctx.fillText(glyph.text, glyph.x, glyph.y);
  }
}

const VS = `attribute vec2 aPos; void main(){ gl_Position = vec4(aPos, 0.0, 1.0); }`;
const FS = `precision highp float;
uniform sampler2D uCov; uniform vec2 uSize; uniform vec3 uPaper; uniform vec3 uInk; uniform float uEmboss;
float cov(vec2 px){ return texture2D(uCov, (floor(px) + 0.5) / uSize).a; }
void main(){
  vec2 px = gl_FragCoord.xy;
  float c = cov(px);
  vec3 col = mix(uPaper, uInk, c);
  if (uEmboss > 0.5) {
    // Letterpress: the inked area is pressed in; light from the upper left
    // catches the far wall of each stroke and leaves the near wall in shade.
    float r = 1.5;
    float gx = (cov(px + vec2(r, 0.0)) - cov(px - vec2(r, 0.0)));
    float gy = (cov(px + vec2(0.0, r)) - cov(px - vec2(0.0, r)));
    float shade = clamp(0.5 + 0.35 * (gx * 0.7 - gy * 0.7), 0.0, 1.0);
    col *= 0.94 + 0.12 * shade;
  }
  gl_FragColor = vec4(col, 1.0);
}`;

function makeRenderer(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext("webgl", {
    antialias: false,
    premultipliedAlpha: false,
  });
  if (!gl) throw new Error("WebGL unavailable");
  const compile = (type: number, src: string) => {
    const shader = gl.createShader(type) as WebGLShader;
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader) ?? "shader");
    return shader;
  };
  const program = gl.createProgram() as WebGLProgram;
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VS));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(program);
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const aPos = gl.getAttribLocation(program, "aPos");
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  for (const [k, v] of [
    [gl.TEXTURE_MIN_FILTER, gl.NEAREST],
    [gl.TEXTURE_MAG_FILTER, gl.NEAREST],
    [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE],
    [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE],
  ])
    gl.texParameteri(gl.TEXTURE_2D, k, v);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  const u = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform3fv(u("uPaper"), PAPER);
  gl.uniform3fv(u("uInk"), INK);
  gl.uniform1f(u("uEmboss"), emboss ? 1 : 0);
  return (coverage: HTMLCanvasElement) => {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u("uSize"), coverage.width, coverage.height);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      coverage,
    );
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return gl;
  };
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

/** Times coverage, upload and draw for a phone-sized page of ink. */
function timeFullPage(
  lines: PageLine[],
  ctx2d: CanvasRenderingContext2D,
  textWidth: number,
) {
  const width = Math.round(innerWidth * dpr);
  const height = Math.round(innerHeight * dpr);
  const coverage = document.createElement("canvas");
  coverage.width = width;
  coverage.height = height;
  const target = document.createElement("canvas");
  target.width = width;
  target.height = height;
  const render = makeRenderer(target);
  const base = engineGlyphs(lines, ctx2d, textWidth);
  const glyphs: Glyphs = [];
  const block = lines.length * lineHeight;
  for (let offset = 0; offset + block < innerHeight; offset += block) {
    for (const glyph of base) glyphs.push({ ...glyph, y: glyph.y + offset });
  }
  const draw: number[] = [];
  const upload: number[] = [];
  for (let run = 0; run < 12; run++) {
    const t0 = performance.now();
    drawCoverage(coverage, glyphs);
    const t1 = performance.now();
    const gl = render(coverage);
    gl.finish();
    const t2 = performance.now();
    draw.push(t1 - t0);
    upload.push(t2 - t1);
  }
  return {
    words: glyphs.length,
    draw: median(draw),
    upload: median(upload),
    width,
    height,
  };
}

async function main() {
  if (fontId === "lora") await document.fonts.load(`400 ${sizePx}px "Lora"`);
  await document.fonts.ready;

  const width = Math.floor(Math.min(innerWidth - 32, 430));
  const textWidth = width - PAD * 2;
  const [block] = prepareBlocks(
    [
      {
        type: "text",
        id: "p",
        tag: "p",
        runs: [
          {
            kind: "text",
            text: TEXT,
            bold: false,
            italic: false,
            isCode: false,
          },
        ],
      },
    ],
    {
      bodyFamily: stack,
      headingFamily: stack,
      codeFamily: "monospace",
      baseSizePx: sizePx,
    },
  ) as PreparedTextBlock[];
  const { lines, renderMode } = layoutTextLines(block.items, textWidth, {
    textAlign: "justify-knuth-plass",
  });
  const firstFont = (
    lines[0]?.fragments.find((f: PageFragment) => f.kind === "text") ?? {
      font: `400 ${sizePx}px ${stack}`,
    }
  ).font;
  const height = lines.length * lineHeight + PAD * 2;

  const a = buildCopy("dom", lines, width, height, textWidth, firstFont);
  const b = buildCopy(
    control ? "dom" : "ink",
    lines,
    width,
    height,
    textWidth,
    firstFont,
  );
  copiesEl.append(a.copy, b.copy);
  b.copy.style.marginTop = `${COPY_GAP - 12}px`;

  const coverage = document.createElement("canvas");
  coverage.width = Math.round(width * dpr);
  coverage.height = Math.round(height * dpr);
  const ctx2d = coverage.getContext("2d") as CanvasRenderingContext2D;
  let timing = "";
  let drift = "";
  if (!control) {
    const visible = document.createElement("canvas");
    visible.width = coverage.width;
    visible.height = coverage.height;
    visible.style.width = `${width}px`;
    visible.style.height = `${height}px`;
    b.copy.prepend(visible);
    const fromDom = domGlyphs(b.page, b.copy.getBoundingClientRect());
    const fromEngine = engineGlyphs(lines, ctx2d, textWidth);
    const glyphs = xSource === "dom" ? fromDom : fromEngine;
    // Where the engine's own model puts each word, against where the DOM put it.
    const dx = fromEngine.map((g, i) =>
      Math.abs(g.x - (fromDom[i]?.x ?? Infinity)),
    );
    const dy = fromEngine.map((g, i) =>
      Math.abs(g.y - (fromDom[i]?.y ?? Infinity)),
    );
    drift = ` · engine vs DOM: |dx| max ${(Math.max(...dx) * dpr).toFixed(2)}, median ${(median(dx) * dpr).toFixed(2)}; |dy| max ${(Math.max(...dy) * dpr).toFixed(2)} device px`;
    const t0 = performance.now();
    drawCoverage(coverage, glyphs);
    makeRenderer(visible)(coverage).finish();
    timing = `draw ${(performance.now() - t0).toFixed(1)} ms`;
  }

  if (params.get("sel") === "1") {
    const spans = b.page.querySelectorAll(":scope > span[style*=nowrap]");
    const range = document.createRange();
    range.setStartBefore(spans[1]);
    range.setEndAfter(spans[2]);
    getSelection()?.removeAllRanges();
    getSelection()?.addRange(range);
  }

  let perf = "";
  if (params.get("perf") === "1") {
    const result = timeFullPage(lines, ctx2d, textWidth);
    perf = ` · full page ${result.width}×${result.height}, ${result.words} words: fillText ${result.draw.toFixed(1)} ms, upload+draw ${result.upload.toFixed(1)} ms`;
  }

  const ra = a.copy.getBoundingClientRect();
  const rb = b.copy.getBoundingClientRect();
  const fractional = [ra.left, ra.top, rb.left, rb.top].some(
    (v) => Math.abs(v * dpr - Math.round(v * dpr)) > 0.01,
  );
  const fontOk = document.fonts.check(`${sizePx}px ${stack.split(",")[0]}`);
  statusEl.textContent =
    `${fontId} ${sizePx}/${lineHeight}px · ${renderMode} · ${lines.length} lines · x=${xSource}` +
    `${xSource === "engine" ? ` baseline=${baselineMode}` : ""}${control ? " · CONTROL" : ""}${emboss ? " · emboss" : ""}\n` +
    `dpr ${dpr} · font ${fontOk ? "loaded" : "MISSING"} · copies ${fractional ? "FRACTIONAL" : "on device pixels"} · ${timing}${drift}${perf}`;
  document.body.dataset.ready = "1";
}

main().catch((error: unknown) => {
  statusEl.textContent = `Error: ${String(error)}`;
  document.body.dataset.ready = "error";
});
