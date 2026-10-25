/**
 * Builds a cover scene from hand-made layers.
 *
 *   bun scripts/living-covers/author.ts <scene folder> [--out <folder>]
 *
 * A scene folder holds `scene.json`, the cover (`cover.webp`, `.jpg` or
 * `.png`) and `recipe.ts`. The recipe draws the maps with SVG layers written
 * by hand (`*.svg`, in the cover's own pixels) and a few image operations,
 * then calls `kit.write`. The tool packs the channels, copies the scene and
 * draws `preview.png`: the cover, the depth, the relief and the masks side
 * by side, to check the hand-work against the art.
 *
 * Needs `rsvg-convert` and ImageMagick 7 (`magick`).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_WIDTH = 480;

type Channel = string | number;

export interface Kit {
  dir: string;
  work: string;
  width: number;
  height: number;
  /** The cover at map size, as a PNG, for colour keys and SVG `<image>`. */
  cover: string;
  run(args: string[]): void;
  /** Render `<name>.svg` from the scene folder; returns the PNG path. */
  svg(name: string): string;
  /** A grey mask from an ImageMagick -fx expression over the cover. */
  fx(name: string, expression: string, input?: string): string;
  /** Round a mask into a dome: height rises over `radius` px from its edge. */
  inflate(name: string, mask: string, radius: number, power?: number): string;
  blur(name: string, input: string, sigma: number): string;
  /** Combine two grey images with an ImageMagick compose operator. */
  compose(name: string, a: string, b: string, operator: string): string;
  /**
   * Per-pixel maths over grey images: `u` is the first, `v` the second,
   * `u[2]` the third and so on (ImageMagick -fx).
   */
  math(name: string, inputs: string[], expression: string): string;
  /** Scale and offset a grey image: out = in * gain + bias. */
  levels(name: string, input: string, gain: number, bias: number): string;
  write(maps: {
    depth: [Channel, Channel];
    materials?: [Channel, Channel, Channel];
    life?: [Channel, Channel, Channel];
  }): void;
}

function magick(args: string[]) {
  const result = spawnSync("magick", args, { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`magick ${args.join(" ")}\n${result.stderr}`);
  }
  return result.stdout;
}

function findCover(dir: string) {
  for (const name of ["cover.webp", "cover.jpg", "cover.png", "source.jpg"]) {
    const file = path.join(dir, name);
    if (existsSync(file)) return file;
  }
  throw new Error(`No cover in ${dir}`);
}

async function main() {
  const [dirArg, ...rest] = process.argv.slice(2);
  if (!dirArg) throw new Error("Usage: author.ts <scene folder> [--out dir]");
  const dir = path.resolve(dirArg);
  const outIndex = rest.indexOf("--out");
  const out = outIndex >= 0 ? path.resolve(rest[outIndex + 1]!) : dir;
  const work = path.join(dir, "work");
  mkdirSync(work, { recursive: true });
  mkdirSync(out, { recursive: true });

  const source = findCover(dir);
  const [sourceWidth, sourceHeight] = magick([
    "identify",
    "-format",
    "%w %h",
    `${source}[0]`,
  ])
    .trim()
    .split(" ")
    .map(Number) as [number, number];
  const width = Math.min(MAX_WIDTH, sourceWidth);
  const height = Math.round((sourceHeight / sourceWidth) * width);
  const cover = path.join(work, "cover.png");
  magick([`${source}[0]`, "-resize", `${width}x${height}!`, "-strip", cover]);
  writeGrid(cover, path.join(work, "grid.png"), width, height);

  const gray = (name: string) => path.join(work, `${name}.png`);
  const kit: Kit = {
    dir,
    work,
    width,
    height,
    cover,
    run: magick,
    svg(name) {
      const output = gray(name);
      const result = spawnSync(
        "rsvg-convert",
        [
          "-w",
          String(width),
          "-h",
          String(height),
          "-b",
          "black",
          "-o",
          output,
          path.join(dir, `${name}.svg`),
        ],
        { encoding: "utf8", cwd: work },
      );
      if (result.status !== 0)
        throw new Error(`rsvg-convert ${name}\n${result.stderr}`);
      return output;
    },
    fx(name, expression, input = cover) {
      const output = gray(name);
      magick([
        input,
        "-colorspace",
        "sRGB",
        "-fx",
        expression,
        "-colorspace",
        "Gray",
        output,
      ]);
      return output;
    },
    inflate(name, mask, radius, power = 0.5) {
      const output = gray(name);
      magick([
        mask,
        "-colorspace",
        "Gray",
        "-threshold",
        "50%",
        "-morphology",
        "Distance",
        `Euclidean:4,${(65535 / radius).toFixed(2)}`,
        "-evaluate",
        "Pow",
        String(power),
        output,
      ]);
      return output;
    },
    math(name, inputs, expression) {
      const output = gray(name);
      magick([
        ...inputs.flatMap((input) => [input, "-colorspace", "Gray"]),
        "-fx",
        expression,
        output,
      ]);
      return output;
    },
    blur(name, input, sigma) {
      const output = gray(name);
      magick([input, "-blur", `0x${sigma}`, output]);
      return output;
    },
    compose(name, a, b, operator) {
      const output = gray(name);
      magick([a, b, "-compose", operator, "-composite", output]);
      return output;
    },
    levels(name, input, gain, bias) {
      const output = gray(name);
      magick([
        input,
        "-colorspace",
        "Gray",
        "-function",
        "Polynomial",
        `${gain},${bias}`,
        output,
      ]);
      return output;
    },
    write(maps) {
      const channel = (value: Channel) =>
        typeof value === "number"
          ? ["-size", `${width}x${height}`, `xc:gray(${value * 100}%)`]
          : [value, "-colorspace", "Gray", "-resize", `${width}x${height}!`];
      // Lossless WebP: exact values, a third smaller than PNG.
      const pack = (name: string, channels: Channel[]) => {
        const file = path.join(out, `${name}.webp`);
        const parts = [...channels];
        while (parts.length < 3) parts.push(1);
        magick([
          ...parts.flatMap(channel),
          "-combine",
          "-colorspace",
          "sRGB",
          "-type",
          "TrueColor",
          "-strip",
          "-define",
          "webp:lossless=true",
          "-define",
          "webp:exact=true",
          file,
        ]);
        return `${name}.webp`;
      };
      const scene = JSON.parse(
        readFileSync(path.join(dir, "scene.json"), "utf8"),
      );
      scene.maps = { depth: pack("depth", maps.depth) };
      if (maps.materials)
        scene.maps.materials = pack("materials", maps.materials);
      if (maps.life) scene.maps.life = pack("life", maps.life);
      writeFileSync(
        path.join(out, "scene.json"),
        `${JSON.stringify(scene, null, 2)}\n`,
      );
      // A bundled scene carries its cover, made as the app makes covers.
      if (out !== dir) {
        magick([
          `${source}[0]`,
          "-resize",
          `${width}x${height}!`,
          "-strip",
          "-quality",
          "80",
          path.join(out, "cover.webp"),
        ]);
      }
      writePreview(kit, out, maps);
    },
  };

  const recipe = await import(path.join(dir, "recipe.ts"));
  await recipe.default(kit);
  console.log(`Wrote ${out}`);
}

/** The cover with a pixel grid, for placing shapes by eye. */
function writeGrid(
  cover: string,
  output: string,
  width: number,
  height: number,
) {
  const draw: string[] = [];
  for (let x = 0; x <= width; x += 20) {
    const strong = x % 100 === 0;
    draw.push(
      "-stroke",
      strong ? "rgba(255,0,80,0.8)" : "rgba(0,255,255,0.35)",
      "-draw",
      `line ${x},0 ${x},${height}`,
    );
  }
  for (let y = 0; y <= height; y += 20) {
    const strong = y % 100 === 0;
    draw.push(
      "-stroke",
      strong ? "rgba(255,0,80,0.8)" : "rgba(0,255,255,0.35)",
      "-draw",
      `line 0,${y} ${width},${y}`,
    );
  }
  const labels: string[] = [
    "-stroke",
    "none",
    "-fill",
    "yellow",
    "-pointsize",
    "11",
  ];
  for (let x = 0; x <= width; x += 100)
    for (let y = 0; y <= height; y += 100)
      labels.push("-draw", `text ${x + 2},${y + 11} '${x},${y}'`);
  magick([
    cover,
    "-resize",
    "200%",
    "-scale",
    "50%",
    ...draw,
    ...labels,
    output,
  ]);
}

function writePreview(
  kit: Kit,
  out: string,
  maps: Parameters<Kit["write"]>[0],
) {
  const { work, cover, width, height } = kit;
  const tile = (name: string) => path.join(work, `preview-${name}.png`);
  const depth = path.join(out, "depth.webp");
  // Depth: deep navy to warm white, with contour lines over the cover.
  magick([
    depth,
    "-channel",
    "R",
    "-separate",
    "+channel",
    "(",
    "-size",
    "1x256",
    "gradient:#0b0f2a-#f6efe2",
    ")",
    "-clut",
    tile("depth"),
  ]);
  magick([
    depth,
    "-channel",
    "R",
    "-separate",
    "+channel",
    "-posterize",
    "12",
    "-morphology",
    "EdgeOut",
    "Diamond:1",
    "-negate",
    "-transparent",
    "white",
    "-fill",
    "#ff2a6a",
    "-colorize",
    "100",
    tile("lines"),
  ]);
  magick([cover, tile("lines"), "-composite", tile("contours")]);
  // Relief: shaded as if lit from the upper left.
  magick([
    depth,
    "-channel",
    "G",
    "-separate",
    "+channel",
    "-shade",
    "135x40",
    "-auto-level",
    tile("relief"),
  ]);
  const overlay = (name: string, file: string, colors: string[]) => {
    const parts = colors.map((color, index) => [
      "(",
      file,
      "-channel",
      "RGB"[index]!,
      "-separate",
      "+channel",
      "-background",
      color,
      "-alpha",
      "shape",
      ")",
    ]);
    magick([
      cover,
      "-modulate",
      "35",
      ...parts.flat(),
      "-background",
      "none",
      "-flatten",
      tile(name),
    ]);
  };
  if (maps.materials)
    overlay("materials", path.join(out, "materials.webp"), [
      "#ffb52e",
      "#5ab4ff",
      "#ff4d2e",
    ]);
  if (maps.life)
    overlay("life", path.join(out, "life.webp"), [
      "#2e8bff",
      "#e8e8e8",
      "#ff3d9a",
    ]);
  const tiles: [string, string][] = [
    ["Cover", cover],
    ["Depth (parallax)", tile("depth")],
    ["Depth contours", tile("contours")],
    ["Relief (lighting)", tile("relief")],
  ];
  if (maps.materials) tiles.push(["Foil · gloss · glow", tile("materials")]);
  if (maps.life) tiles.push(["Shimmer · mist · pulse", tile("life")]);
  magick([
    "montage",
    ...tiles.flatMap(([label, file]) => ["-label", label, file]),
    "-tile",
    `${tiles.length}x1`,
    "-geometry",
    `${width}x${height}+8+8`,
    "-background",
    "#16161a",
    "-fill",
    "#e8e4dc",
    "-pointsize",
    "15",
    path.join(out === kit.dir ? work : kit.dir, "preview.png"),
  ]);
}

await main();
