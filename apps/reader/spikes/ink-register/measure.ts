/**
 * Measures the ink-register spike (see main.ts).
 *
 *   bun spikes/ink-register/measure.ts capture <outDir> [baseUrl]
 *     Screenshots each variant in Playwright Chromium at 390×844, DPR 3,
 *     then analyses them.
 *   bun spikes/ink-register/measure.ts analyse <png>...
 *     Analyses screenshots taken elsewhere, for example an iOS Simulator
 *     screenshot of Safari (`xcrun simctl io <device> screenshot`).
 *
 * Each screenshot holds copy A (DOM text) and copy B (drawn ink) of the same
 * paragraph. Magenta markers sit at both corners of each copy. The analysis
 * cuts each word out of copy A, finds the shift of copy B that matches it
 * best (sub-pixel, from a parabola through the best integer shift), and
 * reports the shifts and the remaining difference in device pixels.
 */
import { chromium, type Page } from "@playwright/test";
import { mkdirSync, readFileSync } from "fs";
import path from "path";

type Image = { width: number; height: number; data: Uint8Array };
type Box = { x0: number; y0: number; x1: number; y1: number };

const VARIANTS = [
  "control=1",
  "x=engine&baseline=float",
  "x=engine&baseline=round",
  "x=dom",
  "font=iowan&control=1",
  "font=iowan&x=engine&baseline=float",
  "font=iowan&x=dom",
];

/** Decodes a PNG with the browser, so the spike needs no image library. */
async function readPng(page: Page, file: string): Promise<Image> {
  const base64 = readFileSync(file).toString("base64");
  const decoded = await page.evaluate(async (source: string) => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext("2d", {
      colorSpace: "srgb",
    }) as CanvasRenderingContext2D;
    ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let binary = "";
    for (let i = 0; i < pixels.length; i += 0x8000) {
      binary += String.fromCharCode(...pixels.subarray(i, i + 0x8000));
    }
    return { width: canvas.width, height: canvas.height, data: btoa(binary) };
  }, base64);
  return {
    width: decoded.width,
    height: decoded.height,
    data: Buffer.from(decoded.data, "base64"),
  };
}

function isMagenta(img: Image, x: number, y: number) {
  const i = (y * img.width + x) * 4;
  return img.data[i] > 230 && img.data[i + 1] < 40 && img.data[i + 2] > 230;
}

/** Finds the magenta marker squares and returns their bounding boxes, top to bottom. */
function findMarkers(img: Image): Box[] {
  const seen = new Uint8Array(img.width * img.height);
  const boxes: Box[] = [];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (seen[y * img.width + x] || !isMagenta(img, x, y)) continue;
      const box = { x0: x, y0: y, x1: x, y1: y };
      const stack = [[x, y]];
      seen[y * img.width + x] = 1;
      while (stack.length) {
        const [px, py] = stack.pop() as number[];
        box.x0 = Math.min(box.x0, px);
        box.x1 = Math.max(box.x1, px);
        box.y0 = Math.min(box.y0, py);
        box.y1 = Math.max(box.y1, py);
        for (const [nx, ny] of [
          [px + 1, py],
          [px - 1, py],
          [px, py + 1],
          [px, py - 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= img.width || ny >= img.height) continue;
          if (seen[ny * img.width + nx] || !isMagenta(img, nx, ny)) continue;
          seen[ny * img.width + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (box.x1 - box.x0 >= 8 && box.y1 - box.y0 >= 8) boxes.push(box);
    }
  }
  return boxes.sort((p, q) => p.y0 - q.y0 || p.x0 - q.x0);
}

/** Ink darkness, 0 on paper and 1 on solid ink, for a region. */
function luminance(img: Image, i: number) {
  return (
    0.2126 * img.data[i] + 0.7152 * img.data[i + 1] + 0.0722 * img.data[i + 2]
  );
}

/** Paper and solid-ink levels of a region: its median and its darkest 0.5%. */
function levels(img: Image, region: Box) {
  const values: number[] = [];
  for (let y = region.y0; y < region.y1; y += 2) {
    for (let x = region.x0; x < region.x1; x += 2)
      values.push(luminance(img, (y * img.width + x) * 4));
  }
  values.sort((p, q) => p - q);
  return {
    paper: values[Math.floor(values.length / 2)],
    ink: values[Math.floor(values.length * 0.005)],
  };
}

function darkness(img: Image, region: Box, paper: number, ink: number) {
  const w = region.x1 - region.x0;
  const h = region.y1 - region.y0;
  const out = new Float32Array(w * h);
  const lum = (i: number) => luminance(img, i);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = ((region.y0 + y) * img.width + region.x0 + x) * 4;
      out[y * w + x] = Math.min(
        1,
        Math.max(0, (paper - lum(i)) / (paper - ink)),
      );
    }
  }
  return { w, h, d: out };
}

function bands(
  profile: Float32Array | number[],
  minGap: number,
  threshold: number,
) {
  const runs: [number, number][] = [];
  let start = -1;
  let gap = 0;
  for (let i = 0; i < profile.length; i++) {
    if (profile[i] > threshold) {
      if (start < 0) start = i;
      gap = 0;
    } else if (start >= 0) {
      gap++;
      if (gap >= minGap) {
        runs.push([start, i - gap + 1]);
        start = -1;
        gap = 0;
      }
    }
  }
  if (start >= 0) runs.push([start, profile.length - gap]);
  return runs;
}

function parabola(m: number, c: number, p: number) {
  const denom = m - 2 * c + p;
  return denom > 1e-9 ? (0.5 * (m - p)) / denom : 0;
}

type WordResult = {
  line: number;
  dx: number;
  dy: number;
  residual: number;
  mass: number;
  edge: boolean;
};

/** Compares copy B with copy A, word by word. */
async function analyse(page: Page, file: string, scale: number) {
  const img = await readPng(page, file);
  const markers = findMarkers(img);
  if (markers.length < 4)
    throw new Error(`${file}: found ${markers.length} markers`);
  const [a0, a1, b0, b1] = markers;
  const regionA = { x0: a0.x0, y0: a0.y0, x1: a1.x1 + 1, y1: a1.y1 + 1 };
  const offsetX = b0.x0 - a0.x0;
  const offsetY = b0.y0 - a0.y0;
  const regionB = {
    x0: regionA.x0 + offsetX,
    y0: regionA.y0 + offsetY,
    x1: regionA.x1 + offsetX,
    y1: regionA.y1 + offsetY,
  };
  if (b1.x1 + 1 !== regionB.x1 || b1.y1 + 1 !== regionB.y1)
    throw new Error(`${file}: copies differ in size`);
  const { paper, ink } = levels(img, regionA);
  const A = darkness(img, regionA, paper, ink);
  const B = darkness(img, regionB, paper, ink);
  // Keep the markers out of the comparison.
  const inset = Math.ceil(8 * scale);
  const at = (img2: typeof A, x: number, y: number) =>
    x < 0 || y < 0 || x >= img2.w || y >= img2.h ? 0 : img2.d[y * img2.w + x];

  const rows = new Float32Array(A.h);
  for (let y = inset; y < A.h - inset; y++)
    for (let x = inset; x < A.w - inset; x++) rows[y] += at(A, x, y);
  const lineBands = bands(rows, Math.round(2 * scale), 0.5);
  const results: WordResult[] = [];
  const R = Math.round(2 * scale);
  lineBands.forEach(([ly0, ly1], lineIndex) => {
    const cols = new Float32Array(A.w);
    for (let y = ly0; y < ly1; y++)
      for (let x = inset; x < A.w - inset; x++) cols[x] += at(A, x, y);
    for (const [wx0, wx1] of bands(cols, Math.round(2.5 * scale), 0.05)) {
      const box = { x0: wx0 - 3, y0: ly0 - 3, x1: wx1 + 3, y1: ly1 + 3 };
      const ssd = (sx: number, sy: number) => {
        let sum = 0;
        for (let y = box.y0; y < box.y1; y++) {
          for (let x = box.x0; x < box.x1; x++) {
            const diff = at(B, x + sx, y + sy) - at(A, x, y);
            sum += diff * diff;
          }
        }
        return sum;
      };
      let best = { sx: 0, sy: 0, v: Infinity };
      for (let sy = -R; sy <= R; sy++)
        for (let sx = -R; sx <= R; sx++) {
          const v = ssd(sx, sy);
          if (v < best.v) best = { sx, sy, v };
        }
      const fx = parabola(
        ssd(best.sx - 1, best.sy),
        best.v,
        ssd(best.sx + 1, best.sy),
      );
      const fy = parabola(
        ssd(best.sx, best.sy - 1),
        best.v,
        ssd(best.sx, best.sy + 1),
      );
      let massA = 0;
      let massB = 0;
      let absDiff = 0;
      for (let y = box.y0; y < box.y1; y++) {
        for (let x = box.x0; x < box.x1; x++) {
          const va = at(A, x, y);
          const vb = at(B, x + best.sx, y + best.sy);
          massA += va;
          massB += vb;
          absDiff += Math.abs(vb - va);
        }
      }
      results.push({
        line: lineIndex,
        dx: best.sx + fx,
        dy: best.sy + fy,
        residual: absDiff / Math.max(1e-6, massA),
        mass: massB / Math.max(1e-6, massA),
        edge: Math.abs(best.sx) === R || Math.abs(best.sy) === R,
      });
    }
  });
  return { file, offsetX, offsetY, lines: lineBands.length, words: results };
}

function summarise(name: string, result: Awaited<ReturnType<typeof analyse>>) {
  const q = (values: number[], p: number) => {
    const sorted = [...values].sort((x, y) => x - y);
    return (
      sorted[
        Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))
      ] ?? 0
    );
  };
  const dx = result.words.map((w) => w.dx);
  const dy = result.words.map((w) => w.dy);
  const absDx = dx.map(Math.abs);
  const absDy = dy.map(Math.abs);
  const perLine = Array.from({ length: result.lines }, (_, line) => {
    const words = result.words.filter((w) => w.line === line);
    const first = words[0];
    const last = words[words.length - 1];
    return first && last ? `${first.dx.toFixed(2)}→${last.dx.toFixed(2)}` : "";
  });
  return {
    name,
    words: result.words.length,
    lines: result.lines,
    dx: { median: q(dx, 0.5), p95abs: q(absDx, 0.95), maxAbs: q(absDx, 1) },
    dy: { median: q(dy, 0.5), p95abs: q(absDy, 0.95), maxAbs: q(absDy, 1) },
    residual: q(
      result.words.map((w) => w.residual),
      0.5,
    ),
    massBoverA: q(
      result.words.map((w) => w.mass),
      0.5,
    ),
    edgeHits: result.words.filter((w) => w.edge).length,
    lineDx: perLine.join("  "),
  };
}

async function capture(page: Page, outDir: string, baseUrl: string) {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  for (const variant of VARIANTS) {
    await page.goto(`${baseUrl}?${variant}`);
    await page.waitForSelector("body[data-ready]");
    const status = await page.textContent("#status");
    const file = path.join(
      outDir,
      `chromium-${variant.replace(/[&=]/g, "_")}.png`,
    );
    await page.screenshot({ path: file });
    console.log(`${variant}\n  ${status?.replace(/\n/g, "\n  ")}`);
    files.push(file);
  }
  return files;
}

const [command, ...args] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
});
try {
  if (command === "capture") {
    const files = await capture(
      page,
      args[0] ?? "ink-register-shots",
      args[1] ?? "http://127.0.0.1:5342/",
    );
    await page.goto("about:blank");
    for (const file of files)
      console.log(
        JSON.stringify(
          summarise(path.basename(file), await analyse(page, file, 3)),
        ),
      );
  } else if (command === "analyse") {
    for (const file of args)
      console.log(
        JSON.stringify(
          summarise(path.basename(file), await analyse(page, file, 3)),
        ),
      );
  } else {
    console.log(
      "Usage: measure.ts capture <outDir> [baseUrl] | analyse <png>...",
    );
  }
} finally {
  await browser.close();
}
