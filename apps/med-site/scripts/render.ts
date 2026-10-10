// Renders src/index.html. The page inlines its CSS and scripts; fonts and
// screenshots are the only other requests.
//
// Template syntax. The markers are plain HTML, so a formatter keeps them.
//   {{key}}                          an escaped value from src/site.ts
//   {{asset:/path}}                  a URL for a file in public/ (hashed in a build)
//   <style data-inline="file">       the file's CSS, inline
//   <script data-inline="file">      the file's script, inline
//   <picture data-shot="name">       light and dark sources for a screenshot
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { shots, type ShotName } from "../src/shots.ts";
import { site } from "../src/site.ts";

const root = join(import.meta.dir, "..");
export const publicDir = join(root, "public");

interface Screenshot {
  width: number;
  height: number;
  widths: number[];
}

export interface Rendered {
  html: string;
  /** Hashed output path (no leading slash) to its source in public/. */
  assets: Map<string, string>;
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function lookup(path: string): string {
  let value: unknown = site;
  for (const key of path.split(".")) {
    value = (value as Record<string, unknown> | undefined)?.[key];
  }
  if (typeof value !== "string") throw new Error(`No string at site.${path}`);
  return value;
}

export function render({ hash }: { hash: boolean }): Rendered {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const screenshots = JSON.parse(read("src/screenshots.json")) as Record<
    string,
    Screenshot
  >;
  const assets = new Map<string, string>();

  function asset(path: string): string {
    if (!hash) return path;
    const source = join(publicDir, path);
    const digest = createHash("sha256")
      .update(readFileSync(source))
      .digest("hex")
      .slice(0, 10);
    const ext = extname(path);
    const output = `assets/${basename(path, ext)}.${digest}${ext}`;
    assets.set(output, source);
    return `/${output}`;
  }

  function picture(name: ShotName): string {
    const shot = shots[name];
    const data = screenshots[name];
    if (!data) throw new Error(`No screenshot named ${name}`);
    const file = (scheme: string, width: number, format: string) =>
      asset(`/screenshots/${name}-${scheme}-${width}.${format}`);
    const srcset = (scheme: string, format: string) =>
      data.widths.map((w) => `${file(scheme, w, format)} ${w}w`).join(", ");
    const sizes = escape(shot.sizes);
    const fallback = data.widths[Math.min(1, data.widths.length - 1)]!;
    const dark = "(prefers-color-scheme: dark)";
    const loading = shot.priority
      ? 'fetchpriority="high"'
      : 'loading="lazy" decoding="async"';
    return [
      "<picture>",
      `<source media="${dark}" type="image/avif" srcset="${srcset("dark", "avif")}" sizes="${sizes}">`,
      `<source media="${dark}" type="image/webp" srcset="${srcset("dark", "webp")}" sizes="${sizes}">`,
      `<source type="image/avif" srcset="${srcset("light", "avif")}" sizes="${sizes}">`,
      `<img src="${file("light", fallback, "webp")}" srcset="${srcset("light", "webp")}" sizes="${sizes}" width="${data.width}" height="${data.height}" alt="${escape(shot.alt)}" ${loading}>`,
      "</picture>",
    ].join("\n");
  }

  const fill = (text: string): string =>
    text
      .replace(
        /<(style|script) data-inline="([^"]+)">\s*<\/\1>/g,
        (_, tag: string, file: string) =>
          `<${tag}>\n${fill(read(file)).trim()}\n</${tag}>`,
      )
      .replace(/<picture data-shot="(\w+)">\s*<\/picture>/g, (_, name) =>
        picture(name as ShotName),
      )
      .replace(/\{\{asset:([^}]+)\}\}/g, (_, path: string) => asset(path))
      .replace(/\{\{([\w.]+)\}\}/g, (_, key: string) => escape(lookup(key)));

  return { html: fill(read("src/index.html")), assets };
}
