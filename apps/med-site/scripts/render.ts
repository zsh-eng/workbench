// Renders the pages: src/index.html, and src/docs.html for each docs page
// (scripts/docs.ts). A page inlines its CSS and scripts; fonts and images are
// the only other requests.
//
// Template syntax. The markers are plain HTML, so a formatter keeps them.
//   {{key}}                          an escaped value from src/site.ts
//   {{page.key}}                     an escaped value of the page: title, description
//   {{asset:/path}}                  a URL for a file in public/ (hashed in a build)
//   {{inline:/path.svg}}             an SVG in public/, in place; its IDs get the
//                                    file's name, so two can share a page
//   <style data-inline="file">       the file's CSS, inline
//   <script data-inline="file">      the file's script, inline
//   <picture data-shot="name">       light and dark sources for a screenshot
//   <!-- include file -->            the file, rendered in place
//   <!-- slot name -->               the page's HTML for the slot, as it is
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { shots, type ShotName } from "../src/shots.ts";
import { site } from "../src/site.ts";
import { renderDocs } from "./docs.ts";

const root = join(import.meta.dir, "..");
export const publicDir = join(root, "public");

interface Screenshot {
  width: number;
  height: number;
  widths: number[];
}

export interface Rendered {
  /** Each page's file in dist/, such as index.html or docs/usage.html, to
   * its HTML. */
  pages: Map<string, string>;
  /** Hashed output path (no leading slash) to its source file. */
  assets: Map<string, string>;
}

interface Page {
  values: Record<string, string>;
  slots?: Record<string, string>;
}

function escape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function lookup(path: string, page: Page): string {
  let value: unknown = path.startsWith("page.") ? page.values : site;
  for (const key of path.replace(/^page\./, "").split(".")) {
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

  /** A hashed URL for any file; the dev server serves it from `assets`. */
  function hashed(source: string): string {
    const digest = createHash("sha256")
      .update(readFileSync(source))
      .digest("hex")
      .slice(0, 10);
    const ext = extname(source);
    const output = `assets/${basename(source, ext)}.${digest}${ext}`;
    assets.set(output, source);
    return `/${output}`;
  }

  function asset(path: string): string {
    return hash ? hashed(join(publicDir, path)) : path;
  }

  function picture(name: ShotName): string {
    const shot = shots[name];
    const data = screenshots[name];
    if (!data) throw new Error(`No screenshot named ${name}`);
    const file = (
      shotName: string,
      scheme: string,
      width: number,
      format: string,
    ) => asset(`/screenshots/${shotName}-${scheme}-${width}.${format}`);
    const set =
      (shotName: string, widths: number[]) =>
      (scheme: string, format: string) =>
        widths
          .map((w) => `${file(shotName, scheme, w, format)} ${w}w`)
          .join(", ");
    const srcset = set(name, data.widths);
    const sizes = escape(shot.sizes);
    const fallback = data.widths[Math.min(1, data.widths.length - 1)]!;
    const dark = "(prefers-color-scheme: dark)";
    const loading = shot.priority
      ? 'fetchpriority="high"'
      : 'loading="lazy" decoding="async"';
    // Phones show a capture of their own, where Med lays the part out again.
    const phone = screenshots[`${name}-phone`];
    const phoneSources: string[] = [];
    if (phone) {
      const narrow = "(max-width: 639px)";
      const phoneSet = set(`${name}-phone`, phone.widths);
      const box = `sizes="calc(100vw - 32px)" width="${phone.width}" height="${phone.height}"`;
      phoneSources.push(
        `<source media="${narrow} and ${dark}" type="image/avif" srcset="${phoneSet("dark", "avif")}" ${box}>`,
        `<source media="${narrow} and ${dark}" type="image/webp" srcset="${phoneSet("dark", "webp")}" ${box}>`,
        `<source media="${narrow}" type="image/avif" srcset="${phoneSet("light", "avif")}" ${box}>`,
        `<source media="${narrow}" type="image/webp" srcset="${phoneSet("light", "webp")}" ${box}>`,
      );
    }
    return [
      "<picture>",
      ...phoneSources,
      `<source media="${dark}" type="image/avif" srcset="${srcset("dark", "avif")}" sizes="${sizes}">`,
      `<source media="${dark}" type="image/webp" srcset="${srcset("dark", "webp")}" sizes="${sizes}">`,
      `<source type="image/avif" srcset="${srcset("light", "avif")}" sizes="${sizes}">`,
      `<img src="${file(name, "light", fallback, "webp")}" srcset="${srcset("light", "webp")}" sizes="${sizes}" width="${data.width}" height="${data.height}" alt="${escape(shot.alt)}" ${loading}>`,
      "</picture>",
    ].join("\n");
  }

  const fill = (text: string, page: Page): string =>
    text
      .replace(/<!-- include (\S+) -->/g, (_, file: string) =>
        fill(read(file), page).trim(),
      )
      .replace(
        /<(style|script) data-inline="([^"]+)">\s*<\/\1>/g,
        (_, tag: string, file: string) =>
          `<${tag}>\n${fill(read(file), page).trim()}\n</${tag}>`,
      )
      .replace(/<picture data-shot="(\w+)">\s*<\/picture>/g, (_, name) =>
        picture(name as ShotName),
      )
      .replace(/\{\{inline:([^}]+)\}\}/g, (_, path: string) => {
        const name = basename(path, extname(path));
        return readFileSync(join(publicDir, path), "utf8")
          .trim()
          .replace(/ id="([^"]+)"/g, ` id="${name}-$1"`)
          .replace(/url\(#([^)]+)\)/g, `url(#${name}-$1)`);
      })
      .replace(/\{\{asset:([^}]+)\}\}/g, (_, path: string) => asset(path))
      .replace(/\{\{([\w.]+)\}\}/g, (_, key: string) =>
        escape(lookup(key, page)),
      );
  // Slots go in last, so their HTML is not read as template markers.
  const renderPage = (file: string, page: Page) =>
    fill(read(file), page).replace(
      /<!-- slot (\w+) -->/g,
      (_, name: string) => page.slots?.[name] ?? "",
    );

  const pages = new Map([
    [
      "index.html",
      renderPage("src/index.html", {
        values: { title: site.title, description: site.description },
      }),
    ],
  ]);
  for (const doc of renderDocs(hashed))
    pages.set(
      doc.output,
      renderPage("src/docs.html", {
        values: { title: doc.title, description: doc.description },
        slots: doc.slots,
      }),
    );
  return { pages, assets };
}
