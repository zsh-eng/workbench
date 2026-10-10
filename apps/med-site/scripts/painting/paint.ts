// Paints the site's picture for light and dark, and writes it to
// public/painting in AVIF and WebP at the widths the page uses. The painter
// and its scenes are Med's, beside its icons (apps/med/scripts/painting).
// Run it after changing the painting: bun run paint
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import sharp from "sharp";

const here = join(import.meta.dir, "../../../med/scripts/painting");
const out = join(import.meta.dir, "../../public/painting");
// The product panel's shape (src/styles.css, .painting).
const painting = { width: 2400, height: 1816, widths: [1200, 2400] };

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.addScriptTag({ path: join(here, "painter.js") });
  await page.addScriptTag({ path: join(here, "scenes.js") });
  for (const name of ["dawn", "night"]) {
    const started = Date.now();
    const url = await page.evaluate(
      ({ name, width, height }) =>
        // @ts-expect-error The scripts above define these in the page.
        window.paint({
          width,
          height,
          scene: window.scenes[name](width / height),
        }),
      { name, width: painting.width, height: painting.height },
    );
    const png = Buffer.from(url.split(",")[1]!, "base64");
    for (const width of painting.widths) {
      const image = sharp(png).resize(width);
      await image
        .clone()
        .avif({ quality: 50, effort: 6 })
        .toFile(join(out, `${name}-${width}.avif`));
      await image
        .clone()
        .webp({ quality: 72 })
        .toFile(join(out, `${name}-${width}.webp`));
    }
    console.log(`${name}: painted in ${Date.now() - started} ms`);
  }
} finally {
  await browser.close();
}
for (const file of [
  "dawn-1200.avif",
  "dawn-2400.avif",
  "dawn-1200.webp",
  "night-2400.avif",
])
  console.log(
    file,
    (readFileSync(join(out, file)).length / 1024).toFixed(0),
    "KB",
  );
