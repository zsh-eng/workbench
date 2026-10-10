// Writes the static site to dist/. Fonts, screenshots, and the painting get
// content hashes under /assets/, so a host can cache them for a year (see
// public/_headers).
import {
  cpSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative } from "node:path";
import { gzipSync } from "node:zlib";
import { buildDemo } from "./demo.ts";
import { publicDir, render } from "./render.ts";

const dist = join(import.meta.dir, "../dist");
const { html, assets } = render({ hash: true });
const hashed = new Set(assets.values());

rmSync(dist, { recursive: true, force: true });
// Med's live demo first: its build empties its own folder.
buildDemo(join(dist, "demo"));
// Everything in public/ except the files that are written hashed or unused.
cpSync(publicDir, dist, {
  recursive: true,
  filter: (source) =>
    !source.endsWith(".woff2") &&
    !["screenshots", "painting"].some((folder) =>
      relative(publicDir, source).startsWith(folder),
    ),
});
for (const [output, source] of assets) {
  mkdirSync(dirname(join(dist, output)), { recursive: true });
  cpSync(source, join(dist, output));
}
writeFileSync(join(dist, "index.html"), html);

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;
const page = Buffer.from(html);
console.log(
  `index.html: ${kb(page.length)}, ${kb(gzipSync(page, { level: 9 }).length)} gzipped (HTML, CSS, and scripts)`,
);
const sizes = [...hashed].reduce(
  (sum, file) => sum + readFileSync(file).length,
  0,
);
console.log(
  `${hashed.size} hashed assets: ${kb(sizes)} in all formats and widths`,
);
