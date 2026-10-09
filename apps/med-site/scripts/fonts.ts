// Subsets Med's two fonts for the site and copies their OFL notices.
// Run it after Med's fonts change: bun run fonts
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import subsetFont from "subset-font";

const root = join(import.meta.dir, "..");
const med = join(root, "../med");
const out = join(root, "public/fonts");

// Latin-1, common punctuation, arrows, and the Mac modifier keys.
const ranges: [number, number][] = [
  [0x20, 0x7e],
  [0xa0, 0xff],
  [0x2010, 0x2027],
  [0x2190, 0x2193],
  [0x2318, 0x2318],
  [0x2325, 0x2325],
  [0x21e7, 0x21e7],
];
const text = ranges
  .flatMap(([start, end]) =>
    Array.from({ length: end - start + 1 }, (_, i) => start + i),
  )
  .map((code) => String.fromCodePoint(code))
  .join("");

const fonts = [
  {
    source: "public/fonts/Geist-Variable.woff2",
    output: "geist.woff2",
    // The page uses weights 400 to 600.
    axes: { wght: { min: 400, max: 600, default: 400 } },
    license: "upstream/GEIST-OFL.txt",
    notice: "GEIST-OFL.txt",
  },
  {
    source: "public/fonts/PaperMono-Variable.woff2",
    output: "paper-mono.woff2",
    // Code on the page is regular weight only.
    axes: { wght: 400 },
    license: "upstream/PAPER-MONO-OFL.txt",
    notice: "PAPER-MONO-OFL.txt",
  },
];

mkdirSync(out, { recursive: true });
for (const font of fonts) {
  const input = readFileSync(join(med, font.source));
  const subset = await subsetFont(input, text, {
    targetFormat: "woff2",
    variationAxes: font.axes,
  });
  writeFileSync(join(out, font.output), subset);
  copyFileSync(join(med, font.license), join(out, font.notice));
  console.log(`${font.output}: ${input.length} -> ${subset.length} bytes`);
}
