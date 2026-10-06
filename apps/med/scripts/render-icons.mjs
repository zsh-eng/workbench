// Draws Med's app icons into public/icons. Run after changing the drawing:
// node scripts/render-icons.mjs
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";

const out = join(import.meta.dirname, "..", "public", "icons");
const accent = "#8f9cff";
const line = "#55555f";

// Indented lines read as code; the line under review carries Med's change bar.
const glyph = `
  <g fill="none" stroke-linecap="round" stroke-width="52">
    <path stroke="${line}" d="M358 374H646M422 466H730M358 650H508" />
    <path stroke="${accent}" d="M486 558H710" />
    <path stroke="${accent}" stroke-width="26" d="M282 532V584" />
  </g>`;

const background = `
  <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#202026" />
    <stop offset="1" stop-color="#111114" />
  </linearGradient>`;

// Apple's icon grid: an 824-point tile with a 185-point corner on a 1024 canvas.
const body =
  "M285 100H739A185 185 0 0 1 924 285V739A185 185 0 0 1 739 924H285A185 185 0 0 1 100 739V285A185 185 0 0 1 285 100Z";
const app = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${background}
    <clipPath id="tile"><path d="${body}" /></clipPath>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.3" />
    </filter>
  </defs>
  <path d="${body}" fill="url(#fill)" filter="url(#shadow)" />
  <path d="${body}" fill="none" stroke="#fff" stroke-opacity="0.09" stroke-width="4" clip-path="url(#tile)" />
  ${glyph}
</svg>`;

// Platforms that cut their own shape get a full-bleed square; the glyph stays
// inside the central safe circle.
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>${background}</defs>
  <rect width="1024" height="1024" fill="url(#fill)" />
  ${glyph}
</svg>`;

// Browser tabs show 16 to 32 pixels: three heavier lines read better there.
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="7.5" fill="#18181c" />
  <g fill="none" stroke-linecap="round" stroke-width="3.2">
    <path stroke="#62626d" d="M11.5 10H22M11.5 22H17" />
    <path stroke="${accent}" d="M15.5 16H24" />
    <path stroke="${accent}" stroke-width="2.2" d="M7 14.6V17.4" />
  </g>
</svg>
`;

await mkdir(out, { recursive: true });
await writeFile(join(out, "icon.svg"), favicon);
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  for (const [name, svg, size] of [
    ["app-192.png", app, 192],
    ["app-512.png", app, 512],
    ["maskable-512.png", maskable, 512],
    ["apple-touch-icon.png", maskable, 180],
  ]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await page.screenshot({ path: join(out, name), omitBackground: true });
  }
} finally {
  await browser.close();
}
console.log(`Wrote icons to ${out}`);
