import type { Article } from "./articles";
import { cleanArticle } from "./content";
import type { Session } from "./sync/session";

/**
 * An article's cleaned text. `withoutLead` is set when the text starts with
 * the article's cover image: it is the same text without that image.
 */
export type Text =
  | { file: string; html: string; withoutLead?: string }
  | { file: string; error: string };

const pending = new Map<string, Promise<Text>>();
const settled = new Map<string, Text>();
// Cleaned texts are a few hundred kilobytes at most; two dozen cover a
// session of opening, returning, and prefetching what is on screen.
const KEEP = 24;
// The image objects stay referenced, so their decoded pictures stay in memory.
const images = new Map<string, { image: HTMLImageElement; decoded: Promise<void> }>();

const keyOf = (article: Article) =>
  `${article.id} ${article.copy?.file} ${article.image ?? ""}`;

/** Reads and cleans the text once; the last few stay ready for Back and Forward. */
export function articleText(session: Session, article: Article) {
  const file = article.copy?.file;
  if (!file) return Promise.resolve(undefined);
  const key = keyOf(article);
  let work = pending.get(key);
  if (!work) {
    work = session.readFile(file).then(
      (html): Text => {
        const doc = new DOMParser().parseFromString(
          cleanArticle(html, article.url),
          "text/html",
        );
        const lead = article.image && leadImage(doc.body, article.image);
        if (!lead) return { file, html: doc.body.innerHTML };
        lead.setAttribute("data-lead", "");
        lead.removeAttribute("loading");
        const full = doc.body.innerHTML;
        (lead.closest("figure") ?? lead).remove();
        return { file, html: full, withoutLead: doc.body.innerHTML };
      },
      (): Text => ({
        file,
        error: "The text could not load. Check your connection.",
      }),
    );
    pending.set(key, work);
    void work.then((text) => {
      settled.set(key, text);
      if ("error" in text) pending.delete(key);
      for (const old of [...pending.keys()].slice(0, -KEEP)) {
        pending.delete(old);
        settled.delete(old);
      }
    });
  }
  return work;
}

/**
 * Reads, cleans, and decodes ahead of a likely open, so the page appears with
 * its text and cover in the first frame. A pointer that rests on a card, a
 * touch that starts on it, or a card on screen while the browser is idle all
 * start it; a second start is free.
 */
export function prefetch(session: Session, article: Article) {
  if (article.copy && !pending.has(keyOf(article)))
    void articleText(session, article);
  if (article.image && !images.has(article.image)) {
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.src = article.image;
    images.set(article.image, { image, decoded: image.decode().catch(() => {}) });
    for (const old of [...images.keys()].slice(0, -KEEP)) images.delete(old);
  }
}

/**
 * What idle time may prefetch: the texts this browser keeps, and the first
 * few on screen from the network, as the phone preloads its visible rows.
 * With Save-Data on, the network waits for a sign of intent.
 */
export async function idlePrefetchable(session: Session, articles: Article[]) {
  const saveData =
    (navigator as Navigator & { connection?: { saveData?: boolean } })
      .connection?.saveData === true;
  const kept = await session.keptFiles();
  let fetched = 0;
  return articles.filter(
    (article) =>
      !article.copy ||
      kept.has(article.copy.file) ||
      pending.has(keyOf(article)) ||
      (!saveData && fetched++ < 6),
  );
}

/**
 * Whether a loaded image can be a cover: a blank spacer (WordPress's
 * blank.jpg) or a site icon is too small to fill one.
 */
export const isCover = (image: HTMLImageElement) => image.naturalWidth >= 300;

/** Waits for a prefetched cover to decode, so a page change shows it whole. */
export function decodedImage(src: string | undefined) {
  return (src && images.get(src)?.decoded) || Promise.resolve();
}

/** The text when it is ready now, so the first render can place the cover. */
export function readyText(article: Article) {
  return settled.get(keyOf(article));
}

/**
 * The first images of the text, when one is the cover image near the start.
 * Substack's cover is often a generated quote card; the text's own first
 * image replaces it.
 */
function leadImage(body: HTMLElement, cover: string) {
  const images = [...body.querySelectorAll("img")].slice(0, 2);
  const lead = images.find((image, index) => {
    const src = image.getAttribute("src") ?? "";
    return (
      sameImage(src, cover) ||
      (index === 0 && cover.includes("post_selection_image"))
    );
  });
  if (!lead) return null;
  const before = body.ownerDocument.createRange();
  before.setStart(body, 0);
  before.setEndBefore(lead.closest("figure") ?? lead);
  return before.toString().trim().length > 400 ? null : lead;
}

/**
 * Whether two image URLs name one picture: image proxies are unwrapped and
 * size variants (`-1024x768`, `-scaled`, `.fill-1200x600`) are ignored.
 */
export function sameImage(a: string, b: string) {
  const x = imageName(a);
  const y = imageName(b);
  if (!x || !y) return false;
  if (x.path === y.path) return true;
  const [short, long] =
    x.stem.length <= y.stem.length ? [x.stem, y.stem] : [y.stem, x.stem];
  // A plain name such as "cover" or "hero" counts only on the same path.
  if (short.length < 8 && !/\d/.test(short)) return false;
  if (long.includes(short)) return true;
  let common = 0;
  while (common < short.length && short[common] === long[common]) common++;
  // A numbered series, such as figure_1 and figure_3, holds different images.
  if (/^\d+$/.test(short.slice(common)) && /^\d+$/.test(long.slice(common)))
    return false;
  return common >= 12 && common >= short.length * 0.75;
}

function imageName(src: string) {
  let url: URL;
  try {
    url = new URL(src);
  } catch {
    return null;
  }
  // Next.js and Vercel pass the image as ?url=; Substack and Cloudinary put
  // the encoded address in the path.
  for (let depth = 0; depth < 3; depth++) {
    const inner =
      url.searchParams.get("url") ??
      decode(url.pathname).match(/https?:\/\/.*/)?.[0];
    if (!inner) break;
    try {
      url = new URL(inner, url);
    } catch {
      break;
    }
  }
  const path = decode(url.pathname)
    .replace(/^\/cdn-cgi\/image\/[^/]+/, "")
    .toLowerCase();
  let stem = (path.split("/").pop() ?? "").replace(
    /\.(jpe?g|png|webp|avif|gif|svg)$/,
    "",
  );
  for (let previous = ""; previous !== stem; ) {
    previous = stem;
    stem = stem.replace(
      /[-_.](\d+x\d+|scaled|original|fill-\d+x\d+|[0-9a-f]{8})$/,
      "",
    );
  }
  if (!stem) return null;
  return { path: path.replace(/[^/]*$/, stem), stem };
}

function decode(value: string) {
  for (let step = 0; step < 3; step++) {
    try {
      const next = decodeURIComponent(value);
      if (next === value) break;
      value = next;
    } catch {
      break;
    }
  }
  return value;
}
