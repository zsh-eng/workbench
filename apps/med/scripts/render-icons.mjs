// Draws Med's app icons into public/icons. Run after changing the drawing:
// node scripts/render-icons.mjs
//
// The mark is Reflection: the sun on the sea and its reflection, set one step
// to the side. It sits on a painted tile of the same sea (scripts/painting):
// dawn, and moonrise where a dark variant is possible. The favicon carries
// both and follows the colour scheme; icon-dawn.svg and icon-night.svg carry
// one each, for a page that picks by colour scheme itself.
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const out = join(import.meta.dirname, "..", "public", "icons");
const painting = join(import.meta.dirname, "painting");

// The mark on a 64-unit tile: a half disc above the horizon and the same half
// disc below it, moved right. The sun is paper; its reflection lets the sea
// show through.
const mark = (reflection) =>
  `<path d="M14 30A15 15 0 0 1 44 30Z" fill="#fffaf1" /><path d="M20 34A15 15 0 0 0 50 34Z" fill="#fffaf1" fill-opacity="${reflection}" />`;
const dawnMark = mark(0.62);
const nightMark = mark(0.5);

// Apple's icon grid: an 824-point tile with a 185-point corner on a 1024 canvas.
const body =
  "M285 100H739A185 185 0 0 1 924 285V739A185 185 0 0 1 739 924H285A185 185 0 0 1 100 739V285A185 185 0 0 1 285 100Z";
// The rim catches light at the top and darkens below.
const app = (tile) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <clipPath id="tile"><path d="${body}" /></clipPath>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff" stop-opacity="0.3" />
      <stop offset="0.5" stop-color="#fff" stop-opacity="0.04" />
      <stop offset="1" stop-color="#000" stop-opacity="0.22" />
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000" flood-opacity="0.3" />
    </filter>
  </defs>
  <path d="${body}" fill="#8c9fb0" filter="url(#shadow)" />
  <image href="${tile}" x="100" y="100" width="824" height="824" clip-path="url(#tile)" />
  <g transform="translate(100 100) scale(12.875)">${dawnMark}</g>
  <path d="${body}" fill="none" stroke="url(#rim)" stroke-width="5" clip-path="url(#tile)" />
</svg>`;

// Platforms that cut their own shape get a full-bleed square; the mark stays
// inside the central safe circle.
const maskable = (tile) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <image href="${tile}" width="1024" height="1024" />
  <g transform="scale(16)">${dawnMark}</g>
</svg>`;

// Browser tabs show 16 to 32 pixels: small tiles, dawn in a light scheme and
// moonrise in a dark one.
const favicon = (dawn, night) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <style>
    .night { display: none }
    @media (prefers-color-scheme: dark) { .dawn { display: none } .night { display: inline } }
  </style>
  <clipPath id="tile"><rect width="64" height="64" rx="14" /></clipPath>
  <g class="dawn"><image href="${dawn}" width="64" height="64" clip-path="url(#tile)" />${dawnMark}</g>
  <g class="night"><image href="${night}" width="64" height="64" clip-path="url(#tile)" />${nightMark}</g>
</svg>
`;
const single = (tile, mark) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <clipPath id="tile"><rect width="64" height="64" rx="14" /></clipPath>
  <image href="${tile}" width="64" height="64" clip-path="url(#tile)" />${mark}
</svg>
`;

await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const tab = await browser.newPage();
  await tab.addScriptTag({ path: join(painting, "painter.js") });
  await tab.addScriptTag({ path: join(painting, "scenes.js") });
  // Each tile at full size as PNG, and at 128 pixels as WebP for the favicon.
  const tiles = await tab.evaluate(async () => {
    const result = {};
    for (const name of ["dawnTile", "nightTile"]) {
      const png = window.paint({ width: 1024, height: 1024, scene: window.scenes[name]() });
      const image = new Image();
      image.src = png;
      await image.decode();
      const small = document.createElement("canvas");
      small.width = small.height = 128;
      const g = small.getContext("2d");
      g.imageSmoothingQuality = "high";
      g.drawImage(image, 0, 0, 128, 128);
      result[name] = { png, webp: small.toDataURL("image/webp", 0.82) };
    }
    return result;
  });

  await writeFile(join(out, "icon.svg"), favicon(tiles.dawnTile.webp, tiles.nightTile.webp));
  await writeFile(join(out, "icon-dawn.svg"), single(tiles.dawnTile.webp, dawnMark));
  await writeFile(join(out, "icon-night.svg"), single(tiles.nightTile.webp, nightMark));
  const shots = [
    ["app-192.png", app(tiles.dawnTile.png), 192],
    ["app-512.png", app(tiles.dawnTile.png), 512],
    ["maskable-512.png", maskable(tiles.dawnTile.png), 512],
    ["apple-touch-icon.png", maskable(tiles.dawnTile.png), 180],
  ];
  // ICON_ART=path also writes the app icon at 1024 pixels, for brand pages.
  if (process.env.ICON_ART) shots.push([process.env.ICON_ART, app(tiles.dawnTile.png), 1024]);
  for (const [name, svg, size] of shots) {
    await tab.setViewportSize({ width: size, height: size });
    await tab.setContent(
      `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
    );
    await tab.screenshot({ path: resolve(out, name), omitBackground: true });
  }
} finally {
  await browser.close();
}
console.log(`Wrote icons to ${out}`);
