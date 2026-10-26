/**
 * Reader's launch screens: the images iOS shows while an app opened from
 * the Home Screen starts (`apple-touch-startup-image`). Without one, iOS
 * shows a blank screen until the page paints.
 *
 * The Library's first paint is its page colour alone: it stays hidden
 * until its books, covers and fonts are ready, then shows at once. So each
 * image is that colour and nothing else, and launch flows into the Library
 * with no mark to vanish first. Light and dark come from `--background` in
 * src/index.css.
 *
 * iOS picks an image by an exact media query (device size, pixel ratio,
 * orientation, colour scheme), so each device size needs its own. The
 * images are 1-bit PNGs of a few hundred bytes. They are written to
 * public/launch/, which the service worker does not precache: iOS fetches
 * the one it needs once, when the app is added to the Home Screen.
 *
 *   bun scripts/launch-screens.ts         writes public/launch/ (dev, build)
 *   bun scripts/launch-screens.ts --html  also rewrites index.html's links
 */
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";

/** A screen in portrait, in CSS pixels, as Safari's media queries see it. */
export interface LaunchDevice {
  devices: string;
  width: number;
  height: number;
  scale: number;
}

/**
 * Every iPhone and iPad screen that runs iOS or iPadOS 26 and later, read
 * from Xcode's simulator device types. The 12 and 13 mini report the 11
 * Pro's 375 × 812 to Safari.
 */
export const LAUNCH_DEVICES: LaunchDevice[] = [
  {
    devices: "iPhone 16, 17 and 18 Pro Max",
    width: 440,
    height: 956,
    scale: 3,
  },
  { devices: "iPhone Air", width: 420, height: 912, scale: 3 },
  {
    devices: "iPhone 14 Pro Max, 15 Plus and Pro Max, 16 Plus",
    width: 430,
    height: 932,
    scale: 3,
  },
  {
    devices: "iPhone 16 Pro, 17, 17 Pro, 18 Pro",
    width: 402,
    height: 874,
    scale: 3,
  },
  {
    devices: "iPhone 14 Pro, 15, 15 Pro, 16",
    width: 393,
    height: 852,
    scale: 3,
  },
  {
    devices: "iPhone 12 and 13 Pro Max, 14 Plus",
    width: 428,
    height: 926,
    scale: 3,
  },
  { devices: "iPhone 12, 13, 14, 16e, 17e", width: 390, height: 844, scale: 3 },
  {
    devices: "iPhone 11 Pro, 12 mini, 13 mini",
    width: 375,
    height: 812,
    scale: 3,
  },
  { devices: "iPhone 11 Pro Max", width: 414, height: 896, scale: 3 },
  { devices: "iPhone 11", width: 414, height: 896, scale: 2 },
  {
    devices: "iPhone SE (2nd and 3rd generation)",
    width: 375,
    height: 667,
    scale: 2,
  },
  { devices: "iPad Pro 13-inch (M4, M5)", width: 1032, height: 1376, scale: 2 },
  {
    devices: "iPad Pro 12.9-inch, iPad Air 13-inch",
    width: 1024,
    height: 1366,
    scale: 2,
  },
  { devices: "iPad Pro 11-inch (M4, M5)", width: 834, height: 1210, scale: 2 },
  {
    devices: "iPad Pro 11-inch (1st to 4th generation)",
    width: 834,
    height: 1194,
    scale: 2,
  },
  {
    devices: "iPad Air 11-inch, iPad (10th generation, A16)",
    width: 820,
    height: 1180,
    scale: 2,
  },
  {
    devices: "iPad Air (3rd generation), iPad Pro 10.5-inch",
    width: 834,
    height: 1112,
    scale: 2,
  },
  {
    devices: "iPad (8th and 9th generation)",
    width: 810,
    height: 1080,
    scale: 2,
  },
  {
    devices: "iPad mini (6th generation, A17 Pro)",
    width: 744,
    height: 1133,
    scale: 2,
  },
  { devices: "iPad mini (5th generation)", width: 768, height: 1024, scale: 2 },
];

export type LaunchScheme = "light" | "dark";
export type LaunchOrientation = "portrait" | "landscape";

export interface LaunchScreen {
  device: LaunchDevice;
  scheme: LaunchScheme;
  orientation: LaunchOrientation;
  /** Path under public/, as index.html links it. */
  href: string;
  media: string;
  /** Pixel size in this orientation. */
  pixelWidth: number;
  pixelHeight: number;
  colour: string;
}

const APP_ROOT = join(import.meta.dirname, "..");
export const LAUNCH_DIR = join(APP_ROOT, "public", "launch");
const INDEX_HTML = join(APP_ROOT, "index.html");
const START = "<!-- launch-screens:start -->";
const END = "<!-- launch-screens:end -->";

/** `--background` for light (`:root, .light`) and `.dark` in index.css. */
export function pageColours(
  css = readFileSync(join(APP_ROOT, "src", "index.css"), "utf8"),
): Record<LaunchScheme, string> {
  const background = (block: RegExp) => {
    const body = block.exec(css)?.[1];
    const value = body && /--background:\s*([^;]+);/.exec(body)?.[1];
    if (!value) throw new Error(`No --background in ${block}`);
    return cssColourToHex(value.trim());
  };
  return {
    light: background(/:root,\s*\.light\s*\{([^}]*)\}/),
    dark: background(/\n\.dark\s*\{([^}]*)\}/),
  };
}

/** Converts `#rrggbb` or `oklch(L C H)`, the forms index.css uses, to hex. */
export function cssColourToHex(value: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const match = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/.exec(value);
  if (!match) throw new Error(`Unsupported colour: ${value}`);
  const [lightness, chroma, hue] = match.slice(1).map(Number) as [
    number,
    number,
    number,
  ];
  const a = chroma * Math.cos((hue * Math.PI) / 180);
  const b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${linear
    .map((channel) => {
      const encoded =
        channel <= 0.0031308
          ? 12.92 * channel
          : 1.055 * channel ** (1 / 2.4) - 0.055;
      const byte = Math.round(Math.min(1, Math.max(0, encoded)) * 255);
      return byte.toString(16).padStart(2, "0");
    })
    .join("")}`;
}

export function launchScreens(colours = pageColours()): LaunchScreen[] {
  return LAUNCH_DEVICES.flatMap((device) =>
    (["light", "dark"] as const).flatMap((scheme) =>
      (["portrait", "landscape"] as const).map((orientation) => {
        const portrait = orientation === "portrait";
        const pixelWidth =
          (portrait ? device.width : device.height) * device.scale;
        const pixelHeight =
          (portrait ? device.height : device.width) * device.scale;
        return {
          device,
          scheme,
          orientation,
          href: `/launch/${scheme}-${pixelWidth}x${pixelHeight}.png`,
          // iOS keeps device-width and device-height in portrait terms.
          media: `(device-width: ${device.width}px) and (device-height: ${device.height}px) and (-webkit-device-pixel-ratio: ${device.scale}) and (orientation: ${orientation}) and (prefers-color-scheme: ${scheme})`,
          pixelWidth,
          pixelHeight,
          colour: colours[scheme],
        };
      }),
    ),
  );
}

/** The `<link>` block for index.html, laid out as the formatter lays it out. */
export function launchLinks(screens = launchScreens()): string {
  return [
    START,
    "    <!-- Written by scripts/launch-screens.ts --html; src/lib/launch-screens.ts keeps the ones for this appearance. -->",
    ...screens.map((screen) =>
      [
        "    <link",
        '      rel="apple-touch-startup-image"',
        `      data-scheme="${screen.scheme}"`,
        `      href="${screen.href}"`,
        `      media="${screen.media}"`,
        "    />",
      ].join("\n"),
    ),
    `    ${END}`,
  ].join("\n");
}

/** The links in index.html as written, for the check and for `--html`. */
export function indexLaunchLinks(
  html = readFileSync(INDEX_HTML, "utf8"),
): string | null {
  const start = html.indexOf(START);
  const end = html.indexOf(END);
  if (start < 0 || end < 0) return null;
  return html.slice(start, end + END.length);
}

/** A one-colour PNG: one bit a pixel, so a whole screen is a few hundred bytes. */
export function solidPng(
  width: number,
  height: number,
  colour: string,
): Uint8Array {
  const rowBytes = 1 + Math.ceil(width / 8);
  // Every row is filter 0 and palette entry 0.
  const pixels = deflateSync(new Uint8Array(rowBytes * height), { level: 9 });
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header.set([1, 3, 0, 0, 0], 8); // bit depth 1, indexed colour
  const palette = Uint8Array.from(
    [1, 3, 5].map((offset) => parseInt(colour.slice(offset, offset + 2), 16)),
  );
  return concat([
    Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("PLTE", palette),
    chunk("IDAT", pixels),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typed = concat([new TextEncoder().encode(type), data]);
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(typed, 4);
  view.setUint32(8 + data.length, crc32(typed));
  return out;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(
    parts.reduce((total, part) => total + part.length, 0),
  );
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function writeImages(screens: LaunchScreen[]): void {
  mkdirSync(LAUNCH_DIR, { recursive: true });
  const wanted = new Set(
    screens.map((screen) => screen.href.split("/").pop()!),
  );
  for (const file of readdirSync(LAUNCH_DIR))
    if (!wanted.has(file)) rmSync(join(LAUNCH_DIR, file));
  for (const screen of screens)
    writeFileSync(
      join(LAUNCH_DIR, screen.href.split("/").pop()!),
      solidPng(screen.pixelWidth, screen.pixelHeight, screen.colour),
    );
}

function writeHtml(screens: LaunchScreen[]): void {
  const html = readFileSync(INDEX_HTML, "utf8");
  const current = indexLaunchLinks(html);
  if (!current) throw new Error(`index.html needs ${START} and ${END}`);
  writeFileSync(
    INDEX_HTML,
    html.replace(current, launchLinks(screens).trimStart()),
  );
}

if (import.meta.main) {
  const screens = launchScreens();
  writeImages(screens);
  if (process.argv.includes("--html")) writeHtml(screens);
  else if (indexLaunchLinks() !== launchLinks(screens).trimStart())
    console.warn(
      "index.html's launch screen links are stale: run bun scripts/launch-screens.ts --html",
    );
}
